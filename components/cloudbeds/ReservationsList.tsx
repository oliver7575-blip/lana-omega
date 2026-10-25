'use client'

import { useCallback, useEffect, useState } from 'react'
import ReservationModal from './ReservationModal'
import SearchBar from './SearchBar'
import { cbApi, longDate, mxn, nights, statusLabel, type ReservationSummary } from './shared'

export default function ReservationsList() {
  const [rows, setRows] = useState<ReservationSummary[]>([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
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
  const thc = 'border-r border-white px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#14213d] last:border-r-0'
  const tdc = 'px-2.5 py-1.5 text-[13px] text-[#14213d]'

  return (
    <div className="min-h-[calc(100vh-1.5rem)] min-w-0 overflow-hidden rounded-2xl bg-[#f2f3f5] px-3 py-4 text-[#14213d] sm:px-5 sm:py-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold tracking-tight sm:text-[22px]">Reservations</h1>
        <button onClick={refresh} title="Refresh" className="flex h-8 w-9 items-center justify-center rounded-md bg-[#e4e6ea] text-[15px] text-[#14213d] shadow-sm hover:bg-[#d9dce1]">↻</button>
      </div>

      <div className="mb-4 flex justify-center">
        <SearchBar onOpen={setOpen} />
      </div>

      {error && <p className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg bg-white shadow-[0_1px_3px_rgba(15,23,42,0.10)]">
        <table className="w-full">
          <thead className="bg-[#f1f2f4]">
            <tr>
              <th className={thc}>Guest</th>
              <th className={thc}>Check-in</th>
              <th className={thc}>Check-out</th>
              <th className={thc}>Nights</th>
              <th className={thc}>Amount</th>
              <th className={thc}>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr aria-hidden="true"><td colSpan={6} className="h-1.5 p-0" /></tr>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={6} className="py-6 text-center text-[13px] text-gray-500">No reservations found.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.reservationID} onClick={() => setOpen(r.reservationID)} className="cursor-pointer border-t border-gray-100 hover:bg-[#f7f8fa]">
                <td className={`${tdc} min-w-[160px] font-medium text-[#3d62e8]`}>{r.guestName || '—'}</td>
                <td className={`${tdc} whitespace-nowrap`}>{longDate(r.startDate)}</td>
                <td className={`${tdc} whitespace-nowrap`}>{longDate(r.endDate)}</td>
                <td className={tdc}>{nights(r.startDate, r.endDate) ?? '—'}</td>
                <td className={tdc}>{mxn(r.total)}</td>
                <td className={`${tdc} capitalize`}>{statusLabel(r.status)}</td>
              </tr>
            ))}
            {loading && (
              <tr><td colSpan={6} className="py-6 text-center text-[13px] text-gray-500">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button disabled={loading} onClick={() => load(page + 1, false)}
            className="rounded-full border border-gray-300 bg-white px-5 py-1.5 text-[13px] font-semibold text-[#14213d] hover:bg-gray-50 disabled:opacity-50">
            Load more
          </button>
        </div>
      )}

      {open && <ReservationModal id={open} today={today} onClose={() => setOpen(null)} onChanged={refresh} />}
    </div>
  )
}
