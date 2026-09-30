'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import StaffModal from '@/components/maintenance/StaffModal'
import TaskModal from '@/components/maintenance/TaskModal'
import TaskDrawer from '@/components/maintenance/TaskDrawer'
import PreviewModal from '@/components/maintenance/PreviewModal'
import { api, fmtDateTime, localParts, recurrenceLabel, STATUS_LABEL, titleCase, type Staff, type Task } from '@/components/maintenance/shared'

interface Stats { open: number; inProgress: number; needAttention: number; completed: number }
interface ActivityEvent { id: string; task_id: string; task_title: string; event_type: string; detail: string; created_at: string }

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'seasonal', label: 'Seasonal' },
  { key: 'interval', label: 'Every X hrs' },
  { key: 'none', label: 'One-off' },
  { key: 'urgent', label: '🚨 Urgent' },
]
const STATUS_TABS = [
  { key: 'all', label: 'All active' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'waiting', label: 'Waiting' },
]

function eventIcon(type: string) {
  if (type.includes('assign')) return '→'
  if (type.includes('completed') || type === 'status_changed') return '✓'
  if (type.includes('escalation') || type.includes('failed') || type.includes('help')) return '!'
  if (type.includes('deferred') || type.includes('reassessed')) return '⏱'
  return '+'
}

export default function MaintenancePage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [stats, setStats] = useState<Stats>({ open: 0, inProgress: 0, needAttention: 0, completed: 0 })
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [tz, setTz] = useState('America/Mexico_City')
  const [loaded, setLoaded] = useState(false)

  const [staffFilter, setStaffFilter] = useState('')
  const [dateFilter, setDateFilter] = useState<string>(() => localParts(new Date().toISOString(), 'America/Mexico_City').date)
  const [mode, setMode] = useState<'active' | 'completed'>('active')
  const [category, setCategory] = useState('all')
  const [statusTab, setStatusTab] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [showStaff, setShowStaff] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [editTask, setEditTask] = useState<Task | null | 'new'>(null)
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [t, s, a] = await Promise.all([
        api<{ tasks: Task[]; stats: Stats; timezone: string }>('/api/maintenance/tasks'),
        api<{ staff: Staff[] }>('/api/maintenance/staff'),
        api<{ events: ActivityEvent[] }>('/api/maintenance/activity'),
      ])
      setTasks(t.tasks)
      setStats(t.stats)
      setStaff(s.staff)
      setActivity(a.events)
      if (t.timezone && t.timezone !== tz) {
        setTz(t.timezone)
        if (!loaded) setDateFilter(localParts(new Date().toISOString(), t.timezone).date)
      }
    } catch (e) {
      setFlash(e instanceof Error ? e.message : 'Could not load maintenance')
    }
    setLoaded(true)
  }, [tz, loaded])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  const staffName = (id: string | null) => (id ? staff.find((s) => s.id === id)?.name ?? '—' : 'Unassigned')

  const visible = useMemo(() => {
    return tasks
      .filter((t) => (mode === 'active' ? ['scheduled', 'waiting', 'in_progress'].includes(t.status) : ['done', 'cancelled'].includes(t.status)))
      .filter((t) => !staffFilter || t.assigned_to === staffFilter)
      .filter((t) => {
        if (!dateFilter) return true
        const ref = mode === 'completed' ? t.completed_at ?? t.updated_at : t.due_at
        return ref ? localParts(ref, tz).date === dateFilter : false
      })
      .filter((t) => (category === 'all' ? true : category === 'urgent' ? t.priority === 'urgent' : t.recurrence_rule === category))
      .filter((t) => (mode === 'completed' || statusTab === 'all' ? true : t.status === statusTab))
      .sort((a, b) =>
        mode === 'completed'
          ? (b.completed_at ?? b.updated_at).localeCompare(a.completed_at ?? a.updated_at)
          : (a.due_at ?? '').localeCompare(b.due_at ?? '')
      )
  }, [tasks, mode, staffFilter, dateFilter, category, statusTab, tz])

  async function run(fn: () => Promise<unknown>, ok?: string) {
    try {
      await fn()
      if (ok) setFlash(ok)
    } catch (e) {
      setFlash(e instanceof Error ? e.message : 'Something went wrong')
    }
    load()
  }

  const action = (t: Task, a: string, ok: string) => run(() => api(`/api/maintenance/tasks/${t.id}/action`, 'POST', { action: a }), ok)
  const setStatus = (t: Task, status: string) => run(() => api(`/api/maintenance/tasks/${t.id}`, 'PATCH', { status }))
  const remove = (t: Task) => {
    if (confirm(`Delete "${t.title}" (#${t.task_code})? A recurring task stops repeating.`)) {
      run(() => api(`/api/maintenance/tasks/${t.id}`, 'DELETE'), 'Task deleted')
    }
  }
  const bulk = (a: 'mark_done' | 'delete') => {
    if (a === 'delete' && !confirm(`Delete ${selected.size} task(s)?`)) return
    run(() => api('/api/maintenance/bulk', 'POST', { ids: [...selected], action: a }), a === 'delete' ? 'Deleted' : 'Marked done').then(() =>
      setSelected(new Set())
    )
  }

  const statCard = (label: string, value: number, sub: string, subCls = 'text-navy/50') => (
    <div className="rounded-2xl border border-line bg-surface px-5 py-5">
      <p className="text-[11px] font-semibold uppercase tracking-[.13em] text-navy/60">{label}</p>
      <p className="mt-2 text-4xl font-semibold text-white">{value}</p>
      <p className={`mt-1 text-sm ${subCls}`}>{sub}</p>
    </div>
  )

  const allVisibleSelected = visible.length > 0 && visible.every((t) => selected.has(t.id))
  const cols = 'grid grid-cols-[24px_minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1.5fr)] items-center gap-4'

  return (
    <main className="px-5 py-6 md:px-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl italic text-white">Maintenance</h1>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[.18em] text-emerald-300">
              WhatsApp automation
            </span>
          </div>
          <p className="mt-1 text-sm text-navy/60">Assign maintenance tasks, send reminders, and track WhatsApp replies.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowPreview(true)} className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3.5 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-400/15">
            Preview reminders
          </button>
          <button onClick={() => setShowStaff(true)} className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm text-navy hover:bg-line/40">
            + Add staff
          </button>
          <button onClick={() => setEditTask('new')} className="rounded-lg bg-clay px-3.5 py-2 text-sm font-semibold text-white hover:bg-clay/90">
            + Add task
          </button>
        </div>
      </div>

      {flash && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-2.5 text-sm text-navy/85">
          <span>{flash}</span>
          <button onClick={() => setFlash(null)} className="text-navy/50 hover:text-navy">×</button>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCard('Open tasks', stats.open, 'Active queue')}
        {statCard('In progress', stats.inProgress, 'Staff are working')}
        {statCard('Need attention', stats.needAttention, 'Escalation required', 'text-clay')}
        {statCard('Completed', stats.completed, 'All time')}
      </div>

      <section className="mb-6 rounded-2xl border border-line bg-surface">
        <div className="flex flex-col gap-4 px-5 pt-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Task list</h2>
            <p className="text-sm text-navy/50">{visible.length} shown</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)} className="rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-navy outline-none">
              <option value="">All staff</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-navy outline-none" />
            <button onClick={() => setDateFilter('')} title="Show all dates" className="rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm text-navy/60 hover:text-navy">×</button>
            <div className="flex rounded-lg bg-paper p-1">
              {(['active', 'completed'] as const).map((m) => (
                <button key={m} onClick={() => { setMode(m); setSelected(new Set()) }} className={`rounded-md px-3 py-1 text-sm capitalize ${mode === m ? 'bg-surface text-white' : 'text-navy/50 hover:text-navy'}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 px-5 pt-4">
          {CATEGORIES.map((c) => (
            <button key={c.key} onClick={() => setCategory(c.key)} className={`rounded-full border px-3 py-1 text-sm ${category === c.key ? 'border-clay text-clay' : 'border-line text-navy/70 hover:border-navy/30'}`}>
              {c.label}
            </button>
          ))}
        </div>
        {mode === 'active' && (
          <div className="flex flex-wrap gap-1 px-5 pt-3">
            {STATUS_TABS.map((s) => (
              <button key={s.key} onClick={() => setStatusTab(s.key)} className={`rounded-md px-3 py-1.5 text-sm ${statusTab === s.key ? 'bg-paper text-white' : 'text-navy/50 hover:text-navy'}`}>
                {s.label}
              </button>
            ))}
          </div>
        )}

        {selected.size > 0 && (
          <div className="mx-5 mt-3 flex items-center gap-4 rounded-lg bg-paper px-4 py-2 text-sm">
            <span className="text-navy/70">{selected.size} selected</span>
            {mode === 'active' && <button onClick={() => bulk('mark_done')} className="text-emerald-300 hover:underline">Mark done</button>}
            <button onClick={() => bulk('delete')} className="text-red-300 hover:underline">Delete</button>
          </div>
        )}

        <div className="mt-4 overflow-x-auto border-t border-line">
          <div className="min-w-[860px]">
            <div className={`${cols} border-b border-line px-5 py-3 text-[11px] font-semibold uppercase tracking-[.13em] text-navy/45`}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((t) => t.id)))}
                className="h-4 w-4 accent-clay"
              />
              <span>Task</span>
              <span>Assigned to</span>
              <span>Due</span>
              <span>Status</span>
              <span>Action</span>
            </div>
            {loaded && visible.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-navy/50">
                No tasks here{dateFilter ? ' for this date — clear the date (×) to see all' : ''}.
              </p>
            )}
            {visible.map((t) => (
              <div key={t.id} className={`${cols} border-b border-line px-5 py-3.5 last:border-b-0 hover:bg-white/[0.02]`}>
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => {
                    const n = new Set(selected)
                    if (n.has(t.id)) n.delete(t.id)
                    else n.add(t.id)
                    setSelected(n)
                  }}
                  className="h-4 w-4 accent-clay"
                />
                <button onClick={() => setDrawerId(t.id)} className="min-w-0 text-left">
                  <p className="truncate">
                    <span className="mr-2 font-mono text-[10px] text-navy/40">#{t.task_code}</span>
                    <span className="text-[15px] text-white">{t.title}</span>
                    {t.priority === 'urgent' && <span className="ml-2 text-xs text-red-300">🚨 Urgent</span>}
                  </p>
                  <p className="truncate text-xs text-navy/50">
                    {[t.location ? `⌖ ${t.location}` : null, t.priority, recurrenceLabel(t), `${t.reminder_count} reminder${t.reminder_count === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                    {t.escalation_status === 'required' && <span className="ml-2 text-clay">· Needs attention</span>}
                  </p>
                </button>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[10px] font-semibold text-navy/80">
                    {t.assigned_to ? staffName(t.assigned_to)[0]?.toUpperCase() : '—'}
                  </span>
                  <span className="truncate text-sm text-navy/85">{t.assigned_to ? staffName(t.assigned_to) : 'Auto'}</span>
                </div>
                <span className="text-sm text-navy/70">{fmtDateTime(mode === 'completed' ? t.completed_at ?? t.updated_at : t.due_at, tz)}</span>
                <select
                  value={t.status}
                  onChange={(e) => setStatus(t, e.target.value)}
                  className="w-fit rounded-md border border-line bg-paper px-2 py-1 text-sm text-navy outline-none"
                >
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <button onClick={() => setEditTask(t)} className="text-navy/75 hover:text-navy">Edit</button>
                  {mode === 'active' && (
                    <>
                      <button onClick={() => action(t, 'send_now', 'Reminder sent')} className="text-navy/85 hover:text-white">⚡ Send now</button>
                      <button onClick={() => action(t, 'mark_done', `#${t.task_code} marked done`)} className="text-emerald-300 hover:text-emerald-200">Mark done</button>
                    </>
                  )}
                  <button onClick={() => remove(t)} className="text-red-300 hover:text-red-200">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface px-5 py-5">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Activity</h2>
            <p className="text-sm text-navy/50">Live audit trail for maintenance work</p>
          </div>
          <span className="mt-2 h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />
        </div>
        {activity.length === 0 && <p className="text-sm text-navy/50">No activity yet.</p>}
        <div className="grid gap-3 lg:grid-cols-2">
          {activity.map((e) => (
            <button key={e.id} onClick={() => setDrawerId(e.task_id)} className="flex gap-3 rounded-xl border border-line bg-paper/40 px-4 py-3 text-left hover:bg-paper/60">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-clay/10 text-sm text-clay">{eventIcon(e.event_type)}</span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">{e.task_title}</span>
                <span className="block text-xs text-navy/60">{titleCase(e.detail)}</span>
                <span className="block text-xs text-navy/40">{fmtDateTime(e.created_at, tz)}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {showStaff && <StaffModal staff={staff} timezone={tz} onClose={() => setShowStaff(false)} onChanged={load} />}
      {showPreview && <PreviewModal onClose={() => setShowPreview(false)} />}
      {editTask && (
        <TaskModal
          task={editTask === 'new' ? null : editTask}
          staff={staff}
          timezone={tz}
          onClose={() => setEditTask(null)}
          onSaved={() => { setEditTask(null); load() }}
        />
      )}
      {drawerId && <TaskDrawer taskId={drawerId} staff={staff} timezone={tz} onClose={() => setDrawerId(null)} onChanged={load} />}
    </main>
  )
}
