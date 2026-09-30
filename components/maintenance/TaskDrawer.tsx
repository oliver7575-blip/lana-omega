'use client'

import { useEffect, useState } from 'react'
import { api, fmtDateTime, recurrenceLabel, STATUS_LABEL, titleCase, type Staff, type Task } from './shared'

interface Detail {
  task: Task
  reminders: { id: string; scheduled_for: string; sent_at: string | null; status: string; error_message: string | null }[]
  messages: { id: string; direction: string; content: string; delivery_status: string | null; created_at: string }[]
  events: { id: string; event_type: string; detail: string; created_at: string }[]
}

export default function TaskDrawer({ taskId, staff, timezone, onClose, onChanged }: {
  taskId: string
  staff: Staff[]
  timezone: string
  onClose: () => void
  onChanged: () => void
}) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setD(await api<Detail>(`/api/maintenance/tasks/${taskId}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load')
    }
  }
  useEffect(() => {
    load()
  }, [taskId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function escalation(action: 'ack_escalation' | 'resolve_escalation') {
    await api(`/api/maintenance/tasks/${taskId}/action`, 'POST', { action })
    await load()
    onChanged()
  }

  const t = d?.task
  const assignee = t?.assigned_to ? staff.find((s) => s.id === t.assigned_to)?.name ?? '—' : 'Auto-assign'
  const box = 'rounded-xl border border-line bg-paper/40 px-4 py-3'
  const boxLabel = 'text-[10px] font-semibold uppercase tracking-[.13em] text-navy/50'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <aside className="h-full w-full max-w-lg overflow-y-auto border-l border-line bg-surface px-6 py-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <p className="font-mono text-xs text-clay">#{t?.task_code ?? ''}</p>
          <button onClick={onClose} className="text-xl text-navy/50 hover:text-navy" aria-label="Close">×</button>
        </div>
        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
        {!t ? (
          <p className="mt-6 text-sm text-navy/50">Loading…</p>
        ) : (
          <>
            <h2 className="mt-1 font-display text-2xl italic text-white">{t.title}</h2>
            <p className="mt-1 text-sm text-navy/60">
              {[t.location, t.priority, recurrenceLabel(t)].filter(Boolean).join(' · ')}
            </p>
            {t.description && <p className="mt-2 whitespace-pre-wrap text-sm text-navy/75">{t.description}</p>}

            {(t.escalation_status === 'required' || t.escalation_status === 'acknowledged') && (
              <div className="mt-4 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3">
                <p className="text-sm font-semibold text-red-200">
                  {t.escalation_status === 'required' ? 'Escalation required' : 'Escalation acknowledged'}
                </p>
                <p className="text-xs text-red-200/70">Reminders stopped after 3 unanswered messages.</p>
                <div className="mt-2 flex gap-3">
                  {t.escalation_status === 'required' && (
                    <button onClick={() => escalation('ack_escalation')} className="rounded-lg border border-red-300/30 px-3 py-1 text-xs text-red-200 hover:bg-red-400/10">
                      Acknowledge
                    </button>
                  )}
                  <button onClick={() => escalation('resolve_escalation')} className="rounded-lg border border-red-300/30 px-3 py-1 text-xs text-red-200 hover:bg-red-400/10">
                    Resolve
                  </button>
                </div>
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className={box}><p className={boxLabel}>Status</p><p className="mt-1 text-sm text-white">{STATUS_LABEL[t.status]}</p></div>
              <div className={box}><p className={boxLabel}>Assigned to</p><p className="mt-1 text-sm text-white">{assignee}</p></div>
              <div className={box}><p className={boxLabel}>Deadline</p><p className="mt-1 text-sm text-white">{fmtDateTime(t.due_at, timezone)}</p></div>
              <div className={box}><p className={boxLabel}>Reminders</p><p className="mt-1 text-sm text-white">{t.reminder_count}</p></div>
            </div>

            <h3 className="mb-2 mt-6 text-sm font-semibold text-white">Reminder schedule</h3>
            {d.reminders.length === 0 ? (
              <p className="text-sm text-navy/50">No reminders.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {d.reminders.map((r) => (
                  <span key={r.id} title={r.error_message ?? ''} className={`rounded-lg border border-line px-3 py-1.5 text-xs ${r.status === 'failed' ? 'text-red-300' : r.status === 'cancelled' ? 'text-navy/35 line-through' : 'text-navy/75'}`}>
                    {titleCase(r.status)} · {fmtDateTime(r.sent_at ?? r.scheduled_for, timezone)}
                  </span>
                ))}
              </div>
            )}

            <h3 className="mb-2 mt-6 text-sm font-semibold text-white">Message history</h3>
            {d.messages.length === 0 ? (
              <p className="text-sm text-navy/50">No messages yet.</p>
            ) : (
              <div className="space-y-2">
                {d.messages.map((m) => (
                  <div key={m.id} className={`rounded-xl px-4 py-3 ${m.direction === 'outbound' ? 'ml-8 bg-clay/5' : 'mr-8 bg-paper/60'}`}>
                    <div className="flex justify-between text-[10px] font-semibold uppercase tracking-[.1em] text-navy/45">
                      <span>{m.direction} · WhatsApp</span>
                      <span>{m.delivery_status}</span>
                    </div>
                    <p className="mt-1 text-sm text-white">{m.content}</p>
                    <p className="mt-0.5 text-xs text-navy/40">{fmtDateTime(m.created_at, timezone)}</p>
                  </div>
                ))}
              </div>
            )}

            <h3 className="mb-2 mt-6 text-sm font-semibold text-white">Audit trail</h3>
            <div className="space-y-3 border-l border-line pl-4">
              {d.events.map((e) => (
                <div key={e.id}>
                  <p className="text-sm font-semibold text-white">{titleCase(e.event_type.replace(/_/g, ' '))}</p>
                  <p className="text-xs text-navy/65">{e.detail}</p>
                  <p className="text-xs text-navy/40">{fmtDateTime(e.created_at, timezone)}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  )
}
