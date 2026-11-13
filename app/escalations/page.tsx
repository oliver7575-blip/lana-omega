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
  handled_at: string | null
  handled_by: string | null
  staff_reply: string | null
  replied_by: string | null
  guest_informed: boolean
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
  const [tab, setTab] = useState<'open' | 'handled'>('open')

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

  async function setHandled(ids: string[], handled: boolean) {
    await fetch('/api/escalations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, handled }),
    })
    setSelected(new Set())
    load()
  }

  const openItems = (items ?? []).filter((e) => !e.handled_at)
  const handledItems = (items ?? []).filter((e) => e.handled_at)
  const shown = tab === 'open' ? openItems : handledItems
  const allShownSelected = shown.length > 0 && shown.every((e) => selected.has(e.id))

  return (
    <main>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-display text-2xl italic text-white sm:text-3xl">Escalations</h1>
        <p className="text-sm text-navy/60">{total} total</p>
      </div>

      <div className="mb-3 flex gap-2">
        {([['open', 'To handle', openItems.length], ['handled', 'Handled', handledItems.length]] as const).map(([key, label, n]) => (
          <button
            key={key}
            onClick={() => {
              setTab(key)
              setSelected(new Set())
            }}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${
              tab === key ? 'border-clay bg-clay/15 text-white' : 'border-line text-navy/70 hover:bg-white/[0.05]'
            }`}
          >
            {label} <span className="text-navy/50">{n}</span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between rounded-2xl border border-line bg-surface px-5 py-3">
        <label className="flex items-center gap-3 text-sm text-navy/80">
          <input
            type="checkbox"
            checked={allShownSelected}
            onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((e) => e.id)))}
            className="h-4 w-4 accent-clay"
          />
          Select all {shown.length}
        </label>
        <div className="flex gap-2">
          {tab === 'open' && (
            <button
              disabled={selected.size === 0}
              onClick={() => setStatus([...selected], 'read')}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-navy/80 transition hover:bg-white/[0.05] disabled:text-navy/25"
            >
              Mark selected as read
            </button>
          )}
          <button
            disabled={selected.size === 0}
            onClick={() => setHandled([...selected], tab === 'open')}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-navy/80 transition hover:bg-white/[0.05] disabled:text-navy/25"
          >
            {tab === 'open' ? 'Mark selected as handled' : 'Move selected back to to-handle'}
          </button>
        </div>
      </div>

      {items === null && <p className="text-navy/50">Loading…</p>}
      {items !== null && shown.length === 0 && (
        <p className="rounded-2xl border border-line bg-surface px-6 py-10 text-center text-sm text-navy/50">
          {tab === 'open' ? 'Nothing left to handle. New escalations appear here whenever Lana alerts staff.' : 'No handled escalations yet.'}
        </p>
      )}

      <div className="space-y-3">
        {shown.map((e) => {
          const isNew = e.status === 'new'
          return (
            <div key={e.id} className="flex items-start gap-4 rounded-2xl border border-line bg-surface px-5 py-4">
              <input
                type="checkbox"
                checked={selected.has(e.id)}
                onChange={() => {
                  const next = new Set(selected)
                  if (next.has(e.id)) next.delete(e.id)
                  else next.add(e.id)
                  setSelected(next)
                }}
                className="mt-1 h-4 w-4 shrink-0 accent-clay"
              />
              <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${isNew ? 'bg-[#ef4d3f]' : 'bg-[#35b876]'}`} />
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
                      isNew ? 'bg-[#fff0ed] text-[#b54434]' : 'bg-[#eaf8f2] text-[#176b4d]'
                    }`}
                  >
                    {e.category}
                  </span>
                  <span className="text-xs uppercase tracking-wide text-navy/50">{e.urgency === 'urgent' ? 'high' : e.urgency}</span>
                  {e.room && <span className="text-xs text-navy/50">Room {e.room}</span>}
                  {!e.delivered && <span className="text-xs text-amber-300">alert not delivered</span>}
                  <span className="ml-auto text-xs text-navy/50">{fmt(e.created_at)}</span>
                </div>
                <p className="text-sm text-navy">{e.summary}</p>
                {e.staff_reply && (
                  <p className="mt-2 rounded-lg border border-line bg-white/[0.03] px-3 py-2 text-xs text-navy/80">
                    <span className="text-navy/50">Team replied{e.replied_by ? ` (${e.replied_by})` : ''}:</span> {e.staff_reply}
                    {e.guest_informed && <span className="ml-2 text-[#35b876]">· guest informed</span>}
                  </p>
                )}
                <div className="mt-1 flex items-center gap-4 text-xs">
                  <span className={e.handled_at ? 'text-[#35b876]' : isNew ? 'text-[#ef4d3f]' : 'text-navy/60'}>
                    {e.handled_at ? `Handled${e.handled_by ? ` by ${e.handled_by}` : ''}` : isNew ? 'New' : 'Read'}
                  </span>
                  {e.conversation_id && (
                    <Link href={`/conversations/${e.conversation_id}`} className="text-navy/60 hover:text-clay">
                      Open conversation →
                    </Link>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <button
                  onClick={() => setHandled([e.id], !e.handled_at)}
                  className={`rounded-lg px-3 py-1.5 text-xs ${
                    e.handled_at ? 'border border-line text-navy/80 hover:bg-white/[0.05]' : 'bg-clay text-[#1a0f08] hover:opacity-90'
                  }`}
                >
                  {e.handled_at ? 'Move back' : 'Mark handled'}
                </button>
                {!e.handled_at && (
                  <button
                    onClick={() => setStatus([e.id], isNew ? 'read' : 'new')}
                    className="rounded-lg border border-line px-3 py-1.5 text-xs text-navy/80 hover:bg-white/[0.05]"
                  >
                    {isNew ? 'Mark read' : 'Mark unread'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </main>
  )
}
