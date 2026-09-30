'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import ReservationModal from '@/components/cloudbeds/ReservationModal'
import SearchBar from '@/components/cloudbeds/SearchBar'
import { cbApi, statusColor } from '@/components/cloudbeds/shared'

interface Cal {
  today: string
  start: string
  days: string[]
  links: { newReservation: string }
  roomTypes: { id: string; name: string; rates: Record<string, number>; rooms: { id: string; name: string }[] }[]
  bookings: { reservationID: string; guestName: string; status: string; roomID: string; start: string; end: string }[]
  unassigned: { reservationID: string; guestName: string; roomTypeID: string; start: string; end: string; status: string }[]
  blocks: { roomID: string; start: string; end: string; reason: string }[]
}

const DAY_W = 78 // px per night
const LEFT_W = 190
const ROW_H = 38
const DAYS = 19

function addDays(d: string, n: number) {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
const diff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)

/** A stay bar from mid-check-in day to mid-check-out day, arrow-shaped like Beta's. */
function Bar({ start, end, viewStart, label, color, onClick, title }: {
  start: string; end: string; viewStart: string; label: string; color: string; onClick?: () => void; title?: string
}) {
  const from = diff(viewStart, start) + 0.5
  const to = diff(viewStart, end) + 0.5
  const left = Math.max(0, from) * DAY_W
  const right = Math.min(DAYS, to) * DAY_W
  if (right <= left) return null
  return (
    <button
      onClick={onClick}
      title={title ?? label}
      className="absolute top-1 flex h-[30px] items-center overflow-hidden whitespace-nowrap pl-5 pr-4 text-left text-[11px] font-semibold text-white hover:brightness-95"
      style={{
        left,
        width: right - left,
        background: color,
        clipPath: 'polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)',
      }}
    >
      <span className="truncate">{label}</span>
    </button>
  )
}

export default function CalendarPage() {
  const [data, setData] = useState<Cal | null>(null)
  const [start, setStart] = useState<string | null>(null)
  const [goTo, setGoTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const j = await cbApi<Cal>(`/api/cloudbeds/calendar?days=${DAYS}${start ? `&start=${start}` : ''}`)
      setData(j)
      setError(null)
      if (!start) setStart(j.start)
      if (!goTo) setGoTo(j.start)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the calendar')
    }
  }, [start]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const t = setInterval(load, 60000)
    return () => clearInterval(t)
  }, [load])

  const roomCount = useMemo(() => data?.roomTypes.reduce((s, t) => s + t.rooms.length, 0) ?? 0, [data])
  const viewStart = data?.start ?? start ?? ''
  const shift = (n: number) => setStart(addDays(viewStart, n))
  const gridW = LEFT_W + DAYS * DAY_W

  return (
    <div className="p-3 md:p-4">
      <div className="min-h-[calc(100vh-2rem)] rounded-2xl bg-[#f7f9fb] p-5 text-[#14213d] md:p-6">
        <Link href="/cloudbeds" className="text-lg font-semibold text-[#3b6fe0] hover:underline">← Activity</Link>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Reservation calendar</h1>
            <p className="text-sm text-gray-600">{roomCount} rooms · live assignments from Cloudbeds</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="mr-1 flex items-center gap-2 text-sm text-gray-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Updates automatically</span>
            <button onClick={() => shift(-7)} className="rounded-full border border-gray-200 bg-white px-3 py-2 hover:bg-gray-50" aria-label="Previous week">←</button>
            <button onClick={() => data && setStart(addDays(data.today, -1))} className="rounded-full border border-gray-200 bg-white px-4 py-2 font-semibold hover:bg-gray-50">Today</button>
            <button onClick={() => shift(7)} className="rounded-full border border-gray-200 bg-white px-3 py-2 hover:bg-gray-50" aria-label="Next week">→</button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2">
          <SearchBar onOpen={setOpen} />
          <div className="flex items-center gap-2 text-sm">
            {data && (
              <a href={data.links.newReservation} target="_blank" rel="noreferrer" title="New reservation"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#3b6fe0] text-lg text-white hover:bg-[#2f5fcc]">+</a>
            )}
            <span className="text-gray-700">Go to date</span>
            <input type="date" value={goTo} onChange={(e) => setGoTo(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 outline-none focus:border-[#3b6fe0]" />
            <button onClick={() => goTo && setStart(addDays(goTo, 0))} className="rounded-full bg-[#3b6fe0] px-4 py-1.5 font-semibold text-white hover:bg-[#2f5fcc]">Go</button>
          </div>
        </div>

        {error && <p className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
        {!data && !error && <p className="py-10 text-center text-sm text-gray-500">Loading the calendar…</p>}

        {data && (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <div style={{ width: gridW }}>
              {/* Day header */}
              <div className="sticky top-0 z-20 flex border-b-2 border-gray-200 bg-gray-50 text-sm font-semibold">
                <div className="sticky left-0 z-10 border-r-2 border-gray-200 bg-gray-50 px-4 py-2.5" style={{ width: LEFT_W, minWidth: LEFT_W }}>Room type / room</div>
                {data.days.map((d) => {
                  const dt = new Date(`${d}T12:00:00Z`)
                  const isToday = d === data.today
                  return (
                    <div key={d} className={`border-r border-gray-200 py-2.5 text-center ${isToday ? 'bg-sky-100 text-[#3b6fe0]' : ''}`} style={{ width: DAY_W, minWidth: DAY_W }}>
                      {dt.getUTCDate()} {dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}
                    </div>
                  )
                })}
              </div>

              {data.roomTypes.map((t) => {
                const isCollapsed = collapsed.has(t.id)
                const unassigned = data.unassigned.filter((u) => u.roomTypeID === t.id)
                return (
                  <div key={t.id} className="border-b-2 border-gray-200">
                    {/* Room type row with nightly rates */}
                    <div className="flex bg-gray-50 text-[11px] text-gray-500">
                      <button
                        onClick={() => { const n = new Set(collapsed); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); setCollapsed(n) }}
                        className="sticky left-0 z-10 border-r-2 border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm font-semibold text-[#14213d]"
                        style={{ width: LEFT_W, minWidth: LEFT_W }}
                      >
                        <span className="mr-1 inline-block text-xs text-gray-500">{isCollapsed ? '›' : '⌄'}</span>{t.name}
                      </button>
                      {data.days.map((d) => (
                        <div key={d} className={`flex items-center justify-center border-r border-gray-200 ${d === data.today ? 'bg-sky-50' : ''}`} style={{ width: DAY_W, minWidth: DAY_W }}>
                          {t.rates[d] ? Math.round(t.rates[d]) : ''}
                        </div>
                      ))}
                    </div>

                    {!isCollapsed && [...t.rooms, ...(unassigned.length ? [{ id: `unassigned-${t.id}`, name: 'Unassigned' }] : [])].map((room) => {
                      const isUnassigned = room.id.startsWith('unassigned-')
                      const stays = isUnassigned
                        ? unassigned.map((u) => ({ ...u, roomID: room.id }))
                        : data.bookings.filter((b) => b.roomID === room.id)
                      const blocks = data.blocks.filter((b) => b.roomID === room.id)
                      return (
                        <div key={room.id} className="flex border-t border-gray-100">
                          <div className={`sticky left-0 z-10 border-r-2 border-gray-200 bg-white px-4 text-sm font-semibold ${isUnassigned ? 'italic text-amber-700' : ''}`}
                            style={{ width: LEFT_W, minWidth: LEFT_W, height: ROW_H, lineHeight: `${ROW_H}px` }}>
                            {room.name}
                          </div>
                          <div className="relative flex" style={{ height: ROW_H }}>
                            {data.days.map((d) => (
                              <div key={d} className={`border-r border-gray-100 ${d === data.today ? 'bg-sky-50' : ''}`} style={{ width: DAY_W, minWidth: DAY_W }} />
                            ))}
                            {blocks.map((b, i) => (
                              <Bar key={`b${i}`} start={b.start} end={addDays(b.end, 1)} viewStart={data.start} label={b.reason} color="#d9433f" title={`Blocked: ${b.reason}`} />
                            ))}
                            {stays.map((s) => (
                              <Bar key={`${s.reservationID}-${s.start}`} start={s.start} end={s.end} viewStart={data.start}
                                label={s.guestName} color={statusColor(s.status).bar} onClick={() => setOpen(s.reservationID)} />
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-600">
          {[['#7fc0e4', 'Confirmed'], ['#f3c46b', 'Not confirmed'], ['#6ab77a', 'Checked in'], ['#b8c1cc', 'Checked out'], ['#d9433f', 'Blocked']].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-sm" style={{ background: c }} />{l}</span>
          ))}
        </div>
      </div>

      {open && data && <ReservationModal id={open} today={data.today} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  )
}
