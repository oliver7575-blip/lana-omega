'use client'

import { useState } from 'react'
import Modal from './Modal'
import { api, inputCls, labelCls, localParts, type Staff, type Task } from './shared'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function TaskModal({ task, staff, timezone, followUps = [], onClose, onSaved }: {
  task: Task | null
  staff: Staff[]
  /** Follow-up tasks (on hold) this task can start when it's finished. */
  followUps?: Task[]
  timezone: string
  onClose: () => void
  onSaved: () => void
}) {
  // Defaults to now: the reminder goes out on the next run (within 5 minutes).
  const defaultDue = localParts(new Date().toISOString(), timezone).dateTime
  const [f, setF] = useState({
    title: task?.title ?? '',
    description: task?.description ?? '',
    location: task?.location ?? '',
    priority: task?.priority ?? 'routine',
    assigned_to: task?.assigned_to ?? '',
    lock_assignee: task?.lock_assignee ?? false,
    due_local: task?.due_at ? localParts(task.due_at, timezone).dateTime : defaultDue,
    recurrence_rule: task?.recurrence_rule ?? 'none',
    interval_hours: String(task?.interval_hours ?? 2),
    interval_window_start: task?.interval_window_start ?? '10:00',
    interval_window_end: task?.interval_window_end ?? '16:00',
    season_start_month: String(task?.season_start_month ?? 11),
    season_end_month: String(task?.season_end_month ?? 3),
    season_lead_days: String(task?.season_lead_days ?? 0),
    season_within_frequency: task?.season_within_frequency ?? 'monthly',
    on_hold: task?.status === 'on_hold',
    carry_over: Boolean(task?.carry_over),
    next_task_id: task?.next_task_id ?? '',
    next_delay_minutes: String(task?.next_delay_minutes ?? 0),
    next_assign: task?.next_assign ?? 'finisher',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }))

  async function save() {
    setSaving(true)
    setError(null)
    try {
      if (task) await api(`/api/maintenance/tasks/${task.id}`, 'PATCH', f)
      else await api('/api/maintenance/tasks', 'POST', f)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
      setSaving(false)
    }
  }

  return (
    <Modal
      title={task ? `Edit task #${task.task_code}` : 'Add maintenance task'}
      subtitle="The assigned person gets a WhatsApp reminder at the due time."
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="text-sm text-navy/70 hover:text-navy">Cancel</button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-clay px-5 py-2 text-sm font-semibold text-white hover:bg-clay/90 disabled:opacity-60">
            {saving ? 'Saving…' : task ? 'Save changes' : 'Add task'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex items-start gap-2.5 rounded-xl border border-line bg-paper/40 px-3 py-2.5 text-sm text-navy/85">
          <input type="checkbox" checked={f.on_hold} onChange={(e) => set('on_hold', e.target.checked)} className="mt-0.5 h-4 w-4 accent-clay" />
          <span>
            <span className="font-semibold text-white">Follow-up task</span>
            <span className="block text-xs text-navy/55">Only starts when another task is finished. Set it up once; it waits on hold and a fresh copy is sent each time it's triggered.</span>
          </span>
        </label>
        <div>
          <label className={labelCls}>Task *</label>
          <input className={inputCls} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Apagar filtro de albercas" />
        </div>
        <div>
          <label className={labelCls}>Location</label>
          <input className={inputCls} value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="Albercas del #12 y #19" />
        </div>
        <div>
          <label className={labelCls}>Details</label>
          <textarea rows={2} className={inputCls} value={f.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Priority</label>
            <select className={inputCls} value={f.priority} onChange={(e) => set('priority', e.target.value)}>
              <option value="routine">Routine</option>
              <option value="urgent">🚨 Urgent</option>
            </select>
          </div>
          <div className={f.on_hold ? 'hidden' : ''}>
            <label className={labelCls}>Due (hotel time) — reminder is sent at this time</label>
            <input type="datetime-local" className={inputCls} value={f.due_local} onChange={(e) => set('due_local', e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Assign to</label>
            <select className={inputCls} value={f.assigned_to} onChange={(e) => set('assigned_to', e.target.value)}>
              <option value="">Auto (lowest workload)</option>
              {staff.filter((s) => s.active || s.id === f.assigned_to).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className={f.on_hold ? 'hidden' : ''}>
            <label className={labelCls}>Repeat</label>
            <select className={inputCls} value={f.recurrence_rule} onChange={(e) => set('recurrence_rule', e.target.value)}>
              <option value="none">One-off</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="seasonal">Seasonal</option>
              <option value="interval">Every X hours</option>
            </select>
          </div>
        </div>

        {!f.on_hold && f.recurrence_rule === 'interval' && (
          <div className="grid grid-cols-3 gap-3 rounded-xl border border-line bg-paper/40 p-3">
            <div>
              <label className={labelCls}>Every (hours)</label>
              <input type="number" min={1} max={24} className={inputCls} value={f.interval_hours} onChange={(e) => set('interval_hours', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>From</label>
              <input type="time" className={inputCls} value={f.interval_window_start} onChange={(e) => set('interval_window_start', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Until</label>
              <input type="time" className={inputCls} value={f.interval_window_end} onChange={(e) => set('interval_window_end', e.target.value)} />
            </div>
          </div>
        )}

        {!f.on_hold && f.recurrence_rule === 'seasonal' && (
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-paper/40 p-3">
            <div>
              <label className={labelCls}>Season starts</label>
              <select className={inputCls} value={f.season_start_month} onChange={(e) => set('season_start_month', e.target.value)}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Season ends</label>
              <select className={inputCls} value={f.season_end_month} onChange={(e) => set('season_end_month', e.target.value)}>
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Repeat within season</label>
              <select className={inputCls} value={f.season_within_frequency} onChange={(e) => set('season_within_frequency', e.target.value)}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="">Once per season</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Start early (days)</label>
              <input type="number" min={0} max={60} className={inputCls} value={f.season_lead_days} onChange={(e) => set('season_lead_days', e.target.value)} />
            </div>
          </div>
        )}

        {f.assigned_to && f.recurrence_rule !== 'none' && (
          <label className="flex items-center gap-2.5 text-sm text-navy/85">
            <input type="checkbox" checked={f.lock_assignee} onChange={(e) => set('lock_assignee', e.target.checked)} className="h-4 w-4 accent-clay" />
            Always give this task to the same person
          </label>
        )}
        <div className="rounded-xl border border-line bg-paper/40 p-3">
          <label className={labelCls}>When this task is finished, start…</label>
          <select className={inputCls} value={f.next_task_id} onChange={(e) => set('next_task_id', e.target.value)}>
            <option value="">Nothing</option>
            {followUps.filter((t) => t.id !== task?.id).map((t) => (
              <option key={t.id} value={t.id}>#{t.task_code} {t.title}</option>
            ))}
          </select>
          {followUps.filter((t) => t.id !== task?.id).length === 0 && (
            <p className="mt-1.5 text-xs text-navy/55">No follow-up tasks yet. Create one first with "Follow-up task" ticked, then choose it here.</p>
          )}
          {f.next_task_id && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Start it</label>
                <select className={inputCls} value={f.next_delay_minutes} onChange={(e) => set('next_delay_minutes', e.target.value)}>
                  <option value="0">Right away</option>
                  <option value="15">After 15 minutes</option>
                  <option value="30">After 30 minutes</option>
                  <option value="60">After 1 hour</option>
                  <option value="120">After 2 hours</option>
                  <option value="240">After 4 hours</option>
                  <option value="-1">Next morning (07:00)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Who does it</label>
                <select className={inputCls} value={f.next_assign} onChange={(e) => set('next_assign', e.target.value)}>
                  <option value="finisher">Whoever finished this task</option>
                  <option value="own">The follow-up's own assignee</option>
                  <option value="auto">Auto (lowest workload)</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {!f.on_hold && (
          <label className="flex items-start gap-2.5 rounded-xl border border-line bg-paper/40 px-3 py-2.5 text-sm text-navy/85">
            <input
              type="checkbox"
              checked={Boolean(f.next_task_id) || f.carry_over}
              disabled={Boolean(f.next_task_id)}
              onChange={(e) => set('carry_over', e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-clay"
            />
            <span>
              <span className="font-semibold text-white">Carry over until finished</span>
              <span className="block text-xs text-navy/55">
                {f.next_task_id
                  ? 'Always on for tasks that start a follow-up.'
                  : 'Never resets at midnight: the task stays open day after day until it is finished.'}{' '}
                Once accepted there are no more reminders that day; the next day at 8:01 AM the assigned person is asked if they are still working on it, and again every morning until it is done.
              </span>
            </span>
          </label>
        )}

        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>
    </Modal>
  )
}
