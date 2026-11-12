'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ReservationModal from '@/components/cloudbeds/ReservationModal'
import NewReservationModal from '@/components/cloudbeds/NewReservationModal'
import BlockModal from '@/components/cloudbeds/BlockModal'
import SearchBar from '@/components/cloudbeds/SearchBar'
import { cbApi } from '@/components/cloudbeds/shared'

interface Booking { reservationID: string; guestName: string; status: string; roomID: string; start: string; end: string; due?: boolean; src?: string }
interface Unassigned { reservationID: string; guestName: string; roomTypeID: string; start: string; end: string; status: string; due?: boolean; src?: string }
interface Block { roomBlockID: string; type: string; roomID: string; start: string; end: string; reason: string }
interface RoomType { id: string; name: string; rates: Record<string, number>; rateID?: string; rooms: { id: string; name: string }[] }
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

const LEFT_W = 156
const ROW_H = 30
const SPANS = [{ days: 7, label: '1w' }, { days: 14, label: '2w' }, { days: 21, label: '3w' }, { days: 30, label: '1m' }] as const
const DEFAULT_SPAN = 21 // days that fit on screen by default
const MIN_DAY_W = 30
const CHUNK = 28 // days loaded each time you scroll near an edge
const EDGE_PX = 400
const MONTH_ROW_H = 20
const PCT_ROW_H = 18
const DAY_ROW_H = 40
const TYPE_ROW_H = 34

// Soft bar colours by reservation status (text stays dark enough to read on each).
const BAR: Record<string, { bg: string; border: string; text: string }> = {
  confirmed: { bg: '#bcd3f8', border: '#86aaec', text: '#17356b' },
  not_confirmed: { bg: '#fdeccb', border: '#f0c978', text: '#7a4a05' },
  checked_in: { bg: '#b4e6d0', border: '#74c9a6', text: '#0e4d38' },
  checked_out: { bg: '#d5d9e0', border: '#b3bac6', text: '#454d5c' },
}
function barColors(status: string) {
  const k = status.toLowerCase()
  return BAR[k === 'in_house' ? 'checked_in' : k] ?? BAR.confirmed
}
const HATCH_BLOCK = 'repeating-linear-gradient(135deg,#e3e6ec 0 5px,#f1f3f6 5px 10px)'
const HATCH_SERVICE = 'repeating-linear-gradient(135deg,#fde7c2 0 5px,#fff4de 5px 10px)'

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

/** Small source badge shown after the guest name: Booking.com, Airbnb, walk-in, website/direct. */
function sourceBadge(src?: string): { t: string; bg: string; name: string } | null {
  const s = (src ?? '').toLowerCase()
  if (!s) return null
  if (s.includes('booking.com')) return { t: 'B.', bg: '#0b4aa8', name: 'Booking.com' }
  if (s.includes('airbnb')) return { t: 'A', bg: '#ff5a7a', name: 'Airbnb' }
  if (s.includes('walk')) return { t: 'W', bg: '#2f9e6b', name: 'Walk-in' }
  if (s.includes('website') || s.includes('direct') || s.includes('engine') || s.includes('soiree') || s.includes('soirée')) return { t: '@', bg: '#7a54d6', name: 'Website' }
  return null
}

function Bar({ start, end, viewStart, totalDays, label, bg, border, text, onClick, onContextMenu, title, dayW, due, src }: {
  start: string; end: string; viewStart: string; totalDays: number; label: string; bg: string; border: string; text: string; onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void; title?: string; dayW: number; due?: boolean; src?: string
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
      className="absolute top-1 flex items-center overflow-hidden whitespace-nowrap rounded-lg border px-2.5 text-left text-[11px] font-semibold leading-none hover:brightness-95"
      style={{ left: left + 1, width: right - left - 2, height: ROW_H - 8, background: bg, borderColor: border, color: text }}
    >
      {due && <i aria-label="Balance due" className="absolute left-[3px] top-[3px] h-[6px] w-[6px] rounded-full bg-[#e5484d]" />}
      <span className="truncate">{label}</span>
      {(() => {
        const b = sourceBadge(src)
        return b ? <i title={b.name} className="ml-1.5 inline-flex h-[15px] min-w-[15px] shrink-0 items-center justify-center rounded-[4px] border bg-white/50 px-0.5 text-[9px] font-bold not-italic leading-none" style={{ borderColor: b.bg, color: b.bg }}>{b.t}</i> : null
      })()}
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
  const [dayW, setDayW] = useState(0) // 0 until the screen width is measured
  const [span, setSpan] = useState<number>(DEFAULT_SPAN) // days shown at once: 7, 14, 21 or 30
  useEffect(() => {
    try { const v = Number(localStorage.getItem('calendarSpan')); if (SPANS.some((x) => x.days === v)) setSpan(v) } catch { /* ignore */ }
  }, [])
  const [menu, setMenu] = useState<{ x: number; y: number; reservationID: string; guestName: string; status: string; roomID: string | null } | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [openBlock, setOpenBlock] = useState<Block | null>(null)
  const [hoverDay, setHoverDay] = useState<string | null>(null) // column under the pointer
  const [markDay, setMarkDay] = useState<string | null>(null) // column marked by clicking its date
  const [typeOrder, setTypeOrder] = useState<string[]>([])
  // Balance changes made here show at once (Cloudbeds can lag a moment before its list reflects them).
  const dueOverride = useRef<Map<string, { due: boolean; until: number }>>(new Map())
  const [, bumpDue] = useState(0)
  const [dragType, setDragType] = useState<string | null>(null)
  const [priceEdit, setPriceEdit] = useState<{ typeID: string; day: string; value: string; through: string; x: number; y: number; busy: boolean; err: string | null } | null>(null)

  // Room type order is a personal preference stored on the staff member's account (so it follows them
  // across browsers). The browser copy is only a fast start / fallback.
  useEffect(() => {
    let local: string[] = []
    try {
      const saved = JSON.parse(localStorage.getItem('calendar-room-type-order') ?? '[]')
      if (Array.isArray(saved)) local = saved.map(String)
    } catch { /* ignore */ }
    if (local.length) setTypeOrder(local)
    cbApi<{ preferences: Record<string, unknown> }>('/api/preferences')
      .then((j) => {
        const remote = j.preferences?.calendar_room_type_order
        if (Array.isArray(remote) && remote.length) setTypeOrder(remote.map(String))
        else if (local.length) cbApi('/api/preferences', 'PUT', { key: 'calendar_room_type_order', value: local }).catch(() => {}) // move an existing local order to the account
      })
      .catch(() => {})
  }, [])
  // Click-to-book: first click picks the check-in day, second click the check-out day.
  const [pick, setPick] = useState<{ roomID: string; roomTypeID: string; start: string; hover: string | null } | null>(null)
  const [creating, setCreating] = useState<{ start: string; end: string; roomTypeID?: string; roomID?: string } | 'blank' | 'block' | null>(null)
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
  useLayoutEffect(() => {
    const measure = () => {
      const w = scroller.current?.clientWidth ?? 0
      if (w) setDayW(Math.max(MIN_DAY_W, Math.floor((w - LEFT_W) / span)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [data !== null, span]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the view steady when days are added on the left, and jump to requested days.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || !data || !dayW) return // wait for the first measurement so today lands in the right column
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

  const dueOf = (id: string, due?: boolean) => {
    const o = dueOverride.current.get(id)
    return o && o.until > Date.now() ? o.due : due
  }
  const onBalance = (id: string, balance: number | null) => {
    dueOverride.current.set(id, { due: Number(balance ?? 0) > 0.005, until: Date.now() + 120000 })
    bumpDue((n) => n + 1)
  }

  const savePrice = async () => {
    const pe = priceEdit
    const cur = dataRef.current
    if (!pe || !cur) return
    const t = cur.roomTypes.find((x) => x.id === pe.typeID)
    const rate = Number(pe.value.replace(',', '.'))
    if (!t?.rateID) { setPriceEdit({ ...pe, err: 'This category has no editable base rate.' }); return }
    if (!Number.isFinite(rate) || rate <= 0) { setPriceEdit({ ...pe, err: 'Enter a valid price.' }); return }
    const through = pe.through && pe.through >= pe.day ? pe.through : pe.day
    if (diff(pe.day, through) >= 30) { setPriceEdit({ ...pe, err: 'Up to 30 nights at a time.' }); return }
    setPriceEdit({ ...pe, busy: true, err: null })
    try {
      const res = await fetch('/api/cloudbeds/rates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rateID: t.rateID, startDate: pe.day, endDate: through, rate }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Cloudbeds error')
      setData((prev) => prev && ({
        ...prev,
        roomTypes: prev.roomTypes.map((x) => {
          if (x.id !== pe.typeID) return x
          const rates = { ...x.rates }
          for (let d = pe.day; d <= through; d = addDays(d, 1)) rates[d] = rate
          return { ...x, rates }
        }),
      }))
      setPriceEdit(null)
      const nights = diff(pe.day, through) + 1
      setToast({ ok: true, text: `${t.name}: $${Math.round(rate).toLocaleString('en-US')} set for ${nights === 1 ? pe.day : `${pe.day} to ${through}`}. Cloudbeds may take a moment to apply it.` })
    } catch (e) {
      setPriceEdit({ ...pe, busy: false, err: e instanceof Error ? e.message : 'Cloudbeds error' })
    }
  }

  // Live refresh of the part on screen (and a week either side).
  const refreshVisible = useCallback(async () => {
    const el = scroller.current
    const cur = dataRef.current
    if (!el || !cur || !dayW) return
    const firstIdx = Math.max(0, Math.floor(el.scrollLeft / dayW) - 7)
    const start = cur.days[Math.min(firstIdx, cur.days.length - 1)]
    const days = Math.min(span + 14, 62)
    try {
      const chunk = await fetchRange(start, days)
      setData((prev) => mergeChunk(prev, { ...chunk, days: prev?.days ?? chunk.days, start: prev?.start ?? chunk.start }, start, addDays(start, days)))
    } catch {
      // Keep showing what we have.
    }
  }, [dayW, span])

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

  useEffect(() => {
    if (!pick) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPick(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pick])

  function clickDay(room: { id: string }, roomTypeID: string, day: string) {
    if (!data || day < data.today) return
    if (!pick || pick.roomID !== room.id) {
      setPick({ roomID: room.id, roomTypeID, start: day, hover: null })
      return
    }
    let s = pick.start
    let e = day
    if (e < s) [s, e] = [e, s]
    if (e === s) e = addDays(s, 1)
    setPick(null)
    setCreating({ start: s, end: e, roomTypeID, roomID: room.id })
  }

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
    if (action === 'check_out') {
      // Cloudbeds asks staff to acknowledge an open balance before checking out; do the same here.
      try {
        const d = await cbApi<{ reservation: { balance: number | null } }>(`/api/cloudbeds/reservation/${m.reservationID}`)
        const owed = d.reservation.balance ?? 0
        if (owed > 0 && !confirm(`${m.guestName} still has a balance of MXN ${owed.toLocaleString('en-US')}.\n\nCheck out anyway? The balance stays open on the reservation in Cloudbeds.`)) return
      } catch {
        // If the balance can't be read, let Cloudbeds decide.
      }
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

  const changeSpan = (days: number) => {
    if (days === span) return
    const el = scroller.current
    const cur = dataRef.current
    if (el && cur && dayW) scrollToDay.current = cur.days[Math.min(cur.days.length - 1, Math.max(0, Math.floor(el.scrollLeft / dayW)))]
    try { localStorage.setItem('calendarSpan', String(days)) } catch { /* ignore */ }
    setSpan(days)
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

  const orderedTypes = useMemo(() => {
    const types = data?.roomTypes ?? []
    const rank = (id: string) => { const i = typeOrder.indexOf(id); return i === -1 ? Number.MAX_SAFE_INTEGER : i }
    return [...types].sort((a, b) => rank(a.id) - rank(b.id)) // stable: unknown types keep Cloudbeds' order
  }, [data, typeOrder])

  function saveOrder(ids: string[]) {
    setTypeOrder(ids)
    try { localStorage.setItem('calendar-room-type-order', JSON.stringify(ids)) } catch { /* ignore */ }
    cbApi('/api/preferences', 'PUT', { key: 'calendar_room_type_order', value: ids }).catch(() => {})
  }
  function moveType(id: string, toId: string) {
    const ids = orderedTypes.map((t) => t.id)
    const from = ids.indexOf(id)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0 || from === to) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    saveOrder(ids)
  }
  function shiftType(id: string, dir: -1 | 1) {
    const ids = orderedTypes.map((t) => t.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    saveOrder(ids)
  }

  const roomCount = useMemo(() => data?.roomTypes.reduce((s, t) => s + t.rooms.length, 0) ?? 0, [data])
  const totalDays = data?.days.length ?? 0
  const gridW = LEFT_W + totalDays * dayW

  // Which room type a room belongs to (for the per-day availability / occupancy math below).
  const roomTypeOf = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of data?.roomTypes ?? []) for (const r of t.rooms) m[r.id] = t.id
    return m
  }, [data])

  // Available rooms per type per day (shown under the rate), and hotel-wide occupancy % per day
  // (shown in the band above the dates) — the same figures Cloudbeds' own calendar shows.
  const dayStats = useMemo(() => {
    if (!data) return null
    const perType: Record<string, Record<string, number>> = {}
    const occupiedByDay: Record<string, number> = {}
    for (const t of data.roomTypes) perType[t.id] = {}
    for (const d of data.days) {
      let occupiedTotal = 0
      for (const t of data.roomTypes) {
        let occ = 0
        for (const b of data.bookings) if (b.start <= d && d < b.end && roomTypeOf[b.roomID] === t.id) occ++
        for (const bl of data.blocks) if (bl.start <= d && d <= bl.end && roomTypeOf[bl.roomID] === t.id) occ++
        for (const u of data.unassigned) if (u.start <= d && d < u.end && u.roomTypeID === t.id) occ++
        perType[t.id][d] = Math.max(0, t.rooms.length - occ)
        occupiedTotal += Math.min(occ, t.rooms.length)
      }
      occupiedByDay[d] = occupiedTotal
    }
    return { perType, occupiedByDay }
  }, [data, roomTypeOf])

  // Month-label segments for the band above the date row ("OCT 2026" spanning its days, "NOV 2026" the next).
  const monthBands = useMemo(() => {
    if (!data) return [] as { label: string; left: number; width: number }[]
    const bands: { label: string; left: number; width: number }[] = []
    let i = 0
    while (i < data.days.length) {
      const dt = new Date(`${data.days[i]}T12:00:00Z`)
      const ym = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}`
      let j = i
      while (j < data.days.length) {
        const dj = new Date(`${data.days[j]}T12:00:00Z`)
        if (`${dj.getUTCFullYear()}-${dj.getUTCMonth()}` !== ym) break
        j++
      }
      bands.push({ label: dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase(), left: i * dayW, width: (j - i) * dayW })
      i = j
    }
    return bands
  }, [data, dayW])

  return (
    <div className="p-2 md:p-3">
      <div className="min-h-[calc(100vh-1.5rem)] rounded-2xl bg-[#f6f7f9] p-5 text-[#14213d]">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="mr-2">
            <Link href="/cloudbeds" className="text-xs font-semibold text-[#3b6fe0] hover:underline">← Activity</Link>
            <h1 className="text-[22px] font-bold leading-tight tracking-tight">Calendar</h1>
            <p className="flex items-center gap-1.5 text-[12.5px] text-gray-600">
              {roomCount} rooms
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Updates automatically
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => scrollBy(-7)} className="h-9 w-9 rounded-[10px] border border-gray-300 bg-white text-base hover:bg-gray-50" aria-label="Back a week">‹</button>
            <button onClick={() => data && jumpTo(data.today)} className="h-9 rounded-[10px] border border-gray-300 bg-white px-3.5 text-[13px] font-semibold hover:bg-gray-50">Today</button>
            <button onClick={() => scrollBy(7)} className="h-9 w-9 rounded-[10px] border border-gray-300 bg-white text-base hover:bg-gray-50" aria-label="Forward a week">›</button>
            <div className="ml-1 flex rounded-[10px] bg-[#e9ecf1] p-[3px]" role="group" aria-label="Days shown">
              {SPANS.map((o) => (
                <button key={o.days} onClick={() => changeSpan(o.days)} aria-pressed={span === o.days}
                  className={`h-[30px] rounded-[8px] px-2.5 text-[12.5px] font-semibold ${span === o.days ? 'bg-white text-[#14213d] shadow-sm' : 'text-gray-500 hover:text-[#14213d]'}`}>{o.label}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[13px]">
            <input type="date" value={goTo} onChange={(e) => setGoTo(e.target.value)} aria-label="Go to date"
              className="h-9 rounded-[10px] border border-gray-300 bg-white px-2.5 text-[13px] outline-none focus:border-[#3b6fe0]" />
            <button onClick={() => goTo && jumpTo(goTo)} className="h-9 rounded-[10px] border border-gray-300 bg-white px-3.5 text-[13px] font-semibold hover:bg-gray-50">Go</button>
          </div>
          <div className="min-w-[220px] flex-1"><SearchBar onOpen={setOpen} /></div>
          {data && (
            <div className="relative h-9">
              <button onClick={() => setCreating('block')} className="h-9 rounded-[10px] border border-gray-300 bg-white px-4 text-[13px] font-semibold hover:bg-gray-50">Block dates</button>
              <button onClick={() => setCreating('blank')} className="absolute right-0 top-full mt-1.5 h-9 whitespace-nowrap rounded-[10px] bg-[#1f9d78] px-[18px] text-[13px] font-semibold text-white hover:bg-[#188a69]">+ Create new reservation</button>
            </div>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-x-[18px] gap-y-1 text-xs text-gray-600">
          {([['Confirmed', BAR.confirmed.bg, BAR.confirmed.border], ['Not confirmed', BAR.not_confirmed.bg, BAR.not_confirmed.border], ['Checked in', BAR.checked_in.bg, BAR.checked_in.border], ['Checked out', BAR.checked_out.bg, BAR.checked_out.border], ['Blocked', HATCH_BLOCK, '#c5cad4'], ['Out of service', HATCH_SERVICE, '#efc47a']] as const).map(([l, bg, bd]) => (
            <span key={l} className="flex items-center gap-1.5"><i className="h-3 w-3 rounded border" style={{ background: bg, borderColor: bd }} />{l}</span>
          ))}
        </div>

        {error && <p className="mb-2 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
        {!data && !error && <p className="py-10 text-center text-sm text-gray-500">Loading the calendar…</p>}

        {data && (
          <div ref={scroller} onScroll={onScroll} onMouseLeave={() => setHoverDay(null)} className="relative overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-[0_1px_2px_rgba(20,33,61,.04)]">
            {loading && (
              <div className={`pointer-events-none sticky top-0 z-30 ${loading === 'past' ? 'left-0' : 'left-0'} h-0`}>
                <span className="absolute left-2 top-1 rounded bg-white/90 px-2 py-0.5 text-[10px] text-gray-500 shadow">Loading {loading === 'past' ? 'earlier' : 'later'} days…</span>
              </div>
            )}
            <div className="relative" style={{ width: gridW }}>
              {markDay && data.days.includes(markDay) && (
                <div className="pointer-events-none absolute bottom-0 top-0" style={{
                  left: LEFT_W + data.days.indexOf(markDay) * dayW, width: dayW,
                  background: 'rgba(255,193,59,.22)', boxShadow: 'inset 1px 0 0 rgba(224,150,20,.7), inset -1px 0 0 rgba(224,150,20,.7)',
                }} />
              )}
              <div className="sticky top-0 z-20 flex border-b border-gray-200 bg-gray-50 text-[9px] font-semibold text-gray-500">
                <div className="sticky left-0 z-10 border-r-2 border-gray-200 bg-gray-50" style={{ width: LEFT_W, minWidth: LEFT_W, height: MONTH_ROW_H }} />
                <div className="relative" style={{ width: totalDays * dayW, height: MONTH_ROW_H }}>
                  {monthBands.map((m) => (
                    <div key={m.left} className="absolute top-0 flex h-full items-center border-l-2 border-gray-300 pl-1.5 tracking-wide" style={{ left: m.left, width: m.width }}>{m.label}</div>
                  ))}
                </div>
              </div>

              <div className="sticky z-20 flex border-b border-gray-200 bg-gray-50 text-[9.5px] font-semibold text-gray-500" style={{ top: MONTH_ROW_H }}>
                <div className="sticky left-0 z-10 border-r-2 border-gray-200 bg-gray-50" style={{ width: LEFT_W, minWidth: LEFT_W, height: PCT_ROW_H }} />
                {data.days.map((d) => {
                  const pct = roomCount ? ((dayStats?.occupiedByDay[d] ?? 0) / roomCount) * 100 : 0
                  const isToday = d === data.today
                  return (
                    <div key={d} className={`flex items-center justify-center border-r border-gray-200 ${markDay === d ? '!bg-[#ffe9a8]' : ''} ${isToday ? 'bg-[#eefaf5] text-[#1f7d60]' : ''}`} style={{ width: dayW, minWidth: dayW, height: PCT_ROW_H }}>
                      {pct.toFixed(2)}%
                    </div>
                  )
                })}
              </div>

              <div className="sticky z-20 flex border-b-2 border-gray-200 bg-gray-50 text-[10px] font-semibold" style={{ top: MONTH_ROW_H + PCT_ROW_H }}>
                <div className="sticky left-0 z-10 flex items-center border-r-2 border-gray-200 bg-gray-50 px-2.5" style={{ width: LEFT_W, minWidth: LEFT_W, height: DAY_ROW_H }}>Room type / room</div>
                {data.days.map((d) => {
                  const dt = new Date(`${d}T12:00:00Z`)
                  const isToday = d === data.today
                  return (
                    <div key={d}
                      onClick={() => setMarkDay((m) => (m === d ? null : d))}
                      title={markDay === d ? 'Click to unmark this day' : 'Click to mark this whole day'}
                      className={`flex cursor-pointer flex-col items-center justify-center border-r text-center leading-tight border-gray-200 ${markDay === d ? '!bg-[#ffd666]' : ''} ${d === hoverDay ? 'bg-[#dbe8f7]' : ''} ${dt.getUTCDate() === 1 ? 'border-l-2 border-l-gray-300' : ''} ${isToday ? 'bg-[#eefaf5] text-[#1f7d60]' : ''}`}
                      style={{ width: dayW, minWidth: dayW, height: DAY_ROW_H }}>
                      <span className="text-[10px] font-medium text-gray-500">{dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
                      <span className={`mt-0.5 flex h-6 min-w-6 items-center justify-center rounded-full text-[12.5px] font-semibold ${isToday ? 'bg-[#1f9d78] text-white' : markDay === d ? 'bg-[#e08a00] text-white' : ''}`}>{dt.getUTCDate()}</span>
                    </div>
                  )
                })}
              </div>

              {orderedTypes.map((t, ti) => {
                const isCollapsed = collapsed.has(t.id)
                const unassigned = data.unassigned.filter((u) => u.roomTypeID === t.id)
                return (
                  <div key={t.id} className="border-b border-gray-300">
                    <div className="flex bg-gray-50 text-[9px] text-gray-500">
                      <div
                        draggable
                        onDragStart={() => setDragType(t.id)}
                        onDragOver={(e) => { if (dragType && dragType !== t.id) e.preventDefault() }}
                        onDrop={() => { if (dragType) moveType(dragType, t.id); setDragType(null) }}
                        onDragEnd={() => setDragType(null)}
                        className={`sticky left-0 z-10 flex items-center border-r-2 border-gray-200 bg-gray-50 pl-1 pr-1 ${dragType === t.id ? 'opacity-50' : ''} ${dragType && dragType !== t.id ? 'outline-dashed outline-1 -outline-offset-2 outline-[#1f9d78]/40' : ''}`}
                        style={{ width: LEFT_W, minWidth: LEFT_W, height: TYPE_ROW_H }}
                      >
                        <span title="Drag to re-order" className="cursor-grab select-none px-0.5 text-[11px] leading-none text-gray-400 hover:text-gray-600" aria-hidden="true">⋮⋮</span>
                        <button
                          onClick={() => { const n = new Set(collapsed); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); setCollapsed(n) }}
                          className="flex min-w-0 flex-1 items-center truncate px-1 text-left text-[11px] font-semibold text-[#14213d]"
                        >
                          <span className="mr-1 inline-block shrink-0 text-[10px] text-gray-500">{isCollapsed ? '›' : '⌄'}</span><span className="truncate">{t.name}</span>
                        </button>
                        <span className="flex shrink-0 flex-col">
                          <button onClick={() => shiftType(t.id, -1)} disabled={ti === 0} title="Move up" aria-label={`Move ${t.name} up`} className="px-1 text-[8px] leading-[10px] text-gray-400 hover:text-[#14213d] disabled:opacity-30">▲</button>
                          <button onClick={() => shiftType(t.id, 1)} disabled={ti === orderedTypes.length - 1} title="Move down" aria-label={`Move ${t.name} down`} className="px-1 text-[8px] leading-[10px] text-gray-400 hover:text-[#14213d] disabled:opacity-30">▼</button>
                        </span>
                      </div>
                      {data.days.map((d) => {
                        const avail = dayStats?.perType[t.id]?.[d]
                        const rate = t.rates[d]
                        return (
                          <div key={d}
                            className={`flex flex-col items-center justify-center border-r border-gray-200 leading-tight ${new Date(`${d}T12:00:00Z`).getUTCDate() === 1 ? 'border-l-2 border-l-gray-300' : ''} ${d === data.today ? 'bg-[#e6f6ef] font-semibold text-[#1f7d60]' : ''}`}
                            style={{ width: dayW, minWidth: dayW, height: TYPE_ROW_H }}>
                            {rate ? (
                              <>
                                <span>{avail ?? ''}</span>
                                <button
                                  title="Click to change the price"
                                  onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPriceEdit({ typeID: t.id, day: d, value: String(Math.round(rate)), through: d, x: r.left, y: r.bottom + 4, busy: false, err: null }) }}
                                  className="rounded px-1 font-normal underline-offset-2 hover:bg-[#fff3d6] hover:text-[#8a5a00] hover:underline"
                                >${Math.round(rate).toLocaleString('en-US')}.00</button>
                              </>
                            ) : (
                              <span>{avail || ''}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {!isCollapsed && [...t.rooms, ...(unassigned.length ? [{ id: `unassigned-${t.id}`, name: 'Unassigned' }] : [])].map((room) => {
                      const isUnassigned = room.id.startsWith('unassigned-')
                      const stays = isUnassigned ? unassigned.map((u) => ({ ...u, roomID: room.id })) : data.bookings.filter((b) => b.roomID === room.id)
                      const blocks = data.blocks.filter((b) => b.roomID === room.id)
                      return (
                        <div key={room.id} className="group flex border-t border-[#d5dae4] hover:bg-[#f4f8fb]">
                          <div className={`sticky left-0 z-10 border-r-2 border-gray-200 bg-white px-2.5 text-[11px] font-semibold group-hover:bg-[#f4f8fb] ${isUnassigned ? 'italic text-amber-700' : ''}`}
                            style={{ width: LEFT_W, minWidth: LEFT_W, height: ROW_H, lineHeight: `${ROW_H}px` }}>
                            {room.name}
                          </div>
                          <div className="relative flex" style={{ height: ROW_H }}>
                            {data.days.map((d) => {
                              const canPick = !isUnassigned && d >= data.today
                              const inRange = pick && pick.roomID === room.id && pick.hover !== null
                                ? d >= (pick.hover < pick.start ? pick.hover : pick.start) && d <= (pick.hover < pick.start ? pick.start : pick.hover)
                                : pick?.roomID === room.id && d === pick.start
                              const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
                              const bg = inRange ? 'bg-[#bfe7d8]' : d === hoverDay ? 'bg-[#e8f1fb]' : d === data.today ? 'bg-[#f1fbf7]' : dow === 0 || dow === 6 ? 'bg-[#f6f7fa]' : ''
                              return (
                                <div key={d}
                                  onClick={canPick ? () => clickDay(room, t.id, d) : undefined}
                                  onMouseEnter={() => {
                                    setHoverDay(d)
                                    if (pick && pick.roomID === room.id) setPick((p) => (p ? { ...p, hover: d } : p))
                                  }}
                                  className={`${canPick ? 'cursor-pointer hover:bg-[#d9f0e6]' : ''} ${bg}`}
                                  style={{ width: dayW, minWidth: dayW }} />
                              )
                            })}
                            <div className="pointer-events-none absolute inset-0" style={{
                              backgroundImage: 'linear-gradient(to left, #cfd5e0 1px, transparent 1px)',
                              backgroundSize: `${dayW}px 100%`,
                            }} />
                            {blocks.map((b, i) => {
                              const service = b.type === 'out_of_service' || /service|servicio|mainten|repair|mantenim|reparaci/i.test(b.reason)
                              return (
                                <Bar key={`b${i}`} start={b.start} end={addDays(b.end, 1)} viewStart={data.start} totalDays={totalDays} label={b.reason}
                                  bg={service ? HATCH_SERVICE : HATCH_BLOCK} border={service ? '#efc47a' : '#c5cad4'} text={service ? '#7a4a05' : '#4a5262'}
                                  title={`${service ? 'Out of service' : 'Blocked'}: ${b.reason} (click to open)`} dayW={dayW} onClick={() => setOpenBlock(b)} />
                              )
                            })}
                            {stays.map((s) => (
                              <Bar key={`${s.reservationID}-${s.start}`} start={s.start} end={s.end} viewStart={data.start} totalDays={totalDays}
                                label={s.guestName} due={dueOf(s.reservationID, s.due)} src={s.src} bg={barColors(s.end < data.today ? 'checked_out' : s.status).bg} border={barColors(s.end < data.today ? 'checked_out' : s.status).border} text={barColors(s.end < data.today ? 'checked_out' : s.status).text} onClick={() => setOpen(s.reservationID)} dayW={dayW}
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setMenu({ x: e.clientX, y: e.clientY, reservationID: s.reservationID, guestName: s.guestName, status: s.status, roomID: isUnassigned ? null : room.id })
                                }}
                                title={`${s.guestName} · ${s.status.replace(/_/g, ' ')} · ${s.start} → ${s.end}${s.due ? ' · balance due' : ''}`} />
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

      {creating && data && (
        <NewReservationModal
          today={data.today}
          initial={creating === 'blank' || creating === 'block' ? undefined : creating}
          initialMode={creating === 'block' ? 'block' : undefined}
          onClose={() => setCreating(null)}
          onBlocked={(text) => {
            setCreating(null)
            setToast({ ok: true, text })
            refreshVisible()
          }}
          onCreated={(id) => {
            setCreating(null)
            setToast({ ok: true, text: `Reservation #${id} created.` })
            refreshVisible()
          }}
        />
      )}

      {openBlock && data && (() => {
        const type = data.roomTypes.find((t) => t.rooms.some((r) => r.id === openBlock.roomID))
        const room = type?.rooms.find((r) => r.id === openBlock.roomID)
        const sameBlock = openBlock.roomBlockID ? data.blocks.filter((b) => b.roomBlockID === openBlock.roomBlockID && b.roomID !== openBlock.roomID) : []
        const otherRooms = sameBlock.map((b) => data.roomTypes.flatMap((t) => t.rooms).find((r) => r.id === b.roomID)?.name ?? 'another room')
        return (
          <BlockModal
            block={openBlock}
            roomName={room?.name ?? 'Room'}
            roomTypeName={type?.name ?? ''}
            otherRooms={[...new Set(otherRooms)]}
            onClose={() => setOpenBlock(null)}
            onRemoved={() => { setOpenBlock(null); setToast({ ok: true, text: `Block removed from ${room?.name ?? 'the room'}.` }); refreshVisible() }}
          />
        )
      })()}


      {priceEdit && (() => {
        const t = data?.roomTypes.find((x) => x.id === priceEdit.typeID)
        const left = Math.min(priceEdit.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 250)
        const top = Math.min(priceEdit.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 200)
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPriceEdit(null)} />
            <div className="fixed z-50 w-[236px] rounded-[12px] border border-[#d9dde4] bg-white p-3 shadow-[0_12px_32px_rgba(20,33,61,.18)]" style={{ left, top }}
              onKeyDown={(e) => { if (e.key === 'Escape') setPriceEdit(null); if (e.key === 'Enter') savePrice() }}>
              <div className="text-[12px] font-semibold text-[#14213d]">{t?.name}</div>
              <div className="mb-2 text-[11px] text-gray-500">{priceEdit.day}</div>
              <label className="block text-[11px] font-semibold text-gray-600">Price per night
                <input autoFocus inputMode="decimal" value={priceEdit.value} onFocus={(e) => e.currentTarget.select()}
                  onChange={(e) => setPriceEdit({ ...priceEdit, value: e.target.value, err: null })}
                  className="mt-1 h-9 w-full rounded-[8px] border border-[#d9dde4] px-2 text-[14px] font-semibold text-[#14213d] outline-none focus:border-[#1f9d78]" />
              </label>
              <label className="mt-2 block text-[11px] font-semibold text-gray-600">Same price through <span className="font-normal text-gray-400">(optional)</span>
                <input type="date" value={priceEdit.through} min={priceEdit.day} onChange={(e) => setPriceEdit({ ...priceEdit, through: e.target.value, err: null })}
                  className="mt-1 h-9 w-full rounded-[8px] border border-[#d9dde4] px-2 text-[13px] text-[#14213d] outline-none focus:border-[#1f9d78]" />
              </label>
              {priceEdit.err && <div className="mt-2 text-[11.5px] text-red-600">{priceEdit.err}</div>}
              <div className="mt-3 flex gap-2">
                <button onClick={savePrice} disabled={priceEdit.busy} className="h-9 flex-1 rounded-[8px] bg-[#1f9d78] text-[13px] font-semibold text-white disabled:opacity-60">{priceEdit.busy ? 'Saving…' : 'Save'}</button>
                <button onClick={() => setPriceEdit(null)} className="h-9 rounded-[8px] border border-[#d9dde4] px-3 text-[13px] font-semibold text-[#14213d]">Cancel</button>
              </div>
            </div>
          </>
        )
      })()}
      {open && data && <ReservationModal id={open} today={data.today} onClose={() => setOpen(null)} onChanged={refreshVisible} onCheckedOut={(text) => setToast({ ok: true, text })} onBalance={onBalance} />}
    </div>
  )
}
