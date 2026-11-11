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
    <section className="min-w-0 rounded-2xl border border-gray-200 bg-white p-5 shadow-[0_1px_2px_rgba(20,33,61,.04)]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-bold tracking-tight text-[#14213d]">{title}</h2>
        <button onClick={onRefresh} title="Refresh" className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 text-[13px] text-gray-600 hover:bg-gray-50">↻</button>
      </div>
      {children}
    </section>
  )
}

/** Soft segmented switch, the same one the calendar's windows use. */
function Segmented({ items, value, onChange }: { items: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-[10px] bg-[#e9ecf1] p-[3px]">
      {items.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`h-[30px] shrink-0 whitespace-nowrap rounded-lg px-3.5 text-[12.5px] font-semibold ${value === t.key ? 'bg-white text-[#14213d] shadow-[0_1px_2px_rgba(20,33,61,.12)]' : 'text-gray-600 hover:text-[#14213d]'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

function StatusPill({ label, status }: { label: string; status: string }) {
  const k = status.toLowerCase()
  const c =
    k === 'checked_in' || k === 'in_house' ? { bg: '#cdeee1', border: '#8fd3b8', text: '#0e4d38' }
    : k === 'checked_out' ? { bg: '#e6e9ef', border: '#c5cad4', text: '#4a5262' }
    : k === 'not_confirmed' ? { bg: '#fdeccb', border: '#f0c978', text: '#7a4a05' }
    : k === 'canceled' || k === 'cancelled' ? { bg: '#fde0e0', border: '#f0a9a9', text: '#7a1b1b' }
    : { bg: '#d6e4fb', border: '#9bbbf0', text: '#17356b' }
  return <span className="inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold capitalize" style={{ background: c.bg, borderColor: c.border, color: c.text }}>{label}</span>
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
  const thc = 'px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500'
  const tdc = 'px-3 py-2.5 text-[13px] text-[#14213d]'

  const stats = [
    { n: summary?.arrivals, label: 'Arrivals', color: '#1f9d78', tint: '#eefaf5' },
    { n: summary?.departures, label: 'Departures', color: '#c9631f', tint: '#fff4e8' },
    { n: summary?.stayovers, label: 'Stay overs', color: '#6a4fd8', tint: '#f1eefd' },
    { n: summary?.roomsOccupied, label: 'Accommodations booked', color: '#2f66d0', tint: '#eef3fd', pct: summary?.percentageOccupied },
  ]

  return (
    <div className="p-2 md:p-3">
      <div className="min-h-[calc(100vh-1.5rem)] min-w-0 rounded-2xl bg-[#f6f7f9] p-5 text-[#14213d]">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="mr-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Dashboard</p>
            <h1 className="text-[22px] font-bold leading-tight tracking-tight">{todayLabel || 'Today'}</h1>
          </div>
          <div className="flex-1" />
          <Link href="/cloudbeds/calendar" className="flex h-9 items-center gap-2 rounded-[10px] border border-gray-300 bg-white px-3.5 text-[13px] font-semibold hover:bg-gray-50">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
            Calendar
          </Link>
          <button onClick={() => { loadSummary(); loadList(); setOverbookings(null) }} title="Refresh (also updates automatically)"
            className="h-9 w-9 rounded-[10px] border border-gray-300 bg-white text-[14px] hover:bg-gray-50">↻</button>
          {summary && (
            <button onClick={() => setCreating(true)} className="h-9 rounded-[10px] bg-[#1f9d78] px-[18px] text-[13px] font-semibold text-white hover:bg-[#188a69]">
              + Create new reservation
            </button>
          )}
        </div>

        {summaryError && <p className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{summaryError}</p>}

        <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((c) => (
            <div key={c.label} className="flex items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 shadow-[0_1px_2px_rgba(20,33,61,.04)]">
              <div>
                <p className="text-[30px] font-bold leading-none tracking-tight" style={{ color: c.color }}>{c.n ?? '—'}</p>
                <p className="mt-2 text-[12px] font-semibold text-gray-600">{c.label}</p>
              </div>
              {c.pct !== undefined ? (
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[12px] font-bold" style={{ background: c.tint, color: c.color }}>{Math.round(c.pct)}%</span>
              ) : (
                <span className="h-12 w-12 shrink-0 rounded-full" style={{ background: c.tint }} />
              )}
            </div>
          ))}
        </div>

        <div className="mb-5 grid gap-4 xl:grid-cols-2">
          <Card title="Reservations" onRefresh={loadList}>
            <Segmented items={TABS} value={tab} onChange={setTab} />
            <div className="mb-3 mt-3 flex flex-wrap items-center gap-3">
              <Segmented items={[{ key: 'today', label: 'Today' }, { key: 'tomorrow', label: 'Tomorrow' }]} value={day} onChange={(k) => setDay(k as 'today' | 'tomorrow')} />
              <label className="flex h-9 w-full max-w-[220px] items-center gap-2 rounded-[10px] border border-gray-300 bg-white px-3">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input value={guestFilter} onChange={(e) => setGuestFilter(e.target.value)} placeholder="Guest name"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-[#14213d] outline-none placeholder:text-gray-400" />
              </label>
            </div>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full">
                <thead className="border-b border-gray-200 bg-[#fbfbfc]">
                  <tr><th className={thc}>Guest</th><th className={thc}>Conf #</th><th className={thc}>Room</th><th className={thc}>Arrival</th><th className={thc}>Status</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {shownRows === null && <tr><td colSpan={5} className="py-6 text-center text-[13px] text-gray-500">Loading…</td></tr>}
                  {shownRows?.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-[13px] text-gray-500">{listError ?? 'None available'}</td></tr>}
                  {shownRows?.map((r) => (
                    <tr key={r.reservationID} onClick={() => setOpen(r.reservationID)} className="cursor-pointer hover:bg-[#f4f8fb]">
                      <td className={`${tdc} min-w-[130px] font-semibold`}>{r.guestName}</td>
                      <td className={`${tdc} text-gray-600`}>{r.reservationID}</td>
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

          <Card title="Today's activity" onRefresh={() => { loadSummary(); setOverbookings(null) }}>
            <Segmented
              items={[{ key: 'sales', label: 'Sales' }, { key: 'cancellations', label: 'Cancellations' }, { key: 'overbookings', label: 'Overbookings' }]}
              value={activity}
              onChange={(k) => setActivity(k as typeof activity)}
            />
            {activity !== 'overbookings' ? (
              <>
                <div className="my-4 grid grid-cols-3 gap-3">
                  {[
                    { v: act?.count ?? '—', l: activity === 'sales' ? 'Booked today' : 'Cancelled today' },
                    { v: act?.roomNights ?? '—', l: 'Room nights' },
                    { v: act ? mxn(act.revenue) : '—', l: 'Revenue' },
                  ].map((x) => (
                    <div key={x.l} className="rounded-xl bg-[#f6f7f9] px-4 py-3">
                      <p className="text-[22px] font-bold leading-none tracking-tight text-[#2f66d0]">{x.v}</p>
                      <p className="mt-1.5 text-[12px] font-semibold text-gray-600">{x.l}</p>
                    </div>
                  ))}
                </div>
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full">
                    <thead className="border-b border-gray-200 bg-[#fbfbfc]"><tr><th className={thc}>Guest</th><th className={thc}>Revenue</th><th className={thc}>Check-in</th><th className={thc}>Nights</th></tr></thead>
                    <tbody className="divide-y divide-gray-100">
                      {act?.rows.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-[13px] text-gray-500">None available</td></tr>}
                      {act?.rows.map((r) => (
                        <tr key={r.reservationID} onClick={() => setOpen(r.reservationID)} className="cursor-pointer hover:bg-[#f4f8fb]">
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
              <div className="mt-4 text-[13px]">
                {overbookings === null && <p className="py-6 text-center text-gray-500">Checking the next 30 days…</p>}
                {overbookings?.length === 0 && <p className="py-6 text-center text-gray-500">None available</p>}
                {overbookings?.map((o, i) => (
                  <p key={i} className="border-b border-gray-100 py-2">
                    Two stays share room {o.roomID}:{' '}
                    {o.reservationIDs.map((id) => (
                      <button key={id} onClick={() => setOpen(id)} className="mr-2 font-semibold text-[#2f66d0] hover:underline">#{id}</button>
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
