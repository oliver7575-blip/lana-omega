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
    <section className="min-w-0 rounded-lg border-t-[5px] border-[#3d62e8] bg-white px-4 py-5 shadow-[0_1px_3px_rgba(15,23,42,0.10)] sm:px-7 sm:py-6">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-[19px] font-semibold text-[#14213d] sm:text-[22px]">{title}</h2>
        <button onClick={onRefresh} title="Refresh" className="text-[18px] text-[#14213d] hover:text-[#3d62e8]">↻</button>
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
          className={`shrink-0 px-4 py-2.5 text-[14px] text-[#14213d] sm:px-5 sm:py-3 sm:text-[15px] ${value === t.key ? 'bg-[#e4e6ea]' : 'hover:bg-[#e9ebee]'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

const ICONS: Record<string, React.ReactNode> = {
  bell: <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#c5c9cf" strokeWidth="1.6"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>,
  out: <svg width="34" height="34" viewBox="0 0 24 24" fill="#c5c9cf"><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5v-2H6V6h4V4Z" /><path d="M14 7l5 5-5 5v-3H9v-4h5V7Z" /></svg>,
  moon: <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#c5c9cf" strokeWidth="1.6"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" /></svg>,
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
  const thc = 'border-r border-white px-3 py-3 text-left text-[13px] font-semibold uppercase tracking-wide text-[#14213d] last:border-r-0 sm:text-[14px]'
  const tdc = 'px-3 py-3.5 text-[14px] text-[#14213d] sm:text-[15px]'

  return (
    <div className="p-2 md:p-3">
      <div className="min-h-[calc(100vh-1.5rem)] min-w-0 overflow-hidden rounded-2xl bg-[#f2f3f5] px-4 py-6 text-[#14213d] sm:px-7 sm:py-8">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-[26px] font-semibold tracking-tight sm:text-[32px]">{todayLabel || 'Dashboard'}</h1>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link href="/cloudbeds/calendar" title="Reservation calendar"
              className="flex h-10 w-11 items-center justify-center rounded-md bg-[#e4e6ea] text-[#14213d] shadow-sm hover:bg-[#d9dce1]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
            </Link>
            <button onClick={() => { loadSummary(); loadList(); setOverbookings(null) }} title="Refresh (also updates automatically)"
              className="flex h-10 w-11 items-center justify-center rounded-md bg-[#e4e6ea] text-[18px] text-[#14213d] shadow-sm hover:bg-[#d9dce1]">↻</button>
            {summary && (
              <button onClick={() => setCreating(true)}
                className="rounded-full bg-[#5cc3a5] px-5 py-2.5 text-[13px] font-medium uppercase tracking-wide text-white hover:bg-[#4bb294] sm:px-6 sm:text-[15px]">
                Create new reservation
              </button>
            )}
          </div>
        </div>

        {summaryError && <p className="mb-5 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{summaryError}</p>}

        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-7">
          {[
            { n: summary?.arrivals, label: 'Arrivals', color: '#3aa99f', icon: ICONS.bell },
            { n: summary?.departures, label: 'Departures', color: '#e0622d', icon: ICONS.out },
            { n: summary?.stayovers, label: 'Stay overs', color: '#7a5af8', icon: ICONS.moon },
            { n: summary?.roomsOccupied, label: 'Accommodations booked', color: '#3d62e8', pct: summary?.percentageOccupied },
          ].map((c) => (
            <div key={c.label} className="relative min-h-[118px] rounded-lg bg-white px-6 py-5 shadow-[0_1px_3px_rgba(15,23,42,0.10)]">
              <p className="text-[32px] leading-none" style={{ color: c.color }}>{c.n ?? '—'}</p>
              <p className="mt-6 text-[17px] font-semibold uppercase tracking-wide sm:text-[19px]">{c.label}</p>
              {c.pct !== undefined ? (
                <span className="absolute right-5 top-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#eef0f2] text-[13px] text-[#44506a]">
                  {c.pct.toFixed(2)}%
                </span>
              ) : (
                <span className="absolute right-5 top-5">{c.icon}</span>
              )}
            </div>
          ))}
        </div>

        <div className="mb-7 grid gap-6 xl:grid-cols-2 xl:gap-11">
          <Card title="Reservations" onRefresh={loadList}>
            <Tabs items={TABS} value={tab} onChange={setTab} />
            <div className="mb-4 mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
              <div className="flex">
                {(['today', 'tomorrow'] as const).map((d) => (
                  <button key={d} onClick={() => setDay(d)}
                    className={`border-b-[3px] px-5 py-2.5 text-[16px] font-medium capitalize sm:text-[17px] ${day === d ? 'border-[#3d62e8] text-[#3d62e8]' : 'border-transparent text-[#14213d]'}`}>
                    {d}
                  </button>
                ))}
              </div>
              <label className="flex w-full max-w-[300px] items-center border-b border-gray-400 pb-1.5">
                <input value={guestFilter} onChange={(e) => setGuestFilter(e.target.value)} placeholder="Guest Name"
                  className="min-w-0 flex-1 bg-transparent px-2.5 text-[15px] text-[#14213d] outline-none placeholder:text-gray-400" />
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              </label>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#f1f2f4]">
                  <tr><th className={thc}>Guest</th><th className={thc}>Conf #</th><th className={thc}>Room</th><th className={thc}>Arrival time</th><th className={thc}>Status</th></tr>
                </thead>
                <tbody>
                  <tr aria-hidden="true"><td colSpan={5} className="h-3 p-0" /></tr>
                  {shownRows === null && <tr><td colSpan={5} className="py-8 text-center text-[15px] text-gray-500">Loading…</td></tr>}
                  {shownRows?.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-[15px] text-[#14213d]">{listError ?? 'None available'}</td></tr>}
                  {shownRows?.map((r) => (
                    <tr key={r.reservationID} onClick={() => setOpen(r.reservationID)} className="cursor-pointer hover:bg-[#f7f8fa]">
                      <td className={`${tdc} min-w-[170px]`}>
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
                <div className="my-6 grid grid-cols-3 gap-4 px-3">
                  <div><p className="text-[30px] leading-none text-[#3d62e8] sm:text-[34px]">{act?.count ?? '—'}</p><p className="mt-4 text-[13px] font-semibold uppercase sm:text-[15px]">{activity === 'sales' ? 'Booked today' : 'Cancelled today'}</p></div>
                  <div><p className="text-[30px] leading-none text-[#3d62e8] sm:text-[34px]">{act?.roomNights ?? '—'}</p><p className="mt-4 text-[13px] font-semibold uppercase sm:text-[15px]">Room nights</p></div>
                  <div><p className="text-[30px] leading-none text-[#3d62e8] sm:text-[34px]">{act ? mxn(act.revenue) : '—'}</p><p className="mt-4 text-[13px] font-semibold uppercase sm:text-[15px]">Revenue</p></div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-[#f1f2f4]"><tr><th className={thc}>Guest</th><th className={thc}>Revenue</th><th className={thc}>Check-in</th><th className={thc}>Nights</th></tr></thead>
                    <tbody>
                      <tr aria-hidden="true"><td colSpan={4} className="h-3 p-0" /></tr>
                      {act?.rows.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-[15px] text-[#14213d]">None available</td></tr>}
                      {act?.rows.map((r) => (
                        <tr key={r.reservationID} onClick={() => setOpen(r.reservationID)} className="cursor-pointer hover:bg-[#f7f8fa]">
                          <td className={`${tdc} min-w-[160px] text-[#3d62e8]`}>{r.guestName}</td>
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
              <div className="mt-5 text-[15px]">
                {overbookings === null && <p className="py-8 text-center text-gray-500">Checking the next 30 days…</p>}
                {overbookings?.length === 0 && <p className="py-8 text-center">None available</p>}
                {overbookings?.map((o, i) => (
                  <p key={i} className="border-b border-gray-100 py-3">
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

        <div className="flex justify-center pb-4">
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
