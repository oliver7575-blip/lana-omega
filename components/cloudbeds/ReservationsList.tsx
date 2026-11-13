'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import ReservationModal from './ReservationModal'
import { HOLO_BG } from './ui'
import RoomCell from './RoomCell'
import { cbApi, longDate, mxn, nights, statusLabel, type ReservationSummary } from './shared'

const LINE = 'border-[#8fb4ff]/25'
const EDGE: Record<string, string> = { confirmed: '#5b95f5', not_confirmed: '#f0b548', checked_in: '#3ccf8a', in_house: '#3ccf8a', checked_out: '#8793a6', canceled: '#ff6b75', cancelled: '#ff6b75' }

function StatusPill({ status }: { status: string }) {
  const c = EDGE[status.toLowerCase()] ?? '#5b95f5'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize" style={{ borderColor: `${c}66`, background: `${c}22`, color: c }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />{statusLabel(status)}
    </span>
  )
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)
function dayHeading(day: string, today: string) {
  const d = dayDiff(day, today)
  const label = new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
  return d === 0 ? `Today · ${label}` : d === 1 ? `Yesterday · ${label}` : label
}

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

  // Group neighbouring rows by the day they were booked, with a header per day and alternating bands.
  const groups: { day: string; items: ReservationSummary[] }[] = []
  for (const r of shownRows) {
    const day = r.bookedOn || ''
    const last = groups[groups.length - 1]
    if (last && last.day === day) last.items.push(r)
    else groups.push({ day, items: [r] })
  }

  return (
    <div className="p-2 md:p-3">
      <div className="min-h-[calc(100vh-1.5rem)] min-w-0 rounded-2xl p-3 text-[#eaf0fb] antialiased" style={{ background: HOLO_BG }}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex h-10 shrink-0 items-center justify-center" style={{ width: 149 }}>
          <Link href="/cloudbeds" className="font-display text-[40px] font-semibold italic leading-none tracking-tight text-white">Soirée</Link>
        </div>
        <div className="h-9 w-px bg-[#8fb4ff]/25" />
        <div className="mr-2">
          <h1 className="text-[20px] font-semibold leading-tight tracking-tight text-white">Reservations</h1>
          <p className="text-[11.5px] text-[#9fb3dc]">Newest bookings first • grouped by day booked</p>
        </div>
        <div className="flex-1" />
        <label className={`flex h-8 w-full max-w-[300px] items-center gap-2 rounded-full border ${LINE} bg-white/[0.06] px-3`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9fb3dc" strokeWidth="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name..." className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[#eaf0fb] outline-none placeholder:text-[#8ea3cf]" />
        </label>
        <button onClick={refresh} title="Refresh" className={`h-8 rounded-full border ${LINE} bg-white/[0.06] px-3.5 text-[12.5px] font-semibold text-[#eaf0fb] hover:bg-white/[0.12]`}>↻ Refresh</button>
      </div>

      {error && <p className="mb-4 rounded-md bg-red-950/40 px-4 py-2 text-sm text-red-300">{error}</p>}

      <div className={`overflow-hidden rounded-2xl border ${LINE}`} style={{ background: 'rgba(22,40,92,.5)' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className={`border-b ${LINE} text-left text-[10.5px] font-semibold uppercase tracking-[.12em] text-[#9fb3dc]`}>
                {['Guest', 'Check-in', 'Check-out', 'Nights', 'Room Type', 'Room Number', 'Amount', 'Status'].map((h) => (
                  <th key={h} className="px-4 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shownRows.length === 0 && !loading && (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-sm text-[#9fb3dc]">No reservations found.</td></tr>
              )}
              {groups.map((g, gi) => {
                const band = gi % 2 === 0 ? 'rgba(91,149,245,.07)' : 'rgba(255,255,255,0)'
                return [
                  <tr key={`h-${gi}-${g.day}`} style={{ background: 'linear-gradient(90deg,rgba(143,180,255,.2),rgba(143,180,255,.05))' }} className={`border-y ${LINE}`}>
                    <td colSpan={8} className="px-4 py-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[.12em] text-[#cfdcff]">{g.day ? dayHeading(g.day, today) : 'Booking date unknown'}</span>
                      <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#cfdcff]">{g.items.length}</span>
                    </td>
                  </tr>,
                  ...g.items.map((r) => (
                    <tr key={r.reservationID} onClick={() => setOpen(r.reservationID)} style={{ background: band }}
                      className="cursor-pointer border-b border-[#8fb4ff]/10 text-[12.5px] text-[#eaf0fb] hover:bg-white/[0.07]">
                      <td className="px-4 py-2.5 font-semibold text-white">{r.guestName || '—'}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">{longDate(r.startDate)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">{longDate(r.endDate)}</td>
                      <td className="px-4 py-2.5">{nights(r.startDate, r.endDate) ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        {r.rooms.length ? [...new Set(r.rooms.map((x) => x.roomTypeName).filter(Boolean))].join(', ') || '—' : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.rooms.length ? (
                          <span className="flex flex-wrap gap-1">
                            {r.rooms.map((room, i) => (
                              <RoomCell key={room.roomID ?? `${room.roomTypeID}-${i}`} reservationID={r.reservationID} room={room} onChanged={refresh} />
                            ))}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-2.5">{mxn(r.total)}</td>
                      <td className="px-4 py-2.5"><StatusPill status={r.status} /></td>
                    </tr>
                  )),
                ]
              })}
              {loading && (
                <tr><td colSpan={8} className="px-6 py-10 text-center text-sm text-[#9fb3dc]">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {hasMore && !term && (
        <div className="mt-4 flex justify-center">
          <button disabled={loading} onClick={() => load(page + 1, false)}
            className={`rounded-full border ${LINE} bg-white/[0.06] px-5 py-1.5 text-sm font-semibold text-[#eaf0fb] transition hover:bg-white/[0.12] disabled:opacity-50`}>
            Load more
          </button>
        </div>
      )}

      {open && <ReservationModal id={open} today={today} onClose={() => setOpen(null)} onChanged={refresh} />}
      </div>
    </div>
  )
}
