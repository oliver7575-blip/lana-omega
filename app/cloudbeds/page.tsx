'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import ReservationModal from '@/components/cloudbeds/ReservationModal'
import SearchBar from '@/components/cloudbeds/SearchBar'
import NewReservationModal from '@/components/cloudbeds/NewReservationModal'
import { HOLO_BG, priGreen } from '@/components/cloudbeds/ui'
import { cbApi, mxn, statusLabel, type DashRow } from '@/components/cloudbeds/shared'

interface ActivityRow { reservationID: string; guestName: string; revenue: number | null; checkIn: string; nights: number }
interface Summary {
  today: string
  links: { newReservation: string }
  arrivals: number
  departures: number
  stayovers: number
  roomsOccupied: number
  percentageOccupied: number
  sales: { count: number; roomNights: number; revenue: number; rows: ActivityRow[] }
  cancellations: { count: number; roomNights: number; revenue: number; rows: ActivityRow[] }
}
interface CalBooking { reservationID: string; guestName: string; status: string; roomID: string; start: string; end: string; due?: boolean; src?: string }
interface CalData {
  days: string[]
  roomTypes: { id: string; name: string; rates: Record<string, number>; rooms: { id: string; name: string }[] }[]
  bookings: CalBooking[]
  unassigned: { reservationID: string; guestName: string; start: string; end: string; status: string; due?: boolean; src?: string }[]
  blocks: { roomBlockID: string; roomID: string; start: string; end: string; type: string }[]
  overbookings: { roomID: string; reservationIDs: string[] }[]
}

const TABS = [
  { key: 'arrivals', label: 'Arrivals' },
  { key: 'departures', label: 'Departures' },
  { key: 'stayovers', label: 'Stayovers' },
  { key: 'inhouse', label: 'In-House Guests' },
]

const CARD_BG = 'rgba(22,40,92,.5)'
const LINE = 'border-[#8fb4ff]/25'
const BLUE = '#5b95f5'
const GREEN = '#3ccf8a'
const AMBER = '#f0b548'
const GREY = '#8793a6'

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)
const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })
const mdDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

function sourceBadge(src?: string): { t: string; color: string; name: string } {
  const s = (src ?? '').toLowerCase()
  if (s.includes('booking.com')) return { t: 'B.', color: '#0b4aa8', name: 'Booking.com' }
  if (s.includes('airbnb')) return { t: 'A', color: '#ff385c', name: 'Airbnb' }
  if (s.includes('walk')) return { t: 'W', color: '#1c9a66', name: 'Walk-in' }
  if (s.includes('website') || s.includes('direct') || s.includes('engine') || s.includes('soiree') || s.includes('soirée')) return { t: '@', color: '#7a54d6', name: 'Website' }
  return { t: '·', color: '#6b7a99', name: src?.trim() || 'Other' }
}

function Card({ title, sub, onRefresh, children, className = '' }: { title: string; sub?: string; onRefresh?: () => void; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border ${LINE} p-4 ${className}`} style={{ background: CARD_BG }}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold uppercase tracking-[.12em] text-[#cfdcff]">{title}</h2>
          {sub && <p className="mt-0.5 text-[11.5px] text-[#9fb3dc]">{sub}</p>}
        </div>
        {onRefresh && (
          <button onClick={onRefresh} title="Refresh" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#8fb4ff]/25 bg-white/[0.06] text-[12px] text-[#cfdcff] hover:bg-white/[0.12]">↻</button>
        )}
      </div>
      {children}
    </section>
  )
}

function Segmented({ items, value, onChange }: { items: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className={`inline-flex max-w-full overflow-x-auto rounded-full border ${LINE} bg-white/[0.06] p-[3px]`}>
      {items.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`h-7 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[12px] font-semibold transition ${value === t.key ? 'bg-white/90 text-[#14264f] shadow' : 'text-[#cfdcff] hover:text-white'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

function StatusPill({ label, status }: { label: string; status: string }) {
  const k = status.toLowerCase()
  const c =
    k === 'checked_in' || k === 'in_house' ? GREEN
    : k === 'checked_out' ? GREY
    : k === 'not_confirmed' ? AMBER
    : k === 'canceled' || k === 'cancelled' ? '#ff6b75'
    : BLUE
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize" style={{ borderColor: `${c}66`, background: `${c}22`, color: c }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />{label}
    </span>
  )
}

function SrcChip({ src }: { src?: string }) {
  const b = sourceBadge(src)
  return <span title={b.name} className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] px-1 text-[10px] font-bold text-white" style={{ background: b.color }}>{b.t}</span>
}

export default function DashviewPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [tab, setTab] = useState('arrivals')
  const [day, setDay] = useState<'today' | 'tomorrow'>('today')
  const [rows, setRows] = useState<DashRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [activity, setActivity] = useState<'sales' | 'cancellations' | 'overbookings'>('sales')
  const [cal, setCal] = useState<CalData | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [guestFilter, setGuestFilter] = useState('')

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await cbApi<Summary>('/api/cloudbeds/dashview'))
      setSummaryError(null)
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : 'Could not load Cloudbeds')
    }
  }, [])

  const loadList = useCallback(async () => {
    setRows(null)
    try {
      setRows((await cbApi<{ rows: DashRow[] }>(`/api/cloudbeds/list?tab=${tab}&day=${day}`)).rows)
      setListError(null)
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Could not load reservations')
      setRows([])
    }
  }, [tab, day])

  const loadCal = useCallback(async (today: string) => {
    try {
      setCal(await cbApi<CalData>(`/api/cloudbeds/calendar?days=30&start=${today}`))
    } catch {
      setCal((c) => c ?? { days: [], roomTypes: [], bookings: [], unassigned: [], blocks: [], overbookings: [] })
    }
  }, [])

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadList() }, [loadList])
  useEffect(() => { if (summary?.today && !cal) loadCal(summary.today) }, [summary?.today, cal, loadCal])
  useEffect(() => {
    const t = setInterval(() => { loadSummary(); loadList(); if (summary?.today) loadCal(summary.today) }, 60000)
    return () => clearInterval(t)
  }, [loadSummary, loadList, loadCal, summary?.today])

  const refreshAll = () => { loadSummary(); loadList(); if (summary?.today) loadCal(summary.today) }

  const todayLabel = summary
    ? new Date(`${summary.today}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : ''
  const act = summary ? (activity === 'cancellations' ? summary.cancellations : summary.sales) : null
  const shownRows = rows?.filter((r) => !guestFilter.trim() || r.guestName.toLowerCase().includes(guestFilter.trim().toLowerCase())) ?? null

  // ---- Extra insights, all derived from the 30-day calendar feed ----
  const ins = useMemo(() => {
    if (!cal || !summary || cal.days.length === 0) return null
    const today = summary.today
    const totalRooms = cal.roomTypes.reduce((s, t) => s + t.rooms.length, 0)
    const live = cal.bookings.filter((b) => !['canceled', 'cancelled', 'no_show'].includes(b.status.toLowerCase()))
    const blockedOn = (d: string) => cal.blocks.filter((b) => b.start <= d && d < b.end).length
    const next14 = cal.days.filter((d) => d >= today).slice(0, 14).map((d) => {
      const occ = live.filter((b) => b.start <= d && d < b.end).length
      const blocked = blockedOn(d)
      return { d, occ, blocked, pct: totalRooms ? Math.round((occ / totalRooms) * 100) : 0 }
    })
    const freeTonight = Math.max(0, totalRooms - (next14[0]?.occ ?? 0) - (next14[0]?.blocked ?? 0))
    const upcoming = live
      .filter((b) => b.start > today && b.start <= cal.days[Math.min(cal.days.length - 1, 14)])
      .sort((a, b) => a.start.localeCompare(b.start))
    const dueList = live.filter((b) => b.due && b.end >= today)
    const unconfirmed = live.filter((b) => b.status.toLowerCase() === 'not_confirmed' && b.end >= today)
    const sources = new Map<string, { n: number; src: string }>()
    for (const b of live.filter((x) => x.end > today)) {
      const k = sourceBadge(b.src).name
      sources.set(k, { n: (sources.get(k)?.n ?? 0) + 1, src: b.src ?? '' })
    }
    const srcList = [...sources.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.n - a.n)
    const srcTotal = srcList.reduce((s, x) => s + x.n, 0)
    const rates = cal.roomTypes.flatMap((t) => Object.entries(t.rates).filter(([d, r]) => d >= today && r > 0).map(([, r]) => r))
    const avgRate = rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : null
    const nights = live.reduce((s, b) => {
      const a = b.start < today ? today : b.start
      return s + Math.max(0, dayDiff(a, b.end))
    }, 0)
    return { totalRooms, next14, freeTonight, upcoming, dueList, unconfirmed, srcList, srcTotal, avgRate, nights, blockCount: cal.blocks.filter((b) => b.end >= today).length }
  }, [cal, summary])

  const thc = 'px-3 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[.12em] text-[#9fb3dc]'
  const tdc = 'px-3 py-2 text-[12.5px] text-[#eaf0fb]'
  const tableWrap = `overflow-x-auto rounded-xl border ${LINE} bg-[#0f1c42]/40`

  const stats = [
    { n: summary?.arrivals, label: 'Arrivals', color: GREEN },
    { n: summary?.departures, label: 'Departures', color: AMBER },
    { n: summary?.stayovers, label: 'Stay overs', color: '#a58cff' },
    { n: summary?.roomsOccupied, label: 'Accommodations booked', color: BLUE, pct: summary?.percentageOccupied },
    { n: ins?.freeTonight, label: 'Free tonight', color: '#7fd6ff' },
    { n: ins ? ins.dueList.length : undefined, label: 'Payments due', color: '#ff6b75' },
  ]

  return (
    <div className="p-2 md:p-3">
      <div className="min-h-[calc(100vh-1.5rem)] min-w-0 rounded-2xl p-3 text-[#eaf0fb] antialiased" style={{ background: HOLO_BG }}>
        {/* Header — same wordmark box as the calendar and the side panel */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="flex h-10 shrink-0 items-center justify-center" style={{ width: 149 }}>
            <Link href="/cloudbeds" className="font-display text-[40px] font-semibold italic leading-none tracking-tight text-white">Soirée</Link>
          </div>
          <div className="h-9 w-px bg-[#8fb4ff]/25" />
          <div className="mr-2 min-w-0">
            <h1 className="text-[20px] font-semibold leading-tight tracking-tight text-white">Dashboard</h1>
            <p className="text-[11.5px] text-[#9fb3dc]">{todayLabel || 'Today'} • Updates automatically</p>
          </div>
          <div className="flex-1" />
          <Link href="/cloudbeds/calendar" className={`flex h-8 items-center gap-2 rounded-full border ${LINE} bg-white/[0.06] px-3.5 text-[12.5px] font-semibold text-[#eaf0fb] hover:bg-white/[0.12]`}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
            Calendar
          </Link>
          <button onClick={refreshAll} title="Refresh (also updates automatically)" className={`h-8 w-8 rounded-full border ${LINE} bg-white/[0.06] text-[13px] text-[#eaf0fb] hover:bg-white/[0.12]`}>↻</button>
          {summary && (
            <button onClick={() => setCreating(true)} className={`${priGreen} !h-8 !rounded-full !px-4 !text-[12.5px]`}>+ New reservation</button>
          )}
        </div>

        {summaryError && <p className="mb-3 rounded-xl border border-[#ff6b75]/40 bg-[#ff6b75]/15 px-4 py-2 text-sm text-[#ffd0d4]">{summaryError}</p>}

        {/* Top tiles */}
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {stats.map((c) => (
            <div key={c.label} className={`flex items-center justify-between gap-2 rounded-2xl border ${LINE} px-4 py-3`} style={{ background: CARD_BG }}>
              <div className="min-w-0">
                <p className="text-[28px] font-semibold leading-none tracking-tight" style={{ color: c.color }}>{c.n ?? '—'}</p>
                <p className="mt-1.5 truncate text-[11.5px] font-medium text-[#b9c9ee]">{c.label}</p>
              </div>
              {c.pct !== undefined && (
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-[11.5px] font-bold" style={{ borderColor: c.color, color: c.color }}>{Math.round(c.pct)}%</span>
              )}
            </div>
          ))}
        </div>

        {/* Reservations + activity */}
        <div className="mb-3 grid gap-3 xl:grid-cols-2">
          <Card title="Reservations" onRefresh={loadList}>
            <Segmented items={TABS} value={tab} onChange={setTab} />
            <div className="mb-3 mt-3 flex flex-wrap items-center gap-3">
              <Segmented items={[{ key: 'today', label: 'Today' }, { key: 'tomorrow', label: 'Tomorrow' }]} value={day} onChange={(k) => setDay(k as 'today' | 'tomorrow')} />
              <label className={`flex h-8 w-full max-w-[220px] items-center gap-2 rounded-full border ${LINE} bg-white/[0.06] px-3`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9fb3dc" strokeWidth="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input value={guestFilter} onChange={(e) => setGuestFilter(e.target.value)} placeholder="Guest name"
                  className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[#eaf0fb] outline-none placeholder:text-[#8ea3cf]" />
              </label>
            </div>
            <div className={tableWrap}>
              <table className="w-full">
                <thead className={`border-b ${LINE}`}>
                  <tr><th className={thc}>Guest</th><th className={thc}>Conf #</th><th className={thc}>Room</th><th className={thc}>Arrival</th><th className={thc}>Status</th></tr>
                </thead>
                <tbody className="divide-y divide-[#8fb4ff]/10">
                  {shownRows === null && <tr><td colSpan={5} className="py-6 text-center text-[12.5px] text-[#9fb3dc]">Loading…</td></tr>}
                  {shownRows?.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-[12.5px] text-[#9fb3dc]">{listError ?? 'None available'}</td></tr>}
                  {shownRows?.map((r) => (
                    <tr key={r.reservationID} onClick={() => setOpen(r.reservationID)} className="cursor-pointer hover:bg-white/[0.06]">
                      <td className={`${tdc} min-w-[130px] font-semibold`}>{r.guestName}</td>
                      <td className={`${tdc} text-[#9fb3dc]`}>{r.reservationID}</td>
                      <td className={tdc}>{r.room}</td>
                      <td className={tdc}>{r.arrivalTime ?? '—'}</td>
                      <td className={tdc}>
                        <StatusPill status={r.status} label={tab === 'arrivals' && ['confirmed', 'not_confirmed'].includes(r.status) ? 'Arrival' : statusLabel(r.status)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Today's activity" onRefresh={refreshAll}>
            <Segmented
              items={[{ key: 'sales', label: 'Sales' }, { key: 'cancellations', label: 'Cancellations' }, { key: 'overbookings', label: 'Overbookings' }]}
              value={activity}
              onChange={(k) => setActivity(k as typeof activity)}
            />
            {activity !== 'overbookings' ? (
              <>
                <div className="my-3 grid grid-cols-3 gap-3">
                  {[
                    { v: act?.count ?? '—', l: activity === 'sales' ? 'Booked today' : 'Cancelled today' },
                    { v: act?.roomNights ?? '—', l: 'Room nights' },
                    { v: act ? mxn(act.revenue) : '—', l: 'Revenue' },
                  ].map((x) => (
                    <div key={x.l} className={`rounded-xl border ${LINE} bg-[#0f1c42]/40 px-3.5 py-2.5`}>
                      <p className="text-[20px] font-semibold leading-none tracking-tight text-white">{x.v}</p>
                      <p className="mt-1.5 text-[11.5px] font-medium text-[#9fb3dc]">{x.l}</p>
                    </div>
                  ))}
                </div>
                <div className={tableWrap}>
                  <table className="w-full">
                    <thead className={`border-b ${LINE}`}><tr><th className={thc}>Guest</th><th className={thc}>Revenue</th><th className={thc}>Check-in</th><th className={thc}>Nights</th></tr></thead>
                    <tbody className="divide-y divide-[#8fb4ff]/10">
                      {act?.rows.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-[12.5px] text-[#9fb3dc]">None available</td></tr>}
                      {act?.rows.map((r) => (
                        <tr key={r.reservationID} onClick={() => setOpen(r.reservationID)} className="cursor-pointer hover:bg-white/[0.06]">
                          <td className={`${tdc} min-w-[110px] font-semibold`}>{r.guestName}</td>
                          <td className={tdc}>{mxn(r.revenue)}</td>
                          <td className={tdc}>{r.checkIn}</td>
                          <td className={tdc}>{r.nights}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="mt-3 text-[12.5px]">
                {cal === null && <p className="py-6 text-center text-[#9fb3dc]">Checking the next 30 days…</p>}
                {cal && cal.overbookings.length === 0 && <p className="py-6 text-center text-[#9fb3dc]">None available</p>}
                {cal?.overbookings.map((o, i) => (
                  <p key={i} className="border-b border-[#8fb4ff]/10 py-2">
                    Two stays share room {o.roomID}:{' '}
                    {o.reservationIDs.map((id) => (
                      <button key={id} onClick={() => setOpen(id)} className="mr-2 font-semibold text-[#8fb4ff] hover:underline">#{id}</button>
                    ))}
                  </p>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Insights */}
        <div className="mb-3 grid gap-3 xl:grid-cols-3">
          <Card title="Next 14 nights" sub={ins ? `${ins.totalRooms} rooms • avg rate ${ins.avgRate ? mxn(ins.avgRate) : '—'} / night` : undefined}>
            {!ins ? <p className="py-6 text-center text-[12.5px] text-[#9fb3dc]">Loading…</p> : (
              <div className="flex h-[150px] items-end gap-1.5">
                {ins.next14.map((x, i) => (
                  <div key={x.d} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${mdDay(x.d)}: ${x.occ}/${ins.totalRooms} rooms (${x.pct}%)${x.blocked ? `, ${x.blocked} blocked` : ''}`}>
                    <span className="text-[10px] font-semibold text-[#cfdcff]">{x.pct}%</span>
                    <div className="flex w-full flex-1 items-end overflow-hidden rounded-md bg-white/[0.06]">
                      <div className="w-full rounded-md" style={{ height: `${Math.max(x.pct, 3)}%`, background: i === 0 ? `linear-gradient(180deg,#7fb0ff,${BLUE})` : `linear-gradient(180deg,${BLUE},#3b6fd0)` }} />
                    </div>
                    <span className="text-[9.5px] leading-none text-[#9fb3dc]">{shortDay(x.d).replace(' ', ' ')}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Coming up" sub="Arrivals in the next two weeks">
            {!ins ? <p className="py-6 text-center text-[12.5px] text-[#9fb3dc]">Loading…</p> : ins.upcoming.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-[#9fb3dc]">None available</p>
            ) : (
              <ul className="max-h-[170px] divide-y divide-[#8fb4ff]/10 overflow-y-auto pr-1">
                {ins.upcoming.slice(0, 12).map((b) => (
                  <li key={b.reservationID}>
                    <button onClick={() => setOpen(b.reservationID)} className="flex w-full items-center gap-2 py-1.5 text-left hover:bg-white/[0.05]">
                      <span className="w-[52px] shrink-0 text-[11.5px] font-semibold text-[#8fb4ff]">{mdDay(b.start)}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{b.guestName}</span>
                      <span className="shrink-0 text-[11px] text-[#9fb3dc]">{dayDiff(b.start, b.end)}n</span>
                      {b.due && <span className="h-2 w-2 shrink-0 rounded-full bg-[#ff4d5a] ring-1 ring-white/70" title="Payment due" />}
                      <SrcChip src={b.src} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Needs attention">
            {!ins ? <p className="py-6 text-center text-[12.5px] text-[#9fb3dc]">Loading…</p> : (
              <ul className="space-y-1.5 text-[12.5px]">
                {[
                  { n: ins.dueList.length, l: 'with a balance due', c: '#ff6b75', ids: ins.dueList.map((b) => b.reservationID) },
                  { n: ins.unconfirmed.length, l: 'not confirmed yet', c: AMBER, ids: ins.unconfirmed.map((b) => b.reservationID) },
                  { n: cal?.unassigned.length ?? 0, l: 'without a room assigned', c: '#a58cff', ids: (cal?.unassigned ?? []).map((u) => u.reservationID) },
                  { n: cal?.overbookings.length ?? 0, l: 'overbooked rooms', c: '#ff6b75', ids: (cal?.overbookings ?? []).flatMap((o) => o.reservationIDs) },
                  { n: ins.blockCount, l: 'blocked date ranges', c: GREY, ids: [] as string[] },
                ].map((x) => (
                  <li key={x.l}>
                    <button disabled={!x.ids.length} onClick={() => x.ids[0] && setOpen(x.ids[0])} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left enabled:hover:bg-white/[0.06]">
                      <span className="flex h-6 min-w-[28px] items-center justify-center rounded-full px-2 text-[12px] font-bold" style={{ background: x.n ? `${x.c}33` : 'rgba(255,255,255,.06)', color: x.n ? x.c : '#7f93bf' }}>{x.n}</span>
                      <span className={x.n ? 'text-[#eaf0fb]' : 'text-[#7f93bf]'}>{x.l}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="mb-3 grid gap-3 xl:grid-cols-3">
          <Card title="Where bookings come from" sub="Active and upcoming stays, next 30 days" className="xl:col-span-2">
            {!ins ? <p className="py-6 text-center text-[12.5px] text-[#9fb3dc]">Loading…</p> : ins.srcList.length === 0 ? (
              <p className="py-6 text-center text-[12.5px] text-[#9fb3dc]">None available</p>
            ) : (
              <ul className="space-y-2">
                {ins.srcList.map((s) => (
                  <li key={s.name} className="flex items-center gap-3">
                    <SrcChip src={s.src} />
                    <span className="w-[110px] shrink-0 truncate text-[12.5px]">{s.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                      <div className="h-full rounded-full" style={{ width: `${Math.round((s.n / ins.srcTotal) * 100)}%`, background: sourceBadge(s.src).color }} />
                    </div>
                    <span className="w-[74px] shrink-0 text-right text-[12px] text-[#cfdcff]">{s.n} · {Math.round((s.n / ins.srcTotal) * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Next 30 days">
            {!ins ? <p className="py-6 text-center text-[12.5px] text-[#9fb3dc]">Loading…</p> : (
              <div className="grid grid-cols-2 gap-3">
                {[
                  { v: ins.nights, l: 'Room nights booked' },
                  { v: ins.upcoming.length, l: 'Arrivals in 14 days' },
                ].map((x) => (
                  <div key={x.l} className={`rounded-xl border ${LINE} bg-[#0f1c42]/40 px-3.5 py-2.5`}>
                    <p className="text-[20px] font-semibold leading-none text-white">{x.v}</p>
                    <p className="mt-1.5 text-[11.5px] font-medium text-[#9fb3dc]">{x.l}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="flex justify-center pb-1">
          <SearchBar onOpen={setOpen} dark />
        </div>
      </div>

      {creating && summary && (
        <NewReservationModal
          today={summary.today}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); setOpen(id); loadList(); loadSummary() }}
        />
      )}

      {open && summary && (
        <ReservationModal id={open} today={summary.today} onClose={() => setOpen(null)} onChanged={() => { loadList(); loadSummary() }} />
      )}
    </div>
  )
}
