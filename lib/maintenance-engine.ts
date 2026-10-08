/**
 * Maintenance engine — the same behaviour as Beta's maintenance system:
 *  - every task occurrence has its own 6-character code (e.g. CD9B91)
 *  - recurring tasks (daily / weekly / monthly / seasonal / every X hours)
 *    create the next occurrence when one is finished, or when it is missed
 *    at the end of its day ("rolled forward")
 *  - unassigned occurrences go to the available staff member with the
 *    lightest workload when their reminder is due
 *  - reminders: at the due time, then hourly; after 3 unanswered reminders
 *    the task is flagged "Need attention"
 *  - pacing: staff never get two new reminders within 45 minutes; weekly
 *    days off, days-off ranges and quiet hours are respected (urgent tasks
 *    ignore quiet hours and pacing)
 *  - staff reply "CODE TERMINADO / ACEPTO / AYUDA" or tap the buttons
 */
import { notifyStaff } from './escalation'
import { findEscalationContact, parseEscalationContacts } from './escalation-contacts'
import { createServiceClient } from './supabase/service'
import type { EncryptedPayload } from './crypto'
import { sendWhatsAppButtons, sendWhatsAppMessage } from './whatsapp-send'
import {
  getMaintenanceTemplate,
  resolveTemplateChoice,
  sendMaintenanceTemplate,
  type TemplateChoice,
} from './maintenance-template'
import { addLocalDays, addLocalMonths, fromZoned, hhmmToMinutes, localDate, zonedParts } from './tz'

type DB = ReturnType<typeof createServiceClient>

export const ACTIVE_STATUSES = ['scheduled', 'waiting', 'in_progress'] as const
const FOLLOW_UP_MINUTES = 60
const ACCEPTED_FOLLOW_UP_MINUTES = 120
const PACING_MINUTES = 45
const MAX_REMINDERS = 3

export interface TaskRow {
  id: string
  tenant_id: string
  task_code: string
  title: string
  description: string | null
  location: string | null
  priority: 'routine' | 'urgent'
  status: string
  assigned_to: string | null
  lock_assignee: boolean
  due_at: string | null
  recurrence_rule: string
  interval_hours: number | null
  interval_window_start: string | null
  interval_window_end: string | null
  season_start_month: number | null
  season_end_month: number | null
  season_lead_days: number
  season_within_frequency: string | null
  parent_task_id: string | null
  series_due_at: string | null
  carried_over_count: number
  next_spawned: boolean
  reminder_count: number
  last_reminded_at: string | null
  escalation_status: string
  created_by: string | null
  next_task_id?: string | null
  next_delay_minutes?: number | null
  next_assign?: string | null
  paused?: boolean
  carry_over?: boolean
}

/**
 * Tasks that carry over: they never reset at midnight and stay open (day after
 * day) until finished. That is every task with a follow-up, every follow-up task
 * (created with carry_over on), and any task whose "Carry over until finished"
 * switch is on.
 */
export function isCarryOver(task: Pick<TaskRow, 'carry_over' | 'next_task_id'>): boolean {
  return Boolean(task.carry_over) || Boolean(task.next_task_id)
}

export interface StaffRow {
  id: string
  name: string
  phone: string
  active: boolean
  language: string
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  weekly_days_off: number[] | null
  unavailable_from: string | null
  unavailable_until: string | null
}

export interface EngineContext {
  db: DB
  tenantId: string
  tz: string
  whatsapp: { phoneNumberId: string; credentials: EncryptedPayload; wabaId?: string } | null
  choice: TemplateChoice
  templateApproved?: boolean
}

// ---------------------------------------------------------------------------
// Context & small helpers
// ---------------------------------------------------------------------------

export async function loadEngineContext(tenantId: string, db: DB = createServiceClient()): Promise<EngineContext> {
  const [{ data: tenant }, { data: wa }] = await Promise.all([
    db.from('tenants').select('timezone, maintenance_template').eq('id', tenantId).single(),
    db
      .from('tenant_integrations')
      .select('status, credentials, config')
      .eq('tenant_id', tenantId)
      .eq('integration_type', 'whatsapp')
      .maybeSingle(),
  ])
  const cfg = (wa?.config ?? {}) as { phone_number_id?: string; waba_id?: string }
  return {
    db,
    tenantId,
    tz: (tenant?.timezone as string) || 'America/Mexico_City',
    whatsapp:
      wa?.status === 'connected' && wa.credentials && cfg.phone_number_id
        ? { phoneNumberId: cfg.phone_number_id, credentials: wa.credentials as EncryptedPayload, wabaId: cfg.waba_id }
        : null,
    choice: resolveTemplateChoice(tenant?.maintenance_template),
  }
}

async function templateReady(ctx: EngineContext): Promise<boolean> {
  if (ctx.templateApproved !== undefined) return ctx.templateApproved
  if (!ctx.whatsapp?.wabaId) return (ctx.templateApproved = false)
  try {
    const info = await getMaintenanceTemplate(ctx.whatsapp.wabaId, ctx.whatsapp.credentials, ctx.choice)
    ctx.templateApproved = info.exists && info.status === 'APPROVED'
  } catch {
    ctx.templateApproved = false
  }
  return ctx.templateApproved
}

export function newTaskCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

export async function logEvent(ctx: EngineContext, taskId: string, type: string, detail: string, metadata?: object) {
  await ctx.db.from('maintenance_task_events').insert({
    tenant_id: ctx.tenantId,
    task_id: taskId,
    event_type: type,
    detail,
    metadata: metadata ?? null,
  })
}

async function cancelPendingReminders(ctx: EngineContext, taskId: string) {
  await ctx.db
    .from('maintenance_reminders')
    .update({ status: 'cancelled' })
    .eq('task_id', taskId)
    .eq('status', 'pending')
}

export type ReminderKind = 'standard' | 'morning_check'

export async function scheduleReminder(ctx: EngineContext, taskId: string, at: Date, kind: ReminderKind = 'standard') {
  await ctx.db.from('maintenance_reminders').insert({
    tenant_id: ctx.tenantId,
    task_id: taskId,
    scheduled_for: at.toISOString(),
    kind,
  })
}

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60000)

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

function inSeason(month: number, start: number, end: number): boolean {
  return start <= end ? month >= start && month <= end : month >= start || month <= end
}

export function stepOnce(task: TaskRow, from: Date, tz: string): Date | null {
  switch (task.recurrence_rule) {
    case 'daily':
      return addLocalDays(from, 1, tz)
    case 'weekly':
      return addLocalDays(from, 7, tz)
    case 'monthly':
      return addLocalMonths(from, 1, tz)
    case 'interval': {
      const hours = Math.max(1, task.interval_hours ?? 1)
      const candidate = new Date(from.getTime() + hours * 3600000)
      const start = hhmmToMinutes(task.interval_window_start)
      const end = hhmmToMinutes(task.interval_window_end)
      if (start === null || end === null) return candidate
      const p = zonedParts(candidate, tz)
      const mins = p.hour * 60 + p.minute
      const sameDay = localDate(candidate, tz) === localDate(from, tz)
      if (sameDay && mins >= start && mins < end) return candidate // end is exclusive, like Beta
      if (sameDay && mins < start) return fromZoned(p.year, p.month, p.day, Math.floor(start / 60), start % 60, tz)
      // Past the window: first slot the next morning.
      const f = zonedParts(from, tz)
      const next = new Date(Date.UTC(f.year, f.month - 1, f.day + 1))
      return fromZoned(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), Math.floor(start / 60), start % 60, tz)
    }
    case 'seasonal': {
      const start = task.season_start_month ?? 1
      const end = task.season_end_month ?? 12
      const step =
        task.season_within_frequency === 'weekly'
          ? addLocalDays(from, 7, tz)
          : task.season_within_frequency === 'monthly'
            ? addLocalMonths(from, 1, tz)
            : addLocalMonths(from, 12, tz)
      const sp = zonedParts(step, tz)
      if (task.season_within_frequency && inSeason(sp.month, start, end)) return step
      // Next season: the start month's first day, minus the lead days.
      const fp = zonedParts(from, tz)
      let year = fp.year
      let seasonStart = fromZoned(year, start, 1, fp.hour, fp.minute, tz)
      while (seasonStart.getTime() <= from.getTime()) {
        year += 1
        seasonStart = fromZoned(year, start, 1, fp.hour, fp.minute, tz)
      }
      return addLocalDays(seasonStart, -(task.season_lead_days || 0), tz)
    }
    default:
      return null
  }
}

/** The next occurrence after this one, never in the past. */
export function nextOccurrence(task: TaskRow, tz: string): Date | null {
  const base = task.series_due_at ?? task.due_at
  if (!base || task.recurrence_rule === 'none') return null
  let next = stepOnce(task, new Date(base), tz)
  let guard = 0
  while (next && next.getTime() <= Date.now() && guard++ < 500) next = stepOnce(task, next, tz)
  return next
}

export async function spawnNext(ctx: EngineContext, task: TaskRow): Promise<string | null> {
  if (task.next_spawned || task.recurrence_rule === 'none') return null
  const next = nextOccurrence(task, ctx.tz)
  if (!next) return null

  // Claim the spawn first so two runs can't both create the next occurrence.
  const { data: claimed } = await ctx.db
    .from('maintenance_tasks')
    .update({ next_spawned: true })
    .eq('id', task.id)
    .eq('next_spawned', false)
    .select('id')
  if (!claimed?.length) return null

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: created, error } = await ctx.db
      .from('maintenance_tasks')
      .insert({
        tenant_id: task.tenant_id,
        task_code: newTaskCode(),
        title: task.title,
        description: task.description,
        location: task.location,
        priority: task.priority,
        status: 'scheduled',
        assigned_to: task.lock_assignee ? task.assigned_to : null,
        lock_assignee: task.lock_assignee,
        due_at: next.toISOString(),
        recurrence_rule: task.recurrence_rule,
        interval_hours: task.interval_hours,
        interval_window_start: task.interval_window_start,
        interval_window_end: task.interval_window_end,
        season_start_month: task.season_start_month,
        season_end_month: task.season_end_month,
        season_lead_days: task.season_lead_days,
        season_within_frequency: task.season_within_frequency,
        parent_task_id: task.parent_task_id ?? task.id,
        created_by: task.created_by,
        next_task_id: task.next_task_id ?? null,
        next_delay_minutes: task.next_delay_minutes ?? 0,
        next_assign: task.next_assign ?? 'finisher',
        carry_over: task.carry_over ?? false,
      })
      .select('id')
      .single()
    if (error?.code === '23505') continue // task code clash — try another
    if (error || !created) return null
    await scheduleReminder(ctx, created.id as string, next)
    await logEvent(
      ctx,
      created.id as string,
      'recurrence_created',
      task.lock_assignee
        ? `Created from recurring task ${task.id}; kept with the same staff member`
        : `Created from recurring task ${task.id}; released to the staff pool for reassignment`
    )
    return created.id as string
  }
  return null
}

// ---------------------------------------------------------------------------
// Staff availability & assignment
// ---------------------------------------------------------------------------

function offToday(staff: StaffRow, tz: string, at = new Date()): 'weekly' | 'range' | null {
  const p = zonedParts(at, tz)
  if ((staff.weekly_days_off ?? []).includes(p.weekday)) return 'weekly'
  const today = localDate(at, tz)
  if (staff.unavailable_from && staff.unavailable_until && today >= staff.unavailable_from && today <= staff.unavailable_until) {
    return 'range'
  }
  return null
}

function inQuietHours(staff: StaffRow, tz: string, at = new Date()): boolean {
  const s = hhmmToMinutes(staff.quiet_hours_start)
  const e = hhmmToMinutes(staff.quiet_hours_end)
  if (s === null || e === null || s === e) return false
  const p = zonedParts(at, tz)
  const m = p.hour * 60 + p.minute
  return s < e ? m >= s && m < e : m >= s || m < e
}

/** Next local occurrence of the staff member's quiet-hours end (their "morning"). */
function nextMorning(staff: StaffRow, tz: string, daysAhead = 0): Date {
  const e = hhmmToMinutes(staff.quiet_hours_end) ?? 7 * 60
  const now = new Date()
  const p = zonedParts(now, tz)
  let candidate = fromZoned(p.year, p.month, p.day, Math.floor(e / 60), e % 60, tz)
  if (daysAhead > 0) candidate = addLocalDays(candidate, daysAhead, tz)
  else if (candidate.getTime() <= now.getTime()) candidate = addLocalDays(candidate, 1, tz)
  return candidate
}

export async function loadStaff(ctx: EngineContext): Promise<StaffRow[]> {
  const { data } = await ctx.db
    .from('maintenance_staff')
    .select('id, name, phone, active, language, quiet_hours_start, quiet_hours_end, weekly_days_off, unavailable_from, unavailable_until')
    .eq('tenant_id', ctx.tenantId)
  return (data ?? []) as StaffRow[]
}

/** Available staff member with the fewest open tasks (ties: alphabetical). */
/** A staff member can have at most this many unfinished (waiting / in progress) tasks. */
export const MAX_OPEN_PER_STAFF = 2

export async function pickStaff(ctx: EngineContext, excludeId?: string): Promise<StaffRow | null> {
  const staff = (await loadStaff(ctx)).filter((s) => s.active && s.id !== excludeId && !offToday(s, ctx.tz))
  if (staff.length === 0) return null
  const { data: open } = await ctx.db
    .from('maintenance_tasks')
    .select('assigned_to')
    .eq('tenant_id', ctx.tenantId)
    .eq('paused', false)
    .in('status', ['waiting', 'in_progress'])
    .in('assigned_to', staff.map((s) => s.id))
  const counts = new Map(staff.map((s) => [s.id, 0]))
  for (const r of open ?? []) counts.set(r.assigned_to as string, (counts.get(r.assigned_to as string) ?? 0) + 1)
  // Nobody gets a new task while they already have MAX_OPEN_PER_STAFF unfinished ones.
  const withRoom = staff.filter((s) => counts.get(s.id)! < MAX_OPEN_PER_STAFF)
  return [...withRoom].sort((a, b) => (counts.get(a.id)! - counts.get(b.id)!) || a.name.localeCompare(b.name))[0] ?? null
}

// ---------------------------------------------------------------------------
// Carry-over: the morning check-in (8:01), pause and resume
// ---------------------------------------------------------------------------

const MORNING_CHECK_MINUTES = 8 * 60 + 1 // 8:01 AM

/**
 * The next 8:01 AM (hotel time) on a day this person works — or their quiet-hours
 * end, if that is later. Days off (weekly and date ranges) are skipped, so a check-in
 * that would land on a day off goes out on the next working day instead.
 * `includeToday` allows today's 8:01 when it is still ahead.
 */
export function nextMorningCheck(staff: StaffRow | null, tz: string, includeToday: boolean, from: Date = new Date()): Date {
  const quietEnd = staff ? hhmmToMinutes(staff.quiet_hours_end) : null
  const minutes = quietEnd !== null && quietEnd > MORNING_CHECK_MINUTES && quietEnd < 12 * 60 ? quietEnd : MORNING_CHECK_MINUTES
  const p = zonedParts(from, tz)
  const base = fromZoned(p.year, p.month, p.day, Math.floor(minutes / 60), minutes % 60, tz)
  for (let i = includeToday ? 0 : 1; i < 60; i++) {
    const candidate = i === 0 ? base : addLocalDays(base, i, tz)
    if (candidate.getTime() <= from.getTime() + 60_000) continue
    if (staff && offToday(staff, tz, candidate)) continue
    return candidate
  }
  return addLocalDays(base, 1, tz)
}

async function staffOf(ctx: EngineContext, task: TaskRow): Promise<StaffRow | null> {
  if (!task.assigned_to) return null
  return (await loadStaff(ctx)).find((s) => s.id === task.assigned_to) ?? null
}

/**
 * Next day at 8:01 for an accepted carry-over task (never the same day it was
 * accepted). Replaces any other pending reminder for the task.
 */
export async function scheduleMorningCheck(ctx: EngineContext, task: TaskRow, includeToday = false): Promise<Date> {
  const staff = await staffOf(ctx, task)
  const at = nextMorningCheck(staff, ctx.tz, includeToday)
  await cancelPendingReminders(ctx, task.id)
  await scheduleReminder(ctx, task.id, at, 'morning_check')
  return at
}

/** True when the person messaged our number in the last 24 hours, so free text can be delivered. */
async function windowOpen(ctx: EngineContext, staff: StaffRow): Promise<boolean> {
  const { data } = await ctx.db
    .from('maintenance_messages')
    .select('created_at')
    .eq('tenant_id', ctx.tenantId)
    .eq('staff_id', staff.id)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
  const last = data?.[0]?.created_at ? Date.parse(data[0].created_at as string) : 0
  // A 10-minute margin: a message exactly 24h old may already be outside WhatsApp's window.
  return last > 0 && Date.now() - last < 24 * 3600_000 - 10 * 60_000
}

/** Pauses a task: no reminders, no check-ins, no roll-forward, no repeating — until resumed. */
export async function pauseTask(ctx: EngineContext, task: TaskRow): Promise<void> {
  await ctx.db.from('maintenance_tasks').update({ paused: true, updated_at: new Date().toISOString() }).eq('id', task.id)
  await cancelPendingReminders(ctx, task.id)
  await logEvent(ctx, task.id, 'paused', 'Task paused — no reminders and no repeating until it is switched back on')
}

/** Local time of day (HH:MM) of an instant, as minutes. */
const minutesOfDay = (d: Date, tz: string) => {
  const p = zonedParts(d, tz)
  return p.hour * 60 + p.minute
}

/**
 * Switches a task back on. It waits for its NEXT scheduled time rather than
 * reminding right away: the next occurrence for repeating tasks, the next time of
 * day for one-off tasks, and the next 8:01 check-in for carry-over tasks.
 */
export async function resumeTask(ctx: EngineContext, task: TaskRow): Promise<void> {
  const nowIso = new Date().toISOString()
  await ctx.db.from('maintenance_tasks').update({ paused: false, updated_at: nowIso }).eq('id', task.id)
  await cancelPendingReminders(ctx, task.id)
  const resumed: TaskRow = { ...task, paused: false }

  let detail: string
  if (isCarryOver(resumed)) {
    const staff = await staffOf(ctx, resumed)
    const at = nextMorningCheck(staff, ctx.tz, true)
    if (resumed.status === 'in_progress') {
      await scheduleReminder(ctx, resumed.id, at, 'morning_check')
    } else {
      await ctx.db.from('maintenance_tasks').update({ status: 'scheduled', reminder_count: 0, last_reminded_at: null }).eq('id', resumed.id)
      await scheduleReminder(ctx, resumed.id, at)
    }
    detail = `Next reminder ${at.toISOString()} (8:01 check-in)`
    await logEvent(ctx, resumed.id, 'resumed', `Task switched back on; ${detail}`)
    return
  }

  const due = resumed.due_at ? new Date(resumed.due_at) : null
  let next: Date | null = null
  if (due && due.getTime() > Date.now()) {
    next = due // still ahead: keep its schedule
  } else if (resumed.recurrence_rule !== 'none') {
    next = nextOccurrence(resumed, ctx.tz)
  } else if (due) {
    // One-off task whose time has passed: its next occurrence of that time of day.
    const m = minutesOfDay(due, ctx.tz)
    const p = zonedParts(new Date(), ctx.tz)
    let candidate = fromZoned(p.year, p.month, p.day, Math.floor(m / 60), m % 60, ctx.tz)
    if (candidate.getTime() <= Date.now()) candidate = addLocalDays(candidate, 1, ctx.tz)
    next = candidate
  }
  if (!next) next = addLocalDays(new Date(), 1, ctx.tz)

  await ctx.db
    .from('maintenance_tasks')
    .update({
      due_at: next.toISOString(),
      series_due_at: resumed.series_due_at ?? resumed.due_at,
      status: 'scheduled',
      reminder_count: 0,
      last_reminded_at: null,
      escalation_status: 'none',
      updated_at: nowIso,
    })
    .eq('id', resumed.id)
  await scheduleReminder(ctx, resumed.id, next)
  await logEvent(ctx, resumed.id, 'resumed', `Task switched back on; waiting for its next scheduled time (${next.toISOString()})`)
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function formatDue(dueAt: string | null, tz: string): string {
  if (!dueAt) return 'Hoy'
  const due = new Date(dueAt)
  const p = zonedParts(due, tz)
  const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
  if (localDate(due, tz) === localDate(new Date(), tz)) return `Hoy, ${time}`
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}, ${time}`
}

async function sendStaffText(ctx: EngineContext, staff: StaffRow, taskId: string | null, text: string) {
  if (!ctx.whatsapp) return
  const res = await sendWhatsAppMessage(ctx.whatsapp.phoneNumberId, ctx.whatsapp.credentials, staff.phone, text)
  await ctx.db.from('maintenance_messages').insert({
    tenant_id: ctx.tenantId,
    task_id: taskId,
    staff_id: staff.id,
    direction: 'outbound',
    content: text,
    delivery_status: res.success ? 'accepted' : 'failed',
  })
}

/** Free text with tap buttons (valid inside WhatsApp's 24-hour window, which a button tap just opened). */
async function sendStaffButtons(ctx: EngineContext, staff: StaffRow, taskId: string | null, text: string, buttons: { id: string; title: string }[]) {
  if (!ctx.whatsapp) return
  const res = await sendWhatsAppButtons(ctx.whatsapp.phoneNumberId, ctx.whatsapp.credentials, staff.phone, text, buttons)
  await ctx.db.from('maintenance_messages').insert({
    tenant_id: ctx.tenantId,
    task_id: taskId,
    staff_id: staff.id,
    direction: 'outbound',
    content: text,
    delivery_status: res.success ? 'accepted' : 'failed',
  })
}

/** The reminder text staff see (for previews and the message log). */
export function reminderPreview(task: TaskRow, staff: StaffRow | null, tz: string): string {
  const first = staff?.name.split(' ')[0] ?? '—'
  return `Hola ${first}: #${task.task_code} ${task.title} · ${task.location ?? '—'} · ${formatDue(task.due_at, tz)}`
}

// ---------------------------------------------------------------------------
// Sending one reminder
// ---------------------------------------------------------------------------

export interface ReminderOutcome {
  taskId: string
  result: 'sent' | 'deferred' | 'cancelled' | 'failed' | 'skipped'
  detail?: string
}

async function loadTask(ctx: EngineContext, taskId: string): Promise<TaskRow | null> {
  const { data } = await ctx.db.from('maintenance_tasks').select('*').eq('id', taskId).maybeSingle()
  return (data as TaskRow) ?? null
}

async function defer(ctx: EngineContext, reminderId: string, taskId: string, until: Date, type: string, detail: string): Promise<ReminderOutcome> {
  await ctx.db.from('maintenance_reminders').update({ scheduled_for: until.toISOString() }).eq('id', reminderId)
  await logEvent(ctx, taskId, type, detail)
  return { taskId, result: 'deferred', detail }
}

/**
 * Handles one due reminder. `force` (the dashboard's "Send now") skips
 * pacing, quiet hours and days off.
 */
export async function processReminder(
  ctx: EngineContext,
  reminder: { id: string; task_id: string; kind?: string },
  opts: { force?: boolean } = {}
): Promise<ReminderOutcome> {
  const task = await loadTask(ctx, reminder.task_id)
  // A paused task never sends anything.
  if (task?.paused) {
    await ctx.db.from('maintenance_reminders').update({ status: 'cancelled' }).eq('id', reminder.id)
    return { taskId: reminder.task_id, result: 'cancelled', detail: 'Task is paused' }
  }
  // Stop reminding once someone has ignored MAX_REMINDERS reminders (the task is
  // flagged for a manager). A task moved to tomorrow after a help request is also
  // flagged, but starts a fresh set of reminders, so it still goes out.
  const ignoredTooOften = reminder.kind !== 'morning_check' && task?.escalation_status === 'required' && (task.reminder_count ?? 0) >= MAX_REMINDERS
  if (!task || !ACTIVE_STATUSES.includes(task.status as never) || ignoredTooOften) {
    await ctx.db.from('maintenance_reminders').update({ status: 'cancelled' }).eq('id', reminder.id)
    return { taskId: reminder.task_id, result: 'cancelled' }
  }
  if (!ctx.whatsapp) {
    return { taskId: task.id, result: 'skipped', detail: 'WhatsApp is not connected' }
  }
  if (reminder.kind === 'morning_check') return processMorningCheck(ctx, reminder, task, opts)
  // Until Meta approves the template, reminders go out as plain text (only
  // delivered if the staff member messaged the number in the last 24 hours).
  const useTemplate = await templateReady(ctx)

  // Assign if nobody has it yet.
  const staffList = await loadStaff(ctx)
  let staff = staffList.find((s) => s.id === task.assigned_to) ?? null
  if (!staff || !staff.active) {
    const picked = await pickStaff(ctx)
    if (!picked) {
      return defer(ctx, reminder.id, task.id, minutesFromNow(60), 'reminder_deferred', 'No staff available right now; reminder deferred 60 min')
    }
    staff = picked
    await ctx.db.from('maintenance_tasks').update({ assigned_to: staff.id, updated_at: new Date().toISOString() }).eq('id', task.id)
    task.assigned_to = staff.id
    await logEvent(ctx, task.id, 'assigned', `Auto-assigned to ${staff.name} (lowest current workload)`)
  }

  if (!opts.force) {
    const off = offToday(staff, ctx.tz)
    if (off === 'weekly') {
      if (!task.lock_assignee) {
        const other = await pickStaff(ctx, staff.id)
        if (other) {
          await ctx.db.from('maintenance_tasks').update({ assigned_to: other.id }).eq('id', task.id)
          await logEvent(ctx, task.id, 'assigned', `${staff.name} is off today; reassigned to ${other.name}`)
          return processReminder(ctx, reminder, opts)
        }
      }
      return defer(ctx, reminder.id, task.id, nextMorning(staff, ctx.tz), 'reminder_deferred_weekly_day_off',
        `${staff.name} is off today (standing weekly day off); reminder deferred`)
    }
    if (off === 'range') {
      const until = staff.unavailable_until ? new Date(`${staff.unavailable_until}T12:00:00Z`) : new Date()
      const days = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 86400000) + 1)
      return defer(ctx, reminder.id, task.id, nextMorning(staff, ctx.tz, days), 'reminder_deferred',
        `${staff.name} has days off until ${staff.unavailable_until}; reminder deferred`)
    }
    // Capacity: if this would be a third unfinished task for them, hand it to
    // someone with room, or wait until one of theirs is done.
    if (task.status === 'scheduled') {
      const { count: openCount } = await ctx.db
        .from('maintenance_tasks')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenantId)
        .eq('assigned_to', staff.id)
        .eq('paused', false)
        .in('status', ['waiting', 'in_progress'])
        .neq('id', task.id)
      if ((openCount ?? 0) >= MAX_OPEN_PER_STAFF) {
        if (!task.lock_assignee) {
          const other = await pickStaff(ctx, staff.id)
          if (other) {
            await ctx.db.from('maintenance_tasks').update({ assigned_to: other.id }).eq('id', task.id)
            await logEvent(ctx, task.id, 'assigned', `${staff.name} already has ${MAX_OPEN_PER_STAFF} open tasks; reassigned to ${other.name}`)
            return processReminder(ctx, reminder, opts)
          }
        }
        return defer(ctx, reminder.id, task.id, minutesFromNow(30), 'reminder_deferred',
          `${staff.name} already has ${MAX_OPEN_PER_STAFF} open tasks; waiting until one is finished`)
      }
    }

    if (task.priority !== 'urgent') {
      if (inQuietHours(staff, ctx.tz)) {
        return defer(ctx, reminder.id, task.id, nextMorning(staff, ctx.tz), 'reminder_deferred',
          `Quiet hours for ${staff.name}; deferred until ${staff.quiet_hours_end?.slice(0, 5) ?? '07:00'}`)
      }
      // Pacing: no new reminder within 45 min of another unanswered one.
      const since = new Date(Date.now() - PACING_MINUTES * 60000).toISOString()
      const { data: busy } = await ctx.db
        .from('maintenance_tasks')
        .select('id')
        .eq('tenant_id', ctx.tenantId)
        .eq('assigned_to', staff.id)
        .eq('status', 'waiting')
        .neq('id', task.id)
        .gte('last_reminded_at', since)
        .limit(1)
      if (busy?.length) {
        return defer(ctx, reminder.id, task.id, minutesFromNow(PACING_MINUTES), 'reminder_deferred',
          `Deferred ${PACING_MINUTES} min to avoid overloading ${staff.name}`)
      }
    }
  }

  const send = useTemplate
    ? await sendMaintenanceTemplate(
        ctx.whatsapp.phoneNumberId,
        ctx.whatsapp.credentials,
        staff.phone,
        {
          firstName: staff.name.split(' ')[0],
          task: `#${task.task_code} ${task.title}`,
          location: task.location ?? '—',
          due: formatDue(task.due_at, ctx.tz),
        },
        task.id,
        ctx.choice
      )
    : await sendWhatsAppButtons(
        ctx.whatsapp.phoneNumberId,
        ctx.whatsapp.credentials,
        staff.phone,
        [
          `🔧 Hola ${staff.name.split(' ')[0]}, tienes una tarea:`,
          '',
          `*#${task.task_code}* · ${task.title}`,
          `📍 ${task.location ?? '—'}`,
          `🕒 ${formatDue(task.due_at, ctx.tz)}`,
          '',
          `Tarea *#${task.task_code}* — usa los botones de abajo.`,
        ].join('\n'),
        [
          { id: `mt:${task.id}:accept`, title: 'Acepto' },
          { id: `mt:${task.id}:help`, title: 'Necesito ayuda' },
          { id: `mt:${task.id}:done`, title: 'Terminado' },
        ]
      )

  await ctx.db.from('maintenance_messages').insert({
    tenant_id: ctx.tenantId,
    task_id: task.id,
    staff_id: staff.id,
    direction: 'outbound',
    content: task.title,
    delivery_status: send.success ? 'accepted' : 'failed',
  })

  if (!send.success) {
    await ctx.db.from('maintenance_reminders').update({ status: 'failed', error_message: send.error ?? null }).eq('id', reminder.id)
    await logEvent(ctx, task.id, 'reminder_failed', `WhatsApp reminder to ${staff.name} failed: ${send.error ?? 'unknown'}`)
    const { count: failures } = await ctx.db
      .from('maintenance_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', task.id)
      .eq('status', 'failed')
    if ((failures ?? 0) < 3) await scheduleReminder(ctx, task.id, minutesFromNow(30))
    return { taskId: task.id, result: 'failed', detail: send.error }
  }

  const count = task.reminder_count + 1
  await ctx.db.from('maintenance_reminders').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', reminder.id)
  await ctx.db
    .from('maintenance_tasks')
    .update({
      reminder_count: count,
      last_reminded_at: new Date().toISOString(),
      status: task.status === 'scheduled' ? 'waiting' : task.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', task.id)
  await logEvent(ctx, task.id, 'reminder_sent', `WhatsApp reminder sent to ${staff.name}${useTemplate ? '' : ' (with buttons — template not approved yet)'}`)

  if (count >= MAX_REMINDERS && task.status !== 'in_progress') {
    await ctx.db
      .from('maintenance_tasks')
      .update({ escalation_status: 'required', escalated_at: new Date().toISOString() })
      .eq('id', task.id)
    await logEvent(ctx, task.id, 'escalation_required', `${staff.name} has received ${count} reminders without completing the task.`)
    await alertMaintenanceContact(ctx, task, `${staff.name} recibió ${count} recordatorios y no ha respondido.`)
  } else if (isCarryOver(task) && task.status === 'in_progress') {
    // Carry-over tasks that were accepted are not nudged again the same day.
    await scheduleMorningCheck(ctx, task)
  } else {
    await scheduleReminder(
      ctx,
      task.id,
      minutesFromNow(task.status === 'in_progress' ? ACCEPTED_FOLLOW_UP_MINUTES : FOLLOW_UP_MINUTES)
    )
  }
  return { taskId: task.id, result: 'sent' }
}

/**
 * The 8:01 AM check-in for an accepted carry-over task: "are you still working on
 * it?" with tap buttons. Free text when the person messaged us in the last 24 hours;
 * otherwise the approved maintenance template. A day off moves it to the next
 * working day. It repeats every morning until the task is finished.
 */
async function processMorningCheck(
  ctx: EngineContext,
  reminder: { id: string; task_id: string },
  task: TaskRow,
  opts: { force?: boolean }
): Promise<ReminderOutcome> {
  if (!ctx.whatsapp) return { taskId: task.id, result: 'skipped', detail: 'WhatsApp is not connected' }
  const staff = await staffOf(ctx, task)
  if (!staff || !staff.active) {
    return defer(ctx, reminder.id, task.id, minutesFromNow(60), 'reminder_deferred', 'No active staff member for the morning check-in; deferred 60 min')
  }
  if (!opts.force) {
    if (offToday(staff, ctx.tz)) {
      return defer(ctx, reminder.id, task.id, nextMorningCheck(staff, ctx.tz, false), 'reminder_deferred_weekly_day_off',
        `${staff.name} is off today; the check-in moves to their next working day at 8:01`)
    }
    if (inQuietHours(staff, ctx.tz)) {
      return defer(ctx, reminder.id, task.id, nextMorning(staff, ctx.tz), 'reminder_deferred', `Quiet hours for ${staff.name}; check-in deferred`)
    }
  }

  const first = staff.name.split(' ')[0]
  const inWindow = await windowOpen(ctx, staff)
  const useTemplate = !inWindow && (await templateReady(ctx))
  const send = useTemplate
    ? await sendMaintenanceTemplate(
        ctx.whatsapp.phoneNumberId,
        ctx.whatsapp.credentials,
        staff.phone,
        { firstName: first, task: `#${task.task_code} ${task.title}`, location: task.location ?? '—', due: formatDue(task.due_at, ctx.tz) },
        task.id,
        ctx.choice
      )
    : await sendWhatsAppButtons(
        ctx.whatsapp.phoneNumberId,
        ctx.whatsapp.credentials,
        staff.phone,
        `Buenos días ${first} 👋\n¿Sigues trabajando en la tarea *#${task.task_code}* · ${task.title}?\n📍 ${task.location ?? '—'}`,
        [
          { id: `mt:${task.id}:still`, title: 'Sí, sigo' },
          { id: `mt:${task.id}:done`, title: 'Terminado' },
        ]
      )

  await ctx.db.from('maintenance_messages').insert({
    tenant_id: ctx.tenantId,
    task_id: task.id,
    staff_id: staff.id,
    direction: 'outbound',
    content: `Seguimiento: ${task.title}`,
    delivery_status: send.success ? 'accepted' : 'failed',
  })

  if (!send.success) {
    await ctx.db.from('maintenance_reminders').update({ status: 'failed', error_message: send.error ?? null }).eq('id', reminder.id)
    await logEvent(ctx, task.id, 'reminder_failed', `Morning check-in to ${staff.name} failed: ${send.error ?? 'unknown'}`)
    const { count: failures } = await ctx.db.from('maintenance_reminders').select('id', { count: 'exact', head: true }).eq('task_id', task.id).eq('status', 'failed')
    if ((failures ?? 0) < 3) await scheduleReminder(ctx, task.id, minutesFromNow(30), 'morning_check')
    else await scheduleMorningCheck(ctx, task)
    return { taskId: task.id, result: 'failed', detail: send.error }
  }

  await ctx.db.from('maintenance_reminders').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', reminder.id)
  await ctx.db.from('maintenance_tasks').update({ last_reminded_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', task.id)
  const next = await scheduleMorningCheck(ctx, task)
  await logEvent(ctx, task.id, 'morning_check_sent',
    `Morning check-in sent to ${staff.name} (${useTemplate ? 'maintenance template — more than 24 h since their last message' : 'free text with buttons'}); next one ${formatDue(next.toISOString(), ctx.tz)}`)
  return { taskId: task.id, result: 'sent' }
}

// ---------------------------------------------------------------------------
// Task lifecycle
// ---------------------------------------------------------------------------

/**
 * Tells the maintenance contact (Settings → Staff escalation contacts) on
 * WhatsApp that a task needs attention. Uses the staff-alert template when one
 * is chosen, so it arrives even outside WhatsApp's 24-hour window.
 */
async function alertMaintenanceContact(ctx: EngineContext, task: TaskRow, summary: string) {
  if (!ctx.whatsapp) return
  try {
    const { data: tenant } = await ctx.db
      .from('tenants')
      .select('escalation_contacts, message_templates')
      .eq('id', ctx.tenantId)
      .single()
    const contact = findEscalationContact(parseEscalationContacts(tenant?.escalation_contacts), 'maintenance')
    if (!contact) return
    const result = await notifyStaff(
      ctx.whatsapp.phoneNumberId,
      ctx.whatsapp.credentials,
      contact.phone,
      'Mantenimiento',
      { category: 'maintenance', summary: `#${task.task_code} ${task.title}: ${summary}`, urgency: task.priority === 'urgent' ? 'high' : 'normal' },
      tenant?.message_templates,
      'Mantenimiento'
    )
    await logEvent(ctx, task.id, result.success ? 'manager_alerted' : 'manager_alert_failed',
      result.success ? 'Maintenance contact alerted on WhatsApp' : `Could not alert the maintenance contact: ${result.error ?? 'unknown error'}`)
  } catch (err) {
    console.error('[maintenance] manager alert failed', err)
  }
}

/**
 * "When this task is finished, start …": makes a fresh copy of the follow-up
 * task (which waits on hold as a template) and schedules its reminder after
 * the chosen wait. The template stays on hold for next time.
 */
export async function startFollowUp(ctx: EngineContext, finished: TaskRow): Promise<string | null> {
  if (!finished.next_task_id) return null
  const { data: tpl } = await ctx.db
    .from('maintenance_tasks')
    .select('*')
    .eq('id', finished.next_task_id)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle()
  if (!tpl || tpl.status === 'cancelled') {
    await logEvent(ctx, finished.id, 'followup_missing', 'Follow-up task not found (it may have been deleted)')
    return null
  }

  const delay = Number(finished.next_delay_minutes ?? 0)
  let due: Date
  if (delay === -1) {
    // Next morning at 07:00 hotel time.
    const tomorrow = localDate(addLocalDays(new Date(), 1, ctx.tz), ctx.tz)
    const [y, m, d] = tomorrow.split('-').map(Number)
    due = fromZoned(y, m, d, 7, 0, ctx.tz)
  } else {
    due = minutesFromNow(Math.max(0, delay))
  }

  const mode = finished.next_assign ?? 'finisher'
  const assignee = mode === 'finisher' ? finished.assigned_to : mode === 'own' ? (tpl.assigned_to as string | null) : null

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: created, error } = await ctx.db
      .from('maintenance_tasks')
      .insert({
        tenant_id: ctx.tenantId,
        task_code: newTaskCode(),
        title: tpl.title,
        description: tpl.description,
        location: tpl.location,
        priority: tpl.priority,
        status: 'scheduled',
        assigned_to: assignee,
        lock_assignee: mode === 'own' ? Boolean(tpl.lock_assignee) : false,
        due_at: due.toISOString(),
        recurrence_rule: 'none',
        parent_task_id: tpl.id,
        created_by: tpl.created_by,
        // Chains: the copy carries the template's own follow-up (A → B → C).
        next_task_id: tpl.next_task_id ?? null,
        next_delay_minutes: tpl.next_delay_minutes ?? 0,
        next_assign: tpl.next_assign ?? 'finisher',
        carry_over: true,
      })
      .select('id, task_code')
      .single()
    if (error?.code === '23505') continue
    if (error || !created) {
      await logEvent(ctx, finished.id, 'followup_failed', `Could not start the follow-up task: ${error?.message ?? 'unknown error'}`)
      return null
    }
    await scheduleReminder(ctx, created.id as string, due)
    const when = delay === -1 ? 'tomorrow at 07:00' : delay === 0 ? 'now' : `in ${delay} min`
    await logEvent(ctx, created.id as string, 'created', `Follow-up of #${finished.task_code} ${finished.title} (starts ${when})`)
    await logEvent(ctx, finished.id, 'followup_started', `Started follow-up #${created.task_code} ${tpl.title} (${when})`)
    return created.id as string
  }
  return null
}

export async function completeTask(ctx: EngineContext, task: TaskRow, how: { source: 'whatsapp' | 'dashboard'; text?: string }) {
  await ctx.db
    .from('maintenance_tasks')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      escalation_status: task.escalation_status === 'none' ? 'none' : 'resolved',
      updated_at: new Date().toISOString(),
    })
    .eq('id', task.id)
  await cancelPendingReminders(ctx, task.id)
  await logEvent(
    ctx,
    task.id,
    how.source === 'whatsapp' ? 'reply_completed' : 'status_changed',
    how.source === 'whatsapp' ? (how.text ?? 'Completed via WhatsApp') : 'Status changed to done'
  )
  await spawnNext(ctx, task)
  await startFollowUp(ctx, task)

  // Capacity freed up: bring this person's next overdue reminder forward.
  if (task.assigned_to) {
    const { data: waitingTasks } = await ctx.db
      .from('maintenance_tasks')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('assigned_to', task.assigned_to)
      .eq('paused', false)
      .eq('carry_over', false) // carry-over tasks keep their own morning schedule
      .is('next_task_id', null)
      .in('status', ACTIVE_STATUSES as unknown as string[])
      .lte('due_at', new Date().toISOString())
    const ids = (waitingTasks ?? []).map((t) => t.id as string)
    if (ids.length) {
      const soon = minutesFromNow(15)
      const { data: later } = await ctx.db
        .from('maintenance_reminders')
        .select('id, task_id')
        .in('task_id', ids)
        .eq('status', 'pending')
        .eq('kind', 'standard')
        .gt('scheduled_for', soon.toISOString())
        .order('scheduled_for')
        .limit(1)
      for (const r of later ?? []) {
        await ctx.db.from('maintenance_reminders').update({ scheduled_for: soon.toISOString() }).eq('id', r.id)
        await logEvent(ctx, r.task_id as string, 'reminder_reassessed', 'Pulled forward to 15 min from now after a task completion freed up capacity')
      }
    }
  }
}

export async function acknowledgeTask(ctx: EngineContext, task: TaskRow, text: string) {
  await ctx.db.from('maintenance_tasks').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', task.id)
  await cancelPendingReminders(ctx, task.id)
  await logEvent(ctx, task.id, 'reply_acknowledged', text)
  if (isCarryOver(task)) {
    // No reminder the same day it is accepted: the first check-in is the next working morning at 8:01.
    const at = await scheduleMorningCheck(ctx, { ...task, status: 'in_progress' })
    await logEvent(ctx, task.id, 'morning_check_scheduled', `Next check-in ${formatDue(at.toISOString(), ctx.tz)}`)
    return
  }
  await scheduleReminder(ctx, task.id, minutesFromNow(ACCEPTED_FOLLOW_UP_MINUTES))
}

/** "Necesito ayuda": hand the task to someone else (Beta's reassignment rule). */
export async function requestHelp(ctx: EngineContext, task: TaskRow, requester: StaffRow, text: string): Promise<boolean> {
  await logEvent(ctx, task.id, 'reply_needs_help', text)
  const other = await pickStaff(ctx, requester.id)
  if (!other) {
    // Nobody can take it: move it to tomorrow and flag it (Needs attention).
    await cancelPendingReminders(ctx, task.id)
    const reason = `${requester.name} asked for help and nobody else is available; moved to tomorrow`
    if ((task.recurrence_rule === 'daily' || task.recurrence_rule === 'interval') && !isCarryOver(task)) {
      // Tomorrow already has its own occurrence: close this one and flag the next.
      await ctx.db.from('maintenance_tasks').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', task.id)
      await logEvent(ctx, task.id, 'escalation_required', reason)
      const nextId = await spawnNext(ctx, task)
      if (nextId) {
        await ctx.db.from('maintenance_tasks').update({ escalation_status: 'required', escalated_at: new Date().toISOString() }).eq('id', nextId)
        await logEvent(ctx, nextId, 'escalation_required', `${requester.name} asked for help with the previous occurrence and nobody else was available`)
      }
      await alertMaintenanceContact(ctx, task, `${requester.name} pidió ayuda y no hay nadie más disponible. Se pasó a mañana.`)
    } else {
      const base = task.due_at ? new Date(task.due_at) : new Date()
      const days = Math.max(1, Math.round(
        (Date.parse(`${localDate(new Date(), ctx.tz)}T00:00:00Z`) - Date.parse(`${localDate(base, ctx.tz)}T00:00:00Z`)) / 86400000
      ) + 1)
      const newDue = addLocalDays(base, days, ctx.tz)
      await ctx.db
        .from('maintenance_tasks')
        .update({
          due_at: newDue.toISOString(),
          series_due_at: task.series_due_at ?? task.due_at,
          status: 'scheduled',
          reminder_count: 0,
          last_reminded_at: null,
          escalation_status: 'required',
          escalated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', task.id)
      await scheduleReminder(ctx, task.id, newDue)
      await logEvent(ctx, task.id, 'escalation_required', reason)
      await alertMaintenanceContact(ctx, task, `${requester.name} pidió ayuda y no hay nadie más disponible. Se pasó a mañana.`)
    }
    return false
  }
  await ctx.db
    .from('maintenance_tasks')
    .update({ assigned_to: other.id, status: 'scheduled', reminder_count: 0, last_reminded_at: null, updated_at: new Date().toISOString() })
    .eq('id', task.id)
  await cancelPendingReminders(ctx, task.id)
  await scheduleReminder(ctx, task.id, new Date())
  await logEvent(ctx, task.id, 'reassigned_needs_help', `${requester.name} asked for help; reassigned to ${other.name}`)
  return true
}

// ---------------------------------------------------------------------------
// The scheduled run (every 5 minutes)
// ---------------------------------------------------------------------------

/**
 * Carry-over tasks are never closed or replaced. This lines up their next reminder
 * whenever they have none: an accepted task gets its 8:01 check-in; a task nobody
 * accepted gets a fresh reminder the next working morning once a day has passed.
 */
async function ensureCarryOverReminders(ctx: EngineContext, today: string): Promise<void> {
  const { data: tasks } = await ctx.db
    .from('maintenance_tasks')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('paused', false)
    .in('status', ACTIVE_STATUSES as unknown as string[])
    .or('carry_over.eq.true,next_task_id.not.is.null')
  const list = (tasks ?? []) as TaskRow[]
  if (!list.length) return
  const { data: pending } = await ctx.db.from('maintenance_reminders').select('task_id').in('task_id', list.map((t) => t.id)).eq('status', 'pending')
  const hasPending = new Set((pending ?? []).map((r) => r.task_id as string))
  for (const t of list) {
    if (hasPending.has(t.id)) continue
    if (t.status === 'in_progress') {
      const at = await scheduleMorningCheck(ctx, t, true)
      await logEvent(ctx, t.id, 'morning_check_scheduled', `Next check-in ${formatDue(at.toISOString(), ctx.tz)}`)
      continue
    }
    const dueDay = t.due_at ? localDate(new Date(t.due_at), ctx.tz) : today
    if (dueDay >= today) continue
    const at = nextMorningCheck(await staffOf(ctx, t), ctx.tz, true)
    await ctx.db
      .from('maintenance_tasks')
      .update({ status: 'scheduled', reminder_count: 0, last_reminded_at: null, carried_over_count: (t.carried_over_count ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', t.id)
    await scheduleReminder(ctx, t.id, at)
    await logEvent(ctx, t.id, 'carried_over', `Still open since ${dueDay}; carried over — next reminder ${formatDue(at.toISOString(), ctx.tz)}`)
  }
}

export async function runTenantTick(tenantId: string) {
  const ctx = await loadEngineContext(tenantId)
  const today = localDate(new Date(), ctx.tz)

  // 1) Unfinished work from earlier days (checked every run, so it happens right after midnight):
  //    - daily / every-X-hours tasks: that occurrence is closed as missed and the
  //      next one runs at its normal time (tomorrow's occurrence);
  //    - one-off, weekly, monthly and seasonal tasks are re-run: the same task
  //      moves to the same time today, with a fresh set of reminders.
  //    Every-X-hours tasks also roll forward as soon as their next slot starts.
  const { data: open } = await ctx.db
    .from('maintenance_tasks')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('status', ACTIVE_STATUSES as unknown as string[])
    .lt('due_at', new Date().toISOString())
  let rolled = 0
  for (const t of (open ?? []) as TaskRow[]) {
    if (!t.due_at) continue
    // Paused tasks and carry-over tasks never reset at midnight — they stay open until finished.
    if (t.paused || isCarryOver(t)) continue
    const dueDay = localDate(new Date(t.due_at), ctx.tz)
    const nextSlotStarted =
      t.recurrence_rule === 'interval' && (stepOnce(t, new Date(t.due_at), ctx.tz)?.getTime() ?? Infinity) <= Date.now()
    if (dueDay >= today && !nextSlotStarted) continue

    if (t.recurrence_rule === 'daily' || t.recurrence_rule === 'interval') {
      await ctx.db.from('maintenance_tasks').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', t.id)
      await cancelPendingReminders(ctx, t.id)
      await logEvent(ctx, t.id, 'missed_rolled_forward', 'Not completed in time; the next occurrence runs at its normal time')
      await spawnNext(ctx, t)
    } else {
      // Re-run today at the same local time.
      const days = Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDay}T00:00:00Z`)) / 86400000))
      const newDue = addLocalDays(new Date(t.due_at), days, ctx.tz)
      await cancelPendingReminders(ctx, t.id)
      await ctx.db
        .from('maintenance_tasks')
        .update({
          due_at: newDue.toISOString(),
          series_due_at: t.series_due_at ?? t.due_at,
          status: 'scheduled',
          reminder_count: 0,
          last_reminded_at: null,
          escalation_status: 'none',
          carried_over_count: (t.carried_over_count ?? 0) + 1,
          assigned_to: t.lock_assignee ? t.assigned_to : t.assigned_to,
          updated_at: new Date().toISOString(),
        })
        .eq('id', t.id)
      await scheduleReminder(ctx, t.id, newDue.getTime() > Date.now() ? newDue : new Date())
      await logEvent(ctx, t.id, 'carried_over', `Not completed on ${dueDay}; re-run today at the same time`)
    }
    rolled++
  }

  // 1b) Carry-over tasks: make sure each one always has its next reminder lined up.
  await ensureCarryOverReminders(ctx, today)

  // 2) Send due reminders — urgent first, then oldest due.
  const { data: due } = await ctx.db
    .from('maintenance_reminders')
    .select('id, task_id, scheduled_for, kind')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for')
    .limit(40)
  const outcomes: ReminderOutcome[] = []
  const seen = new Set<string>()
  for (const r of due ?? []) {
    if (seen.has(r.task_id as string)) {
      await ctx.db.from('maintenance_reminders').update({ status: 'cancelled' }).eq('id', r.id)
      continue
    }
    seen.add(r.task_id as string)
    outcomes.push(await processReminder(ctx, { id: r.id as string, task_id: r.task_id as string, kind: r.kind as string }))
  }
  return { tenantId, rolled, outcomes }
}

// ---------------------------------------------------------------------------
// Staff WhatsApp replies
// ---------------------------------------------------------------------------

type Action = 'accept' | 'done' | 'help' | 'still'
const WORDS: Record<string, Action> = {
  ACEPTO: 'accept',
  ACEPTAR: 'accept',
  TERMINADO: 'done',
  LISTO: 'done',
  HECHO: 'done',
  AYUDA: 'help',
  'NECESITO AYUDA': 'help',
  'SÍ, SIGO': 'still',
  'SI, SIGO': 'still',
  'SÍ SIGO': 'still',
  'SI SIGO': 'still',
  SIGO: 'still',
}

export function parseStaffReply(text: string): { taskId?: string; code?: string; action: Action } | null {
  const payload = /^mt:([0-9a-f-]{36}):(accept|help|done|still)$/i.exec(text.trim())
  if (payload) return { taskId: payload[1], action: payload[2].toLowerCase() as Action }
  const clean = text.trim().toUpperCase().replace(/\s+/g, ' ').replace(/[.!]+$/, '')
  const withCode = /^#?([0-9A-F]{6}) (.+)$/.exec(clean)
  if (withCode && WORDS[withCode[2]]) return { code: withCode[1], action: WORDS[withCode[2]] }
  if (WORDS[clean]) return { action: WORDS[clean] }
  return null
}

export async function handleStaffReply(ctx: EngineContext, staff: StaffRow, text: string): Promise<boolean> {
  const parsed = parseStaffReply(text)
  if (!parsed) return false

  await ctx.db.from('maintenance_messages').insert({
    tenant_id: ctx.tenantId,
    staff_id: staff.id,
    direction: 'inbound',
    content: text.startsWith('mt:') ? parsed.action.toUpperCase() : text,
    delivery_status: 'received',
  })

  let task: TaskRow | null = null
  if (parsed.taskId || parsed.code) {
    let q = ctx.db.from('maintenance_tasks').select('*').eq('tenant_id', ctx.tenantId)
    q = parsed.taskId ? q.eq('id', parsed.taskId) : q.eq('task_code', parsed.code!)
    const { data } = await q.maybeSingle()
    task = (data as TaskRow) ?? null
  } else {
    const { data } = await ctx.db
      .from('maintenance_tasks')
      .select('*')
      .eq('tenant_id', ctx.tenantId)
      .eq('assigned_to', staff.id)
      .eq('paused', false)
      .in('status', ['waiting', 'in_progress'])
      .order('last_reminded_at', { ascending: false })
    const list = (data ?? []) as TaskRow[]
    if (list.length > 1) {
      await sendStaffText(ctx, staff, null,
        `Tienes varias tareas abiertas. Responde con el código de la tarea, por ejemplo: ${list[0].task_code} TERMINADO`)
      return true
    }
    task = list[0] ?? null
  }

  if (!task || !ACTIVE_STATUSES.includes(task.status as never)) {
    await sendStaffText(ctx, staff, task?.id ?? null, 'Esa tarea ya no está abierta o ya fue completada. Gracias.')
    return true
  }
  if (task.assigned_to && task.assigned_to !== staff.id) {
    await sendStaffText(ctx, staff, task.id, 'Esa tarea está asignada a otra persona. Gracias.')
    return true
  }

  await ctx.db.from('maintenance_messages').update({ task_id: task.id })
    .eq('staff_id', staff.id).is('task_id', null).eq('direction', 'inbound').gte('created_at', new Date(Date.now() - 60000).toISOString())

  // A paused task can still be reported finished, but nothing else.
  if (task.paused && parsed.action !== 'done') {
    await sendStaffText(ctx, staff, task.id, `La tarea #${task.task_code} está en pausa por ahora. Gracias.`)
    return true
  }
  // Tapping "Acepto" on a carry-over task already in progress (the template's button) means "I'm still on it".
  const action: Action = parsed.action === 'accept' && task.status === 'in_progress' && isCarryOver(task) ? 'still' : parsed.action
  const label = `${task.task_code} ${action === 'done' ? 'TERMINADO' : action === 'accept' ? 'ACEPTO' : action === 'still' ? 'SIGO' : 'AYUDA'}`
  const first = staff.name.split(' ')[0]
  if (action === 'still') {
    await logEvent(ctx, task.id, 'reply_still_working', label)
    // Tomorrow's check-in is already lined up; make sure it is.
    const { count: pendingChecks } = await ctx.db
      .from('maintenance_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('task_id', task.id)
      .eq('status', 'pending')
    if (!pendingChecks) await scheduleMorningCheck(ctx, task)
    await sendStaffButtons(
      ctx,
      staff,
      task.id,
      `Gracias ${first} 🙌 Cuando termines la tarea *#${task.task_code}*, toca el botón *Terminado*.`,
      [{ id: `mt:${task.id}:done`, title: 'Terminado' }]
    )
    return true
  }
  if (parsed.action === 'done') {
    await completeTask(ctx, task, { source: 'whatsapp', text: label })
    await sendStaffText(ctx, staff, task.id, `✅ Anotado #${task.task_code}, gracias ${first}`)
  } else if (parsed.action === 'accept') {
    await acknowledgeTask(ctx, task, label)
    await sendStaffText(ctx, staff, task.id, `Entendido #${task.task_code}`)
  } else {
    await requestHelp(ctx, task, staff, label)
    await sendStaffText(ctx, staff, task.id, `Entiendo ${first}. Tomo nota y pido que alguien nos ayude con la tarea #${task.task_code}.`)
  }
  return true
}
