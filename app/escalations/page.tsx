'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Escalation {
  id: string
  conversation_id: string | null
  category: string
  urgency: string
  summary: string
  room: string | null
  delivered: boolean
  status: 'new' | 'read'
  created_at: string
}

function fmt(iso: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Mexico_City',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso))
}

export default function EscalationsPage() {
  const [items, setItems] = useState<Escalation[] | null>(null)
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  async function load() {
    const res = await fetch('/api/escalations', { cache: 'no-store' })
    const json = await res.json()
    setItems(json.escalations ?? [])
    setTotal(json.total ?? 0)
  }
  useEffect(() => {
    load()
  }, [])

  async function setStatus(ids: string[], status: 'read' | 'new') {
    await fetch('/api/escalations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, status }),
    })
    setSelected(new Set())
    load()
  }

  const unread = (items ?? []).filter((e) => e.status === 'new')
  const allUnreadSelected = unread.length > 0 && unread.every((e) => selected.has(e.id))

  return (
    <main className="px-5 py-7 md:px-8 xl:px-10">
      <div className="mb-7 flex items-center justify-between">
        <h1 className="font-display text-4xl italic text-white">Escalations</h1>
        <p className="text-lg text-navy/60">{total} total</p>
      </div>

      <div className="mb-5 flex items-center justify-between rounded-2xl border border-line bg-surface px-6 py-4">
        <label className="flex items-center gap-4 text-navy/80">
          <input
            type="checkbox"
            checked={allUnreadSelected}
            onChange={() => setSelected(allUnreadSelected ? new Set() : new Set(unread.map((e) => e.id)))}
            className="h-5 w-5 accent-clay"
          />
          Select unread escalations
        </label>
        <button
          disabled={selected.size === 0}
          onClick={() => setStatus([...selected], 'read')}
          className="rounded-lg border border-line px-4 py-2 text-navy/80 transition hover:bg-white/[0.05] disabled:text-navy/25"
        >
          Mark selected as read
        </button>
      </div>

      {items === null && <p className="text-navy/50">Loading…</p>}
      {items?.length === 0 && (
        <p className="rounded-2xl border border-line bg-surface px-6 py-10 text-center text-navy/50">
          No escalations yet. They appear here whenever Lana alerts staff.
        </p>
      )}

      <div className="space-y-5">
        {(items ?? []).map((e) => {
          const isNew = e.status === 'new'
          return (
            <div key={e.id} className="flex items-start gap-5 rounded-2xl border border-line bg-surface px-6 py-5">
              <input
                type="checkbox"
                checked={selected.has(e.id)}
                onChange={() => {
                  const next = new Set(selected)
                  if (next.has(e.id)) next.delete(e.id)
                  else next.add(e.id)
                  setSelected(next)
                }}
                className="mt-2 h-5 w-5 shrink-0 accent-clay"
              />
              <span className={`mt-2 h-4 w-4 shrink-0 rounded-full ${isNew ? 'bg-[#ef4d3f]' : 'bg-[#35b876]'}`} />
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-full px-3.5 py-1 text-sm font-medium capitalize ${
                      isNew ? 'bg-[#fff0ed] text-[#b54434]' : 'bg-[#eaf8f2] text-[#176b4d]'
                    }`}
                  >
                    {e.category}
                  </span>
                  <span className="text-sm uppercase tracking-wide text-navy/50">{e.urgency === 'urgent' ? 'high' : e.urgency}</span>
                  {e.room && <span className="text-sm text-navy/50">Room {e.room}</span>}
                  {!e.delivered && <span className="text-sm text-amber-300">alert not delivered</span>}
                  <span className="ml-auto text-sm text-navy/50">{fmt(e.created_at)}</span>
                </div>
                <p className="text-lg text-navy">{e.summary}</p>
                <div className="mt-1 flex items-center gap-4">
                  <span className={isNew ? 'text-[#ef4d3f]' : 'text-[#35b876]'}>{isNew ? 'New' : 'Read'}</span>
                  {e.conversation_id && (
                    <Link href={`/conversations/${e.conversation_id}`} className="text-sm text-navy/60 hover:text-clay">
                      Open conversation →
                    </Link>
                  )}
                </div>
              </div>
              <button
                onClick={() => setStatus([e.id], isNew ? 'read' : 'new')}
                className="shrink-0 rounded-lg border border-line px-4 py-2 text-sm text-navy/80 hover:bg-white/[0.05]"
              >
                {isNew ? 'Mark read' : 'Mark unread'}
              </button>
            </div>
          )
        })}
      </div>
    </main>
  )
}
