'use client'

import { useEffect, useMemo, useState } from 'react'
import { cbApi } from './shared'

interface RoomType {
  roomTypeID: string
  name: string
  maxGuests: number
  roomsAvailable: number
  total: number | null
  roomRateID: string | null
  ratePlan: string | null
  rooms: { roomID: string; roomName: string }[]
}
interface Options {
  sources: { id: string; name: string }[]
  paymentMethods: { code: string; name: string }[]
}

const COUNTRIES =
  'MX US CA ES FR DE IT GB NL BE CH AT SE NO DK FI IE PT PL CZ AR CL CO PE BR UY VE CR GT CU DO PR EC BO PY AU NZ JP KR CN IN IL ZA RU UA GR TR HU RO'.split(' ')

function addDays(d: string, n: number) {
  const x = new Date(`${d}T12:00:00Z`)
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
const nights = (a: string, b: string) => Math.max(0, Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000))

export default function NewReservationModal({ today, onClose, onCreated }: {
  today: string
  onClose: () => void
  onCreated: (reservationID: string) => void
}) {
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(addDays(today, 1))
  const [adults, setAdults] = useState(2)
  const [children, setChildren] = useState(0)
  const [rooms, setRooms] = useState<RoomType[] | null>(null)
  const [roomTypeID, setRoomTypeID] = useState('')
  const [roomID, setRoomID] = useState('')
  const [checking, setChecking] = useState(false)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [country, setCountry] = useState('MX')
  const [arrivalTime, setArrivalTime] = useState('')

  const [options, setOptions] = useState<Options | null>(null)
  const [sourceID, setSourceID] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [sendEmail, setSendEmail] = useState(true)

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const countryNames = useMemo(() => {
    const dn = new Intl.DisplayNames(['en'], { type: 'region' })
    return COUNTRIES.map((c) => ({ code: c, name: dn.of(c) ?? c })).sort((a, b) => (a.code === 'MX' ? -1 : b.code === 'MX' ? 1 : a.name.localeCompare(b.name)))
  }, [])

  useEffect(() => {
    cbApi<Options>('/api/cloudbeds/availability?options=1')
      .then((o) => {
        setOptions(o)
        const direct = o.sources.find((s) => /direct|walk|phone|tel/i.test(s.name)) ?? o.sources[0]
        if (direct) setSourceID(direct.id)
        const cash = o.paymentMethods.find((m) => /cash|efectivo/i.test(m.code + m.name)) ?? o.paymentMethods[0]
        if (cash) setPaymentMethod(cash.code)
      })
      .catch(() => setOptions({ sources: [], paymentMethods: [] }))
  }, [])

  // Any change to the stay means availability must be checked again.
  useEffect(() => {
    setRooms(null)
    setRoomTypeID('')
    setRoomID('')
  }, [start, end, adults, children])

  async function check() {
    setError(null)
    setChecking(true)
    try {
      const j = await cbApi<{ roomTypes: RoomType[] }>(`/api/cloudbeds/availability?start=${start}&end=${end}&adults=${adults}&children=${children}`)
      setRooms(j.roomTypes)
      if (j.roomTypes.length === 1) setRoomTypeID(j.roomTypes[0].roomTypeID)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check availability')
    }
    setChecking(false)
  }

  const chosen = rooms?.find((r) => r.roomTypeID === roomTypeID)

  async function create() {
    setError(null)
    setSaving(true)
    try {
      const j = await cbApi<{ reservationID: string }>('/api/cloudbeds/reservations', 'POST', {
        startDate: start, endDate: end, adults, children,
        roomTypeID, roomID: roomID || undefined, roomRateID: chosen?.roomRateID ?? undefined,
        firstName, lastName, email, phone, country, arrivalTime: arrivalTime || undefined,
        sourceID: sourceID || undefined, paymentMethod, sendEmail,
      })
      onCreated(j.reservationID)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the reservation')
    }
    setSaving(false)
  }

  const input = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-[13px] text-[#14213d] outline-none focus:border-[#3b6fe0]'
  const label = 'mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-gray-600'
  const section = 'mb-1.5 mt-4 text-[13px] font-semibold text-[#14213d]'
  const n = nights(start, end)
  const canCreate = Boolean(chosen && firstName.trim() && lastName.trim() && email.trim() && country && paymentMethod && !saving)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl bg-white text-[#14213d] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between rounded-t-xl bg-[#5cc3a5] px-5 py-3 text-white">
          <p className="text-[15px] font-semibold">New reservation</p>
          <button onClick={onClose} className="text-2xl leading-none opacity-90 hover:opacity-100" aria-label="Close">×</button>
        </div>

        <div className="max-h-[calc(100vh-9rem)] overflow-y-auto px-5 pb-4">
          <p className={section}>Stay</p>
          <div className="grid grid-cols-4 gap-2">
            <label className="col-span-1"><span className={label}>Check-in</span>
              <input type="date" value={start} min={today} onChange={(e) => { setStart(e.target.value); if (e.target.value >= end) setEnd(addDays(e.target.value, 1)) }} className={input} />
            </label>
            <label className="col-span-1"><span className={label}>Check-out</span>
              <input type="date" value={end} min={addDays(start, 1)} onChange={(e) => setEnd(e.target.value)} className={input} />
            </label>
            <label><span className={label}>Adults</span>
              <input type="number" min={1} max={12} value={adults} onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))} className={input} />
            </label>
            <label><span className={label}>Children</span>
              <input type="number" min={0} max={12} value={children} onChange={(e) => setChildren(Math.max(0, Number(e.target.value) || 0))} className={input} />
            </label>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[12px] text-gray-600">{n} night{n === 1 ? '' : 's'}</span>
            <button onClick={check} disabled={checking || n < 1}
              className="rounded-md bg-[#3b6fe0] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#2f5fcc] disabled:opacity-50">
              {checking ? 'Checking…' : rooms ? 'Check again' : 'Check availability'}
            </button>
          </div>

          {rooms && (
            <div className="mt-2 space-y-1.5">
              {rooms.length === 0 && <p className="rounded-md bg-amber-50 px-3 py-2 text-[12px] text-amber-800">Nothing available for these dates and guests.</p>}
              {rooms.map((r) => (
                <label key={r.roomTypeID}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[13px] ${roomTypeID === r.roomTypeID ? 'border-[#3b6fe0] bg-sky-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <span className="flex items-center gap-2">
                    <input type="radio" name="roomType" checked={roomTypeID === r.roomTypeID} onChange={() => { setRoomTypeID(r.roomTypeID); setRoomID('') }} />
                    <span>
                      <span className="font-semibold">{r.name}</span>
                      <span className="block text-[11px] text-gray-500">{r.roomsAvailable} available · up to {r.maxGuests} guests{r.ratePlan ? ` · ${r.ratePlan}` : ''}</span>
                    </span>
                  </span>
                  <span className="whitespace-nowrap font-semibold">{r.total !== null ? `MXN ${Math.round(r.total).toLocaleString('en-US')}` : '—'}</span>
                </label>
              ))}
              {chosen && chosen.rooms.length > 0 && (
                <label className="block pt-1"><span className={label}>Room (optional)</span>
                  <select value={roomID} onChange={(e) => setRoomID(e.target.value)} className={input}>
                    <option value="">Any available {chosen.name}</option>
                    {chosen.rooms.map((r) => <option key={r.roomID} value={r.roomID}>{r.roomName}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          <p className={section}>Guest</p>
          <div className="grid grid-cols-2 gap-2">
            <label><span className={label}>First name *</span><input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={input} /></label>
            <label><span className={label}>Last name *</span><input value={lastName} onChange={(e) => setLastName(e.target.value)} className={input} /></label>
            <label><span className={label}>Email *</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} /></label>
            <label><span className={label}>Phone</span><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+52 …" className={input} /></label>
            <label><span className={label}>Country *</span>
              <select value={country} onChange={(e) => setCountry(e.target.value)} className={input}>
                {countryNames.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </label>
            <label><span className={label}>Estimated arrival</span><input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} className={input} /></label>
          </div>

          <p className={section}>Booking</p>
          <div className="grid grid-cols-2 gap-2">
            <label><span className={label}>Source</span>
              <select value={sourceID} onChange={(e) => setSourceID(e.target.value)} className={input} disabled={!options}>
                {!options && <option>Loading…</option>}
                {options?.sources.length === 0 && <option value="">Default</option>}
                {options?.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label><span className={label}>Payment method *</span>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={input} disabled={!options}>
                {!options && <option>Loading…</option>}
                {options?.paymentMethods.length === 0 && <option value="cash">Cash</option>}
                {options?.paymentMethods.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
              </select>
            </label>
          </div>
          <label className="mt-2 flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
            Send Cloudbeds confirmation email to the guest
          </label>

          {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-3">
          <span className="text-[12.5px] text-gray-600">
            {chosen ? <>Total <b className="text-[#14213d]">{chosen.total !== null ? `MXN ${Math.round(chosen.total).toLocaleString('en-US')}` : '—'}</b> · {n} night{n === 1 ? '' : 's'}</> : 'Check availability and choose a room'}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border border-gray-300 px-3 py-1.5 text-[12.5px] font-semibold hover:bg-gray-50">Cancel</button>
            <button onClick={create} disabled={!canCreate}
              className="rounded-md bg-[#5cc3a5] px-4 py-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-white hover:bg-[#4bb294] disabled:opacity-50">
              {saving ? 'Creating…' : 'Create reservation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
