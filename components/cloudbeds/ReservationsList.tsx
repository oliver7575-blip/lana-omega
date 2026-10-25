'use client'

import { useCallback, useEffect, useState } from 'react'
import ReservationModal from './ReservationModal'
import RoomCell from './RoomCell'
import { cbApi, longDate, mxn, nights, statusLabel, type ReservationSummary } from './shared'

export default function ReservationsList() {
  const [rows, setRows] = useState<ReservationSummary[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const today = new Date().toISOString().slice(0, 10)

  const load = useCallback(async (p: number, replace: boolean) => {
    setLoading(true)
    setError(null)
    try {
      const j = await cbApi<{ rows: ReservationSummary[]; hasMore: boolean }>(`/api/cloudbeds/reservations?page=${p}`)
      setRows((prev) => (replace ? j.rows : [...prev, ...j.rows]))
      setHasMore(j.hasMore)
      setPage(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load reservations')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load(1, true) }, [load])

  const refresh = () => load(1, true)
  const term = q.trim().toLowerCase()
  const shownRows = term ? rows.filter((r) => r.guestName.toLowerCase().includes(term)) : rows

  return (
    <>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-display text-2xl italic text-white sm:text-3xl">Reservations</h1>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name..."
          className="mx-auto block w-full max-w-md rounded-full border border-line bg-surface px-4 py-1.5 text-sm text-navy outline-none placeholder:text-navy/40 focus:border-clay"
        />
        <button onClick={refresh} title="Refresh" className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-sm text-navy/80 transition hover:bg-white/[0.05]">
          ↻ Refresh
        </button>
      </div>

      {error && <p className="mb-4 rounded-md bg-red-950/40 px-4 py-2 text-sm text-red-300">{error}</p>}

      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-navy/50">
                <th className="px-4 py-2.5 sm:px-5">Guest</th>
                <th className="px-4 py-2.5 sm:px-5">Check-in</th>
                <th className="px-4 py-2.5 sm:px-5">Check-out</th>
                <th className="px-4 py-2.5 sm:px-5">Nights</th>
                <th className="px-4 py-2.5 sm:px-5">Room Type</th>
                <th className="px-4 py-2.5 sm:px-5">Room Number</th>
                <th className="px-4 py-2.5 sm:px-5">Amount</th>
                <th className="px-4 py-2.5 sm:px-5">Status</th>
              </tr>
            </thead>
            <tbody>
              {shownRows.length === 0 && !loading && (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-sm text-navy/50">No reservations found.</td></tr>
              )}
              {shownRows.map((r) => (
                <tr key={r.reservationID} onClick={() => setOpen(r.reservationID)}
                  className="cursor-pointer border-b border-line text-sm text-navy last:border-b-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3 font-medium text-clay sm:px-5">{r.guestName || '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 sm:px-5">{longDate(r.startDate)}</td>
                  <td className="whitespace-nowrap px-4 py-3 sm:px-5">{longDate(r.endDate)}</td>
                  <td className="px-4 py-3 sm:px-5">{nights(r.startDate, r.endDate) ?? '—'}</td>
                  <td className="px-4 py-3 sm:px-5">
                    {r.rooms.length ? [...new Set(r.rooms.map((x) => x.roomTypeName).filter(Boolean))].join(', ') || '—' : '—'}
                  </td>
                  <td className="px-4 py-3 sm:px-5">
                    {r.rooms.length ? (
                      <span className="flex flex-wrap gap-1">
                        {r.rooms.map((room, i) => (
                          <RoomCell key={room.roomID ?? `${room.roomTypeID}-${i}`} reservationID={r.reservationID} room={room} onChanged={refresh} />
                        ))}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 sm:px-5">{mxn(r.total)}</td>
                  <td className="px-4 py-3 capitalize text-navy/80 sm:px-5">{statusLabel(r.status)}</td>
                </tr>
              ))}
              {loading && (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-sm text-navy/50">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {hasMore && !term && (
        <div className="mt-4 flex justify-center">
          <button disabled={loading} onClick={() => load(page + 1, false)}
            className="rounded-full border border-line px-5 py-1.5 text-sm font-semibold text-navy/80 transition hover:bg-white/[0.05] disabled:opacity-50">
            Load more
          </button>
        </div>
      )}

      {open && <ReservationModal id={open} today={today} onClose={() => setOpen(null)} onChanged={refresh} />}
    </>
  )
}
