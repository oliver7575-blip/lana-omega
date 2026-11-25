/**
 * Dashboard + Calendar data for a Lodgify hotel, in the same shapes the
 * Cloudbeds pages already read (lib/cloudbeds-ops.ts), so the pages work for
 * either PMS. Read-only: every Lodgify property (rental) is one "room type"
 * with one room.
 */
import {
  amount,
  guestOf,
  listBookings,
  listPropertiesRaw,
  lodgifyFetch,
  mapLodgifyStatus,
  sourceLabel,
  type LodgifyAuth,
  type Raw,
} from './lodgify'
import type { CalendarData, DashRow, ActivityRow } from './cloudbeds-ops'

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())
const day = (v: unknown) => str(v).slice(0, 10)

export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + n)
  return t.toISOString().slice(0, 10)
}
const nights = (a: string, b: string) => Math.max(0, Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000))

interface Prop { id: string; name: string }

async function loadProps(auth: LodgifyAuth): Promise<Prop[]> {
  const r = await listPropertiesRaw(auth)
  if (!r.ok) throw new Error(r.error)
  const d = r.data as { items?: Raw[] } | Raw[] | null
  const list = Array.isArray(d) ? d : (d?.items ?? [])
  return list
    .filter((p) => p.id !== undefined && (!auth.propertyId || String(p.id) === auth.propertyId))
    .map((p) => ({ id: String(p.id), name: str(p.name) || `Property ${p.id}` }))
}

// A short cache: the dashboard fires several requests at once.
const cache = new Map<string, { at: number; rows: Raw[] }>()
async function allBookings(auth: LodgifyAuth): Promise<Raw[]> {
  const key = auth.apiKey.slice(-8)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 30_000) return hit.rows
  const r = await listBookings(auth, 'stayFilter=All&includeCount=false')
  if (!r.ok) throw new Error(r.error)
  cache.set(key, { at: Date.now(), rows: r.rows })
  return r.rows
}

const isCanceled = (b: Raw) => mapLodgifyStatus(b) === 'canceled'
/** Real stays: not enquiries, not cancelled, not owner blocks. */
const isStay = (b: Raw) => {
  const s = mapLodgifyStatus(b)
  return s !== 'canceled' && s !== 'enquiry' && b.is_unavailable !== true
}

/** What the calendar/dashboard show as the stay's status, by date. */
function stayState(b: Raw, today: string): string {
  const a = day(b.arrival)
  const d = day(b.departure)
  if (String(b.status ?? '').toLowerCase() === 'tentative') return 'not_confirmed'
  if (d <= today) return 'checked_out'
  if (a <= today) return 'in_house'
  return 'confirmed'
}

const propName = (props: Prop[], b: Raw) => props.find((p) => p.id === str(b.property_id))?.name ?? '—'

function row(props: Prop[], b: Raw, today: string): DashRow {
  return {
    reservationID: str(b.id),
    guestName: str(guestOf(b).name),
    room: propName(props, b),
    arrivalTime: null,
    status: stayState(b, today),
    startDate: day(b.arrival),
    endDate: day(b.departure),
  }
}

export async function dashListLodgify(auth: LodgifyAuth, tab: 'arrivals' | 'departures' | 'stayovers' | 'inhouse', date: string, today: string): Promise<DashRow[]> {
  const [props, all] = await Promise.all([loadProps(auth), allBookings(auth)])
  const stays = all.filter(isStay)
  const pick = stays.filter((b) => {
    const a = day(b.arrival)
    const d = day(b.departure)
    if (tab === 'arrivals') return a === date
    if (tab === 'departures') return d === date
    if (tab === 'stayovers') return a < date && d > date
    return a <= today && d > today // in-house tonight
  })
  return pick.map((b) => row(props, b, today)).sort((x, y) => x.room.localeCompare(y.room))
}

/** The Reservations page: newest bookings first, 40 per page. */
export async function listReservationsLodgify(auth: LodgifyAuth, page: number, today: string) {
  const size = 40
  const [props, all] = await Promise.all([loadProps(auth), allBookings(auth)])
  const sorted = all
    .filter((b) => b.is_unavailable !== true)
    .filter((b) => mapLodgifyStatus(b) !== 'canceled')
    .sort((a, b) => str(b.created_at).localeCompare(str(a.created_at)))
  const start = (Math.max(1, page) - 1) * size
  const rows = sorted.slice(start, start + size).map((b) => {
    const pid = str(b.property_id)
    const name = props.find((p) => p.id === pid)?.name ?? ''
    return {
      reservationID: str(b.id),
      guestID: null,
      guestName: str(guestOf(b).name),
      bookedOn: day(b.created_at),
      startDate: day(b.arrival),
      endDate: day(b.departure),
      status: mapLodgifyStatus(b) === 'canceled' ? 'canceled' : stayState(b, today),
      total: amount(b.total_amount) ?? null,
      rooms: [{ roomTypeID: pid, roomTypeName: name, roomID: pid, roomName: name }],
    }
  })
  return { rows, hasMore: start + size < sorted.length }
}

function activity(b: Raw): ActivityRow {
  return {
    reservationID: str(b.id),
    guestName: str(guestOf(b).name),
    revenue: amount(b.total_amount) ?? null,
    checkIn: day(b.arrival),
    nights: nights(day(b.arrival), day(b.departure)),
    status: mapLodgifyStatus(b),
  }
}

export async function dashSummaryLodgify(auth: LodgifyAuth, today: string) {
  const [props, all] = await Promise.all([loadProps(auth), allBookings(auth)])
  const stays = all.filter(isStay)
  const arrivals = stays.filter((b) => day(b.arrival) === today).length
  const departures = stays.filter((b) => day(b.departure) === today).length
  const stayovers = stays.filter((b) => day(b.arrival) < today && day(b.departure) > today).length
  const occupied = new Set(stays.filter((b) => day(b.arrival) <= today && day(b.departure) > today).map((b) => str(b.property_id)))
  const roomsOccupied = props.filter((p) => occupied.has(p.id)).length

  const salesRows = stays.filter((b) => day(b.created_at) === today).slice(0, 30).map(activity)
  const cancelRows = all.filter((b) => isCanceled(b) && day(b.canceled_at ?? b.updated_at) === today).slice(0, 30).map(activity)

  return {
    arrivals,
    departures,
    stayovers,
    inHouse: roomsOccupied,
    roomsOccupied,
    percentageOccupied: props.length ? Math.round((roomsOccupied / props.length) * 100) : 0,
    sales: { count: salesRows.length, roomNights: salesRows.reduce((s, r) => s + r.nights, 0), revenue: salesRows.reduce((s, r) => s + (r.revenue ?? 0), 0), rows: salesRows },
    cancellations: { count: cancelRows.length, roomNights: cancelRows.reduce((s, r) => s + r.nights, 0), revenue: cancelRows.reduce((s, r) => s + (r.revenue ?? 0), 0), rows: cancelRows },
  }
}

interface RateDay { date: string; price: number; minStay?: number; maxStay?: number; extra?: number; extraFrom?: number }

/** Lodgify's rates calendar for one rental (inclusive dates). */
async function rateDays(auth: LodgifyAuth, propId: string, roomTypeId: string, start: string, endInclusive: string): Promise<RateDay[]> {
  const r = await lodgifyFetch(auth, `/v2/rates/calendar?houseId=${encodeURIComponent(propId)}&roomTypeId=${encodeURIComponent(roomTypeId)}&startDate=${start}&endDate=${endInclusive}`)
  if (!r.ok) return []
  const items = ((r.data as Raw | null)?.calendar_items as Raw[] | undefined) ?? []
  const out: RateDay[] = []
  for (const it of items) {
    const p = ((it.prices as Raw[] | undefined) ?? [])[0]
    const price = amount(p?.price_per_day)
    if (!p || !price || price <= 0) continue
    out.push({
      date: day(it.date),
      price,
      minStay: Number(p.min_stay) || undefined,
      maxStay: Number(p.max_stay) || undefined,
      extra: amount(p.price_per_additional_guest),
      extraFrom: Number(p.additional_guests_starts_from) || undefined,
    })
  }
  return out
}

/** Sets the nightly price of a rental for start..endInclusive, keeping each night's stay limits. */
export async function setRateLodgify(auth: LodgifyAuth, rateID: string, start: string, endInclusive: string, price: number) {
  const [propertyId, roomTypeId] = rateID.split(':')
  if (!propertyId || !roomTypeId) throw new Error('This rental has no editable rate.')
  const existing = await rateDays(auth, propertyId, roomTypeId, start, endInclusive)
  const byDate = new Map(existing.map((d) => [d.date, d]))
  // Group consecutive nights that share the same stay limits into one rate period.
  const periods: { start: string; end: string; d?: RateDay }[] = []
  for (let d = start; d <= endInclusive; d = addDays(d, 1)) {
    const cur = byDate.get(d)
    const last = periods[periods.length - 1]
    const same = last && last.end === d && last.d?.minStay === cur?.minStay && last.d?.maxStay === cur?.maxStay && last.d?.extra === cur?.extra && last.d?.extraFrom === cur?.extraFrom
    if (same) last.end = addDays(d, 1)
    else periods.push({ start: d, end: addDays(d, 1), d: cur })
  }
  const rates = periods.map((p) => ({
    is_default: false,
    start_date: p.start,
    end_date: p.end, // exclusive
    price_per_day: price,
    ...(p.d?.minStay ? { min_stay: p.d.minStay } : {}),
    ...(p.d?.maxStay ? { max_stay: p.d.maxStay } : {}),
    ...(p.d?.extra ? { price_per_additional_guest: p.d.extra } : {}),
    ...(p.d?.extraFrom ? { additional_guests_starts_from: p.d.extraFrom } : {}),
  }))
  const r = await lodgifyFetch(auth, '/v1/rates/savewithoutavailability', {
    method: 'POST',
    body: JSON.stringify({ property_id: Number(propertyId), room_type_id: Number(roomTypeId), rates }),
  })
  if (!r.ok) {
    if (/940|external rates/i.test(r.error)) throw new Error("Lodgify doesn't allow apps to change prices on this property (it isn't set up for an external rate manager). Change the price in Lodgify.")
    throw new Error(r.error)
  }
}

export async function calendarLodgify(auth: LodgifyAuth, start: string, dayCount: number, today: string): Promise<CalendarData> {
  const end = addDays(start, dayCount)
  const days = Array.from({ length: dayCount }, (_, i) => addDays(start, i))
  const [props, all] = await Promise.all([loadProps(auth), allBookings(auth)])
  const rentals = await rentalRooms(auth)
  const rates = await Promise.all(
    props.map(async (p) => {
      const rt = rentals.find((x) => x.propertyId === p.id)?.roomTypeId
      if (!rt) return { rt: '', map: {} as Record<string, number> }
      const days = await rateDays(auth, p.id, rt, start, addDays(end, -1)).catch(() => [])
      return { rt, map: Object.fromEntries(days.map((d) => [d.date, d.price])) as Record<string, number> }
    }),
  )

  const roomTypes: CalendarData['roomTypes'] = props.map((p, i) => ({
    id: p.id,
    name: p.name,
    rates: rates[i].map,
    ...(rates[i].rt ? { rateID: `${p.id}:${rates[i].rt}` } : {}),
    rooms: [{ id: p.id, name: p.name }],
  }))

  const bookings: CalendarData['bookings'] = []
  const blocks: CalendarData['blocks'] = []
  for (const b of all) {
    const a = day(b.arrival)
    const d = day(b.departure)
    if (!a || !d || a >= end || d <= start) continue
    const roomID = str(b.property_id)
    if (!props.some((p) => p.id === roomID)) continue
    if (b.is_unavailable === true && !isCanceled(b)) {
      blocks.push({ roomBlockID: str(b.id), type: 'blocked', roomID, start: a, end: d, reason: str(b.notes) || 'Unavailable' })
      continue
    }
    if (!isStay(b)) continue
    bookings.push({
      reservationID: str(b.id),
      guestName: str(guestOf(b).name),
      status: stayState(b, today),
      roomID,
      start: a,
      end: d,
      due: (amount(b.amount_due) ?? 0) > 0.005 && !/airbnb|booking/i.test(sourceLabel(b) ?? ''),
      src: sourceLabel(b) ?? '',
    })
  }

  const overbookings: CalendarData['overbookings'] = []
  const byRoom = new Map<string, CalendarData['bookings']>()
  for (const b of bookings) byRoom.set(b.roomID, [...(byRoom.get(b.roomID) ?? []), b])
  for (const [roomID, list] of byRoom) {
    const sorted = [...list].sort((x, y) => x.start.localeCompare(y.start))
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start < sorted[i - 1].end) overbookings.push({ roomID, reservationIDs: [sorted[i - 1].reservationID, sorted[i].reservationID] })
    }
  }

  return { start, days, roomTypes, bookings, unassigned: [], blocks, overbookings }
}

/** One booking in the shape the reservation window reads (read-only). */
export async function reservationDetailLodgify(auth: LodgifyAuth, id: string, today: string) {
  const [props, r] = await Promise.all([loadProps(auth), lodgifyFetch(auth, `/v2/reservations/bookings/${encodeURIComponent(id)}`)])
  if (!r.ok) throw new Error(r.error)
  const b = r.data as Raw
  const g = guestOf(b)
  const a = day(b.arrival)
  const d = day(b.departure)
  const pid = str(b.property_id)
  const room = props.find((p) => p.id === pid)
  const rooms = (b.rooms as Raw[] | undefined) ?? []
  const breakdown = rooms.reduce<{ adults: number; children: number }>(
    (acc, x) => {
      const gb = (x.guest_breakdown as Raw | undefined) ?? {}
      acc.adults += Number(gb.adults ?? x.people ?? 0) || 0
      acc.children += (Number(gb.children ?? 0) || 0) + (Number(gb.infants ?? 0) || 0)
      return acc
    },
    { adults: 0, children: 0 },
  )
  const sub = (b.subtotals as Raw | undefined) ?? {}
  const total = amount(b.total_amount) ?? null
  // Booking.com and Airbnb bookings are prepaid through the channel: show them as paid in full.
  const prepaid = /airbnb|booking/i.test(sourceLabel(b) ?? '')
  const paid = prepaid && total !== null ? total : amount(b.amount_paid) ?? null
  const code = (await import('./lodgify')).channelCodes(b)[0] ?? null
  const state = stayState(b, today)
  return {
    reservationID: str(b.id),
    guestName: str(g.name),
    guestEmail: str(g.email) || null,
    guestPhone: str(g.phone) || null,
    status: mapLodgifyStatus(b) === 'canceled' ? 'canceled' : state,
    source: sourceLabel(b) ?? null,
    startDate: a,
    endDate: d,
    adults: breakdown.adults || 1,
    children: breakdown.children,
    rooms: [{ subReservationID: str(b.id), reservationRoomID: null, roomID: pid, roomTypeID: pid, roomTypeName: room?.name ?? '', roomName: room?.name ?? null, roomStatus: state, startDate: a, endDate: d, adults: breakdown.adults || 1, children: breakdown.children }],
    total,
    balance: prepaid ? 0 : amount(b.amount_due) ?? null,
    // Lodgify's check_in.time is just the property's standard check-in time, not a time the guest gave: the real
    // estimated arrival lives in pms_arrival_times and is merged in by the route.
    estimatedArrivalTime: null as string | null,
    guestCountry: str(g.country_code) || null,
    guestID: null,
    dateCreated: str(b.created_at) || null,
    confirmationCode: code,
    hasQuote: b.quote != null,
    specialRequests: str(b.notes) || null,
    breakdown: {
      subTotal: b.quote == null && total ? total : amount(sub.stay) ?? null,
      additionalItems: (amount(sub.addons) ?? 0) + (amount(sub.fees) ?? 0) || null,
      taxesFees: (amount(sub.taxes) ?? 0) + (amount(sub.vat) ?? 0),
      paid,
    },
  }
}

export async function searchLodgify(auth: LodgifyAuth, q: string, today: string): Promise<DashRow[]> {
  const term = q.trim().toLowerCase()
  if (!term) return []
  const { channelCodes } = await import('./lodgify')
  const [props, all] = await Promise.all([loadProps(auth), allBookings(auth)])
  return all
    .filter((b) => b.is_unavailable !== true)
    .filter((b) => {
      const g = guestOf(b)
      return (
        str(b.id) === term ||
        str(g.name).toLowerCase().includes(term) ||
        str(g.email).toLowerCase().includes(term) ||
        str(g.phone).replace(/\s/g, '').includes(term.replace(/\s/g, '')) ||
        channelCodes(b).some((c) => c.toLowerCase() === term)
      )
    })
    .map((b) => row(props, b, today))
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .slice(0, 50)
}

// ---- New reservation ------------------------------------------------------------

interface RentalRoom { propertyId: string; name: string; roomTypeId: string; maxGuests: number }
const roomCache = new Map<string, { at: number; rows: RentalRoom[] }>()

/** Every rental with the room type id Lodgify needs to book it. */
async function rentalRooms(auth: LodgifyAuth): Promise<RentalRoom[]> {
  const key = auth.apiKey.slice(-8)
  const hit = roomCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.rows
  const props = await loadProps(auth)
  const rows: RentalRoom[] = []
  for (const p of props) {
    const r = await lodgifyFetch(auth, `/v2/properties/${encodeURIComponent(p.id)}/rooms`)
    if (!r.ok) continue
    const list = (Array.isArray(r.data) ? r.data : ((r.data as { items?: Raw[] })?.items ?? [])) as Raw[]
    const first = list[0]
    if (!first || first.id === undefined) continue
    rows.push({ propertyId: p.id, name: p.name, roomTypeId: str(first.id), maxGuests: Number(first.max_people) || 2 })
  }
  roomCache.set(key, { at: Date.now(), rows })
  return rows
}

/** Rentals that are free for the whole stay (no booking or blocked dates overlap it). */
export async function availabilityLodgify(auth: LodgifyAuth, start: string, end: string, adults: number, children: number) {
  const [rooms, all] = await Promise.all([rentalRooms(auth), allBookings(auth)])
  const busy = new Set<string>()
  for (const b of all) {
    if (isCanceled(b) || mapLodgifyStatus(b) === 'enquiry') continue
    if (day(b.arrival) < end && day(b.departure) > start) busy.add(str(b.property_id))
  }
  return rooms
    .filter((r) => !busy.has(r.propertyId) && r.maxGuests >= adults + children)
    .map((r) => ({
      roomTypeID: r.propertyId,
      name: r.name,
      maxGuests: r.maxGuests,
      roomsAvailable: 1,
      total: null as number | null,
      roomRateID: null,
      ratePlan: null,
      rooms: [{ roomID: r.propertyId, roomName: r.name }],
    }))
}

/** Free rentals for Lana's availability tool, with the nightly rates Lodgify has for those nights. */
export async function availabilityWithPricesLodgify(auth: LodgifyAuth, start: string, end: string, adults: number, children: number) {
  const [free, rooms] = await Promise.all([availabilityLodgify(auth, start, end, adults, children), rentalRooms(auth)])
  const lastNight = addDays(end, -1)
  const nightsN = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000))
  return Promise.all(
    free.map(async (f) => {
      const rt = rooms.find((r) => r.propertyId === f.roomTypeID)?.roomTypeId ?? ''
      const days = rt ? await rateDays(auth, f.roomTypeID, rt, start, lastNight).catch(() => []) : []
      const priced = days.filter((d) => d.date >= start && d.date <= lastNight)
      const total = priced.length === nightsN ? priced.reduce((s, d) => s + d.price, 0) : null
      return { name: f.name, maxGuests: f.maxGuests, total, perNight: total !== null ? Math.round(total / nightsN) : null }
    }),
  )
}

export interface NewLodgifyBooking {
  propertyId: string
  start: string
  end: string
  adults: number
  children: number
  firstName: string
  lastName: string
  email: string
  phone?: string
  country: string
  total?: number
  /** Experiment/diagnostic: save the booking without creating a quote afterwards. */
  skipQuote?: boolean
}

/** Creates a booking in Lodgify (POST /v1/reservation/booking). Leaving total out lets Lodgify price the stay. */
export async function createBookingLodgify(auth: LodgifyAuth, b: NewLodgifyBooking): Promise<{ id: string; quoteWarning?: string }> {
  const rooms = await rentalRooms(auth)
  const room = rooms.find((r) => r.propertyId === b.propertyId)
  if (!room) throw new Error('That rental was not found in Lodgify')
  // Re-check just before saving so a booking made a moment ago is not double-booked.
  const free = await availabilityLodgify(auth, b.start, b.end, 1, 0)
  if (!free.some((r) => r.roomTypeID === b.propertyId)) throw new Error('That rental is no longer free for these dates.')
  cache.clear()
  const body: Record<string, unknown> = {
    arrival: b.start,
    departure: b.end,
    property_id: Number(b.propertyId),
    status: 'Booked',
    source_text: 'Lana panel',
    rooms: [{ room_type_id: Number(room.roomTypeId), guest_breakdown: { Adults: b.adults, Children: b.children } }],
    guest: {
      guest_name: { first_name: b.firstName, last_name: b.lastName },
      email: b.email,
      ...(b.phone ? { phone: b.phone } : {}),
      country_code: b.country,
    },
    ...(b.total !== undefined ? { total: b.total, currency_code: 'MXN' } : {}),
  }
  const r = await lodgifyFetch(auth, '/v1/reservation/booking', { method: 'POST', body: JSON.stringify(body) })
  if (!r.ok) throw new Error(r.error)
  const id = typeof r.data === 'number' || typeof r.data === 'string' ? String(r.data) : str((r.data as Raw | null)?.id)
  if (!id) throw new Error('Lodgify did not return the new booking id')
  cache.clear()

  // A typed total is kept as the booking total (Booked, no quote): creating a quote would overwrite it with Lodgify rates.
  if (b.skipQuote || b.total !== undefined) return { id }
  // A booking made through the API has no quote until one is created: ask Lodgify to price the stay
  // from its rates (POST /v1/reservation/booking/{id}/quote). Without the policy workflow the quote needs no
  // payment schedule, so the booking stays Booked instead of waiting for the guest (Tentative).
  let quoteWarning: string | undefined
  const q = await lodgifyFetch(auth, `/v1/reservation/booking/${encodeURIComponent(id)}/quote`, {
    method: 'POST',
    body: JSON.stringify({ is_policy_active: false, room_types: [{ room_type_id: Number(room.roomTypeId) }] }),
  })
  if (!q.ok) quoteWarning = `The booking was saved as Booked in Lodgify (number ${id}), but Lodgify did not create its quote: ${q.error}. Open the booking in Lodgify to add the quote.`
  return { id, quoteWarning }
}

/** Adds a quote at Lodgify's own prices to a booking that has none (POST /v1/reservation/booking/{id}/quote). */
export async function createQuoteLodgify(auth: LodgifyAuth, id: string): Promise<void> {
  const r = await lodgifyFetch(auth, `/v2/reservations/bookings/${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(r.error)
  const b = r.data as Raw
  const room = (await rentalRooms(auth)).find((x) => x.propertyId === str(b.property_id))
  if (!room) throw new Error('Could not find the rental of this booking in Lodgify')
  const q = await lodgifyFetch(auth, `/v1/reservation/booking/${encodeURIComponent(id)}/quote`, {
    method: 'POST',
    body: JSON.stringify({ is_policy_active: false, room_types: [{ room_type_id: Number(room.roomTypeId) }] }),
  })
  if (!q.ok) throw new Error(q.error)
  cache.clear()
}

/**
 * Lodgify cannot edit a booking's price, so this replaces the booking: it declines the old one and creates an
 * identical one (same guest, dates, rental) without a quote and with the new total. The booking number changes.
 */
export async function changePriceLodgify(auth: LodgifyAuth, id: string, nightly: number): Promise<{ newId: string; oldId: string }> {
  if (!Number.isFinite(nightly) || nightly < 0) throw new Error('Enter a valid price per night')
  const r = await lodgifyFetch(auth, `/v2/reservations/bookings/${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(r.error)
  const b = r.data as Raw
  if (/airbnb|booking|expedia|homeaway|ical/.test(String(b.source ?? '').toLowerCase())) throw new Error('The price of an OTA booking can only be changed on the OTA.')
  const g = guestOf(b)
  const start = day(b.arrival)
  const end = day(b.departure)
  const nights = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000)
  if (nights < 1) throw new Error('Could not read the dates of this booking')
  const rooms = (b.rooms as Raw[] | undefined) ?? []
  let adults = 0
  let children = 0
  for (const x of rooms) {
    const gb = (x.guest_breakdown as Raw | undefined) ?? {}
    adults += Number(gb.adults ?? x.people ?? 0) || 0
    children += (Number(gb.children ?? 0) || 0) + (Number(gb.infants ?? 0) || 0)
  }
  const parts = str(g.name).trim().split(/\s+/)
  const make = (total?: number): NewLodgifyBooking => ({
    propertyId: str(b.property_id), start, end, adults: adults || 1, children,
    firstName: parts[0] || 'Guest', lastName: parts.slice(1).join(' ') || '-',
    email: str(g.email), phone: str(g.phone) || undefined, country: str(g.country_code) || 'MX',
    total, skipQuote: true,
  })
  await cancelBookingLodgify(auth, id)
  try {
    const made = await createBookingLodgify(auth, make(Math.round(nightly * nights * 100) / 100))
    return { newId: made.id, oldId: id }
  } catch (e) {
    // Put the guest back rather than leave the dates empty.
    try { await createBookingLodgify(auth, make(amount(b.total_amount) ?? undefined)) } catch { /* reported below */ }
    throw new Error(`Could not create the booking at the new price (${e instanceof Error ? e.message : 'Lodgify error'}). The original booking was restored as a new booking — check Lodgify.`)
  }
}

/** Cancels a booking in Lodgify (PUT /v1/reservation/booking/{id}/decline). */
export async function cancelBookingLodgify(auth: LodgifyAuth, id: string): Promise<void> {
  const r = await lodgifyFetch(auth, `/v2/reservations/bookings/${encodeURIComponent(id)}`)
  if (!r.ok) throw new Error(r.error)
  const b = r.data as Raw
  const src = String(b.source ?? '').toLowerCase()
  if (/airbnb|booking|expedia|homeaway|ical/.test(src)) {
    throw new Error(`This booking came from ${sourceLabel(b) ?? 'a channel'}. Cancel it on that channel (or in Lodgify), so the guest and the channel are told.`)
  }
  const eid = encodeURIComponent(id)
  const decline = () => lodgifyFetch(auth, `/v1/reservation/booking/${eid}/decline`, { method: 'PUT', body: JSON.stringify({}) })
  let p = await decline()
  if (!p.ok && /transition|666/i.test(p.error)) {
    // A booking whose quote was agreed (e.g. created in Lodgify) cannot go Booked → Declined directly:
    // step it back to Tentative first, then decline.
    const t = await lodgifyFetch(auth, `/v1/reservation/booking/${eid}/tentative`, { method: 'PUT', body: JSON.stringify({}) })
    if (t.ok) p = await decline()
    else {
      // Try reopening it instead (POST /v1/reservation/booking/{id}/open), then decline.
      const o = await lodgifyFetch(auth, `/v1/reservation/booking/${eid}/open`, { method: 'POST', body: JSON.stringify({}) })
      if (o.ok) p = await decline()
      else p = { ...p, error: 'Lodgify does not let the panel cancel this booking because its quote was agreed in Lodgify. Cancel it in Lodgify instead.' } as typeof p
    }
  }
  if (!p.ok) throw new Error(p.error)
  cache.clear()
}

/**
 * Copies Lodgify bookings into booking_revenue (the revenue ledger Lana reports from), a slice at a time.
 * Every real booking is stored with its status; only confirmed (Booked) ones count as revenue, so a booking
 * that is cancelled later flips to "not revenue" the next time it is synced. Owner blocks are skipped.
 */
export async function syncRevenueLodgify(
  auth: LodgifyAuth,
  tenantId: string,
  db: import('@supabase/supabase-js').SupabaseClient,
  offset: number,
  limit: number,
): Promise<{ total: number; processed: number; nextOffset: number | null; revenueRows: number; withoutBreakdown: number }> {
  const [props, listed] = await Promise.all([loadProps(auth), listBookings(auth, 'stayFilter=All&includeCount=false')])
  if (!listed.ok) throw new Error(listed.error)
  const all = listed.rows.filter((b) => b.is_unavailable !== true).sort((a, b) => Number(a.id) - Number(b.id))
  const slice = all.slice(offset, offset + limit)
  let revenueRows = 0
  let withoutBreakdown = 0

  const rows: Record<string, unknown>[] = []
  const queue = [...slice]
  async function worker() {
    for (let b = queue.shift(); b; b = queue.shift()) {
      const status = mapLodgifyStatus(b)
      const counts = status === 'confirmed'
      let full = b
      let hasSub = b.subtotals != null
      if (counts && !hasSub) {
        const d = await lodgifyFetch(auth, `/v2/reservations/bookings/${encodeURIComponent(str(b.id))}`)
        if (d.ok && d.data) { full = d.data as Raw; hasSub = full.subtotals != null }
      }
      const sub = (full.subtotals as Raw | undefined) ?? {}
      const arrival = day(full.arrival)
      const departure = day(full.departure)
      const pid = str(full.property_id)
      if (counts) revenueRows++
      if (counts && !hasSub) withoutBreakdown++
      rows.push({
        tenant_id: tenantId,
        reservation_id: str(full.id),
        guest_name: str(guestOf(full).name) || null,
        source: sourceLabel(full) ?? null,
        channel_code: (await import('./lodgify')).channelCodes(full)[0] ?? null,
        property_id: pid || null,
        room_type: props.find((p) => p.id === pid)?.name ?? null,
        arrival: arrival || null,
        departure: departure || null,
        nights: arrival && departure ? nights(arrival, departure) : null,
        booked_on: day(full.created_at) || null,
        pms_status: status,
        counts_as_revenue: counts,
        currency: str(full.currency_code) || str((full.total_amount as Raw | undefined)?.currency_code) || 'MXN',
        // Without a breakdown the whole total is treated as the stay subtotal (no tax split known).
        stay_subtotal: hasSub ? amount(sub.stay) ?? null : amount(full.total_amount) ?? null,
        addons: hasSub ? amount(sub.addons) ?? 0 : 0,
        fees: hasSub ? amount(sub.fees) ?? 0 : 0,
        taxes: hasSub ? amount(sub.taxes) ?? 0 : 0,
        vat: hasSub ? amount(sub.vat) ?? 0 : 0,
        total: amount(full.total_amount) ?? null,
        raw_subtotals: hasSub ? sub : null,
        synced_at: new Date().toISOString(),
      })
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  if (rows.length) {
    const { error } = await db.from('booking_revenue').upsert(rows, { onConflict: 'tenant_id,reservation_id' })
    if (error) throw new Error(error.message)
  }
  const next = offset + limit
  return { total: all.length, processed: slice.length, nextOffset: next < all.length ? next : null, revenueRows, withoutBreakdown }
}
