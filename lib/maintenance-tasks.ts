import { fromZoned } from './tz'
import { RECURRENCE_RULES } from './maintenance-auth'

export interface TaskInput {
  title?: string
  description?: string | null
  location?: string | null
  priority?: string
  assigned_to?: string | null
  lock_assignee?: boolean
  due_local?: string | null // "YYYY-MM-DDTHH:MM" in the hotel's timezone
  recurrence_rule?: string
  interval_hours?: number | string | null
  interval_window_start?: string | null
  interval_window_end?: string | null
  season_start_month?: number | string | null
  season_end_month?: number | string | null
  season_lead_days?: number | string | null
  season_within_frequency?: string | null
  /** Pause switch (handled by the task route: pausing stops reminders and repeating until switched back on). */
  paused?: boolean
  /** Carry over until finished: never resets at midnight; 8:01 AM check-in each day. */
  carry_over?: boolean
  /** A follow-up task: waits on hold until another task's completion starts it. */
  on_hold?: boolean
  /** When this task is finished, start this follow-up task. */
  next_task_id?: string | null
  /** Wait before the follow-up starts: 0, 15, 30, 60, 120, 240 minutes, or -1 = next morning. */
  next_delay_minutes?: number | string | null
  /** Who does the follow-up: the person who finished this task, the follow-up's own assignee, or auto. */
  next_assign?: string | null
}

export const FOLLOW_UP_DELAYS = [0, 15, 30, 60, 120, 240, -1] as const

const num = (v: unknown) => (v === '' || v === null || v === undefined ? null : Number(v))

export function cleanTask(body: TaskInput, partial: boolean, tz: string): { values?: Record<string, unknown>; error?: string } {
  const v: Record<string, unknown> = {}
  if (!partial || body.title !== undefined) {
    if (!body.title?.trim()) return { error: 'Task name is required' }
    v.title = body.title.trim().slice(0, 200)
  }
  if (body.description !== undefined) v.description = body.description?.trim() || null
  if (body.location !== undefined) v.location = body.location?.trim() || null
  if (body.priority !== undefined) v.priority = body.priority === 'urgent' ? 'urgent' : 'routine'
  if (body.assigned_to !== undefined) v.assigned_to = body.assigned_to || null
  if (body.lock_assignee !== undefined) v.lock_assignee = Boolean(body.lock_assignee)

  if (!partial || body.due_local !== undefined) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(body.due_local ?? '')
    if (!m) return { error: 'Choose a due date and time' }
    v.due_at = fromZoned(+m[1], +m[2], +m[3], +m[4], +m[5], tz).toISOString()
  }

  if (!partial || body.recurrence_rule !== undefined) {
    const rule = body.recurrence_rule ?? 'none'
    if (!(RECURRENCE_RULES as readonly string[]).includes(rule)) return { error: 'Unknown repeat option' }
    v.recurrence_rule = rule
    v.interval_hours = null
    v.interval_window_start = null
    v.interval_window_end = null
    v.season_start_month = null
    v.season_end_month = null
    v.season_lead_days = 0
    v.season_within_frequency = null
    if (rule === 'interval') {
      const h = num(body.interval_hours)
      if (!h || h < 1 || h > 24) return { error: 'Every X hours must be between 1 and 24' }
      v.interval_hours = Math.round(h)
      const t = /^\d{2}:\d{2}$/
      if (body.interval_window_start || body.interval_window_end) {
        if (!t.test(body.interval_window_start ?? '') || !t.test(body.interval_window_end ?? '')) {
          return { error: 'The time window needs a start and end (HH:MM)' }
        }
        if (body.interval_window_end! <= body.interval_window_start!) return { error: 'The window end must be after its start' }
        v.interval_window_start = body.interval_window_start
        v.interval_window_end = body.interval_window_end
      }
    }
    if (rule === 'seasonal') {
      const s = num(body.season_start_month)
      const e = num(body.season_end_month)
      if (!s || !e || s < 1 || s > 12 || e < 1 || e > 12) return { error: 'Choose the season start and end months' }
      v.season_start_month = s
      v.season_end_month = e
      v.season_lead_days = Math.max(0, Math.min(60, num(body.season_lead_days) ?? 0))
      v.season_within_frequency = ['weekly', 'monthly'].includes(body.season_within_frequency ?? '')
        ? body.season_within_frequency
        : null
    }
  }
  if (body.next_task_id !== undefined) {
    const id = body.next_task_id || null
    if (id && !/^[0-9a-f-]{36}$/i.test(id)) return { error: 'Unknown follow-up task' }
    v.next_task_id = id
  }
  if (body.next_delay_minutes !== undefined) {
    const d = Number(body.next_delay_minutes ?? 0)
    if (!(FOLLOW_UP_DELAYS as readonly number[]).includes(d)) return { error: 'Unknown wait before the follow-up' }
    v.next_delay_minutes = d
  }
  if (body.carry_over !== undefined) v.carry_over = Boolean(body.carry_over)
  if (body.next_assign !== undefined) {
    v.next_assign = ['finisher', 'own', 'auto'].includes(body.next_assign ?? '') ? body.next_assign : 'finisher'
  }
  // Follow-up tasks don't repeat on their own: each trigger makes one copy.
  if (body.on_hold) {
    v.recurrence_rule = 'none'
  }
  return { values: v }
}

export function recurrenceLabel(t: {
  recurrence_rule: string
  interval_hours?: number | null
  season_within_frequency?: string | null
}): string {
  switch (t.recurrence_rule) {
    case 'daily':
      return 'Daily'
    case 'weekly':
      return 'Weekly'
    case 'monthly':
      return 'Monthly'
    case 'interval':
      return `Every ${t.interval_hours ?? '?'} hrs`
    case 'seasonal':
      return t.season_within_frequency ? `Seasonal · ${t.season_within_frequency}` : 'Seasonal'
    default:
      return 'One-off'
  }
}
