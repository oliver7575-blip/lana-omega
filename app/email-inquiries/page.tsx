'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

interface Email {
  id: string
  from_email: string | null
  from_name: string | null
  subject: string | null
  body_text: string | null
  received_at: string
  category: string
  summary: string | null
  status: 'new' | 'done'
}

const LABEL: Record<string, string> = {
  inquiry: 'Inquiry',
  reservation: 'Reservation',
  billing: 'Billing',
  job: 'Job application',
  sales: 'Sales / partners',
  other: 'Other',
  automated: 'Automated',
  review: 'Review',
}
const COLOR: Record<string, string> = {
  inquiry: 'bg-sky-500/15 text-sky-200',
  reservation: 'bg-emerald-500/15 text-emerald-200',
  billing: 'bg-amber-500/15 text-amber-200',
  job: 'bg-violet-500/15 text-violet-200',
  sales: 'bg-pink-500/15 text-pink-200',
  other: 'bg-white/10 text-navy/80',
  automated: 'bg-white/5 text-navy/50',
}
const FILTERS = ['all', 'inquiry', 'reservation', 'billing', 'job', 'sales', 'other'] as const

export default function EmailInquiriesPage() {
  const [emails, setEmails] = useState<Email[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all')
  const [view, setView] = useState<'new' | 'done'>('new')
  const [showAutomated, setShowAutomated] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [lastChecked, setLastChecked] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/email-inquiries${showAutomated ? '?automated=1' : ''}`)
      .then((r) => r.json())
      .then((j) => {
        setEmails(j.emails ?? [])
        setLastChecked(j.lastChecked ?? null)
        setLastError(j.lastError ?? null)
        setLoading(false)
      })
  }, [showAutomated])
  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])

  async function patch(id: string, change: { status?: string; category?: string }) {
    setEmails((list) => list.map((e) => (e.id === id ? { ...e, ...change } as Email : e)))
    await fetch('/api/email-inquiries', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...change }) })
    if (change.category === 'review') load()
  }

  const inView = useMemo(() => emails.filter((e) => e.status === view && (e.category !== 'automated' || showAutomated)), [emails, view, showAutomated])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: inView.length }
    for (const e of inView) c[e.category] = (c[e.category] ?? 0) + 1
    return c
  }, [inView])
  const visible = inView.filter((e) => filter === 'all' || e.category === filter)

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl italic text-white">Email Inquiries</h1>
          <p className="mt-1 text-sm text-navy/55">
            Emails to the hotel inbox, sorted by Lana. Booking confirmations and other automated mail are left out.
          </p>
        </div>
        <p className="text-xs text-navy/45">
          {lastChecked ? `Inbox checked ${new Date(lastChecked).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Inbox not checked yet'} · every 5 min
        </p>
      </div>
      {lastError && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">Couldn't read the inbox: {lastError}</p>}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs ${filter === f ? 'border-clay bg-clay/15 text-white' : 'border-line text-navy/60 hover:text-navy'}`}
            >
              {f === 'all' ? 'All' : LABEL[f]} {counts[f] ? <span className="ml-0.5 text-navy/50">{counts[f]}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-navy/55">
            <input type="checkbox" checked={showAutomated} onChange={(e) => setShowAutomated(e.target.checked)} className="accent-clay" />
            Show automated
          </label>
          <div className="flex rounded-lg border border-line p-0.5">
            {(['new', 'done'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`rounded-md px-3 py-1 text-xs ${view === v ? 'bg-surface text-white' : 'text-navy/50 hover:text-navy'}`}>
                {v === 'new' ? 'To handle' : 'Handled'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && <p className="mt-6 text-sm text-navy/55">Loading…</p>}
      {!loading && visible.length === 0 && <p className="mt-6 text-sm text-navy/55">Nothing here.</p>}

      <div className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line">
        {visible.map((e) => {
          const expanded = open === e.id
          const replySubject = e.subject?.toLowerCase().startsWith('re:') ? e.subject : `Re: ${e.subject ?? ''}`
          return (
            <div key={e.id} className="bg-surface/30">
              <button onClick={() => setOpen(expanded ? null : e.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface/60">
                <span className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 text-[11px] ${COLOR[e.category] ?? COLOR.other}`}>{LABEL[e.category] ?? e.category}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="truncate text-sm font-semibold text-white">{e.from_name || e.from_email || 'Unknown sender'}</span>
                    <span className="shrink-0 text-[11px] text-navy/45">{new Date(e.received_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </span>
                  <span className="block truncate text-sm text-navy/85">{e.subject}</span>
                  {e.summary && <span className="mt-0.5 block text-xs text-navy/55">{e.summary}</span>}
                </span>
              </button>
              {expanded && (
                <div className="border-t border-line px-4 pb-4 pt-3">
                  <p className="text-xs text-navy/50">{e.from_email}</p>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/20 p-3 font-sans text-sm text-navy/85">{e.body_text || '(empty)'}</pre>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {e.from_email && (
                      <a
                        href={`mailto:${e.from_email}?subject=${encodeURIComponent(replySubject ?? '')}`}
                        className="rounded-lg bg-clay px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                      >
                        Reply
                      </a>
                    )}
                    <button onClick={() => patch(e.id, { status: e.status === 'new' ? 'done' : 'new' })} className="rounded-lg border border-line px-3 py-1.5 text-xs text-navy hover:bg-line/40">
                      {e.status === 'new' ? 'Mark handled' : 'Move back to "To handle"'}
                    </button>
                    <label className="ml-auto flex items-center gap-1.5 text-xs text-navy/55">
                      Move to
                      <select value={e.category} onChange={(ev) => patch(e.id, { category: ev.target.value })} className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-navy">
                        {Object.keys(LABEL).map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
