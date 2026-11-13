'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ReservationModal from '@/components/cloudbeds/ReservationModal'
import { btn, field, headerGradient, lbl, priGreen } from '@/components/cloudbeds/ui'
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

const LEFT_W = 160
const ROW_H = 38
const SPANS = [{ days: 7, label: '1w' }, { days: 14, label: '2w' }, { days: 21, label: '3w' }, { days: 30, label: '1m' }] as const
const DEFAULT_SPAN = 21 // days that fit on screen by default
const MIN_DAY_W = 30
const CHUNK = 28 // days loaded each time you scroll near an edge
const EDGE_PX = 400
const MONTH_ROW_H = 18
const PCT_ROW_H = 16
const DAY_ROW_H = 34
const TYPE_ROW_H = 32

// Reservation colours: upcoming blue, checked in green, checked out grey (not confirmed amber).
const EDGE: Record<string, string> = { confirmed: '#5b95f5', not_confirmed: '#f0b548', checked_in: '#3ccf8a', checked_out: '#8793a6' }
function statusEdge(status: string) {
  const k = status.toLowerCase()
  return EDGE[k === 'in_house' ? 'checked_in' : k] ?? EDGE.confirmed
}
const HATCH_BLOCK = 'repeating-linear-gradient(135deg,#3a4a5c 0 5px,#2a3846 5px 10px)'
const HATCH_SERVICE = 'repeating-linear-gradient(135deg,#6b4a14 0 5px,#4a3410 5px 10px)'
// One colour per room category (assigned by the category's position in Cloudbeds' list).
const CAT_COLORS = ['#ffb454', '#b392ff', '#ff7aa2', '#e39a6b', '#cfe08f', '#f0abfc', '#7fe0d0']
const HEAD_BG = '#17293b'
const ROOM_BG = '#162a3c'
const HOLO_BG =
  'repeating-radial-gradient(circle at 92% 8%,transparent 0,transparent 58px,rgba(111,227,227,.05) 58px,rgba(111,227,227,.05) 59px),' +
  'linear-gradient(rgba(111,227,227,.07) 1px,transparent 1px) 0 0/44px 44px,linear-gradient(90deg,rgba(111,227,227,.07) 1px,transparent 1px) 0 0/44px 44px,' +
  'radial-gradient(900px 520px at 0% 0%,rgba(50,160,180,.38),transparent 62%),radial-gradient(900px 520px at 100% 100%,rgba(70,90,190,.28),transparent 62%),linear-gradient(180deg,#1a3347,#122436)'

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

/** Where the booking came from, as a short text chip (Booking.com, Airbnb, Walk-in, Website). */
function sourceName(src?: string): string | null {
  const s = (src ?? '').toLowerCase()
  if (!s) return null
  if (s.includes('booking.com')) return 'Booking.com'
  if (s.includes('airbnb')) return 'Airbnb'
  if (s.includes('walk')) return 'Walk-in'
  if (s.includes('website') || s.includes('direct') || s.includes('engine') || s.includes('soiree') || s.includes('soirée')) return 'Website'
  return null
}

function Bar({ start, end, viewStart, totalDays, label, sub, bg, border, text, edge, onClick, onContextMenu, title, dayW, due, src }: {
  start: string; end: string; viewStart: string; totalDays: number; label: string; sub?: string; bg: string; border: string; text: string; edge?: string; onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void; title?: string; dayW: number; due?: boolean; src?: string
}) {
  const from = diff(viewStart, start) + 0.5
  const to = diff(viewStart, end) + 0.5
  const left = Math.max(0, from) * dayW
  const right = Math.min(totalDays, to) * dayW
  if (right <= left) return null
  const w = right - left - 2
  if (!edge) {
    // Blocks and out-of-service periods: flat hatched strip.
    return (
      <button onClick={onClick} onContextMenu={onContextMenu} title={title ?? label}
        className="absolute top-1 flex items-center overflow-hidden whitespace-nowrap rounded-[10px] border px-2.5 text-left text-[11px] font-semibold leading-none hover:brightness-110"
        style={{ left: left + 1, width: w, height: ROW_H - 8, background: bg, borderColor: border, color: text }}>
        <span className="truncate">{label}</span>
      </button>
    )
  }
  const chip = sourceName(src)
  const barH = ROW_H - 10
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title ?? label}
      className="absolute flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full border pl-3.5 pr-2 text-left hover:brightness-110"
      style={{ left: left + 1, width: w, top: (ROW_H - barH) / 2, height: barH, color: text, borderColor: edge, background: `linear-gradient(100deg,${edge}66,${edge}30)`, boxShadow: `0 0 14px ${edge}44, inset 0 0 12px ${edge}22` }}
    >
      <span className="min-w-0 flex-1 truncate text-[11.5px] font-bold">
        {label}
        {sub && w >= 90 && <span className="ml-1.5 font-medium opacity-75">· {sub}</span>}
      </span>
      {chip && w >= 170 && <span className="shrink-0 rounded-full border border-white/30 bg-white/[.18] px-1.5 py-[1px] text-[9px] font-semibold">{chip}</span>}
      {due && <b aria-label="Balance due" title="Balance due" className="shrink-0 rounded-full bg-white px-1.5 py-[1px] text-[9px] font-bold text-[#d12a3a]">Due</b>}
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
  // Today's column is highlighted when the calendar opens (and by the Today button).
  useEffect(() => {
    if (data && !markedToday.current) { markedToday.current = true; setMarkDay(data.today) }
  }, [data])
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
  const markedToday = useRef(false)
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
    dueOverride.current.set(id, { due: Number(balance ?? 0) > 0.005, until: Date.now() + 600000 })
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
    const t = setInterval(refreshVisible, 30000)
    // Coming back to this tab (e.g. after clearing a balance in Cloudbeds) refreshes at once.
    const onShow = () => { if (document.visibilityState === 'visible') refreshVisible() }
    document.addEventListener('visibilitychange', onShow)
    window.addEventListener('focus', onShow)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow) }
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

  const stats = (() => {
    if (!data) return { arrivals: 0, departures: 0, inHouse: 0, due: 0 }
    const all = [...data.bookings, ...data.unassigned].filter((b) => !/cancel|no_show/i.test(b.status))
    return {
      arrivals: all.filter((b) => b.start === data.today).length,
      departures: all.filter((b) => b.end === data.today).length,
      inHouse: all.filter((b) => b.start <= data.today && data.today < b.end).length,
      due: all.filter((b) => dueOf(b.reservationID, b.due)).length,
    }
  })()
  const catColor = (typeID: string) => {
    const i = Math.max(0, (data?.roomTypes ?? []).findIndex((x) => x.id === typeID))
    return CAT_COLORS[i % CAT_COLORS.length]
  }
  const pill = `h-8 rounded-full border border-white/10 bg-white/[.06] px-3 text-[12px] font-medium text-[#eaf0fb] transition hover:bg-white/10`

  return (
    <div className="p-2 md:p-3">
      <div className="min-h-[calc(100vh-1.5rem)] rounded-2xl p-4 text-[#eaf0fb]" style={{ background: HOLO_BG }}>
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <div className="mr-3">
            <Link href="/cloudbeds" className="text-[11px] font-bold uppercase tracking-[.3em] text-[#6fe3e3] hover:underline">Soirée</Link>
            <h1 className="text-[22px] font-bold leading-[1.1] tracking-tight">Calendar</h1>
            <p className="flex items-center gap-1.5 text-[11.5px] text-[#8a9bb0]">
              {roomCount} rooms
              <span className="h-1.5 w-1.5 rounded-full bg-[#3ccf8a]" /> Updates automatically
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => scrollBy(-7)} className={`${pill} w-8 !px-0 text-base`} aria-label="Back a week">‹</button>
            <button onClick={() => { if (data) { jumpTo(data.today); setMarkDay(data.today) } }} className={`${pill} font-bold !text-[#6fe3e3]`}>Today</button>
            <button onClick={() => scrollBy(7)} className={`${pill} w-8 !px-0 text-base`} aria-label="Forward a week">›</button>
            <div className="ml-1 flex rounded-full border border-white/10 bg-white/[.06] p-[3px]" role="group" aria-label="Days shown">
              {SPANS.map((o) => (
                <button key={o.days} onClick={() => changeSpan(o.days)} aria-pressed={span === o.days}
                  className={`h-[26px] rounded-full border px-2.5 text-[12px] font-semibold ${span === o.days ? 'border-[#6fe3e3]/50 bg-white/15 text-white' : 'border-transparent text-[#9aa8bb] hover:text-white'}`}>{o.label}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[13px]">
            <input type="date" value={goTo} onChange={(e) => setGoTo(e.target.value)} aria-label="Go to date"
              className="h-8 rounded-full border border-white/10 bg-white/[.06] px-3 text-[12px] text-[#eaf0fb] outline-none [color-scheme:dark] focus:border-[#6fe3e3]/60" />
            <button onClick={() => goTo && jumpTo(goTo)} className={pill}>Go</button>
          </div>
          <div className="min-w-[200px] flex-1"><SearchBar onOpen={setOpen} dark /></div>
          {data && (
            <div className="flex items-center gap-2">
              {([['arrivals', stats.arrivals, '#6fe0a4'], ['departures', stats.departures, '#b9c3d6'], ['in house', stats.inHouse, '#ffffff'], ['balances due', stats.due, '#ffd479']] as const).map(([l, v, c]) => (
                <div key={l} className="flex h-9 flex-col justify-center rounded-xl border border-white/10 bg-white/[.06] px-3">
                  <b className="text-[13.5px] leading-[1.1]" style={{ color: c }}>{v}</b>
                  <span className="text-[9.5px] text-[#8a9bb0]">{l}</span>
                </div>
              ))}
              <button onClick={() => setCreating('block')} className={pill}>Block dates</button>
              <button onClick={() => setCreating('blank')} className={`${priGreen} !h-8 !text-[12px] shadow-[0_4px_18px_rgba(39,173,134,.5),inset_0_1px_0_rgba(255,255,255,.28)]`}>+ New reservation</button>
            </div>
          )}
        </div>

        <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[11px] text-[#9aa8bb]">
          {([['Confirmed', EDGE.confirmed], ['Not confirmed', EDGE.not_confirmed], ['Checked in', EDGE.checked_in], ['Checked out', EDGE.checked_out]] as const).map(([l, e]) => (
            <span key={l} className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[4px] border" style={{ background: `linear-gradient(100deg,${e}88,${e}33)`, borderColor: e }} />{l}</span>
          ))}
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[4px] border" style={{ background: HATCH_BLOCK, borderColor: '#5b6b80' }} />Blocked</span>
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[4px] border" style={{ background: HATCH_SERVICE, borderColor: '#b88a2e' }} />Out of service</span>
          <span className="flex items-center gap-1.5"><i className="h-[7px] w-[7px] rounded-full bg-[#ff5d6c]" />Balance due</span>
        </div>

        {error && <p className="mb-2 rounded-md bg-red-500/15 px-4 py-2 text-sm text-red-200">{error}</p>}
        {!data && !error && <p className="py-10 text-center text-sm text-[#8a9bb0]">Loading the calendar…</p>}

        {data && (
          <div ref={scroller} onScroll={onScroll} onMouseLeave={() => setHoverDay(null)} className="relative overflow-x-auto rounded-3xl border border-[#6fe3e3]/25 shadow-[0_0_40px_rgba(111,227,227,.08),0_24px_60px_rgba(0,0,0,.45)]" style={{ background: 'rgba(22,46,64,.5)' }}>
            {loading && (
              <div className="pointer-events-none sticky top-0 left-0 z-30 h-0">
                <span className="absolute left-2 top-1 rounded bg-[#162a3c] px-2 py-0.5 text-[10px] text-[#9aa8bb] shadow">Loading {loading === 'past' ? 'earlier' : 'later'} days…</span>
              </div>
            )}
            <div className="relative" style={{ width: gridW }}>
              {markDay && data.days.includes(markDay) && (
                <div className="pointer-events-none absolute bottom-0 top-0 z-[5]" style={{
                  left: LEFT_W + data.days.indexOf(markDay) * dayW, width: dayW,
                  background: 'rgba(255,193,59,.14)', boxShadow: 'inset 1px 0 0 rgba(255,193,59,.6), inset -1px 0 0 rgba(255,193,59,.6)',
                }} />
              )}
              {data.days.includes(data.today) && (
                <div className="pointer-events-none absolute bottom-0 z-[5] w-px" style={{
                  left: LEFT_W + data.days.indexOf(data.today) * dayW + dayW / 2 - 0.5, top: MONTH_ROW_H + PCT_ROW_H + DAY_ROW_H,
                  background: 'linear-gradient(180deg,rgba(111,227,227,.38),rgba(111,227,227,.03))',
                }} />
              )}
              <div className="sticky top-0 z-20 flex border-b border-white/10 text-[9px] font-semibold text-[#6f7f94]" style={{ background: HEAD_BG }}>
                <div className="sticky left-0 z-10 border-r border-white/10" style={{ width: LEFT_W, minWidth: LEFT_W, height: MONTH_ROW_H, background: HEAD_BG }} />
                <div className="relative" style={{ width: totalDays * dayW, height: MONTH_ROW_H }}>
                  {monthBands.map((m) => (
                    <div key={m.left} className="absolute top-0 flex h-full items-center border-l-2 border-[#6fe3e3]/30 pl-1.5 tracking-[.12em]" style={{ left: m.left, width: m.width }}>{m.label}</div>
                  ))}
                </div>
              </div>

              <div className="sticky z-20 flex border-b border-white/10 text-[9.5px] font-semibold text-[#8a9bb0]" style={{ top: MONTH_ROW_H, background: HEAD_BG }}>
                <div className="sticky left-0 z-10 border-r border-white/10" style={{ width: LEFT_W, minWidth: LEFT_W, height: PCT_ROW_H, background: HEAD_BG }} />
                {data.days.map((d) => {
                  const pct = roomCount ? ((dayStats?.occupiedByDay[d] ?? 0) / roomCount) * 100 : 0
                  const isToday = d === data.today
                  return (
                    <div key={d} className={`relative flex items-center justify-center border-r border-white/[.06] ${isToday ? 'text-[#6fe3e3]' : ''}`} style={{ width: dayW, minWidth: dayW, height: PCT_ROW_H }}>
                      {pct.toFixed(0)}%
                      <i className="absolute bottom-0 left-1/2 h-[2px] -translate-x-1/2 rounded-full" style={{ width: dayW * 0.55, background: `linear-gradient(90deg,#6fe3e3 ${pct}%,rgba(255,255,255,.1) ${pct}%)` }} />
                    </div>
                  )
                })}
              </div>

              <div className="sticky z-20 flex border-b border-white/10 text-[10px] font-semibold" style={{ top: MONTH_ROW_H + PCT_ROW_H, background: HEAD_BG }}>
                <div className="sticky left-0 z-10 flex items-center border-r border-white/10 px-3 text-[10.5px] font-semibold uppercase tracking-[.1em] text-[#6f7f94]" style={{ width: LEFT_W, minWidth: LEFT_W, height: DAY_ROW_H, background: HEAD_BG }}>Rooms</div>
                {data.days.map((d) => {
                  const dt = new Date(`${d}T12:00:00Z`)
                  const isToday = d === data.today
                  return (
                    <div key={d}
                      onClick={() => setMarkDay((m) => (m === d ? null : d))}
                      title={markDay === d ? 'Click to unmark this day' : 'Click to mark this whole day'}
                      className={`flex cursor-pointer flex-col items-center justify-center border-r border-white/[.06] text-center leading-tight ${dt.getUTCDate() === 1 ? 'border-l-2 border-l-[#6fe3e3]/30' : ''} ${d === hoverDay ? 'bg-white/[.06]' : ''}`}
                      style={{ width: dayW, minWidth: dayW, height: DAY_ROW_H, backgroundImage: isToday ? 'linear-gradient(180deg,rgba(111,227,227,.10),rgba(111,227,227,0))' : undefined }}>
                      <span className="text-[10px] font-medium text-[#8a9bb0]">{dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
                      <span className={`mt-px flex h-[22px] min-w-[22px] items-center justify-center rounded-full text-[12px] font-bold ${isToday ? 'border border-[#6fe3e3]/50 bg-[#6fe3e3]/15 text-[#6fe3e3]' : markDay === d ? 'bg-[#e08a00] text-white' : 'text-white'}`}>{dt.getUTCDate()}</span>
                    </div>
                  )
                })}
              </div>

              {orderedTypes.map((t, ti) => {
                const isCollapsed = collapsed.has(t.id)
                const unassigned = data.unassigned.filter((u) => u.roomTypeID === t.id)
                const c = catColor(t.id)
                return (
                  <div key={t.id} className="border-b" style={{ borderColor: `${c}33` }}>
                    <div className="flex text-[9px]" style={{ backgroundImage: `linear-gradient(90deg,${c}2e,${c}08)`, borderTop: `1px solid ${c}66` }}>
                      <div
                        draggable
                        onDragStart={() => setDragType(t.id)}
                        onDragOver={(e) => { if (dragType && dragType !== t.id) e.preventDefault() }}
                        onDrop={() => { if (dragType) moveType(dragType, t.id); setDragType(null) }}
                        onDragEnd={() => setDragType(null)}
                        className={`sticky left-0 z-10 flex items-center border-r border-white/10 pr-1 ${dragType === t.id ? 'opacity-50' : ''} ${dragType && dragType !== t.id ? 'outline-dashed outline-1 -outline-offset-2 outline-[#6fe3e3]/50' : ''}`}
                        style={{ width: LEFT_W, minWidth: LEFT_W, height: TYPE_ROW_H, backgroundColor: HEAD_BG, backgroundImage: `linear-gradient(${c}33,${c}33)` }}
                      >
                        <i className="mr-1.5 h-full w-[6px] shrink-0" style={{ background: c, boxShadow: `0 0 12px ${c}aa` }} />
                        <span title="Drag to re-order" className="cursor-grab select-none px-0.5 text-[11px] leading-none text-white/30 hover:text-white/70" aria-hidden="true">⋮⋮</span>
                        <button
                          onClick={() => { const n = new Set(collapsed); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); setCollapsed(n) }}
                          className="flex min-w-0 flex-1 items-center truncate px-1 text-left text-[12px] font-bold" style={{ color: c }}
                        >
                          <span className="mr-1 inline-block shrink-0 text-[10px] opacity-70">{isCollapsed ? '›' : '⌄'}</span><span className="truncate">{t.name}</span>
                        </button>
                        <span className="mr-1 shrink-0 rounded-full border px-1.5 text-[10px] font-semibold" style={{ borderColor: `${c}66`, color: c }}>{t.rooms.length}</span>
                        <span className="flex shrink-0 flex-col">
                          <button onClick={() => shiftType(t.id, -1)} disabled={ti === 0} title="Move up" aria-label={`Move ${t.name} up`} className="px-1 text-[8px] leading-[10px] text-white/30 hover:text-white disabled:opacity-20">▲</button>
                          <button onClick={() => shiftType(t.id, 1)} disabled={ti === orderedTypes.length - 1} title="Move down" aria-label={`Move ${t.name} down`} className="px-1 text-[8px] leading-[10px] text-white/30 hover:text-white disabled:opacity-20">▼</button>
                        </span>
                      </div>
                      {data.days.map((d) => {
                        const avail = dayStats?.perType[t.id]?.[d]
                        const rate = t.rates[d]
                        return (
                          <div key={d}
                            className={`flex flex-col items-center justify-center border-r border-white/[.05] leading-tight ${new Date(`${d}T12:00:00Z`).getUTCDate() === 1 ? 'border-l-2 border-l-[#6fe3e3]/30' : ''}`}
                            style={{ width: dayW, minWidth: dayW, height: TYPE_ROW_H, color: c, background: d === data.today ? `${c}12` : undefined }}>
                            {rate ? (
                              <>
                                <span className="opacity-70">{avail ?? ''}</span>
                                <button
                                  title="Click to change the price"
                                  onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setPriceEdit({ typeID: t.id, day: d, value: String(Math.round(rate)), through: d, x: r.left, y: r.bottom + 4, busy: false, err: null }) }}
                                  className="rounded px-1 text-[10px] font-semibold underline-offset-2 hover:bg-white/10 hover:underline"
                                >${Math.round(rate).toLocaleString('en-US')}</button>
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
                        <div key={room.id} className="group flex border-t border-white/[.06]">
                          <div className={`sticky left-0 z-10 flex items-center gap-2 border-r border-white/10 pl-2.5 pr-2 text-[11px] font-semibold ${isUnassigned ? 'italic text-amber-300' : ''}`}
                            style={{ width: LEFT_W, minWidth: LEFT_W, height: ROW_H, backgroundColor: ROOM_BG }}>
                            {!isUnassigned && <i className="h-5 w-[3px] shrink-0 rounded-full" style={{ background: c, opacity: 0.6 }} />}
                            <span className={`truncate ${isUnassigned ? '' : 'text-[#dbe5f1]'}`}>{room.name}</span>
                          </div>
                          <div className="relative flex" style={{ height: ROW_H }}>
                            {data.days.map((d) => {
                              const canPick = !isUnassigned && d >= data.today
                              const inRange = pick && pick.roomID === room.id && pick.hover !== null
                                ? d >= (pick.hover < pick.start ? pick.hover : pick.start) && d <= (pick.hover < pick.start ? pick.start : pick.hover)
                                : pick?.roomID === room.id && d === pick.start
                              const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
                              const bg = inRange ? 'bg-[#3ccf8a]/30' : d === hoverDay ? 'bg-white/[.06]' : d === data.today ? 'bg-[#6fe3e3]/[.035]' : dow === 0 || dow === 6 ? 'bg-white/[.025]' : ''
                              return (
                                <div key={d}
                                  onClick={canPick ? () => clickDay(room, t.id, d) : undefined}
                                  onMouseEnter={() => {
                                    setHoverDay(d)
                                    if (pick && pick.roomID === room.id) setPick((p) => (p ? { ...p, hover: d } : p))
                                  }}
                                  className={`${canPick ? 'cursor-pointer hover:bg-[#3ccf8a]/20' : ''} ${bg}`}
                                  style={{ width: dayW, minWidth: dayW }} />
                              )
                            })}
                            <div className="pointer-events-none absolute inset-0" style={{
                              backgroundImage: 'linear-gradient(to left, rgba(111,227,227,.09) 1px, transparent 1px)',
                              backgroundSize: `${dayW}px 100%`,
                            }} />
                            {blocks.map((b, i) => {
                              const service = b.type === 'out_of_service' || /service|servicio|mainten|repair|mantenim|reparaci/i.test(b.reason)
                              return (
                                <Bar key={`b${i}`} start={b.start} end={addDays(b.end, 1)} viewStart={data.start} totalDays={totalDays} label={b.reason}
                                  bg={service ? HATCH_SERVICE : HATCH_BLOCK} border={service ? '#b88a2e' : '#5b6b80'} text={service ? '#ffd9a0' : '#cdd6e2'}
                                  title={`${service ? 'Out of service' : 'Blocked'}: ${b.reason} (click to open)`} dayW={dayW} onClick={() => setOpenBlock(b)} />
                              )
                            })}
                            {stays.map((s) => (
                              <Bar key={`${s.reservationID}-${s.start}`} start={s.start} end={s.end} viewStart={data.start} totalDays={totalDays}
                                label={s.guestName} sub={`${diff(s.start, s.end)}n`} due={dueOf(s.reservationID, s.due)} src={s.src}
                                edge={statusEdge(s.status)} bg="" border="" text="#fff" onClick={() => setOpen(s.reservationID)} dayW={dayW}
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
            <div className="fixed z-50 w-[250px] overflow-hidden rounded-[18px] bg-white shadow-[0_18px_44px_rgba(20,33,61,.28)]" style={{ left, top }}
              onKeyDown={(e) => { if (e.key === 'Escape') setPriceEdit(null); if (e.key === 'Enter') savePrice() }}>
              <div className={`px-4 py-2.5 text-white ${headerGradient('blue')}`}>
                <div className="text-[13px] font-bold">{t?.name}</div>
                <div className="text-[11px] text-white/70">{priceEdit.day}</div>
              </div>
              <div className="space-y-2.5 p-3.5">
                <label className={lbl}>Price per night
                  <input autoFocus inputMode="decimal" value={priceEdit.value} onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setPriceEdit({ ...priceEdit, value: e.target.value, err: null })}
                    className={`${field} mt-1.5 !text-[15px] !font-semibold normal-case tracking-normal`} />
                </label>
                <label className={lbl}>Same price through <span className="font-normal normal-case text-gray-400">(optional)</span>
                  <input type="date" value={priceEdit.through} min={priceEdit.day} onChange={(e) => setPriceEdit({ ...priceEdit, through: e.target.value, err: null })}
                    className={`${field} mt-1.5 normal-case tracking-normal`} />
                </label>
                {priceEdit.err && <div className="text-[11.5px] text-red-600">{priceEdit.err}</div>}
                <div className="flex justify-end gap-2 pt-0.5">
                  <button onClick={() => setPriceEdit(null)} className={btn}>Cancel</button>
                  <button onClick={savePrice} disabled={priceEdit.busy} className={`${priGreen} !h-[34px] !px-4 !text-[12.5px]`}>{priceEdit.busy ? 'Saving…' : 'Save price'}</button>
                </div>
              </div>
            </div>
          </>
        )
      })()}
      {open && data && <ReservationModal id={open} today={data.today} onClose={() => setOpen(null)} onChanged={refreshVisible} onCheckedOut={(text) => setToast({ ok: true, text })} onBalance={onBalance} />}
    </div>
  )
}
