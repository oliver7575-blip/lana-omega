export interface Task {
  id: string
  task_code: string
  title: string
  description: string | null
  location: string | null
  priority: 'routine' | 'urgent'
  status: 'scheduled' | 'waiting' | 'in_progress' | 'done' | 'cancelled' | 'on_hold'
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
  reminder_count: number
  escalation_status: string
  completed_at: string | null
  updated_at: string
  paused?: boolean
  carry_over?: boolean
  next_task_id?: string | null
  next_delay_minutes?: number | null
  next_assign?: string | null
}

export interface Staff {
  id: string
  name: string
  phone: string
  active: boolean
  language: string
  specialties: string[]
  quiet_hours_start: string
  quiet_hours_end: string
  weekly_days_off: number[]
  unavailable_from: string | null
  unavailable_until: string | null
}

export const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  waiting: 'Waiting',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
}

export function recurrenceLabel(t: Pick<Task, 'recurrence_rule' | 'interval_hours' | 'season_within_frequency'>) {
  switch (t.recurrence_rule) {
    case 'daily': return 'Daily'
    case 'weekly': return 'Weekly'
    case 'monthly': return 'Monthly'
    case 'interval': return `Every ${t.interval_hours ?? '?'} hrs`
    case 'seasonal': return 'Seasonal'
    default: return 'One-off'
  }
}

export function fmtDateTime(iso: string | null, tz: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' }).format(d)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d)
  return `${date} at ${time}`
}

/** "YYYY-MM-DD" and "YYYY-MM-DDTHH:MM" in the hotel's timezone. */
export function localParts(iso: string, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])
  )
  return { date: `${p.year}-${p.month}-${p.day}`, dateTime: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}` }
}

export const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase())

export const inputCls =
  'w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-navy outline-none placeholder:text-navy/35 focus:border-clay'
export const labelCls = 'mb-1 block text-xs font-medium text-navy/70'

export async function api<T = Record<string, unknown>>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`)
  return json as T
}

/** Tasks that never reset at midnight and stay open until finished (has a follow-up, is a follow-up, or the switch is on). */
export const carriesOver = (t: Pick<Task, 'carry_over' | 'next_task_id'>) => Boolean(t.carry_over) || Boolean(t.next_task_id)
