'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export interface InboxListRow {
  id: string
  name: string
  channel: string
  reservationStatus: string | null
  phone: string | null
  preview: string
  status: string
  unread: boolean
  ago: string
}

/** The conversation list with Escalations-style read/unread controls. */
export default function InboxList({ rows }: { rows: InboxListRow[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [override, setOverride] = useState<Record<string, boolean>>({}) // id → unread, until the page refreshes
  const [busy, setBusy] = useState(false)

  const isUnread = (r: InboxListRow) => (r.id in override ? override[r.id] : r.unread)
  const unreadRows = rows.filter(isUnread)
  const allUnreadSelected = unreadRows.length > 0 && unreadRows.every((r) => selected.has(r.id))

  async function mark(ids: string[], read: boolean) {
    if (!ids.length) return
    setBusy(true)
    setOverride((o) => ({ ...o, ...Object.fromEntries(ids.map((id) => [id, !read])) }))
    const res = await fetch('/api/inbox/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, read }),
    })
    if (!res.ok) setOverride((o) => Object.fromEntries(Object.entries(o).filter(([k]) => !ids.includes(k))))
    setSelected(new Set())
    setBusy(false)
    router.refresh()
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-4 py-2.5 sm:px-5">
        <label className="flex items-center gap-3 text-sm text-navy/80">
          <input
            type="checkbox"
            checked={allUnreadSelected}
            onChange={() => setSelected(allUnreadSelected ? new Set() : new Set(unreadRows.map((r) => r.id)))}
            className="h-4 w-4 accent-clay"
          />
          Select unread messages
        </label>
        <div className="flex gap-2">
          <button
            disabled={selected.size === 0 || busy}
            onClick={() => mark([...selected], true)}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-navy/80 transition hover:bg-white/[0.05] disabled:text-navy/25"
          >
            Mark selected as read
          </button>
          <button
            disabled={unreadRows.length === 0 || busy}
            onClick={() => mark(unreadRows.map((r) => r.id), true)}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-navy/80 transition hover:bg-white/[0.05] disabled:text-navy/25"
          >
            Mark all as read
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        {rows.length === 0 && <p className="px-6 py-10 text-center text-sm text-navy/50">No conversations here.</p>}
        {rows.map((r) => {
          const unread = isUnread(r)
          return (
            <div key={r.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0 hover:bg-white/[0.03] sm:px-5">
              <input
                type="checkbox"
                checked={selected.has(r.id)}
                onChange={() => {
                  const next = new Set(selected)
                  if (next.has(r.id)) next.delete(r.id)
                  else next.add(r.id)
                  setSelected(next)
                }}
                className="h-4 w-4 shrink-0 accent-clay"
                aria-label="Select conversation"
              />
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${unread ? 'bg-[#ef4d3f]' : 'bg-[#35b876]'}`} title={unread ? 'Unread' : 'Read'} />
              <Link href={`/conversations/${r.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper font-display text-base italic text-white">
                  {r.name ? r.name[0].toUpperCase() : ''}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {r.name && <span className={`text-[14px] text-white ${unread ? 'font-semibold' : 'font-normal'}`}>{r.name}</span>}
                    <span className="text-[11px] uppercase tracking-wider text-navy/45">{r.channel}</span>
                    {r.reservationStatus && (
                      <span className="rounded-full bg-clay/15 px-2 py-0.5 text-[11px] text-clay">{r.reservationStatus.replace(/_/g, ' ')}</span>
                    )}
                  </div>
                  {r.phone && <p className="text-xs text-navy/55">{r.phone}</p>}
                  <p className={`truncate text-sm ${unread ? 'text-navy' : 'text-navy/70'}`}>{r.preview}</p>
                </div>
              </Link>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {r.status === 'human_takeover' ? (
                  <span className="rounded-full bg-purple-500/15 px-2.5 py-1 text-xs font-medium text-purple-300">human takeover</span>
                ) : unread ? (
                  <span className="rounded-full bg-[#1b2340] px-2.5 py-1 text-xs font-medium text-[#8dacff]">new</span>
                ) : null}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => mark([r.id], unread)}
                    disabled={busy}
                    className="hidden rounded-md border border-line px-2 py-0.5 text-[11px] text-navy/70 hover:bg-white/[0.05] sm:block"
                  >
                    {unread ? 'Mark read' : 'Mark unread'}
                  </button>
                  <span className="text-xs text-navy/50">{r.ago}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
