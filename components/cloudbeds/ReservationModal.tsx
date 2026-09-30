'use client'

import { useEffect, useState } from 'react'
import { cbApi, statusColor, statusLabel } from './shared'

interface Detail {
  reservationID: string
  guestName: string
  status: string
  source: string | null
  startDate: string
  endDate: string
  adults: number
  children: number
  rooms: { roomName: string | null; roomTypeName: string }[]
  total: number | null
  balance: number | null
  estimatedArrivalTime: string | null
}

export default function ReservationModal({ id, today, onClose, onChanged }: {
  id: string
  today: string
  onClose: () => void
  onChanged?: () => void
}) {
  const [r, setR] = useState<Detail | null>(null)
  const [link, setLink] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [time, setTime] = useState('')
  const [checkin, setCheckin] = useState('')
  const [checkout, setCheckout] = useState('')

  function apply(d: Detail) {
    setR(d)
    setTime(d.estimatedArrivalTime ?? '')
    setCheckin(d.startDate)
    setCheckout(d.endDate)
  }

  useEffect(() => {
    cbApi<{ reservation: Detail; link: string }>(`/api/cloudbeds/reservation/${id}`)
      .then((j) => { apply(j.reservation); setLink(j.link) })
      .catch((e) => setError(e.message))
  }, [id])

  async function act(body: Record<string, string>, ok: string) {
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      const j = await cbApi<{ reservation: Detail }>(`/api/cloudbeds/reservation/${id}`, 'POST', body)
      apply(j.reservation)
      setMsg(ok)
      onChanged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cloudbeds error')
    }
    setBusy(false)
  }

  const color = statusColor(r?.status ?? '')
  const canCheckIn = r && ['confirmed', 'not_confirmed'].includes(r.status) && r.startDate <= today
  const label = 'text-sm font-semibold text-[#14213d]'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl overflow-hidden rounded-xl bg-white text-[#14213d] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 text-white" style={{ background: color.head }}>
          <div>
            <p className="text-lg font-semibold">{r ? `${r.guestName} · ${statusLabel(r.status)}` : 'Loading…'}</p>
            <p className="text-sm opacity-90">#{id}{r?.source ? ` · ${r.source}` : ''}</p>
          </div>
          <button onClick={onClose} className="text-2xl leading-none opacity-90 hover:opacity-100" aria-label="Close">×</button>
        </div>

        {error && <p className="mx-6 mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {msg && <p className="mx-6 mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}

        {r && (
          <div className="grid gap-0 sm:grid-cols-[200px_1fr]">
            <div className="space-y-3 border-b border-gray-200 px-6 py-5 text-sm sm:border-b-0 sm:border-r">
              <div><p className={label}>Check-in / Out</p><p>{r.startDate} – {r.endDate}</p></div>
              <div><p className={label}>Guests</p><p>{r.adults + r.children}</p></div>
              <div><p className={label}>Room</p><p>{r.rooms.map((x) => x.roomName ?? `${x.roomTypeName} (unassigned)`).join(', ') || '—'}</p></div>
              <div><p className={label}>Grand Total</p><p>MXN {r.total?.toLocaleString('en-US') ?? '—'}</p></div>
              <div>
                <p className={label}>Balance Due</p>
                <p className={r.balance && r.balance > 0 ? 'text-red-600' : ''}>MXN {r.balance?.toLocaleString('en-US') ?? '—'}</p>
              </div>
            </div>
            <div className="px-6 py-5">
              <div className="flex flex-wrap gap-2 border-b border-gray-200 pb-4">
                {canCheckIn && (
                  <button disabled={busy} onClick={() => act({ action: 'check_in' }, 'Checked in.')}
                    className="rounded-full bg-[#3b6fe0] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#2f5fcc] disabled:opacity-60">
                    Check in
                  </button>
                )}
                {link && (
                  <a href={link} target="_blank" rel="noreferrer"
                    className="rounded-full border border-gray-300 px-4 py-1.5 text-sm font-semibold text-[#14213d] hover:bg-gray-50">
                    Reservation details
                  </a>
                )}
              </div>

              <p className="mb-1.5 mt-4 text-sm font-semibold">Estimated arrival time</p>
              <div className="flex gap-2">
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                  className="w-28 rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-[#3b6fe0]" />
                <button disabled={busy || !time} onClick={() => act({ action: 'arrival_time', time }, 'Arrival time updated.')}
                  className="rounded-md bg-[#1b2340] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#2a3560] disabled:opacity-50">
                  Update
                </button>
              </div>

              <details className="mt-4 border-t border-gray-200 pt-3">
                <summary className="cursor-pointer text-sm font-semibold">Quick Edit</summary>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs text-gray-600">Arrival
                    <input type="date" value={checkin} onChange={(e) => setCheckin(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-[#14213d] outline-none focus:border-[#3b6fe0]" />
                  </label>
                  <label className="text-xs text-gray-600">Departure
                    <input type="date" value={checkout} onChange={(e) => setCheckout(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm text-[#14213d] outline-none focus:border-[#3b6fe0]" />
                  </label>
                </div>
                <button disabled={busy || (checkin === r.startDate && checkout === r.endDate)}
                  onClick={() => act({ action: 'dates', checkin, checkout }, 'Stay dates saved.')}
                  className="mt-3 w-full rounded-md bg-[#3b6fe0] py-2 text-sm font-semibold text-white hover:bg-[#2f5fcc] disabled:opacity-50">
                  Save stay dates
                </button>
              </details>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
