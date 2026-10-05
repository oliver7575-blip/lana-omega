'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import ReservationModal from '@/components/cloudbeds/ReservationModal'
import SearchBar from '@/components/cloudbeds/SearchBar'
import NewReservationModal from '@/components/cloudbeds/NewReservationModal'
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

const TABS = [
  { key: 'arrivals', label: 'Arrivals' },
  { key: 'departures', label: 'Departures' },
  { key: 'stayovers', label: 'Stayovers' },
  { key: 'inhouse', label: 'In-House Guests' },
]

function Card({ title, onRefresh, children }: { title: string; onRefresh: () => void; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-lg border-t-[4px] border-[#3d62e8] bg-white px-3 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.10)] sm:px-4 sm:py-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-[#14213d]">{title}</h2>
        <button onClick={onRefresh} title="Refresh" className="text-[15px] text-[#14213d] hover:text-[#3d62e8]">↻</button>
      </div>
      {children}
    </section>
  )
}

function Tabs({ items, value, onChange }: { items: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="flex overflow-x-auto bg-[#f1f2f4]">
      {items.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`shrink-0 px-3 py-1.5 text-[12px] text-[#14213d] sm:px-4 ${value === t.key ? 'bg-[#e4e6ea]' : 'hover:bg-[#e9ebee]'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

const ICONS: Record<string, React.ReactNode> = {
  bell: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c5c9cf" strokeWidth="1.6"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>,
  out: <svg width="22" height="22" viewBox="0 0 24 24" fill="#c5c9cf"><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5v-2H6V6h4V4Z" /><path d="M14 7l5 5-5 5v-3H9v-4h5V7Z" /></svg>,
  moon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#c5c9cf" strokeWidth="1.6"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>,
}

export default function DashviewPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [tab, setTab] = useState('arrivals')
  const [day, setDay] = useState<'today' | 'tomorrow'>('today')
  const [rows, setRows] = useState<DashRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [activity, setActivity] = useState<'sales' | 'cancellations' | 'overbookings'>('sales')
  const [overbookings, setOverbookings] = useState<{ roomID: string; reservationIDs: string[] }[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

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

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => { loadList() }, [loadList])
  useEffect(() => {
    const t = setInterval(() => { loadSummary(); loadList() }, 60000)
    return () => clearInterval(t)
  }, [loadSummary, loadList])
  useEffect(() => {
    if (activity !== 'overbookings' || overbookings) return
    cbApi<{ overbookings: { roomID: string; reservationIDs: string[] }[] }>(`/api/cloudbeds/calendar?days=30&start=${summary?.today ?? ''}`)
      .then((j) => setOverbookings(j.overbookings))
      .catch(() => setOverbookings([]))
  }, [activity, overbookings, summary?.today])

  const todayLabel = summary
    ? new Date(`${summary.today}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : ''
  const act = summary ? (activity === 'cancellations' ? summary.cancellations : summary.sales) : null

  const [guestFilter, setGuestFilter] = useState('')
  const shownRows = rows?.filter((r) => !guestFilter.trim() || r.guestName.toLowerCase().includes(guestFilter.trim().toLowerCase())) ?? null
  const thc = 'border-r border-white px-2.5 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[#14213d] last:border-r-0'
  const tdc = 'px-2.5 py-1.5 text-[13px] text-[#14213d]'

  return (
    <div className="p-2 md:p-3">
      <div className="min-h-[calc(100vh-1.5rem)] min-w-0 overflow-hidden rounded-2xl bg-[#f2f3f5] px-3 py-4 text-[#14213d] sm:px-5 sm:py-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-[20px] font-semibold tracking-tight sm:text-[22px]">{todayLabel || 'Dashboard'}</h1>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link href="/cloudbeds/calendar" title="Reservation calendar"
              className="flex h-8 w-9 items-center justify-center rounded-md bg-[#e4e6ea] text-[#14213d] shadow-sm hover:bg-[#d9dce1]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
            </Link>
            <button onClick={() => { loadSummary(); loadList(); setOverbookings(null) }} title="Refresh (also updates automatically)"
              className="flex h-8 w-9 items-center justify-center rounded-md bg-[#e4e6ea] text-[15px] text-[#14213d] shadow-sm hover:bg-[#d9dce1]">↻</button>
            {summary && (
              <button onClick={() => setCreating(true)}
                className="rounded-full bg-[#5cc3a5] px-4 py-1.5 text-[12px] font-medium uppercase tracking-wide text-white hover:bg-[#4bb294]">
                Create new reservation
              </button>
            )}
          </div>
        </div>

        {summaryError && <p className="mb-5 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{summaryError}</p>}

        <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:gap-4">
          {[
            { n: summary?.arrivals, label: 'Arrivals', color: '#3aa99f', icon: ICONS.bell },
            { n: summary?.departures, label: 'Departures', color: '#e0622d', icon: ICONS.out },
            { n: summary?.stayovers, label: 'Stay overs', color: '#7a5af8', icon: ICONS.moon },
            { n: summary?.roomsOccupied, label: 'Accommodations booked', color: '#3d62e8', pct: summary?.percentageOccupied },
          ].map((c) => (
            <div key={c.label} className="relative min-h-[76px] rounded-lg bg-white px-4 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.10)]">
              <p className="text-[22px] leading-none" style={{ color: c.color }}>{c.n ?? '—'}</p>
              <p className="mt-3 text-[12px] font-semibold uppercase tracking-wide">{c.label}</p>
              {c.pct !== undefined ? (
                <span className="absolute right-4 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#eef0f2] text-[11px] text-[#44506a]">
                  {c.pct.toFixed(2)}%
                </span>
              ) : (
                <span className="absolute right-4 top-3">{c.icon}</span>
              )}
            </div>
          ))}
        </div>

        <div className="mb-4 grid gap-4 xl:grid-cols-2 xl:gap-5">
          <Card title="Reservations" onRefresh={loadList}>
            <Tabs items={TABS} value={tab} onChange={setTab} />
            <div className="mb-2 mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
              <div className="flex">
                {(['today', 'tomorrow'] as const).map((d) => (
                  <button key={d} onClick={() => setDay(d)}
                    className={`border-b-[2px] px-3 py-1.5 text-[13px] font-medium capitalize ${day === d ? 'border-[#3d62e8] text-[#3d62e8]' : 'border-transparent text-[#14213d]'}`}>
                    {d}
                  </button>
                ))}
              </div>
              <label className="flex w-full max-w-[240px] items-center border-b border-gray-400 pb-1">
                <input value={guestFilter} onChange={(e) => setGuestFilter(e.target.value)} placeholder="Guest Name"
                  className="min-w-0 flex-1 bg-transparent px-2 text-[13px] text-[#14213d] outline-none placeholder:text-gray-400" />
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#f1f2f4]">
                  <tr><th className={thc}>Guest</th><th className={thc}>Conf #</th><th className={thc}>Room</th><th className={thc}>Arrival time</th><th className={thc}>Status</th></tr>
                </thead>
                <tbody>
                  <tr aria-hidden="true"><td colSpan={5} className="h-1.5 p-0" /></tr>
                  {shownRows === null && <tr><td colSpan={5} className="py-5 text-center text-[13px] text-gray-500">Loading…</td></tr>}
                  {shownRows?.length === 0 && <tr><td colSpan={5} className="py-5 text-center text-[13px] text-[#14213d]">{listError ?? 'None available'}</td></tr>}
                  {shownRows?.map((r) => (
                    <tr key={r.reservationID} onClick={() => setOpen(r.reservationID)} className="cursor-pointer hover:bg-[#f7f8fa]">
                      <td className={`${tdc} min-w-[150px]`}>
                        <span className="inline-flex items-center gap-2 text-[#3d62e8] hover:underline">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#14213d" strokeWidth="2"><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="M14 6l4 4" /></svg>
                          {r.guestName}
                        </span>
                      </td>
                      <td className={tdc}>{r.reservationID}</td>
                      <td className={tdc}>{r.room}</td>
                      <td className={tdc}>{r.arrivalTime ?? '—'}</td>
                      <td className={`${tdc} capitalize text-[#3d62e8]`}>
                        {tab === 'arrivals' && ['confirmed', 'not_confirmed'].includes(r.status) ? 'Arrival' : statusLabel(r.status)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Today's Activity" onRefresh={() => { loadSummary(); setOverbookings(null) }}>
            <Tabs
              items={[{ key: 'sales', label: 'Sales' }, { key: 'cancellations', label: 'Cancellations' }, { key: 'overbookings', label: 'Overbookings' }]}
              value={activity}
              onChange={(k) => setActivity(k as typeof activity)}
            />
            {activity !== 'overbookings' ? (
              <>
                <div className="my-3 grid grid-cols-3 gap-3 px-2">
                  <div><p className="text-[30px] leading-none text-[#3d62e8] sm:text-[34px]">{act?.count ?? '—'}</p><p className="mt-2 text-[12px] font-semibold uppercase">{activity === 'sales' ? 'Booked today' : 'Cancelled today'}</p></div>
                  <div><p className="text-[30px] leading-none text-[#3d62e8] sm:text-[34px]">{act?.roomNights ?? '—'}</p><p className="mt-2 text-[12px] font-semibold uppercase">Room nights</p></div>
                  <div><p className="text-[30px] leading-none text-[#3d62e8] sm:text-[34px]">{act ? mxn(act.revenue) : '—'}</p><p className="mt-2 text-[12px] font-semibold uppercase">Revenue</p></div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-[#f1f2f4]"><tr><th className={thc}>Guest</th><th className={thc}>Revenue</th><th className={thc}>Check-in</th><th className={thc}>Nights</th></tr></thead>
                    <tbody>
                      <tr aria-hidden="true"><td colSpan={4} className="h-1.5 p-0" /></tr>
                      {act?.rows.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-[13px] text-[#14213d]">None available</td></tr>}
                      {act?.rows.map((r) => (
                        <tr key={r.reservationID} onClick={() => setOpen(r.reservationID)} className="cursor-pointer hover:bg-[#f7f8fa]">
                          <td className={`${tdc} min-w-[140px] text-[#3d62e8]`}>{r.guestName}</td>
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
              <div className="mt-3 text-[13px]">
                {overbookings === null && <p className="py-5 text-center text-gray-500">Checking the next 30 days…</p>}
                {overbookings?.length === 0 && <p className="py-5 text-center">None available</p>}
                {overbookings?.map((o, i) => (
                  <p key={i} className="border-b border-gray-100 py-1.5">
                    Two stays share room {o.roomID}:{' '}
                    {o.reservationIDs.map((id) => (
                      <button key={id} onClick={() => setOpen(id)} className="mr-2 text-[#3d62e8] hover:underline">#{id}</button>
                    ))}
                  </p>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="flex justify-center pb-2">
          <SearchBar onOpen={setOpen} />
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
