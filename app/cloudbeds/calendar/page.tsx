'use client'

import PropertyClock from '@/components/PropertyClock'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import ReservationModal from '@/components/cloudbeds/ReservationModal'
import { btn, field, headerGradient, HOLO_BG, lbl, priGreen } from '@/components/cloudbeds/ui'
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

const LEFT_W = 164
const ROW_H = 32
const SPANS = [{ days: 7, label: '1w' }, { days: 14, label: '2w' }, { days: 21, label: '3w' }, { days: 30, label: '1m' }] as const
const DEFAULT_SPAN = 21 // days that fit on screen by default
const MIN_DAY_W = 30
const CHUNK = 28 // days loaded each time you scroll near an edge
const EDGE_PX = 400
const MONTH_ROW_H = 16
const PCT_ROW_H = 14
const DAY_ROW_H = 30
const TYPE_ROW_H = 28

// Reservation colours: upcoming blue, checked in green, checked out grey (not confirmed amber).
const EDGE: Record<string, string> = { confirmed: '#5f84c4', not_confirmed: '#d6a950', checked_in: '#5fa386', checked_out: '#7e8a9f' }
function statusEdge(status: string) {
  const k = status.toLowerCase()
  return EDGE[k === 'in_house' ? 'checked_in' : k] ?? EDGE.confirmed
}
const HATCH_BLOCK = 'repeating-linear-gradient(135deg,#3a4a5c 0 5px,#2a3846 5px 10px)'
const HATCH_SERVICE = 'repeating-linear-gradient(135deg,#6b4a14 0 5px,#4a3410 5px 10px)'
// Solid, opaque fills for reservation bars (top, bottom), keyed by the status colour.
const BAR_FILL: Record<string, [string, string]> = {
  [EDGE.confirmed]: ['#5f84c4', '#4a6aa6'],
  [EDGE.not_confirmed]: ['#d6a950', '#b88d38'],
  [EDGE.checked_in]: ['#5fa386', '#4a8a6f'],
  [EDGE.checked_out]: ['#7e8a9f', '#6a768b'],
}
const HEAD_BG = '#0e1a3d'
const ROOM_BG = '#142350'

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

const AIRBNB_PATH = 'M12.001 18.275c-1.353-1.697-2.148-3.184-2.413-4.457-.263-1.027-.16-1.848.291-2.465.477-.71 1.188-1.056 2.121-1.056s1.643.345 2.12 1.063c.446.61.558 1.432.286 2.465-.291 1.298-1.085 2.785-2.412 4.458zm9.601 1.14c-.185 1.246-1.034 2.28-2.2 2.783-2.253.98-4.483-.583-6.392-2.704 3.157-3.951 3.74-7.028 2.385-9.018-.795-1.14-1.933-1.695-3.394-1.695-2.944 0-4.563 2.49-3.927 5.382.37 1.565 1.352 3.343 2.917 5.332-.98 1.085-1.91 1.856-2.732 2.333-.636.344-1.245.558-1.828.609-2.679.399-4.778-2.2-3.825-4.88.132-.345.395-.98.845-1.961l.025-.053c1.464-3.178 3.242-6.79 5.285-10.795l.053-.132.58-1.116c.45-.822.635-1.19 1.351-1.643.346-.21.77-.315 1.246-.315.954 0 1.698.558 2.016 1.007.158.239.345.557.582.953l.558 1.089.08.159c2.041 4.004 3.821 7.608 5.279 10.794l.026.025.533 1.22.318.764c.243.613.294 1.222.213 1.858zm1.22-2.39c-.186-.583-.505-1.271-.9-2.094v-.03c-1.889-4.006-3.642-7.608-5.307-10.844l-.111-.163C15.317 1.461 14.468 0 12.001 0c-2.44 0-3.476 1.695-4.535 3.898l-.081.16c-1.669 3.236-3.421 6.843-5.303 10.847v.053l-.559 1.22c-.21.504-.317.768-.345.847C-.172 20.74 2.611 24 5.98 24c.027 0 .132 0 .265-.027h.372c1.75-.213 3.554-1.325 5.384-3.317 1.829 1.989 3.635 3.104 5.382 3.317h.372c.133.027.239.027.265.027 3.37.003 6.152-3.261 4.802-6.975z'

/** Where the booking came from, as a small letter badge: B. Booking.com, A Airbnb, W walk-in, @ website. */
function sourceBadge(src?: string): { t: string; color: string; name: string } | null {
  const s = (src ?? '').toLowerCase()
  if (!s) return null
  if (s.includes('booking.com')) return { t: 'B', color: '#003580', name: 'Booking.com' }
  if (s.includes('airbnb')) return { t: 'A', color: '#ff385c', name: 'Airbnb' }
  if (s.includes('walk')) return { t: 'W', color: '#1c9a66', name: 'Walk-in' }
  if (s.includes('website') || s.includes('direct') || s.includes('engine') || s.includes('soiree') || s.includes('soirée')) return { t: '@', color: '#7a54d6', name: 'Website' }
  return null
}

function Bar({ start, end, viewStart, totalDays, label, sub, bg, border, text, edge, onClick, onContextMenu, title, dayW, due, note, multi, src, draggable, onDragStart, onDragEnd, passive }: {
  start: string; end: string; viewStart: string; totalDays: number; label: string; sub?: string; bg: string; border: string; text: string; edge?: string; onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void; title?: string; dayW: number; due?: boolean; note?: boolean; multi?: boolean; src?: string
  draggable?: boolean; onDragStart?: (e: React.DragEvent<HTMLButtonElement>) => void; onDragEnd?: () => void; passive?: boolean
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
        className={`${passive ? 'pointer-events-none ' : ''}absolute top-1 flex items-center overflow-hidden whitespace-nowrap rounded-[10px] border px-2.5 text-left text-[11px] font-semibold leading-none hover:brightness-110`}
        style={{ left: left + 1, width: w, height: ROW_H - 8, background: bg, borderColor: border, color: text }}>
        <span className="truncate">{label}</span>
      </button>
    )
  }
  const badge = sourceBadge(src)
  const barH = ROW_H - 10
  const [top, bottom] = BAR_FILL[edge] ?? BAR_FILL[EDGE.confirmed]
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title ?? label}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`${passive ? 'pointer-events-none ' : ''}${draggable ? 'cursor-grab active:cursor-grabbing ' : ''}absolute flex items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[7px] border ${due ? 'pl-[17px]' : 'pl-2.5'} pr-1.5 text-left hover:brightness-110`}
      style={{ left: left + 1, width: w, top: (ROW_H - barH) / 2, height: barH, color: text, borderColor: note ? '#f2c94c' : 'rgba(255,255,255,.18)', borderWidth: note ? 1 : undefined, background: `linear-gradient(180deg,${top},${bottom})`, boxShadow: note ? '0 0 0 1px rgba(242,201,76,.22), 0 2px 6px rgba(0,0,0,.35)' : '0 2px 6px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.22)' }}
    >
      {due && <i aria-label="Balance due" title="Balance due" className="absolute left-[3px] top-[3px] h-[6px] w-[6px] rounded-full bg-[#ff4d5a] ring-1 ring-white/70" />}
      <span className="min-w-0 flex-1 truncate text-[11px] font-bold">
        {multi && <b title="Several rooms in this reservation" className="mr-1 font-black">+</b>}{label}
        {sub && w >= 80 && <span className="ml-1.5 font-medium opacity-80">· {sub}</span>}
      </span>
      {badge && w >= 60 && (
        <i title={badge.name} className="inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[4px] text-[9.5px] font-black not-italic leading-none text-white shadow-[0_1px_2px_rgba(0,0,0,.35)]" style={{ background: badge.color }}>
          {badge.name === 'Airbnb' ? (
            <svg viewBox="0 0 24 24" className="h-[10px] w-[10px]" fill="#fff" aria-hidden="true"><path d={AIRBNB_PATH} /></svg>
          ) : badge.name === 'Booking.com' ? (
            <span className="tracking-[-0.02em]">B<span className="text-[#5ec2ff]">.</span></span>
          ) : badge.t}
        </i>
      )}
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
  const [menu, setMenu] = useState<{ x: number; y: number; reservationID: string; guestName: string; status: string; roomID: string | null; assign?: { typeID: string; start: string; end: string } } | null>(null)
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
  // Reservations that carry a guest special request or a staff note (yellow dot). Looked up lazily, in small batches.
  const [noteIds, setNoteIds] = useState<Set<string>>(new Set())
  const noteChecked = useRef<Map<string, number>>(new Map())
  useEffect(() => {
    if (!data) return
    const today = data.today
    const ids = [...new Set([...data.bookings, ...data.unassigned]
      .filter((b) => b.status !== 'checked_out' && (!today || b.end >= today))
      .map((b) => b.reservationID))]
      .filter((id) => (noteChecked.current.get(id) ?? 0) < Date.now() - 5 * 60 * 1000)
    if (!ids.length) return
    let stop = false
    ;(async () => {
      for (let i = 0; i < ids.length && !stop; i += 40) {
        const batch = ids.slice(i, i + 40)
        try {
          const r = await cbApi<{ flagged: string[] }>(`/api/cloudbeds/note-flags?ids=${batch.join(',')}`)
          if (stop) return
          const now = Date.now()
          batch.forEach((id) => noteChecked.current.set(id, now))
          setNoteIds((prev) => {
            const next = new Set(prev)
            batch.forEach((id) => next.delete(id))
            r.flagged.forEach((id) => next.add(id))
            return next
          })
        } catch {
          /* the dots are a nicety — try again on the next refresh */
        }
      }
    })()
    return () => { stop = true }
  }, [data])
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

  // Reservations holding more than one room at the same time (rooms whose dates overlap) get a "+" before the name.
  const multiIds = useMemo(() => {
    const by = new Map<string, { start: string; end: string }[]>()
    for (const b of [...(data?.bookings ?? []), ...(data?.unassigned ?? [])]) {
      if (b.status === 'canceled' || b.status === 'cancelled' || b.status === 'no_show') continue
      const a = by.get(b.reservationID) ?? []
      a.push({ start: b.start, end: b.end })
      by.set(b.reservationID, a)
    }
    const out = new Set<string>()
    for (const [id, a] of by) {
      if (a.length < 2) continue
      if (a.some((x, i) => a.some((y, j) => j > i && x.start < y.end && y.start < x.end))) out.add(id)
    }
    return out
  }, [data])
  const dueOf = (id: string, due?: boolean) => {
    const o = dueOverride.current.get(id)
    return o && o.until > Date.now() ? o.due : due
  }
  const onBalance = (id: string, balance: number | null) => {
    dueOverride.current.set(id, { due: Number(balance ?? 0) > 0.005, until: Date.now() + 600000 })
    bumpDue((n) => n + 1)
  }

  const priceSaving = useRef(false)
  const savePrice = async () => {
    const pe = priceEdit
    const cur = dataRef.current
    if (!pe || !cur || priceSaving.current) return
    const fail = (text: string) => { setPriceEdit(null); setToast({ ok: false, text }) }
    const t = cur.roomTypes.find((x) => x.id === pe.typeID)
    const rate = Number(pe.value.replace(',', '.'))
    if (!t?.rateID) { fail('This category has no editable base rate.'); return }
    if (!Number.isFinite(rate) || rate <= 0) { fail('Enter a valid price.'); return }
    const through = pe.through && pe.through >= pe.day ? pe.through : pe.day
    if (diff(pe.day, through) >= 30) { fail('Up to 30 nights at a time.'); return }
    priceSaving.current = true
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
      fail(e instanceof Error ? e.message : 'Cloudbeds error')
    }
    priceSaving.current = false
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

  // ---- Drag a reservation to another room / category / date ----
  type DragInfo = { reservationID: string; guestName: string; status: string; start: string; end: string; fromRoomID: string | null; fromTypeID: string; offset: number }
  type MoveAsk = { drag: DragInfo; toRoomID: string; toTypeID: string; newStart: string; newEnd: string; adjustPrice?: boolean }
  const dragRef = useRef<DragInfo | null>(null)
  const [dragging, setDragging] = useState(false)
  const [dragHover, setDragHover] = useState<{ roomID: string; from: string; to: string; ok: boolean } | null>(null)
  const [moveAsk, setMoveAsk] = useState<MoveAsk | null>(null)
  const roomName = (id: string | null, typeID: string) => {
    const t = data?.roomTypes.find((x) => x.id === typeID)
    const r = t?.rooms.find((x) => x.id === id)
    return r ? `Room ${r.name}` : 'No room yet'
  }

  function startDrag(e: React.DragEvent<HTMLButtonElement>, s: { reservationID: string; guestName: string; status: string; start: string; end: string }, fromRoomID: string | null, fromTypeID: string) {
    if (!data) return
    const rect = e.currentTarget.getBoundingClientRect()
    const gridX = e.clientX - rect.left + Math.max(0, diff(data.start, s.start) + 0.5) * dayW
    const nights = diff(s.start, s.end)
    const offset = Math.max(0, Math.min(nights, Math.floor(gridX / dayW) - diff(data.start, s.start)))
    dragRef.current = { ...s, fromRoomID, fromTypeID, offset }
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', s.reservationID)
    setMenu(null)
    setTimeout(() => setDragging(true), 0)
  }

  /** Why the reservation cannot go there (taken, blocked, in the past), or null when it fits. */
  function moveProblem(d: DragInfo, roomID: string, newStart: string, newEnd: string): string | null {
    if (!data) return 'Calendar not loaded'
    if (newStart !== d.start && newStart < data.today) return "A reservation can't be moved to dates in the past."
    if (newStart !== d.start && d.status === 'checked_in') return 'This guest is checked in: change the stay dates in the reservation window.'
    const taken = data.bookings.find((b) => b.roomID === roomID && b.reservationID !== d.reservationID && b.start < newEnd && newStart < b.end)
    if (taken) return `That room is taken by ${taken.guestName} on those dates.`
    const blocked = data.blocks.find((b) => b.roomID === roomID && b.start < newEnd && newStart <= b.end)
    if (blocked) return `That room is blocked on those dates (${blocked.reason || 'blocked'}).`
    return null
  }

  function dropOn(room: { id: string }, toTypeID: string, day: string) {
    const d = dragRef.current
    dragRef.current = null
    setDragHover(null)
    setDragging(false)
    if (!d || !data) return
    const newStart = addDays(day, -d.offset)
    const newEnd = addDays(newStart, diff(d.start, d.end))
    const datesChanged = newStart !== d.start
    if (!datesChanged && room.id === d.fromRoomID) return
    const problem = moveProblem(d, room.id, newStart, newEnd)
    if (problem) { setToast({ ok: false, text: problem }); return }
    const ask: MoveAsk = { drag: d, toRoomID: room.id, toTypeID, newStart, newEnd }
    if (toTypeID === d.fromTypeID && !datesChanged) void executeMove(ask)
    else setMoveAsk(ask)
  }

  async function executeMove(a: MoveAsk) {
    setMoveAsk(null)
    const d = a.drag
    const datesChanged = a.newStart !== d.start
    const cur = dataRef.current
    const orig = cur && (d.fromRoomID
      ? cur.bookings.find((b) => b.reservationID === d.reservationID && b.roomID === d.fromRoomID && b.start === d.start)
      : cur.unassigned.find((u) => u.reservationID === d.reservationID && u.start === d.start && u.roomTypeID === d.fromTypeID))
    // Show the move on the calendar straight away; Cloudbeds is told in the background and double-checked afterwards.
    if (orig) {
      setData((prev) => prev && ({
        ...prev,
        bookings: [
          ...prev.bookings.filter((b) => !(d.fromRoomID && b.reservationID === d.reservationID && b.roomID === d.fromRoomID && b.start === d.start)),
          { reservationID: d.reservationID, guestName: orig.guestName, status: orig.status, roomID: a.toRoomID, start: a.newStart, end: a.newEnd, due: orig.due, src: orig.src },
        ],
        unassigned: d.fromRoomID ? prev.unassigned : prev.unassigned.filter((u) => !(u.reservationID === d.reservationID && u.start === d.start && u.roomTypeID === d.fromTypeID)),
      }))
    }
    const putBack = () => setData((prev) => {
      if (!prev || !orig) return prev
      const bookings = prev.bookings.filter((b) => !(b.reservationID === d.reservationID && b.roomID === a.toRoomID && b.start === a.newStart))
      if (d.fromRoomID) return { ...prev, bookings: [...bookings, orig as Booking] }
      return { ...prev, bookings, unassigned: [...prev.unassigned, orig as Unassigned] }
    })
    try {
      await cbApi(`/api/cloudbeds/reservation/${d.reservationID}`, 'POST', {
        action: 'move',
        oldRoomID: d.fromRoomID ?? undefined,
        fromTypeID: d.fromTypeID,
        fromStart: d.start,
        newRoomID: a.toRoomID,
        newRoomTypeID: a.toTypeID,
        ...(datesChanged ? { checkin: a.newStart, checkout: a.newEnd } : {}),
        adjustPrice: a.adjustPrice !== false,
      })
    } catch (e) {
      putBack()
      setToast({ ok: false, text: `${d.guestName} was not moved: ${e instanceof Error ? e.message : 'Cloudbeds error'}` })
      return
    }
    setToast({ ok: true, text: `${d.guestName}: moved to ${roomName(a.toRoomID, a.toTypeID)}${datesChanged ? ` · ${a.newStart} → ${a.newEnd}` : ''}.` })
    // Double-check with Cloudbeds a moment later; if the change is not there, put the reservation back where it was.
    const from = d.start < a.newStart ? d.start : a.newStart
    const to = d.end > a.newEnd ? d.end : a.newEnd
    let confirmed = false
    for (const wait of [1000, 2000, 3000]) {
      await new Promise((r) => setTimeout(r, wait))
      try {
        const chunk = await fetchRange(addDays(from, -1), diff(from, to) + 3)
        if (chunk.bookings.some((b) => b.reservationID === d.reservationID && b.roomID === a.toRoomID && b.start === a.newStart)) {
          confirmed = true
          setData((prev) => mergeChunk(prev, { ...chunk, days: prev?.days ?? chunk.days, start: prev?.start ?? chunk.start }, addDays(from, -1), addDays(to, 2)))
          break
        }
      } catch {
        // Try again.
      }
    }
    if (!confirmed) {
      putBack()
      setToast({ ok: false, text: `Cloudbeds did not confirm the move, so ${d.guestName} is back where it was. Check the reservation in Cloudbeds.` })
    }
  }

  /** Takes a reservation out of its room (back to "Unassigned"): shown at once, sent to Cloudbeds, double-checked, reverted if it fails. */
  async function doUnassign(reservationID: string, guestName: string, roomID: string) {
    const cur = dataRef.current
    const orig = cur?.bookings.find((b) => b.reservationID === reservationID && b.roomID === roomID)
    const typeID = roomTypeOf[roomID]
    if (!cur || !orig || !typeID) return
    const row: Unassigned = { reservationID, guestName, roomTypeID: typeID, start: orig.start, end: orig.end, status: orig.status, due: orig.due, src: orig.src }
    setData((prev) => prev && ({ ...prev, bookings: prev.bookings.filter((b) => b !== orig), unassigned: [...prev.unassigned, row] }))
    const putBack = () => setData((prev) => prev && ({
      ...prev,
      bookings: [...prev.bookings.filter((b) => !(b.reservationID === reservationID && b.roomID === roomID && b.start === orig.start)), orig],
      unassigned: prev.unassigned.filter((u) => !(u.reservationID === reservationID && u.start === orig.start && u.roomTypeID === typeID)),
    }))
    try {
      await cbApi(`/api/cloudbeds/reservation/${reservationID}`, 'POST', { action: 'unassign', roomID })
    } catch (e) {
      putBack()
      setToast({ ok: false, text: `${guestName} was not unassigned: ${e instanceof Error ? e.message : 'Cloudbeds error'}` })
      return
    }
    setToast({ ok: true, text: `${guestName}: room unassigned.` })
    let confirmed = false
    for (const wait of [1000, 2000, 3000]) {
      await new Promise((r) => setTimeout(r, wait))
      try {
        const chunk = await fetchRange(addDays(orig.start, -1), diff(orig.start, orig.end) + 3)
        if (!chunk.bookings.some((b) => b.reservationID === reservationID && b.roomID === roomID && b.start === orig.start)) {
          confirmed = true
          setData((prev) => mergeChunk(prev, { ...chunk, days: prev?.days ?? chunk.days, start: prev?.start ?? chunk.start }, addDays(orig.start, -1), addDays(orig.end, 2)))
          break
        }
      } catch {
        // Try again.
      }
    }
    if (!confirmed) {
      putBack()
      setToast({ ok: false, text: `Cloudbeds did not confirm it, so ${guestName} is back in the room. Check the reservation in Cloudbeds.` })
    }
  }

  /** Rooms of one category that are free for [start, end). */
  function freeRooms(typeID: string, start: string, end: string, reservationID: string) {
    const t = data?.roomTypes.find((x) => x.id === typeID)
    if (!data || !t) return []
    return t.rooms.filter((r) =>
      !data.bookings.some((b) => b.roomID === r.id && b.reservationID !== reservationID && b.start < end && start < b.end) &&
      !data.blocks.some((b) => b.roomID === r.id && b.start < end && start <= b.end))
  }

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
    if (action === 'unassign' && m.roomID) { void doUnassign(m.reservationID, m.guestName, m.roomID); return }
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

  const pill = `h-8 rounded-full border border-white/10 bg-white/[.06] px-3 text-[12px] font-medium text-[#eaf0fb] transition hover:bg-white/10`

  return (
    <div className="p-2 md:p-3">
      <div className="min-h-[calc(100vh-1.5rem)] rounded-2xl p-3 text-[#eaf0fb] antialiased" style={{ background: HOLO_BG }}>
        <div className="mb-2.5 flex flex-wrap items-center gap-2 pb-0.5 pt-1">
          <div className="mr-6 flex items-center">
            {/* The wordmark is centred over the room column below it (same width), and the title starts after it. */}
            <div className="flex shrink-0 items-center justify-center" style={{ width: LEFT_W + 1 }}>
              <Link href="/cloudbeds" title="Back to the dashboard" className="font-display text-[40px] font-semibold italic leading-none tracking-tight text-white hover:opacity-90">Soirée</Link>
            </div>
            <span className="mr-4 h-9 w-px bg-white/25" />
            <div className="leading-none">
              <div className="flex items-center gap-2.5"><h1 className="text-[20px] font-semibold leading-tight tracking-tight text-white">Calendar</h1><PropertyClock /></div>
              <p className="mt-1.5 flex items-center gap-1.5 whitespace-nowrap text-[10.5px] text-[#8a9bb0]">
                {roomCount} rooms
                <span className="h-1.5 w-1.5 rounded-full bg-[#3ccf8a]" /> Updates automatically
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => scrollBy(-7)} className={`${pill} w-8 !px-0 text-base`} aria-label="Back a week">‹</button>
            <button onClick={() => { if (data) { jumpTo(data.today); setMarkDay(data.today) } }} className={`${pill} font-bold !text-[#8fb4ff]`}>Today</button>
            <button onClick={() => scrollBy(7)} className={`${pill} w-8 !px-0 text-base`} aria-label="Forward a week">›</button>
            <div className="ml-1 flex rounded-full border border-white/10 bg-white/[.06] p-[3px]" role="group" aria-label="Days shown">
              {SPANS.map((o) => (
                <button key={o.days} onClick={() => changeSpan(o.days)} aria-pressed={span === o.days}
                  className={`h-[26px] rounded-full border px-2.5 text-[12px] font-semibold ${span === o.days ? 'border-[#8fb4ff]/50 bg-white/15 text-white' : 'border-transparent text-[#9aa8bb] hover:text-white'}`}>{o.label}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[13px]">
            <input type="date" value={goTo} onChange={(e) => setGoTo(e.target.value)} aria-label="Go to date"
              className="h-8 rounded-full border border-white/10 bg-white/[.06] px-3 text-[12px] text-[#eaf0fb] outline-none [color-scheme:dark] focus:border-[#8fb4ff]/60" />
            <button onClick={() => goTo && jumpTo(goTo)} className={pill}>Go</button>
          </div>
          <div className="min-w-0 flex-1" />
          <div className="w-[300px] max-w-full"><SearchBar onOpen={setOpen} dark /></div>
          {data && (
            <div className="flex items-center gap-2">
              <button onClick={() => setCreating('block')} className={pill}>Block dates</button>
              <button onClick={() => setCreating('blank')} className={`${priGreen} !h-8 !text-[12px] shadow-[0_4px_18px_rgba(39,173,134,.5),inset_0_1px_0_rgba(255,255,255,.28)]`}>+ New reservation</button>
            </div>
          )}
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-[10.5px] text-[#9aa8bb]">
          {([['Confirmed', EDGE.confirmed], ['Not confirmed', EDGE.not_confirmed], ['Checked in', EDGE.checked_in], ['Checked out', EDGE.checked_out]] as const).map(([l, e]) => (
            <span key={l} className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[4px] border" style={{ background: `linear-gradient(100deg,${e}88,${e}33)`, borderColor: e }} />{l}</span>
          ))}
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[4px] border" style={{ background: HATCH_BLOCK, borderColor: '#5b6b80' }} />Blocked</span>
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[4px] border" style={{ background: HATCH_SERVICE, borderColor: '#b88a2e' }} />Out of service</span>
          <span className="flex items-center gap-1.5"><i className="h-[7px] w-[7px] rounded-full bg-[#ff5d6c]" />Balance due</span>
          <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-[4px] border border-[#f2c94c] bg-transparent" />Note / special request</span>
        </div>

        {error && <p className="mb-2 rounded-md bg-red-500/15 px-4 py-2 text-sm text-red-200">{error}</p>}
        {!data && !error && <p className="py-10 text-center text-sm text-[#8a9bb0]">Loading the calendar…</p>}

        {data && (
          <div ref={scroller} onScroll={onScroll} onMouseLeave={() => setHoverDay(null)} className="relative overflow-x-auto rounded-3xl border border-[#8fb4ff]/25 shadow-[0_0_40px_rgba(143,180,255,.08),0_24px_60px_rgba(0,0,0,.45)]" style={{ background: 'rgba(22,40,92,.5)' }}>
            {loading && (
              <div className="pointer-events-none sticky top-0 left-0 z-30 h-0">
                <span className="absolute left-2 top-1 rounded bg-[#0e1a3d] px-2 py-0.5 text-[10px] text-[#9aa8bb] shadow">Loading {loading === 'past' ? 'earlier' : 'later'} days…</span>
              </div>
            )}
            <div className="relative" style={{ width: gridW }}>
              {markDay && data.days.includes(markDay) && (
                <div className="pointer-events-none absolute bottom-0 top-0 z-[5]" style={{
                  left: LEFT_W + data.days.indexOf(markDay) * dayW, width: dayW,
                  background: 'rgba(143,180,255,.10)', boxShadow: 'inset 1px 0 0 rgba(143,180,255,.38), inset -1px 0 0 rgba(143,180,255,.38)',
                }} />
              )}
              {data.days.includes(data.today) && (
                <div className="pointer-events-none absolute bottom-0 z-[5] w-px" style={{
                  left: LEFT_W + data.days.indexOf(data.today) * dayW + dayW / 2 - 0.5, top: MONTH_ROW_H + PCT_ROW_H + DAY_ROW_H,
                  background: 'linear-gradient(180deg,rgba(143,180,255,.38),rgba(143,180,255,.03))',
                }} />
              )}
              <div className="sticky top-0 z-20 flex border-b border-white/10 text-[9px] font-semibold text-[#6f7f94]" style={{ background: HEAD_BG }}>
                <div className="sticky left-0 z-10 border-r border-white/10" style={{ width: LEFT_W, minWidth: LEFT_W, height: MONTH_ROW_H, background: HEAD_BG }} />
                <div className="relative" style={{ width: totalDays * dayW, height: MONTH_ROW_H }}>
                  {monthBands.map((m) => (
                    <div key={m.left} className="absolute top-0 flex h-full items-center border-l-2 border-[#8fb4ff]/30 pl-1.5 tracking-[.12em]" style={{ left: m.left, width: m.width }}>{m.label}</div>
                  ))}
                </div>
              </div>

              <div className="sticky z-20 flex border-b border-white/10 text-[9.5px] font-semibold text-[#8a9bb0]" style={{ top: MONTH_ROW_H, background: HEAD_BG }}>
                <div className="sticky left-0 z-10 border-r border-white/10" style={{ width: LEFT_W, minWidth: LEFT_W, height: PCT_ROW_H, background: HEAD_BG }} />
                {data.days.map((d) => {
                  const pct = roomCount ? ((dayStats?.occupiedByDay[d] ?? 0) / roomCount) * 100 : 0
                  const isToday = d === data.today
                  return (
                    <div key={d} className={`relative flex items-center justify-center border-r border-white/[.06] ${isToday ? 'text-[#8fb4ff]' : ''}`} style={{ width: dayW, minWidth: dayW, height: PCT_ROW_H }}>
                      {pct.toFixed(0)}%
                      <i className="absolute bottom-0 left-1/2 h-[2px] -translate-x-1/2 rounded-full" style={{ width: dayW * 0.55, background: `linear-gradient(90deg,#8fb4ff ${pct}%,rgba(255,255,255,.1) ${pct}%)` }} />
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
                      className={`flex cursor-pointer flex-col items-center justify-center border-r border-white/[.06] text-center leading-tight ${dt.getUTCDate() === 1 ? 'border-l-2 border-l-[#8fb4ff]/30' : ''} ${d === hoverDay ? 'bg-white/[.06]' : ''}`}
                      style={{ width: dayW, minWidth: dayW, height: DAY_ROW_H, backgroundImage: isToday ? 'linear-gradient(180deg,rgba(143,180,255,.10),rgba(143,180,255,0))' : undefined }}>
                      <span className="text-[9.5px] font-medium text-[#8a9bb0]">{dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })}</span>
                      <span className={`mt-px flex h-5 min-w-5 items-center justify-center rounded-full text-[11.5px] font-bold ${isToday ? 'border border-[#8fb4ff]/50 bg-[#8fb4ff]/15 text-[#8fb4ff]' : markDay === d ? 'bg-white/15 text-white' : 'text-white'}`}>{dt.getUTCDate()}</span>
                    </div>
                  )
                })}
              </div>

              {orderedTypes.map((t, ti) => {
                const isCollapsed = collapsed.has(t.id)
                const unassigned = data.unassigned.filter((u) => u.roomTypeID === t.id)
                                return (
                  <div key={t.id} className="border-b border-white/10">
                    <div className="flex border-t border-white/[.12] text-[9px]" style={{ backgroundImage: 'linear-gradient(90deg,rgba(255,255,255,.09),rgba(255,255,255,.02))' }}>
                      <div
                        draggable
                        onDragStart={() => setDragType(t.id)}
                        onDragOver={(e) => { if (dragType && dragType !== t.id) e.preventDefault() }}
                        onDrop={() => { if (dragType) moveType(dragType, t.id); setDragType(null) }}
                        onDragEnd={() => setDragType(null)}
                        className={`sticky left-0 z-10 flex items-center border-r border-white/10 pr-1 ${dragType === t.id ? 'opacity-50' : ''} ${dragType && dragType !== t.id ? 'outline-dashed outline-1 -outline-offset-2 outline-[#8fb4ff]/50' : ''}`}
                        style={{ width: LEFT_W, minWidth: LEFT_W, height: TYPE_ROW_H, backgroundColor: HEAD_BG, backgroundImage: 'linear-gradient(rgba(255,255,255,.07),rgba(255,255,255,.07))' }}
                      >
                                                <span title="Drag to re-order" className="cursor-grab select-none px-0.5 text-[11px] leading-none text-white/30 hover:text-white/70" aria-hidden="true">⋮⋮</span>
                        <button
                          onClick={() => { const n = new Set(collapsed); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); setCollapsed(n) }}
                          className="flex min-w-0 flex-1 items-center truncate pl-3 pr-1 text-left text-[10.5px] font-bold uppercase tracking-[.12em] text-[#f1f4f9]"
                        >
                          <span className="mr-1 inline-block shrink-0 text-[10px] opacity-70">{isCollapsed ? '›' : '⌄'}</span><span className="truncate">{t.name}</span>
                        </button>
                        <span className="mr-1 shrink-0 text-[10.5px] text-[#7b8494]">{t.rooms.length}</span>
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
                            className={`flex flex-col items-center justify-center border-r border-white/[.05] leading-tight ${new Date(`${d}T12:00:00Z`).getUTCDate() === 1 ? 'border-l-2 border-l-[#8fb4ff]/30' : ''}`}
                            style={{ width: dayW, minWidth: dayW, height: TYPE_ROW_H, color: '#8a93a3' }}>
                            {rate ? (
                              <>
                                <span className="opacity-70">{avail ?? ''}</span>
                                {priceEdit && priceEdit.typeID === t.id && priceEdit.day === d ? (
                                  <input
                                    autoFocus
                                    inputMode="decimal"
                                    disabled={priceEdit.busy}
                                    value={priceEdit.value}
                                    onFocus={(e) => e.currentTarget.select()}
                                    onChange={(e) => setPriceEdit({ ...priceEdit, value: e.target.value, err: null })}
                                    onKeyDown={(e) => { if (e.key === 'Escape') setPriceEdit(null); if (e.key === 'Enter') savePrice() }}
                                    onBlur={() => { if (!priceEdit.busy) { if (Number(priceEdit.value.replace(',', '.')) === Math.round(rate)) setPriceEdit(null); else savePrice() } }}
                                    aria-label="Price for this night"
                                    className="rounded border border-[#8fb4ff] bg-[#0e1a3d] px-0.5 text-center text-[9.5px] font-semibold text-white outline-none disabled:opacity-60"
                                    style={{ width: Math.max(36, dayW - 14) }}
                                  />
                                ) : (
                                  <button
                                    title="Click to change the price"
                                    onClick={() => setPriceEdit({ typeID: t.id, day: d, value: String(Math.round(rate)), through: d, x: 0, y: 0, busy: false, err: null })}
                                    className="rounded px-1 text-[9.5px] font-semibold underline-offset-2 hover:bg-white/10 hover:underline"
                                  >${Math.round(rate).toLocaleString('en-US')}</button>
                                )}
                              </>
                            ) : (
                              <span>{avail || ''}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {!isCollapsed && [...t.rooms, ...(unassigned.length || (dragging && dragRef.current?.fromRoomID && dragRef.current.fromTypeID === t.id) ? [{ id: `unassigned-${t.id}`, name: 'Unassigned' }] : [])].map((room) => {
                      const isUnassigned = room.id.startsWith('unassigned-')
                      const stays = isUnassigned ? unassigned.map((u) => ({ ...u, roomID: room.id })) : data.bookings.filter((b) => b.roomID === room.id)
                      const blocks = data.blocks.filter((b) => b.roomID === room.id)
                      return (
                        <div key={room.id} className="group flex border-t border-white/[.06]">
                          <div className={`sticky left-0 z-10 flex items-center gap-2 border-r border-white/10 pl-2.5 pr-2 text-[10.5px] font-semibold ${isUnassigned ? 'italic text-amber-300' : ''}`}
                            style={{ width: LEFT_W, minWidth: LEFT_W, height: ROW_H, backgroundColor: ROOM_BG }}>
                            <span className={`truncate ${isUnassigned ? '' : 'text-[#dbe5f1]'}`}>{room.name}</span>
                          </div>
                          <div className="relative flex" style={{ height: ROW_H }}>
                            {data.days.map((d) => {
                              const canPick = !isUnassigned && d >= data.today
                              const inRange = pick && pick.roomID === room.id && pick.hover !== null
                                ? d >= (pick.hover < pick.start ? pick.hover : pick.start) && d <= (pick.hover < pick.start ? pick.start : pick.hover)
                                : pick?.roomID === room.id && d === pick.start
                              const dow = new Date(`${d}T12:00:00Z`).getUTCDay()
                              const dh = dragHover && dragHover.roomID === room.id && d >= dragHover.from && d < dragHover.to ? dragHover : null
                              const bg = dh ? (dh.ok ? 'bg-[#8fb4ff]/25' : 'bg-[#ff4d5a]/20') : inRange ? 'bg-[#3ccf8a]/30' : d === hoverDay ? 'bg-white/[.06]' : d === data.today ? 'bg-[#8fb4ff]/[.035]' : dow === 0 || dow === 6 ? 'bg-white/[.025]' : ''
                              return (
                                <div key={d}
                                  onClick={canPick ? () => clickDay(room, t.id, d) : undefined}
                                  onMouseEnter={() => {
                                    setHoverDay(d)
                                    if (pick && pick.roomID === room.id) setPick((p) => (p ? { ...p, hover: d } : p))
                                  }}
                                  onDragOver={isUnassigned ? (e) => {
                                    const dr = dragRef.current
                                    if (dr && dr.fromRoomID && dr.fromTypeID === t.id) { e.preventDefault(); if (!dragHover || dragHover.roomID !== room.id) setDragHover({ roomID: room.id, from: dr.start, to: dr.end, ok: true }) }
                                  } : (e) => {
                                    const dr = dragRef.current
                                    if (!dr) return
                                    e.preventDefault()
                                    const ns = addDays(d, -dr.offset)
                                    const ne = addDays(ns, diff(dr.start, dr.end))
                                    if (!dragHover || dragHover.roomID !== room.id || dragHover.from !== ns) setDragHover({ roomID: room.id, from: ns, to: ne, ok: moveProblem(dr, room.id, ns, ne) === null })
                                  }}
                                  onDrop={isUnassigned ? (e) => {
                                    e.preventDefault()
                                    const dr = dragRef.current
                                    dragRef.current = null; setDragHover(null); setDragging(false)
                                    if (dr && dr.fromRoomID && dr.fromTypeID === t.id && confirm(`Remove ${dr.guestName} from this room? The reservation stays, but without a room.`)) void doUnassign(dr.reservationID, dr.guestName, dr.fromRoomID)
                                  } : (e) => { e.preventDefault(); dropOn(room, t.id, d) }}
                                  className={`${canPick ? 'cursor-pointer hover:bg-[#3ccf8a]/20' : ''} ${bg}`}
                                  style={{ width: dayW, minWidth: dayW }} />
                              )
                            })}
                            <div className="pointer-events-none absolute inset-0" style={{
                              backgroundImage: 'linear-gradient(to left, rgba(143,180,255,.09) 1px, transparent 1px)',
                              backgroundSize: `${dayW}px 100%`,
                            }} />
                            {blocks.map((b, i) => {
                              const service = b.type === 'out_of_service' || /service|servicio|mainten|repair|mantenim|reparaci/i.test(b.reason)
                              return (
                                <Bar key={`b${i}`} start={b.start} end={addDays(b.end, 1)} viewStart={data.start} totalDays={totalDays} label={b.reason}
                                  bg={service ? HATCH_SERVICE : HATCH_BLOCK} border={service ? '#b88a2e' : '#5b6b80'} text={service ? '#ffd9a0' : '#cdd6e2'}
                                  title={`${service ? 'Out of service' : 'Blocked'}: ${b.reason} (click to open)`} dayW={dayW} passive={dragging} onClick={() => setOpenBlock(b)} />
                              )
                            })}
                            {stays.map((s) => (
                              <Bar key={`${s.reservationID}-${s.start}`} start={s.start} end={s.end} viewStart={data.start} totalDays={totalDays}
                                label={s.guestName} sub={`${diff(s.start, s.end)}n`} due={dueOf(s.reservationID, s.due)} note={noteIds.has(s.reservationID)} multi={multiIds.has(s.reservationID)} src={s.src}
                                edge={statusEdge(s.status)} bg="" border="" text="#fff" onClick={() => setOpen(s.reservationID)} dayW={dayW}
                                draggable={!['checked_out', 'canceled', 'cancelled', 'no_show'].includes(s.status)}
                                onDragStart={(e) => startDrag(e, s, isUnassigned ? null : room.id, t.id)}
                                onDragEnd={() => { dragRef.current = null; setDragHover(null); setDragging(false) }}
                                passive={dragging}
                                onContextMenu={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  setMenu({ x: e.clientX, y: e.clientY, reservationID: s.reservationID, guestName: s.guestName, status: s.status, roomID: isUnassigned ? null : room.id, assign: isUnassigned ? { typeID: t.id, start: s.start, end: s.end } : undefined })
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
          {menu.assign && menu.status !== 'checked_out' && (
            <div className="border-t border-gray-100 pt-1">
              <p className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-gray-400">Assign to room</p>
              {(() => {
                const m = menu
                const free = freeRooms(m.assign!.typeID, m.assign!.start, m.assign!.end, m.reservationID)
                if (free.length === 0) return <p className="px-3 py-1.5 text-gray-400">No free room in this category</p>
                return free.map((r) => (
                  <button key={r.id} disabled={busy} className="block w-full px-3 py-1.5 text-left hover:bg-gray-100 disabled:opacity-50"
                    onClick={() => {
                      setMenu(null)
                      void executeMove({
                        drag: { reservationID: m.reservationID, guestName: m.guestName, status: m.status, start: m.assign!.start, end: m.assign!.end, fromRoomID: null, fromTypeID: m.assign!.typeID, offset: 0 },
                        toRoomID: r.id, toTypeID: m.assign!.typeID, newStart: m.assign!.start, newEnd: m.assign!.end,
                      })
                    }}>
                    Room {r.name}
                  </button>
                ))
              })()}
            </div>
          )}
        </div>
      )}

      {moveAsk && data && (() => {
        const a = moveAsk
        const rate = (typeID: string, day: string) => data.roomTypes.find((x) => x.id === typeID)?.rates[day]
        const fromRate = rate(a.drag.fromTypeID, a.newStart), toRate = rate(a.toTypeID, a.newStart)
        const typeChanged = a.toTypeID !== a.drag.fromTypeID
        const datesChanged = a.newStart !== a.drag.start
        const kind = typeChanged ? (fromRate != null && toRate != null ? (toRate > fromRate ? 'Upgrade' : toRate < fromRate ? 'Downgrade' : 'Change') : 'Change') : 'Move'
        const title = typeChanged ? (kind === 'Change' ? 'Change room category?' : `${kind} this reservation?`) : 'Change the dates?'
        const typeName = (id: string) => data.roomTypes.find((x) => x.id === id)?.name ?? ''
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setMoveAsk(null)}>
            <div className="w-full max-w-[360px] overflow-hidden rounded-2xl bg-white text-[#14213d] shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="bg-gradient-to-r from-[#2a4f9c] via-[#1d3a78] to-[#16305f] px-5 py-3.5 text-white">
                <p className="text-[15px] font-bold tracking-tight">{title}</p>
                <p className="mt-px text-xs text-white/70">{a.drag.guestName}</p>
              </div>
              <div className="space-y-2.5 px-5 py-4 text-[13px]">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 rounded-xl bg-[#f6f3ec] px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#7a8394]">From</p><p className="truncate font-semibold">{roomName(a.drag.fromRoomID, a.drag.fromTypeID)}</p><p className="truncate text-[11px] text-[#667085]">{typeName(a.drag.fromTypeID)}</p></div>
                  <span className="text-[#98a2b3]">→</span>
                  <div className="min-w-0 flex-1 rounded-xl bg-[#eaf1fd] px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-[#5b6b8c]">To</p><p className="truncate font-semibold">{roomName(a.toRoomID, a.toTypeID)}</p><p className="truncate text-[11px] text-[#667085]">{typeName(a.toTypeID)}</p></div>
                </div>
                {datesChanged && (
                  <p className="rounded-xl bg-[#f6f3ec] px-3 py-2"><span className="text-[10px] font-semibold uppercase tracking-wide text-[#7a8394]">Dates</span><br />
                    <span className="text-[#667085] line-through">{a.drag.start} → {a.drag.end}</span><br /><span className="font-semibold">{a.newStart} → {a.newEnd}</span> · {diff(a.newStart, a.newEnd)}n</p>
                )}
                {typeChanged && (
                  <div className="rounded-xl border border-[#e4e8ef] px-3 py-2.5">
                    <p className="text-[12.5px] font-semibold">Recalculate the price at the new room&apos;s rate?</p>
                    {(() => {
                      const nights = Array.from({ length: Math.max(0, diff(a.newStart, a.newEnd)) }, (_, i) => addDays(a.newStart, i))
                      const fr = nights.map((n) => rate(a.drag.fromTypeID, n)), to = nights.map((n) => rate(a.toTypeID, n))
                      if (!nights.length || fr.some((x) => x == null) || to.some((x) => x == null)) return null
                      const sum = (a: (number | undefined)[]) => a.reduce<number>((t, x) => t + (x ?? 0), 0)
                      const delta = sum(to) - sum(fr)
                      const per = Math.round(delta / nights.length)
                      const fmt = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}MXN ${Math.abs(Math.round(n)).toLocaleString('en-US')}`
                      return (
                        <p className={`mt-1 text-[13px] font-bold ${delta > 0 ? 'text-[#b4540a]' : delta < 0 ? 'text-[#0e7a56]' : 'text-[#667085]'}`}>
                          {delta === 0 ? 'No difference in price' : `${fmt(delta)} in total`}
                          {delta !== 0 && <span className="ml-1.5 text-[11.5px] font-medium opacity-80">({fmt(per)} per night · {nights.length}n)</span>}
                        </p>
                      )
                    })()}
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {([[true, 'Yes, update price'], [false, 'No, keep price']] as const).map(([v, l]) => (
                        <button key={l} onClick={() => setMoveAsk({ ...a, adjustPrice: v })}
                          className={`h-8 rounded-full border text-[12px] font-semibold transition ${(a.adjustPrice !== false) === v ? 'border-[#2456b8] bg-[#eaf1fd] text-[#1d3a78]' : 'border-[#dde2ea] bg-white text-[#667085] hover:bg-gray-50'}`}>{l}</button>
                      ))}
                    </div>
                    {datesChanged && <p className="mt-1.5 text-[11px] text-[#98a2b3]">The new dates themselves are priced by Cloudbeds.</p>}
                  </div>
                )}
                {datesChanged && multiIds.has(a.drag.reservationID) && <p className="text-[12px] text-[#b4540a]">This reservation has several rooms: the new dates apply to all of them.</p>}
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
                <button onClick={() => setMoveAsk(null)} className="h-9 rounded-full border border-[#dde2ea] px-4 text-[12.5px] font-medium hover:bg-gray-50">Cancel</button>
                <button onClick={() => void executeMove(a)} className="h-9 rounded-full bg-gradient-to-b from-[#3b78e6] to-[#2456b8] px-5 text-[12.5px] font-semibold text-white hover:brightness-95">Confirm</button>
              </div>
            </div>
          </div>
        )
      })()}

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


      {open && data && <ReservationModal id={open} today={data.today} onClose={() => setOpen(null)} onChanged={refreshVisible} onCheckedOut={(text) => setToast({ ok: true, text })} onBalance={onBalance} />}
    </div>
  )
}
