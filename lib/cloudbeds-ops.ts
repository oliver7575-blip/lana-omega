/**
 * Cloudbeds reads and actions for the panel's Dashview and Calendar
 * (the same features as Beta's Cloudbeds pages).
 */
const BASE = 'https://api.cloudbeds.com/api/v1.3'

export interface CB {
  apiKey: string
  propertyId: string
}

type Json = Record<string, unknown>

async function cbGet(cb: CB, method: string, params: Record<string, string | number | boolean | undefined>): Promise<Json> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const res = await fetch(`${BASE}/${method}?${qs}`, {
    headers: { 'x-api-key': cb.apiKey },
    signal: AbortSignal.timeout(20000),
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`Cloudbeds ${method} failed: ${res.status}`)
  const json = (await res.json()) as Json
  if (json.success === false) throw new Error(`Cloudbeds ${method}: ${(json.message as string) ?? 'error'}`)
  return json
}

/** PUT with PHP-style form fields (Cloudbeds expects x-www-form-urlencoded). */
async function cbPut(cb: CB, method: string, fields: Record<string, string>): Promise<Json> {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'PUT',
    headers: { 'x-api-key': cb.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ propertyID: cb.propertyId, ...fields }),
    signal: AbortSignal.timeout(20000),
  })
  const json = (await res.json().catch(() => ({}))) as Json
  if (!res.ok || json.success === false) {
    throw new Error((json.message as string) ?? `Cloudbeds ${method} failed: ${res.status}`)
  }
  return json
}

async function cbPost(cb: CB, method: string, fields: Record<string, string>): Promise<Json> {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'x-api-key': cb.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ propertyID: cb.propertyId, ...fields }),
    signal: AbortSignal.timeout(20000),
  })
  const json = (await res.json().catch(() => ({}))) as Json
  if (!res.ok || json.success === false) {
    throw new Error((json.message as string) ?? `Cloudbeds ${method} failed: ${res.status}`)
  }
  return json
}

/** All pages of getReservations (max 5 × 100). */
async function listReservations(cb: CB, params: Record<string, string | number | boolean | undefined>, maxPages = 5): Promise<Json[]> {
  const out: Json[] = []
  for (let page = 1; page <= maxPages; page++) {
    const json = await cbGet(cb, 'getReservations', { propertyID: cb.propertyId, pageSize: 100, pageNumber: page, ...params })
    const data = (json.data as Json[]) ?? []
    out.push(...data)
    if (data.length < 100) break
  }
  return out
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        results[idx] = await fn(items[idx])
      }
    })
  )
  return results
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const nightsBetween = (a?: string, b?: string) =>
  a && b ? Math.max(0, Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)) : 0

/** Cloudbeds reports room statuses in its own words ("in_house", "not_checked_in"…). */
function stayStatus(roomStatus: unknown, reservationStatus: unknown): string {
  const rs = String(roomStatus ?? '').toLowerCase().replace(/[\s-]+/g, '_')
  const res = String(reservationStatus ?? '').toLowerCase()
  if (rs === 'in_house' || rs === 'checked_in' || rs === 'inhouse') return 'checked_in'
  if (rs === 'checked_out' || rs === 'checkedout') return 'checked_out'
  return res || 'confirmed'
}

const ACTIVE = (s: unknown) => !['canceled', 'cancelled', 'no_show'].includes(String(s ?? '').toLowerCase())

// ---------------------------------------------------------------------------
// Single reservation
// ---------------------------------------------------------------------------

export interface ReservationDetail {
  reservationID: string
  guestName: string
  guestEmail: string | null
  status: string
  source: string | null
  startDate: string
  endDate: string
  adults: number
  children: number
  rooms: { subReservationID: string; reservationRoomID: string | null; roomID: string | null; roomTypeID: string; roomTypeName: string; roomName: string | null; startDate: string; endDate: string; adults: number; children: number }[]
  total: number | null
  balance: number | null
  estimatedArrivalTime: string | null
}

/** The raw getReservation record (used by payments to read source, balance and deposit fields). */
export async function getReservationRaw(cb: CB, reservationID: string): Promise<Json> {
  const json = await cbGet(cb, 'getReservation', { propertyID: cb.propertyId, reservationID })
  return (json.data ?? {}) as Json
}

export async function getReservationDetail(cb: CB, reservationID: string): Promise<ReservationDetail> {
  const json = await cbGet(cb, 'getReservation', { propertyID: cb.propertyId, reservationID })
  const d = (json.data ?? {}) as Json
  const assigned = ((d.assigned as Json[]) ?? []).map((r) => ({
    subReservationID: String(r.subReservationID ?? ''),
    reservationRoomID: (r.reservationRoomID as string) ?? null,
    roomID: (r.roomID as string) ?? null,
    roomTypeID: String(r.roomTypeID ?? ''),
    roomTypeName: String(r.roomTypeName ?? ''),
    roomName: (r.roomName as string) ?? null,
    startDate: String(r.startDate ?? d.startDate ?? ''),
    endDate: String(r.endDate ?? d.endDate ?? ''),
    adults: Number(r.adults ?? 0),
    children: Number(r.children ?? 0),
  }))
  const unassigned = ((d.unassigned as Json[]) ?? []).map((r) => ({
    subReservationID: String(r.subReservationID ?? ''),
    reservationRoomID: (r.reservationRoomID as string) ?? null,
    roomID: null,
    roomTypeID: String(r.roomTypeID ?? ''),
    roomTypeName: String(r.roomTypeName ?? ''),
    roomName: null,
    startDate: String(r.startDate ?? d.startDate ?? ''),
    endDate: String(r.endDate ?? d.endDate ?? ''),
    adults: Number(r.adults ?? 0),
    children: Number(r.children ?? 0),
  }))
  const rooms = [...assigned, ...unassigned]
  return {
    reservationID: String(d.reservationID ?? reservationID),
    guestName: String(d.guestName ?? ''),
    guestEmail: (d.guestEmail as string) ?? null,
    status: String(d.status ?? ''),
    source: (d.source as string) ?? null,
    startDate: String(d.startDate ?? ''),
    endDate: String(d.endDate ?? ''),
    adults: rooms.reduce((s, r) => s + r.adults, 0),
    children: rooms.reduce((s, r) => s + r.children, 0),
    rooms,
    total: typeof d.total === 'number' ? d.total : d.total ? Number(d.total) : null,
    balance: typeof d.balance === 'number' ? d.balance : d.balance ? Number(d.balance) : null,
    estimatedArrivalTime: (d.estimatedArrivalTime as string) || null,
  }
}

/**
 * Checks a reservation in — but only if none of its rooms still has another
 * guest checked in (they must be checked out first).
 */
export async function checkIn(cb: CB, reservationID: string) {
  const r = await getReservationDetail(cb, reservationID)
  for (const room of r.rooms) {
    if (!room.roomID) continue
    const occupants = await listReservations(cb, { roomID: room.roomID, status: 'checked_in' })
    const other = occupants.find((o) => String(o.reservationID) !== reservationID)
    if (other) {
      throw new Error(
        `Room ${room.roomName ?? room.roomID} still has ${other.guestName ?? 'another guest'} checked in (#${other.reservationID}). Check them out first.`
      )
    }
  }
  await cbPut(cb, 'putReservation', { reservationID, status: 'checked_in' })
}

export async function setStatus(cb: CB, reservationID: string, status: 'checked_out' | 'confirmed' | 'canceled') {
  await cbPut(cb, 'putReservation', { reservationID, status })
}

/** Takes the reservation out of one room (or all its rooms), back to "unassigned". */
export async function unassignRoom(cb: CB, reservationID: string, roomID?: string) {
  const r = await getReservationDetail(cb, reservationID)
  const targets = r.rooms.filter((x) => x.roomID && (!roomID || x.roomID === roomID))
  if (targets.length === 0) throw new Error('This reservation has no assigned room to remove')
  for (const room of targets) {
    await cbPost(cb, 'postRoomAssign', {
      reservationID,
      subReservationID: room.subReservationID,
      reservationRoomID: room.reservationRoomID ?? '',
      newRoomID: '',
    })
  }
}

export async function setArrivalTime(cb: CB, reservationID: string, time: string) {
  await cbPut(cb, 'putReservation', { reservationID, estimatedArrivalTime: time })
}

/** Moves every room of the reservation to the new stay dates. */
export async function setStayDates(cb: CB, reservationID: string, checkin: string, checkout: string) {
  const r = await getReservationDetail(cb, reservationID)
  if (r.rooms.length === 0) throw new Error('This reservation has no rooms to update')
  const fields: Record<string, string> = { reservationID }
  r.rooms.forEach((room, i) => {
    fields[`rooms[${i}][subReservationID]`] = room.subReservationID
    fields[`rooms[${i}][roomTypeID]`] = room.roomTypeID
    fields[`rooms[${i}][checkinDate]`] = checkin
    fields[`rooms[${i}][checkoutDate]`] = checkout
    fields[`rooms[${i}][adults]`] = String(room.adults || 1)
    fields[`rooms[${i}][children]`] = String(room.children || 0)
  })
  await cbPut(cb, 'putReservation', fields)
}

// ---------------------------------------------------------------------------
// Dashview
// ---------------------------------------------------------------------------

export interface DashRow {
  reservationID: string
  guestName: string
  room: string
  arrivalTime: string | null
  status: string
  startDate: string
  endDate: string
}

function roomLabel(r: Json): string {
  const rooms = (r.rooms as Json[]) ?? []
  const names = rooms.map((x) => x.roomName).filter(Boolean) as string[]
  if (names.length) return [...new Set(names)].join(', ')
  const types = rooms.map((x) => x.roomTypeName).filter(Boolean) as string[]
  return types.length ? `${[...new Set(types)].join(', ')} (unassigned)` : '—'
}

export async function dashList(cb: CB, tab: 'arrivals' | 'departures' | 'stayovers' | 'inhouse', day: string): Promise<DashRow[]> {
  let params: Record<string, string | boolean> = { includeAllRooms: true }
  if (tab === 'arrivals') params = { ...params, checkInFrom: day, checkInTo: day }
  if (tab === 'departures') params = { ...params, checkOutFrom: day, checkOutTo: day }
  if (tab === 'stayovers') params = { ...params, checkInTo: addDays(day, -1), checkOutFrom: addDays(day, 1) }
  if (tab === 'inhouse') params = { ...params, status: 'checked_in' }
  const list = (await listReservations(cb, params)).filter((r) => ACTIVE(r.status))

  // Arrival times only come with the full reservation.
  const times = tab === 'arrivals'
    ? await mapLimit(list.slice(0, 40), 5, async (r) => {
        try {
          return (await getReservationDetail(cb, String(r.reservationID))).estimatedArrivalTime
        } catch {
          return null
        }
      })
    : []

  return list.map((r, i) => ({
    reservationID: String(r.reservationID),
    guestName: String(r.guestName ?? ''),
    room: roomLabel(r),
    arrivalTime: times[i] ?? null,
    status: String(r.status ?? ''),
    startDate: String(r.startDate ?? ''),
    endDate: String(r.endDate ?? ''),
  }))
}

export interface ActivityRow {
  reservationID: string
  guestName: string
  revenue: number | null
  checkIn: string
  nights: number
  status: string
}

export async function dashSummary(cb: CB, today: string, dayStartIso: string) {
  const [dash, sales, cancels, stayovers] = await Promise.all([
    cbGet(cb, 'getDashboard', { propertyID: cb.propertyId, date: today }).catch(() => ({ data: {} })),
    listReservations(cb, { resultsFrom: dayStartIso.replace('T', ' ').slice(0, 19) }),
    listReservations(cb, { status: 'canceled', modifiedFrom: dayStartIso.replace('T', ' ').slice(0, 19) }),
    // Checked in and staying at least one more night.
    listReservations(cb, { status: 'checked_in', checkOutFrom: addDays(today, 1) }),
  ])
  const d = (dash.data ?? {}) as Json

  const detail = async (r: Json): Promise<ActivityRow> => {
    let total: number | null = null
    try {
      total = (await getReservationDetail(cb, String(r.reservationID))).total
    } catch {
      total = null
    }
    return {
      reservationID: String(r.reservationID),
      guestName: String(r.guestName ?? ''),
      revenue: total,
      checkIn: String(r.startDate ?? ''),
      nights: nightsBetween(r.startDate as string, r.endDate as string),
      status: String(r.status ?? ''),
    }
  }
  const salesRows = await mapLimit(sales.filter((r) => ACTIVE(r.status)).slice(0, 30), 5, detail)
  const cancelRows = await mapLimit(cancels.slice(0, 30), 5, detail)

  return {
    arrivals: Number(d.arrivals ?? 0),
    departures: Number(d.departures ?? 0),
    stayovers: stayovers.length,
    inHouse: Number(d.inHouse ?? 0),
    roomsOccupied: Number(d.roomsOccupied ?? 0),
    percentageOccupied: Number(d.percentageOccupied ?? 0),
    sales: {
      count: salesRows.length,
      roomNights: salesRows.reduce((s, r) => s + r.nights, 0),
      revenue: salesRows.reduce((s, r) => s + (r.revenue ?? 0), 0),
      rows: salesRows,
    },
    cancellations: {
      count: cancelRows.length,
      roomNights: cancelRows.reduce((s, r) => s + r.nights, 0),
      revenue: cancelRows.reduce((s, r) => s + (r.revenue ?? 0), 0),
      rows: cancelRows,
    },
  }
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface CalendarData {
  start: string
  days: string[]
  roomTypes: {
    id: string
    name: string
    rates: Record<string, number>
    rooms: { id: string; name: string }[]
  }[]
  bookings: {
    reservationID: string
    guestName: string
    status: string
    roomID: string
    start: string
    end: string
  }[]
  unassigned: { reservationID: string; guestName: string; roomTypeID: string; start: string; end: string; status: string }[]
  blocks: { roomID: string; start: string; end: string; reason: string }[]
  overbookings: { roomID: string; reservationIDs: string[] }[]
}

export async function calendar(cb: CB, start: string, dayCount: number): Promise<CalendarData> {
  const end = addDays(start, dayCount)
  const days = Array.from({ length: dayCount }, (_, i) => addDays(start, i))

  const [roomsJson, reservations, blocksJson, ratesJson] = await Promise.all([
    cbGet(cb, 'getRooms', { propertyIDs: cb.propertyId, pageSize: 100 }),
    listReservations(cb, { checkInTo: end, checkOutFrom: start, includeAllRooms: true }),
    (async () => {
      const all: Json[] = []
      for (let offset = 0; offset < dayCount; offset += 34) {
        const j = await cbGet(cb, 'getRoomBlocks', {
          propertyID: cb.propertyId,
          startDate: addDays(start, offset),
          endDate: addDays(start, Math.min(offset + 33, dayCount)),
        }).catch(() => ({ data: {} }))
        all.push(...((((j.data ?? {}) as Json).roomBlocks as Json[]) ?? []))
      }
      const seen = new Set<string>()
      return { data: { roomBlocks: all.filter((b) => { const k = String(b.roomBlockID); if (seen.has(k)) return false; seen.add(k); return true }) } }
    })(),
    cbGet(cb, 'getRatePlans', { propertyIDs: cb.propertyId, startDate: start, endDate: end, detailedRates: true }).catch(() => ({ data: [] })),
  ])

  // Rooms grouped by room type, in Cloudbeds order.
  const typeMap = new Map<string, CalendarData['roomTypes'][number]>()
  for (const prop of (roomsJson.data as Json[]) ?? []) {
    for (const r of (prop.rooms as Json[]) ?? []) {
      if (r.isVirtual) continue
      const id = String(r.roomTypeID)
      if (!typeMap.has(id)) typeMap.set(id, { id, name: String(r.roomTypeName ?? ''), rates: {}, rooms: [] })
      typeMap.get(id)!.rooms.push({ id: String(r.roomID), name: String(r.roomName ?? '') })
    }
  }
  for (const t of typeMap.values()) {
    t.rooms.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  }

  // Base (non-derived, no promo) rate per room type per night.
  for (const rp of (ratesJson.data as Json[]) ?? []) {
    const t = typeMap.get(String(rp.roomTypeID))
    if (!t || rp.isDerived || rp.promoCode) continue
    for (const day of (rp.roomRateDetailed as Json[]) ?? []) {
      const date = String(day.date)
      const rate = Number(day.rateBase ?? day.totalRate ?? 0)
      if (!(date in t.rates) || rate < t.rates[date]) t.rates[date] = rate
    }
  }

  const bookings: CalendarData['bookings'] = []
  const unassigned: CalendarData['unassigned'] = []
  for (const r of reservations) {
    if (!ACTIVE(r.status)) continue
    for (const room of (r.rooms as Json[]) ?? []) {
      const s = String(room.roomCheckIn ?? r.startDate)
      const e = String(room.roomCheckOut ?? r.endDate)
      if (room.roomID) {
        bookings.push({ reservationID: String(r.reservationID), guestName: String(room.guestName ?? r.guestName ?? ''), status: stayStatus(room.roomStatus, r.status), roomID: String(room.roomID), start: s, end: e })
      } else {
        unassigned.push({ reservationID: String(r.reservationID), guestName: String(r.guestName ?? ''), roomTypeID: String(room.roomTypeID ?? ''), start: s, end: e, status: String(r.status) })
      }
    }
  }

  const blocks: CalendarData['blocks'] = []
  for (const b of (((blocksJson.data ?? {}) as Json).roomBlocks as Json[]) ?? []) {
    for (const room of (b.rooms as Json[]) ?? []) {
      blocks.push({ roomID: String(room.roomID), start: String(b.startDate), end: String(b.endDate), reason: String(b.roomBlockReason ?? b.roomBlockType ?? 'Blocked') })
    }
  }

  // Two stays in the same room on the same night.
  const overbookings: CalendarData['overbookings'] = []
  const byRoom = new Map<string, CalendarData['bookings']>()
  for (const b of bookings) byRoom.set(b.roomID, [...(byRoom.get(b.roomID) ?? []), b])
  for (const [roomID, list] of byRoom) {
    const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start))
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start < sorted[i - 1].end && sorted[i].reservationID !== sorted[i - 1].reservationID) {
        overbookings.push({ roomID, reservationIDs: [sorted[i - 1].reservationID, sorted[i].reservationID] })
      }
    }
  }

  return { start, days, roomTypes: [...typeMap.values()], bookings, unassigned, blocks, overbookings }
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchReservations(cb: CB, q: string): Promise<DashRow[]> {
  const term = q.trim()
  if (!term) return []
  if (/^\d{5,}$/.test(term)) {
    try {
      const r = await getReservationDetail(cb, term)
      return [{ reservationID: r.reservationID, guestName: r.guestName, room: r.rooms.map((x) => x.roomName ?? x.roomTypeName).join(', '), arrivalTime: r.estimatedArrivalTime, status: r.status, startDate: r.startDate, endDate: r.endDate }]
    } catch {
      return []
    }
  }
  const parts = term.split(/\s+/)
  const queries: Record<string, string>[] = parts.length > 1
    ? [{ firstName: parts[0], lastName: parts.slice(1).join(' ') }, { lastName: term }]
    : [{ lastName: term }, { firstName: term }]
  const seen = new Map<string, DashRow>()
  for (const params of queries) {
    const list = await listReservations(cb, { ...params, includeAllRooms: true }).catch(() => [])
    for (const r of list) {
      const id = String(r.reservationID)
      if (!seen.has(id)) {
        seen.set(id, { reservationID: id, guestName: String(r.guestName ?? ''), room: roomLabel(r), arrivalTime: null, status: String(r.status ?? ''), startDate: String(r.startDate ?? ''), endDate: String(r.endDate ?? '') })
      }
    }
  }
  return [...seen.values()].sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 50)
}

/**
 * Finds a reservation from the number a guest quotes: a Booking.com / Airbnb /
 * Expedia confirmation number (Cloudbeds keeps it as thirdPartyIdentifier) or
 * Cloudbeds' own reservation id. A check-in date, when known, narrows the search.
 */
export async function findReservationByConfirmation(
  cb: CB,
  confirmation: string,
  checkInHint?: string | null
): Promise<{ reservationID: string } | null> {
  const num = confirmation.trim()
  if (!num) return null
  const today = new Date().toISOString().slice(0, 10)
  const windows: Record<string, string>[] = []
  if (checkInHint && /^\d{4}-\d{2}-\d{2}$/.test(checkInHint)) windows.push({ checkInFrom: checkInHint, checkInTo: checkInHint })
  windows.push({ checkInFrom: addDays(today, -2), checkInTo: addDays(today, 540) })
  for (const w of windows) {
    const list = await listReservations(cb, w, 10).catch(() => [] as Json[])
    const hit = list.find((r) => String(r.thirdPartyIdentifier ?? '') === num || String(r.reservationID ?? '') === num)
    if (hit) return { reservationID: String(hit.reservationID) }
  }
  if (/^\d{6,}$/.test(num)) {
    try {
      const d = await getReservationDetail(cb, num)
      if (d.reservationID) return { reservationID: d.reservationID }
    } catch {
      // not a Cloudbeds id
    }
  }
  return null
}

/** Writes the guest's expected arrival time (HH:MM) onto the reservation in Cloudbeds. */
export async function setEstimatedArrival(cb: CB, reservationID: string, time: string): Promise<void> {
  await cbPut(cb, 'putReservation', { reservationID, estimatedArrivalTime: time })
}

export function cloudbedsLinks(propertyId: string) {
  return {
    newReservation: `https://hotels.cloudbeds.com/connect/${propertyId}#/newReservation`,
    reservation: (id: string) => `https://hotels.cloudbeds.com/connect/${propertyId}#/reservations/${id}`,
  }
}

// ---------------------------------------------------------------------------
// New reservations
// ---------------------------------------------------------------------------

export interface AvailableRoomType {
  roomTypeID: string
  name: string
  maxGuests: number
  roomsAvailable: number
  total: number | null
  roomRateID: string | null
  ratePlan: string | null
  rooms: { roomID: string; roomName: string }[]
}

/** Room types free for the dates and party size, with the price for the stay. */
export async function availability(cb: CB, start: string, end: string, adults: number, children: number): Promise<AvailableRoomType[]> {
  const json = await cbGet(cb, 'getAvailableRoomTypes', {
    propertyIDs: cb.propertyId,
    startDate: start,
    endDate: end,
    rooms: 1,
    adults,
    children,
    pageSize: 100,
  })
  const out: AvailableRoomType[] = []
  for (const prop of (json.data as Json[]) ?? []) {
    for (const rt of (prop.propertyRooms as Json[]) ?? []) {
      if (Number(rt.roomsAvailable ?? 0) < 1) continue
      out.push({
        roomTypeID: String(rt.roomTypeID),
        name: String(rt.roomTypeName ?? ''),
        maxGuests: Number(rt.maxGuests ?? 0),
        roomsAvailable: Number(rt.roomsAvailable ?? 0),
        total: rt.roomRate !== undefined && rt.roomRate !== null ? Number(rt.roomRate) : null,
        roomRateID: rt.roomRateID ? String(rt.roomRateID) : null,
        ratePlan: (rt.ratePlanNamePublic as string) || null,
        rooms: ((rt.individualRooms as Json[]) ?? []).map((r) => ({ roomID: String(r.roomID), roomName: String(r.roomName ?? '') })),
      })
    }
  }
  return out.sort((a, b) => (a.total ?? 0) - (b.total ?? 0))
}

/** Booking sources and payment methods set up in Cloudbeds. */
export async function bookingOptions(cb: CB) {
  const [sources, payments] = await Promise.all([
    cbGet(cb, 'getSources', { propertyIDs: cb.propertyId }).catch(() => ({ data: [] })),
    cbGet(cb, 'getPaymentMethods', { propertyID: cb.propertyId }).catch(() => ({ data: {} })),
  ])
  const pd = (payments.data ?? {}) as Json
  return {
    sources: ((sources.data as Json[]) ?? [])
      .filter((s) => !s.isThirdParty)
      .map((s) => ({ id: String(s.sourceID), name: String(s.sourceName ?? '') })),
    paymentMethods: ((pd.methods as Json[]) ?? []).map((m) => ({ code: String(m.method ?? m.code ?? ''), name: String(m.name ?? m.method ?? '') })),
  }
}

export interface NewReservation {
  startDate: string
  endDate: string
  adults: number
  children: number
  roomTypeID: string
  roomID?: string
  roomRateID?: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  country: string
  arrivalTime?: string
  sourceID?: string
  paymentMethod: string
  sendEmail: boolean
}

/** Creates the reservation in Cloudbeds and returns its reservation ID. */
export async function createReservation(cb: CB, r: NewReservation): Promise<string> {
  const f: Record<string, string> = {
    startDate: r.startDate,
    endDate: r.endDate,
    guestFirstName: r.firstName,
    guestLastName: r.lastName,
    guestEmail: r.email,
    guestCountry: r.country.toUpperCase(),
    paymentMethod: r.paymentMethod,
    sendEmailConfirmation: r.sendEmail ? 'true' : 'false',
    'rooms[0][roomTypeID]': r.roomTypeID,
    'rooms[0][quantity]': '1',
    'adults[0][roomTypeID]': r.roomTypeID,
    'adults[0][quantity]': String(r.adults),
    'children[0][roomTypeID]': r.roomTypeID,
    'children[0][quantity]': String(r.children),
  }
  if (r.phone) f.guestPhone = r.phone
  if (r.arrivalTime) f.estimatedArrivalTime = r.arrivalTime
  if (r.sourceID) f.sourceID = r.sourceID
  if (r.roomRateID) f['rooms[0][roomRateID]'] = r.roomRateID
  if (r.roomID) {
    f['rooms[0][roomID]'] = r.roomID
    f['adults[0][roomID]'] = r.roomID
    f['children[0][roomID]'] = r.roomID
  }
  const json = await cbPost(cb, 'postReservation', f)
  const id = (json.reservationID ?? (json.data as Json | undefined)?.reservationID) as string | undefined
  if (!id) throw new Error('Cloudbeds did not return a reservation number')
  return String(id)
}
