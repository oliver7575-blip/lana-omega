'use client'

import { useState } from 'react'
import { cbApi, dmy, statusLabel, type DashRow } from './shared'

/** Beta's "Search reservations, guests, and more" bar with a results list. */
export default function SearchBar({ onOpen }: { onOpen: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<DashRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search() {
    if (!q.trim()) return
    setBusy(true)
    setError(null)
    try {
      setRows((await cbApi<{ rows: DashRow[] }>(`/api/cloudbeds/search?q=${encodeURIComponent(q)}`)).rows)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    }
    setBusy(false)
  }

  return (
    <div className="relative w-full max-w-2xl">
      <form onSubmit={(e) => { e.preventDefault(); search() }}
        className="flex items-center gap-2 rounded-full border border-gray-300 bg-white py-1 pl-4 pr-1 shadow-sm">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reservations, guests, and more"
          className="flex-1 bg-transparent py-1 text-sm text-[#14213d] outline-none placeholder:text-gray-500" />
        <button className="rounded-full bg-[#3b6fe0] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#2f5fcc]">{busy ? '…' : 'Search'}</button>
      </form>
      {(rows || error) && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white text-sm text-[#14213d] shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
            <span>{error ?? `${rows!.length} result${rows!.length === 1 ? '' : 's'}`}</span>
            <button onClick={() => { setRows(null); setError(null) }} className="text-gray-400 hover:text-gray-700">Close</button>
          </div>
          {rows?.map((r) => (
            <button key={r.reservationID} onClick={() => { onOpen(r.reservationID); setRows(null) }}
              className="flex w-full items-center justify-between gap-3 border-b border-gray-100 px-4 py-2.5 text-left last:border-0 hover:bg-gray-50">
              <span>
                <span className="font-semibold">{r.guestName}</span>
                <span className="ml-2 text-gray-500">#{r.reservationID}</span>
              </span>
              <span className="text-right text-xs text-gray-500">{dmy(r.startDate)} → {dmy(r.endDate)} · {r.room} · {statusLabel(r.status)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
