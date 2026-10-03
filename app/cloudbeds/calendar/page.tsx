'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ReservationModal from '@/components/cloudbeds/ReservationModal'
import SearchBar from '@/components/cloudbeds/SearchBar'
import { cbApi, statusColor } from '@/components/cloudbeds/shared'

interface Booking { reservationID: string; guestName: string; status: string; roomID: string; start: string; end: string }
interface Unassigned { reservationID: string; guestName: string; roomTypeID: string; start: string; end: string; status: string }
interface Block { roomID: string; start: string; end: string; reason: string }
interface RoomType { id: string; name: string; rates: Record<string, number>; rooms: { id: string; name: string }[] }
interface Chunk {
  today: string
  start: string
  days: string[]
  links: { newReservation: string }
  roomTypes: RoomType[]
  bookings: Booking[]
  unassigned: Unassigned[]
  blocks: Block[]
}

const LEFT_W = 128
const ROW_H = 21
const VISIBLE_DAYS = 21 // how many days fit on screen
const MIN_DAY_W = 30
const CHUNK = 28 // days loaded each time you scroll near an edge
const EDGE_PX = 400

function addDays(d: string, n: number) {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
const diff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)
const overlaps = (s: string, e: string, from: string, to: string) => s < to && e > from

/** Merges a freshly loaded date range into what's already shown. */
function mergeChunk(prev: Chunk | null, next: Chunk, from: string, to: string): Chunk {
  if (!prev) return next
  const days = [...new Set([...prev.days, ...next.days])].sort()
  const roomTypes = prev.roomTypes.map((t) => {
    const n = next.roomTypes.find((x) => x.id === t.id)
    return n ? { ...t, rates: { ...t.rates, ...n.rates } } : t
  })
  for (const n of next.roomTypes) if (!roomTypes.find((t) => t.id === n.id)) roomTypes.push(n)
  const keep = <T extends { start: string; end: string }>(list: T[]) => list.filter((b) => !overlaps(b.start, b.end, from, to))
  const dedupe = <T,>(list: T[], key: (x: T) => string) => [...new Map(list.map((x) => [key(x), x])).values()]
  return {
    ...next,
    start: days[0],
    days,
    roomTypes,
    bookings: dedupe([...keep(prev.bookings), ...next.bookings], (b) => `${b.reservationID}|${b.roomID}|${b.start}`),
    unassigned: dedupe([...keep(prev.unassigned), ...next.unassigned], (b) => `${b.reservationID}|${b.roomTypeID}|${b.start}`),
    blocks: dedupe([...keep(prev.blocks), ...next.blocks], (b) => `${b.roomID}|${b.start}|${b.end}`),
  }
}

function Bar({ start, end, viewStart, totalDays, label, color, onClick, onContextMenu, title, dayW }: {
  start: string; end: string; viewStart: string; totalDays: number; label: string; color: string; onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void; title?: string; dayW: number
}) {
  const from = diff(viewStart, start) + 0.5
  const to = diff(viewStart, end) + 0.5
  const left = Math.max(0, from) * dayW
  const right = Math.min(totalDays, to) * dayW
  if (right <= left) return null
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title ?? label}
      className="absolute top-[3px] flex h-[15px] items-center overflow-hidden whitespace-nowrap pl-2.5 pr-2 text-left text-[9.5px] font-semibold leading-none text-white hover:brightness-95"
      style={{ left, width: right - left, background: color, clipPath: 'polygon(0 0, calc(100% - 6px) 0, 100% 50%, calc(100% - 6px) 100%, 0 100%, 6px 50%)' }}
    >
      <span className="truncate">{label}</span>
    </button>
  )
}

export default function CalendarPage() {
  const [data, setData] = useState<Chunk | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<'past' | 'future' | null>(null)
  const [goTo, setGoTo] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const [dayW, setDayW] = useState(44)
  const [menu, setMenu] = useState<{ x: number; y: number; reservationID: string; guestName: string; status: string; roomID: string | null } | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const pendingShift = useRef(0) // columns added on the left, to keep the view still
  const scrollToDay = useRef<string | null>(null)
  const dataRef = useRef<Chunk | null>(null)
  dataRef.current = data

  const fetchRange = (start: string, days: number) => cbApi<Chunk>(`/api/cloudbeds/calendar?start=${start}&days=${days}`)

  // Initial load: 3 weeks back, 5 weeks ahead, opened at today.
  const reset = useCallback(async (center?: string) => {
    setError(null)
    try {
      const probe = center ?? (await fetchRange(addDays(new Date().toISOString().slice(0, 10), -1), 7)).today
      const start = addDays(probe, -21)
      const chunk = await fetchRange(start, 56)
      scrollToDay.current = addDays(center ?? chunk.today, -2)
      setData(chunk)
      if (!goTo) setGoTo(center ?? chunk.today)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the calendar')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { reset() }, [reset])

  // Days size themselves so about three weeks fit on screen.
  useEffect(() => {
    const measure = () => {
      const w = scroller.current?.clientWidth ?? 0
      if (w) setDayW(Math.max(MIN_DAY_W, Math.floor((w - LEFT_W) / VISIBLE_DAYS)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [data !== null]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the view steady when days are added on the left, and jump to requested days.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !data) return
    if (pendingShift.current) {
      el.scrollLeft += pendingShift.current * dayW
      pendingShift.current = 0
    }
    if (scrollToDay.current) {
      el.scrollLeft = Math.max(0, diff(data.start, scrollToDay.current)) * dayW
      scrollToDay.current = null
    }
  }, [data, dayW])

  const loadMore = useCallback(async (dir: 'past' | 'future') => {
    const cur = dataRef.current
    if (!cur || loading) return
    setLoading(dir)
    try {
      const last = cur.days[cur.days.length - 1]
      const start = dir === 'past' ? addDays(cur.days[0], -CHUNK) : addDays(last, 1)
      const chunk = await fetchRange(start, CHUNK)
      if (dir === 'past') pendingShift.current = CHUNK
      setData((prev) => mergeChunk(prev, chunk, start, addDays(start, CHUNK)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load more days')
    }
    setLoading(null)
  }, [loading])

  function onScroll() {
    const el = scroller.current
    if (!el || loading) return
    if (el.scrollLeft < EDGE_PX) loadMore('past')
    else if (el.scrollLeft + el.clientWidth > el.scrollWidth - EDGE_PX) loadMore('future')
  }

  // Live refresh of the part on screen (and a week either side).
  const refreshVisible = useCallback(async () => {
    const el = scroller.current
    const cur = dataRef.current
    if (!el || !cur) return
    const firstIdx = Math.max(0, Math.floor(el.scrollLeft / dayW) - 7)
    const start = cur.days[Math.min(firstIdx, cur.days.length - 1)]
    const days = Math.min(VISIBLE_DAYS + 14, 62)
    try {
      const chunk = await fetchRange(start, days)
      setData((prev) => mergeChunk(prev, { ...chunk, days: prev?.days ?? chunk.days, start: prev?.start ?? chunk.start }, start, addDays(start, days)))
    } catch {
      // Keep showing what we have.
    }
  }, [dayW])

  useEffect(() => {
    const t = setInterval(refreshVisible, 60000)
    return () => clearInterval(t)
  }, [refreshVisible])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.ok ? 6000 : 12000)
    return () => clearTimeout(t)
  }, [toast])

  // Close the right-click menu on any outside click, scroll or Escape.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  async function runAction(action: string, m: NonNullable<typeof menu>) {
    setMenu(null)
    if (action === 'cancel') {
      const ok = confirm(
        `Cancel reservation #${m.reservationID} (${m.guestName}) in Cloudbeds?\n\n` +
          'NOTICE: this does NOT cancel the booking on third-party platforms (Booking.com, Expedia, Airbnb…). ' +
          'If it came from one of them, cancel it there as well, or the guest may still arrive and the channel may still charge commission.'
      )
      if (!ok) return
    }
    if (action === 'unassign' && !confirm(`Remove ${m.guestName} from this room? The reservation stays, but without a room.`)) return
    setBusy(true)
    try {
      await cbApi(`/api/cloudbeds/reservation/${m.reservationID}`, 'POST', { action, roomID: m.roomID ?? undefined })
      const done: Record<string, string> = {
        check_in: 'checked in', check_out: 'checked out', confirm: 'marked confirmed', unassign: 'room unassigned', cancel: 'cancelled in Cloudbeds',
      }
      setToast({
        ok: true,
        text: `${m.guestName}: ${done[action]}.${action === 'cancel' ? ' Remember to cancel it on the booking channel too, if it came from one.' : ''}`,
      })
      await refreshVisible()
    } catch (e) {
      setToast({ ok: false, text: e instanceof Error ? e.message : 'Cloudbeds error' })
    }
    setBusy(false)
  }

  const scrollBy = (days: number) => scroller.current?.scrollBy({ left: days * dayW, behavior: 'smooth' })
  function jumpTo(day: string) {
    const cur = dataRef.current
    if (cur && day >= cur.days[0] && day <= cur.days[cur.days.length - 1]) {
      scroller.current?.scrollTo({ left: Math.max(0, diff(cur.start, addDays(day, -2))) * dayW, behavior: 'smooth' })
    } else {
      reset(day)
    }
  }

  const roomCount = useMemo(() => data?.roomTypes.reduce((s, t) => s + t.rooms.length, 0) ?? 0, [data])
  const totalDays = data?.days.length ?? 0
  const gridW = LEFT_W + totalDays * dayW

  return (
    <div className="p-2 md:p-3">
      <div className="min-h-[calc(100vh-1.5rem)] rounded-2xl bg-[#f7f9fb] p-3.5 text-[#14213d]">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/cloudbeds" className="text-xs font-semibold text-[#3b6fe0] hover:underline">← Activity</Link>
            <h1 className="text-lg font-semibold leading-tight">Reservation calendar</h1>
            <p className="text-[11px] text-gray-600">{roomCount} rooms · live assignments from Cloudbeds · scroll sideways to move through time · right-click a reservation for actions</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-1 flex items-center gap-1.5 text-xs text-gray-600"><span className="h-2 w-2 rounded-full bg-emerald-500" /> Updates automatically</span>
            <button onClick={() => scrollBy(-7)} className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-sm hover:bg-gray-50" aria-label="Back a week">←</button>
            <button onClick={() => data && jumpTo(data.today)} className="rounded-full border border-gray-200 bg-white px-3 py-0.5 text-sm font-semibold hover:bg-gray-50">Today</button>
            <button onClick={() => scrollBy(7)} className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-sm hover:bg-gray-50" aria-label="Forward a week">→</button>
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-2 py-1">
          <SearchBar onOpen={setOpen} />
          <div className="flex items-center gap-2 text-xs">
            {data && (
              <a href={data.links.newReservation} target="_blank" rel="noreferrer" title="New reservation"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[#3b6fe0] text-base text-white hover:bg-[#2f5fcc]">+</a>
            )}
            <span className="text-gray-700">Go to date</span>
            <input type="date" value={goTo} onChange={(e) => setGoTo(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 text-xs outline-none focus:border-[#3b6fe0]" />
            <button onClick={() => goTo && jumpTo(goTo)} className="rounded-full bg-[#3b6fe0] px-3 py-1 text-xs font-semibold text-white hover:bg-[#2f5fcc]">Go</button>
          </div>
        </div>

        {error && <p className="mb-2 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
        {!data && !error && <p className="py-10 text-center text-sm text-gray-500">Loading the calendar…</p>}

        {data && (
          <div ref={scroller} onScroll={onScroll} className="relative overflow-x-auto rounded-xl border border-gray-200 bg-white">
            {loading && (
              <div className={`pointer-events-none sticky top-0 z-30 ${loading === 'past' ? 'left-0' : 'left-0'} h-0`}>
                <span className="absolute left-2 top-1 rounded bg-white/90 px-2 py-0.5 text-[10px] text-gray-500 shadow">Loading {loading === 'past' ? 'earlier' : 'later'} days…</span>
              </div>
            )}
            <div style={{ width: gridW }}>
              <div className="sticky top-0 z-20 flex border-b-2 border-gray-200 bg-gray-50 text-[10px] font-semibold">
                <div className="sticky left-0 z-10 border-r-2 border-gray-200 bg-gray-50 px-2.5 py-1" style={{ width: LEFT_W, minWidth: LEFT_W }}>Room type / room</div>
                {data.days.map((d) => {
                  const dt = new Date(`${d}T12:00:00Z`)
                  const isToday = d === data.today
                  const firstOfMonth = dt.getUTCDate() === 1
                  return (
                    <div key={d}
                      className={`border-r py-1 text-center leading-tight ${firstOfMonth ? 'border-l-2 border-l-gray-400' : ''} border-gray-200 ${isToday ? 'border-x border-x-[#8ec3ee] bg-[#c6e1f7] text-[#1f5fd6]' : ''}`}
                      style={{ width: dayW, minWidth: dayW }}>
                      {firstOfMonth ? dt.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) + ' ' : ''}
                      {dt.getUTCDate()}{' '}
                      <span className="font-normal text-gray-500">{dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }).slice(0, 2)}</span>
                    </div>
                  )
                })}
              </div>

              {data.roomTypes.map((t) => {
                const isCollapsed = collapsed.has(t.id)
                const unassigned = data.unassigned.filter((u) => u.roomTypeID === t.id)
                return (
                  <div key={t.id} className="border-b border-gray-300">
                    <div className="flex bg-gray-50 text-[9px] text-gray-500">
                      <button
                        onClick={() => { const n = new Set(collapsed); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); setCollapsed(n) }}
                        className="sticky left-0 z-10 truncate border-r-2 border-gray-200 bg-gray-50 px-2 py-0 text-left text-[10.5px] font-semibold leading-[17px] text-[#14213d]"
                        style={{ width: LEFT_W, minWidth: LEFT_W }}
                      >
                        <span className="mr-1 inline-block text-[10px] text-gray-500">{isCollapsed ? '›' : '⌄'}</span>{t.name}
                      </button>
                      {data.days.map((d) => (
                        <div key={d} className={`flex items-center justify-center border-r border-gray-200 ${d === data.today ? 'border-x border-x-[#8ec3ee] bg-[#d6eafa] font-semibold text-[#1f5fd6]' : ''}`} style={{ width: dayW, minWidth: dayW }}>
                          {t.rates[d] ? Math.round(t.rates[d]) : ''}
                        </div>
                      ))}
                    </div>

                    {!isCollapsed && [...t.rooms, ...(unassigned.length ? [{ id: `unassigned-${t.id}`, name: 'Unassigned' }] : [])].map((room) => {
                      const isUnassigned = room.id.startsWith('unassigned-')
                      const stays = isUnassigned ? unassigned.map((u) => ({ ...u, roomID: room.id })) : data.bookings.filter((b) => b.roomID === room.id)
                      const blocks = data.blocks.filter((b) => b.roomID === room.id)
                      return (
                        <div key={room.id} className="flex border-t border-gray-100">
                          <div className={`sticky left-0 z-10 border-r-2 border-gray-200 bg-white px-2.5 text-[10.5px] font-semibold ${isUnassigned ? 'italic text-amber-700' : ''}`}
                            style={{ width: LEFT_W, minWidth: LEFT_W, height: ROW_H, lineHeight: `${ROW_H}px` }}>
                            {room.name}
                          </div>
                          <div className="relative flex" style={{ height: ROW_H }}>
                            {data.days.map((d) => (
                              <div key={d} className={`border-r border-gray-100 ${d === data.today ? 'border-x border-x-[#8ec3ee] bg-[#e4f1fc]' : ''}`} style={{ width: dayW, minWidth: dayW }} />
                            ))}
                            {blocks.map((b, i) => (
                              <Bar key={`b${i}`} start={b.start} end={addDays(b.end, 1)} viewStart={data.start} totalDays={totalDays} label={b.reason} color="#d9433f" title={`Blocked: ${b.reason}`} dayW={dayW} />
                            ))}
                            {stays.map((s) => (
                              <Bar key={`${s.reservationID}-${s.start}`} start={s.start} end={s.end} viewStart={data.start} totalDays={totalDays}
                                label={s.guestName} color={statusColor(s.status).bar} onClick={() => setOpen(s.reservationID)} dayW={dayW}
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setMenu({ x: e.clientX, y: e.clientY, reservationID: s.reservationID, guestName: s.guestName, status: s.status, roomID: isUnassigned ? null : room.id })
                                }}
                                title={`${s.guestName} · ${s.status.replace(/_/g, ' ')} · ${s.start} → ${s.end}`} />
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

        <div className="mt-1.5 flex flex-wrap gap-4 text-[10.5px] text-gray-600">
          {[['#7fc0e4', 'Confirmed'], ['#f3c46b', 'Not confirmed'], ['#6ab77a', 'Checked in'], ['#b8c1cc', 'Checked out'], ['#d9433f', 'Blocked']].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm" style={{ background: c }} />{l}</span>
          ))}
        </div>
      </div>

      {menu && (
        <div
          className="fixed z-50 min-w-[190px] overflow-hidden rounded-lg border border-gray-200 bg-white py-1 text-[12.5px] text-[#14213d] shadow-xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 210), top: Math.min(menu.y, window.innerHeight - 230) }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <p className="truncate border-b border-gray-100 px-3 py-1.5 text-[11px] font-semibold text-gray-500">
            {menu.guestName} · {menu.status.replace(/_/g, ' ')}
          </p>
          {[
            { a: 'open', label: 'Open reservation', show: true },
            { a: 'check_in', label: 'Check in', show: ['confirmed', 'not_confirmed'].includes(menu.status) },
            { a: 'check_out', label: 'Check out', show: menu.status === 'checked_in' },
            { a: 'confirm', label: 'Mark confirmed', show: menu.status === 'not_confirmed' },
            { a: 'unassign', label: 'Unassign room', show: Boolean(menu.roomID) && menu.status !== 'checked_out' },
            { a: 'cancel', label: 'Cancel reservation…', show: !['checked_in', 'checked_out'].includes(menu.status), danger: true },
          ]
            .filter((i) => i.show)
            .map((i) => (
              <button
                key={i.a}
                disabled={busy}
                onClick={() => (i.a === 'open' ? (setMenu(null), setOpen(menu.reservationID)) : runAction(i.a, menu))}
                className={`block w-full px-3 py-1.5 text-left hover:bg-gray-100 disabled:opacity-50 ${'danger' in i && i.danger ? 'text-red-600' : ''}`}
              >
                {i.label}
              </button>
            ))}
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-5 left-1/2 z-50 flex max-w-lg -translate-x-1/2 items-start gap-3 rounded-lg px-4 py-2.5 text-sm shadow-xl ${toast.ok ? 'bg-[#14213d] text-white' : 'bg-red-600 text-white'}`}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} className="opacity-70 hover:opacity-100">×</button>
        </div>
      )}

      {open && data && <ReservationModal id={open} today={data.today} onClose={() => setOpen(null)} onChanged={refreshVisible} />}
    </div>
  )
}
