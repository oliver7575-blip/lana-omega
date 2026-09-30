'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import ReservationModal from '@/components/cloudbeds/ReservationModal'
import SearchBar from '@/components/cloudbeds/SearchBar'
import { cbApi, mxn, statusLabel, type DashRow } from '@/components/cloudbeds/shared'

interface ActivityRow { reservationID: string; guestName: string; revenue: number | null; checkIn: string; nights: number }
interface Summary {
  today: string
  links: { newReservation: string }
  arrivals: number
  departures: number
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
    <section className="rounded-xl border-t-[3px] border-[#3b6fe0] bg-white p-3 shadow-[0_1px_4px_rgba(15,23,42,0.08)]">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <button onClick={onRefresh} title="Refresh" className="text-sm text-gray-500 hover:text-[#3b6fe0]">↻</button>
      </div>
      {children}
    </section>
  )
}

function Tabs({ items, value, onChange }: { items: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="flex overflow-x-auto rounded bg-gray-100 text-sm">
      {items.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)}
          className={`shrink-0 px-2.5 py-1 text-[12px] ${value === t.key ? 'bg-white font-semibold shadow-sm' : 'text-gray-700 hover:bg-gray-200/60'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
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
  const th = 'px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide text-[#14213d]'

  return (
    <div className="p-2 md:p-3">
      <div className="min-h-[calc(100vh-1.5rem)] rounded-2xl bg-[#f7f9fb] p-3.5 text-[12.5px] text-[#14213d]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{todayLabel || 'Dashboard'}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/cloudbeds/calendar" title="Reservation calendar" className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-gray-600 hover:text-[#3b6fe0]">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
            </Link>
            <span className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600">
              <span className="h-2 w-2 rounded-full bg-emerald-500" /> Updates automatically
            </span>
            {summary && (
              <a href={summary.links.newReservation} target="_blank" rel="noreferrer"
                className="rounded-md bg-[#5cc3a5] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-[#4bb294]">
                Create new reservation
              </a>
            )}
          </div>
        </div>

        {summaryError && <p className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{summaryError}</p>}

        <div className="mb-3 grid gap-2.5 md:grid-cols-3">
          {[
            { n: summary?.arrivals, label: 'Arrivals', color: '#3aa99f' },
            { n: summary?.departures, label: 'Departures', color: '#e0622d' },
            { n: summary?.roomsOccupied, label: 'Accommodations booked', color: '#3b6fe0', pct: summary?.percentageOccupied },
          ].map((c) => (
            <div key={c.label} className="relative flex items-center gap-3 rounded-xl bg-white px-4 py-1.5 shadow-[0_1px_4px_rgba(15,23,42,0.08)]">
              <p className="text-xl leading-tight" style={{ color: c.color }}>{c.n ?? '—'}</p>
              <p className="text-[10px] font-semibold uppercase">{c.label}</p>
              {c.pct !== undefined && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px]">{c.pct.toFixed(2)}%</span>
              )}
            </div>
          ))}
        </div>

        <div className="mb-4 grid gap-3 xl:grid-cols-2">
          <Card title="Reservations" onRefresh={loadList}>
            <Tabs items={TABS} value={tab} onChange={setTab} />
            <div className="mb-1.5 mt-1 flex gap-3 border-b border-gray-200 text-[12px]">
              {(['today', 'tomorrow'] as const).map((d) => (
                <button key={d} onClick={() => setDay(d)}
                  className={`-mb-px border-b-2 px-3 py-1.5 capitalize ${day === d ? 'border-[#3b6fe0] text-[#3b6fe0]' : 'border-transparent text-gray-700'}`}>
                  {d}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-gray-100">
                  <tr><th className={th}>Guest</th><th className={th}>Conf #</th><th className={th}>Room</th><th className={th}>Arrival time</th><th className={th}>Status</th></tr>
                </thead>
                <tbody className="[&>tr:first-child>td]:pt-2.5">
                  {rows === null && <tr><td colSpan={5} className="py-5 text-center text-gray-500">Loading…</td></tr>}
                  {rows?.length === 0 && <tr><td colSpan={5} className="py-5 text-center text-gray-500">{listError ?? 'No reservations'}</td></tr>}
                  {rows?.map((r) => (
                    <tr key={r.reservationID} onClick={() => setOpen(r.reservationID)} className="cursor-pointer border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-3 py-1.5 font-medium">{r.guestName}</td>
                      <td className="px-3 py-1.5 text-gray-600">{r.reservationID}</td>
                      <td className="px-3 py-1.5">{r.room}</td>
                      <td className="px-3 py-1.5">{r.arrivalTime ?? '—'}</td>
                      <td className="px-3 py-1.5 capitalize">{statusLabel(r.status)}</td>
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
                <div className="my-2 grid grid-cols-3 gap-3 px-2">
                  <div><p className="text-xl text-[#3b6fe0]">{act?.count ?? '—'}</p><p className="text-[10px] font-semibold uppercase">{activity === 'sales' ? 'Booked today' : 'Cancelled today'}</p></div>
                  <div><p className="text-xl text-[#3b6fe0]">{act?.roomNights ?? '—'}</p><p className="text-[10px] font-semibold uppercase">Room nights</p></div>
                  <div><p className="text-xl text-[#3b6fe0]">{act ? mxn(act.revenue) : '—'}</p><p className="text-[10px] font-semibold uppercase">Revenue</p></div>
                </div>
                <table className="w-full text-[12px]">
                  <thead className="bg-gray-100"><tr><th className={th}>Guest</th><th className={th}>Revenue</th><th className={th}>Check-in</th><th className={th}>Nights</th></tr></thead>
                  <tbody className="[&>tr:first-child>td]:pt-2.5">
                    {act?.rows.length === 0 && <tr><td colSpan={4} className="py-5 text-center text-gray-500">Nothing yet today</td></tr>}
                    {act?.rows.map((r) => (
                      <tr key={r.reservationID} onClick={() => setOpen(r.reservationID)} className="cursor-pointer border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-1.5 font-medium">{r.guestName}</td>
                        <td className="px-3 py-1.5">{mxn(r.revenue)}</td>
                        <td className="px-3 py-1.5">{r.checkIn}</td>
                        <td className="px-3 py-1.5">{r.nights}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <div className="mt-4 text-sm">
                {overbookings === null && <p className="py-5 text-center text-gray-500">Checking the next 30 days…</p>}
                {overbookings?.length === 0 && <p className="py-5 text-center text-gray-500">No overbookings in the next 30 days</p>}
                {overbookings?.map((o, i) => (
                  <p key={i} className="border-b border-gray-100 py-2.5">
                    Two stays share room {o.roomID}:{' '}
                    {o.reservationIDs.map((id) => (
                      <button key={id} onClick={() => setOpen(id)} className="mr-2 text-[#3b6fe0] hover:underline">#{id}</button>
                    ))}
                  </p>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="flex justify-center">
          <SearchBar onOpen={setOpen} />
        </div>
      </div>

      {open && summary && (
        <ReservationModal id={open} today={summary.today} onClose={() => setOpen(null)} onChanged={() => { loadList(); loadSummary() }} />
      )}
    </div>
  )
}
