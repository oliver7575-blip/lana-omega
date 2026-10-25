'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cbApi, statusColor, statusLabel } from './shared'

type Json = Record<string, unknown>

/** "guestHomePhone" → "Home Phone". Strips a leading "guest" and splits camelCase. */
function humanize(key: string): string {
  const stripped = key.replace(/^guest/, '') || key
  const spaced = stripped.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
  return spaced.trim() || key
}

function valueText(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) {
    if (v.length === 0) return null
    const parts = v.map((item) => {
      if (item && typeof item === 'object') {
        const o = item as Json
        const label = (o.field ?? o.name ?? o.label) as string | undefined
        const val = (o.value ?? o.text) as string | undefined
        if (label !== undefined) return val !== undefined ? `${label}: ${val}` : String(label)
        return JSON.stringify(o)
      }
      return String(item)
    })
    return parts.join(' · ')
  }
  if (typeof v === 'object') return null // nested objects skipped — flat fields cover the common case
  return String(v)
}

/** Every field Cloudbeds holds on the guest's profile, shown as plain label/value rows. */
function GuestProfileFields({ profile }: { profile: Json }) {
  const rows = Object.entries(profile)
    .map(([k, v]) => [humanize(k), valueText(v)] as const)
    .filter(([, v]) => v !== null)
  if (rows.length === 0) return <p className="text-sm text-gray-500">No further guest details on file.</p>
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label}>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
          <p className="text-sm text-[#14213d]">{value}</p>
        </div>
      ))}
    </div>
  )
}

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
  const [guestProfile, setGuestProfile] = useState<Json | null>(null)
  const [guestError, setGuestError] = useState<string | null>(null)
  const [guestLoading, setGuestLoading] = useState(false)
  const [messagesBusy, setMessagesBusy] = useState(false)
  const router = useRouter()

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

  function loadGuest() {
    if (guestProfile || guestLoading) return
    setGuestLoading(true)
    setGuestError(null)
    cbApi<{ profile: Json }>(`/api/cloudbeds/reservation/${id}/guest`)
      .then((j) => setGuestProfile(j.profile))
      .catch((e) => setGuestError(e instanceof Error ? e.message : 'Could not load guest details'))
      .finally(() => setGuestLoading(false))
  }

  async function goToMessages() {
    setMessagesBusy(true)
    setError(null)
    try {
      const j = await cbApi<{ conversationId: string }>(`/api/cloudbeds/reservation/${id}/conversation`)
      router.push(`/conversations/${j.conversationId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open this guest’s messages')
      setMessagesBusy(false)
    }
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
                <button disabled={messagesBusy} onClick={goToMessages}
                  className="rounded-full border border-gray-300 px-4 py-1.5 text-sm font-semibold text-[#14213d] hover:bg-gray-50 disabled:opacity-60">
                  {messagesBusy ? 'Opening…' : 'Messages'}
                </button>
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

              <details className="mt-4 border-t border-gray-200 pt-3" onToggle={(e) => e.currentTarget.open && loadGuest()}>
                <summary className="cursor-pointer text-sm font-semibold">Guest details</summary>
                <div className="mt-3">
                  {guestLoading && <p className="text-sm text-gray-500">Loading…</p>}
                  {guestError && <p className="text-sm text-red-600">{guestError}</p>}
                  {guestProfile && <GuestProfileFields profile={guestProfile} />}
                </div>
              </details>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
