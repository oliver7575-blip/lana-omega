'use client'

import { useEffect, useState } from 'react'

interface WaitlistEntry {
  id: string
  full_name: string
  email: string
  phone: string
  date_requested: string
  notes: string | null
  status: string
  created_at: string
}

export default function WaitlistPage() {
  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/waitlist')
      .then((res) => res.json())
      .then((json) => {
        setEntries(json.entries ?? [])
        setLoading(false)
      })
  }, [])

  async function remove(entry: WaitlistEntry) {
    if (!confirm(`Delete ${entry.full_name} from the waitlist? This can't be undone.`)) return
    setBusy(entry.id)
    setError(null)
    const res = await fetch(`/api/waitlist?id=${encodeURIComponent(entry.id)}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) {
      setError(json.error ?? 'Could not delete the entry')
      return
    }
    setEntries((list) => list.filter((e) => e.id !== entry.id))
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
      <h1 className="font-serif text-4xl italic text-white">Waitlist</h1>
      <p className="mt-1 text-sm text-navy/55">Guests waiting for dates that were full. {entries.length > 0 && `${entries.length} waiting.`}</p>

      {error && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      {loading && <p className="mt-6 text-sm text-navy/55">Loading…</p>}
      {!loading && entries.length === 0 && <p className="mt-6 text-sm text-navy/55">No waitlist entries.</p>}

      <div className="mt-6 space-y-3">
        {entries.map((entry) => (
          <div key={entry.id} className="rounded-xl border border-line bg-surface/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-white">{entry.full_name}</p>
                <p className="text-xs text-navy/50">Added {new Date(entry.created_at).toLocaleString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-md px-2 py-0.5 text-xs ${entry.status === 'pending' ? 'bg-amber-500/15 text-amber-200' : 'bg-white/10 text-navy/70'}`}>
                  {entry.status}
                </span>
                <button
                  onClick={() => remove(entry)}
                  disabled={busy === entry.id}
                  className="rounded-md px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                >
                  {busy === entry.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
            <p className="mt-2 text-sm text-navy/85">
              Wants: <span className="font-semibold text-white">{entry.date_requested}</span>
            </p>
            <p className="mt-1 text-sm text-navy/70">{[entry.email, entry.phone].filter(Boolean).join(' · ')}</p>
            {entry.notes && <p className="mt-2 text-sm text-navy/70">Notes: {entry.notes}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
