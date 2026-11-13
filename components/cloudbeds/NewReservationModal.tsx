'use client'

import { useEffect, useMemo, useState } from 'react'
import { cbApi } from './shared'
import { btn, btnLg, field, headerGradient, lbl, priGreen, priSlate } from './ui'

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
  sourcesError?: string | null
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

export default function NewReservationModal({ today, onClose, onCreated, onBlocked, initial, initialMode }: {
  today: string
  onClose: () => void
  onCreated: (reservationID: string) => void
  onBlocked?: (text: string) => void
  initialMode?: 'reservation' | 'block'
  /** Dates (and optionally the room) picked on the calendar: availability is checked straight away. */
  initial?: { start: string; end: string; roomTypeID?: string; roomID?: string }
}) {
  const [start, setStart] = useState(initial?.start ?? today)
  const [end, setEnd] = useState(initial?.end ?? addDays(today, 1))
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
  const [nightly, setNightly] = useState('')

  const [mode, setMode] = useState<'reservation' | 'block'>(initialMode ?? 'reservation')
  const [blockType, setBlockType] = useState<'blocked_dates' | 'out_of_service'>('blocked_dates')
  const [blockReason, setBlockReason] = useState('')
  const [blockGroups, setBlockGroups] = useState<{ typeName: string; rooms: { id: string; name: string }[] }[] | null>(null)
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
    setNightly('')
  }, [start, end, adults, children])

  // Opened from the calendar with dates picked: check availability and pre-select the clicked room.
  useEffect(() => {
    if (!initial) return
    let alive = true
    setChecking(true)
    cbApi<{ roomTypes: RoomType[] }>(`/api/cloudbeds/availability?start=${initial.start}&end=${initial.end}&adults=2&children=0`)
      .then((j) => {
        if (!alive) return
        setRooms(j.roomTypes)
        const t = j.roomTypes.find((x) => x.roomTypeID === initial.roomTypeID) ?? (j.roomTypes.length === 1 ? j.roomTypes[0] : undefined)
        if (t) {
          setRoomTypeID(t.roomTypeID)
          if (initial.roomID && t.rooms.some((r) => r.roomID === initial.roomID)) setRoomID(initial.roomID)
        }
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not check availability'))
      .finally(() => alive && setChecking(false))
    return () => { alive = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
  const nightCount = nights(start, end)
  const setPerNight = chosen && chosen.total !== null && nightCount > 0 ? chosen.total / nightCount : null
  const nightlyNum = nightly.trim() === '' ? null : Number(nightly)
  const nightlyValid = nightlyNum === null || (Number.isFinite(nightlyNum) && nightlyNum >= 0)
  const customTotal = nightlyNum !== null && nightlyValid && setPerNight !== null ? Math.round(nightlyNum * nightCount * 100) / 100 : undefined
  const effectiveTotal = customTotal ?? chosen?.total ?? null

  async function create() {
    setError(null)
    setSaving(true)
    try {
      const j = await cbApi<{ reservationID: string; priceWarning?: string }>('/api/cloudbeds/reservations', 'POST', {
        startDate: start, endDate: end, adults, children,
        roomTypeID, roomID: roomID || undefined, roomRateID: chosen?.roomRateID ?? undefined,
        firstName, lastName, email, phone, country, arrivalTime: arrivalTime || undefined,
        sourceID: sourceID || undefined, paymentMethod, sendEmail,
        customTotal, listTotal: customTotal !== undefined ? chosen?.total ?? undefined : undefined,
      })
      if (j.priceWarning) window.alert(j.priceWarning)
      onCreated(j.reservationID)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the reservation')
    }
    setSaving(false)
  }

  // Block mode: every room is offered (availability must not gate it); Cloudbeds rejects a clash itself.
  useEffect(() => {
    if (mode !== 'block' || blockGroups) return
    let alive = true
    cbApi<{ groups: { typeName: string; rooms: { id: string; name: string }[] }[] }>('/api/cloudbeds/availability?allRooms=1')
      .then((j) => {
        if (!alive) return
        setBlockGroups(j.groups)
        if (initial?.roomID && j.groups.some((g) => g.rooms.some((r) => r.id === initial.roomID))) setRoomID(initial.roomID)
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load rooms'))
    return () => { alive = false }
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  async function block() {
    setError(null)
    setSaving(true)
    try {
      await cbApi('/api/cloudbeds/blocks', 'POST', { roomID, startDate: start, endDate: end, type: blockType, reason: blockReason })
      const roomName = blockGroups?.flatMap((g) => g.rooms).find((r) => r.id === roomID)?.name ?? 'Room'
      onBlocked?.(`${roomName} ${blockType === 'out_of_service' ? 'set out of service' : 'blocked'} ${start} → ${end}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not block the dates')
    }
    setSaving(false)
  }

  const input = field
  const label = lbl
  const section = 'mb-2.5 mt-5 border-t border-[#eef0f4] pt-4 text-[11px] font-semibold uppercase tracking-[.08em] text-[#7a8394]'
  const n = nights(start, end)
  const blocking = mode === 'block'
  const canBlock = Boolean(roomID && end > start && !saving)
  const canCreate = Boolean(chosen && firstName.trim() && lastName.trim() && email.trim() && country && paymentMethod && nightlyValid && !saving)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#14213d]/40 p-4 pt-10" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-[22px] bg-white text-[#14213d] shadow-[0_24px_64px_rgba(20,33,61,.32)]" onClick={(e) => e.stopPropagation()}>
        <div className={`flex items-center justify-between gap-4 px-6 py-4 text-white ${headerGradient(blocking ? 'slate' : 'blue')}`}>
          <div>
            <p className="text-base font-bold tracking-tight">{blocking ? 'Block dates' : 'New reservation'}</p>
            <p className="mt-px text-xs text-white/70">{start} → {end} · {nights(start, end)} night{nights(start, end) === 1 ? '' : 's'}</p>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-full border border-white/30 text-base leading-none text-white hover:bg-white/10" aria-label="Close">×</button>
        </div>

        <div className="max-h-[calc(100vh-9rem)] overflow-y-auto px-6 pb-5">
          <div className="mt-4 inline-flex rounded-full bg-[#e8eef0] p-[3px] text-[12.5px] font-semibold">
            <button onClick={() => setMode('reservation')} className={`h-[30px] rounded-full px-4 ${!blocking ? 'bg-white text-[#0e5f47] shadow-[0_1px_3px_rgba(16,24,40,.12)]' : 'text-gray-600'}`}>Reservation</button>
            <button onClick={() => setMode('block')} className={`h-[30px] rounded-full px-4 ${blocking ? 'bg-white text-[#0e5f47] shadow-[0_1px_3px_rgba(16,24,40,.12)]' : 'text-gray-600'}`}>Block dates / Out of service</button>
          </div>
          <p className={section}>Stay</p>
          <div className="grid grid-cols-4 gap-2">
            <label className="col-span-1"><span className={label}>Check-in</span>
              <input type="date" value={start} min={today} onChange={(e) => { setStart(e.target.value); if (e.target.value >= end) setEnd(addDays(e.target.value, 1)) }} className={input} />
            </label>
            <label className="col-span-1"><span className={label}>Check-out</span>
              <input type="date" value={end} min={addDays(start, 1)} onChange={(e) => setEnd(e.target.value)} className={input} />
            </label>
            {!blocking && <label><span className={label}>Adults</span>
              <input type="number" min={1} max={12} value={adults} onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))} className={input} />
            </label>}
            {!blocking && <label><span className={label}>Children</span>
              <input type="number" min={0} max={12} value={children} onChange={(e) => setChildren(Math.max(0, Number(e.target.value) || 0))} className={input} />
            </label>}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[12px] text-gray-600">{n} night{n === 1 ? '' : 's'}</span>
            {!blocking && <button onClick={check} disabled={checking || n < 1}
              className={`${btn} !border-[#c9d9f7] !text-[#2456b8] disabled:opacity-50`}>
              {checking ? 'Checking…' : rooms ? 'Check again' : 'Check availability'}
            </button>}
          </div>

          {!blocking && rooms && (
            <div className="mt-2 space-y-1.5">
              {rooms.length === 0 && <p className="rounded-xl bg-amber-50 px-3 py-2 text-[12px] text-amber-800">Nothing available for these dates and guests.</p>}
              {rooms.map((r) => (
                <label key={r.roomTypeID}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-3.5 py-3 text-[13px] ${roomTypeID === r.roomTypeID ? 'border-[#1f9d78] bg-[#eefaf5] shadow-[0_0_0_3px_rgba(31,157,120,.12)]' : 'border-[#e6e9f0] hover:bg-gray-50'}`}>
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
              {!blocking && chosen && chosen.rooms.length > 0 && (
                <label className="block pt-1"><span className={label}>{blocking ? 'Room to block *' : 'Room (optional)'}</span>
                  <select value={roomID} onChange={(e) => setRoomID(e.target.value)} className={input}>
                    <option value="">{blocking ? `Select a ${chosen.name} room` : `Any available ${chosen.name}`}</option>
                    {chosen.rooms.map((r) => <option key={r.roomID} value={r.roomID}>{r.roomName}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}

          {blocking && (
            <div className="mt-3 space-y-2">
              {initial?.roomID && roomID ? (
                <p className="text-[12.5px] text-gray-600">
                  Room <b className="text-[#14213d]">{blockGroups?.find((g) => g.rooms.some((r) => r.id === roomID))?.typeName}{blockGroups ? ' · ' : ''}{blockGroups?.flatMap((g) => g.rooms).find((r) => r.id === roomID)?.name}</b>
                </p>
              ) : (
              <label className="block"><span className={label}>Room to block *</span>
                <select value={roomID} onChange={(e) => setRoomID(e.target.value)} className={input} disabled={!blockGroups}>
                  <option value="">{blockGroups ? 'Select a room' : 'Loading rooms…'}</option>
                  {blockGroups?.map((g) => (
                    <optgroup key={g.typeName} label={g.typeName}>
                      {g.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              )}
              <div className="grid grid-cols-2 gap-2">
                <label><span className={label}>Type</span>
                  <select value={blockType} onChange={(e) => setBlockType(e.target.value as 'blocked_dates' | 'out_of_service')} className={input}>
                    <option value="blocked_dates">Block dates</option>
                    <option value="out_of_service">Out of service</option>
                  </select>
                </label>
                <label><span className={label}>Reason</span>
                  <input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} placeholder="Optional" className={input} />
                </label>
              </div>
              <p className="text-[11px] text-gray-500">Check-out day is the first night that is free again. If the room has a reservation on these dates, Cloudbeds will refuse the block.</p>
            </div>
          )}
          {!blocking && <>
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
              {options && options.sources.length === 0 && options.sourcesError && (
                <span className="mt-1 block text-[11px] text-amber-300">Couldn&apos;t load sources ({options.sourcesError}). Using the default.</span>
              )}
            </label>
            <label><span className={label}>Payment method *</span>
              <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={input} disabled={!options}>
                {!options && <option>Loading…</option>}
                {options?.paymentMethods.length === 0 && <option value="cash">Cash</option>}
                {options?.paymentMethods.map((m) => <option key={m.code} value={m.code}>{m.name}</option>)}
              </select>
            </label>
          </div>
          {chosen && (
            <label className="mt-3 block"><span className={label}>Price per night (MXN)</span>
              <input type="number" min="0" step="1" inputMode="decimal" value={nightly} onChange={(e) => setNightly(e.target.value)}
                placeholder={setPerNight !== null ? `Set price: ${Math.round(setPerNight).toLocaleString('en-US')}` : 'Set price'} className={input} />
              <span className="mt-0.5 block text-[11px] text-gray-500">Leave empty to use the set price.</span>
            </label>
          )}
          <label className="mt-2 flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={sendEmail} onChange={(e) => setSendEmail(e.target.checked)} />
            Send Cloudbeds confirmation email to the guest
          </label>
          </>}

          {error && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[12.5px] text-red-700">{error}</p>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#eef0f4] bg-[#fbfbfc] px-6 py-3.5">
          <span className="min-w-0 flex-1 text-[12.5px] text-gray-600">
            {blocking ? 'No guest or charge — the room just becomes unavailable' : chosen ? <>Total <b className="text-[#14213d]">{effectiveTotal !== null ? `MXN ${Math.round(effectiveTotal).toLocaleString('en-US')}` : '—'}</b> · {n} night{n === 1 ? '' : 's'}</> : 'Check availability and choose a room'}
          </span>
          <div className="flex shrink-0 gap-2">
            <button onClick={onClose} className={btnLg}>Cancel</button>
            <button onClick={blocking ? block : create} disabled={blocking ? !canBlock : !canCreate}
              className={blocking ? priSlate : priGreen}>
              {blocking ? (saving ? 'Blocking…' : blockType === 'out_of_service' ? 'Set out of service' : 'Block dates') : saving ? 'Creating…' : 'Create reservation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
