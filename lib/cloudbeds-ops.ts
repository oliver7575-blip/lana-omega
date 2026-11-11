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
  guestPhone: string | null
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
  guestCountry: string | null
  guestID: string | null
  /** When the reservation was made, as Cloudbeds reports it. */
  dateCreated: string | null
  /** The channel's own confirmation code (Airbnb / Booking.com / Expedia…). */
  confirmationCode: string | null
  /** Free-text the guest sent with the booking, if any. */
  specialRequests: string | null
  /** Cloudbeds' own split of the total: room subtotal, extras, taxes & fees, paid. */
  breakdown: { subTotal: number | null; additionalItems: number | null; taxesFees: number | null; paid: number | null }
}

export interface ReservationNote { author: string; date: string; text: string }

/** The notes staff have written on a reservation in Cloudbeds. */
export async function getReservationNotes(cb: CB, reservationID: string): Promise<ReservationNote[]> {
  const json = await cbGet(cb, 'getReservationNotes', { propertyID: cb.propertyId, reservationID })
  return ((json.data as Json[]) ?? [])
    .map((n) => ({
      author: String(n.userName ?? n.user ?? '').trim(),
      date: String(n.dateCreated ?? n.dateModified ?? '').trim(),
      text: String(n.reservationNote ?? n.note ?? '').trim(),
    }))
    .filter((n) => n.text)
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
  // Contact details live on the guest entry of guestList, not at the top level.
  const guestEntry = (d.guestList as Record<string, Json> | undefined)?.[String(d.guestID ?? '')] ?? {}
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    reservationID: String(d.reservationID ?? reservationID),
    guestName: String(d.guestName ?? ''),
    guestEmail: text(d.guestEmail) ?? text(guestEntry.guestEmail),
    guestPhone: text(d.guestPhone) ?? text(d.guestCellPhone) ?? text(guestEntry.guestPhone) ?? text(guestEntry.guestCellPhone),
    guestCountry: text(d.guestCountry) ?? text(guestEntry.guestCountry),
    guestID: text(d.guestID),
    dateCreated: text(d.dateCreated),
    confirmationCode: text(d.thirdPartyIdentifier),
    specialRequests: text(d.specialRequests) ?? text(d.guestSpecialRequests),
    breakdown: (() => {
      const b = (d.balanceDetailed ?? {}) as Json
      const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
      return { subTotal: num(b.subTotal), additionalItems: num(b.additionalItems), taxesFees: num(b.taxesFees), paid: num(b.paid) }
    })(),
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

/** Moves one room of the reservation to a different physical room (same action Cloudbeds uses to unassign, with a target instead of blank). */
export async function assignRoom(
  cb: CB,
  reservationID: string,
  subReservationID: string,
  reservationRoomID: string | null,
  newRoomID: string
) {
  await cbPost(cb, 'postRoomAssign', { reservationID, subReservationID, reservationRoomID: reservationRoomID ?? '', newRoomID })
}

export interface AvailableRoom {
  id: string
  name: string
}

/**
 * Free physical rooms for [start, end), grouped by room type. A room is taken when an active
 * reservation overlaps those nights or a block covers any of them (a block's end date is inclusive).
 */
export async function freeRoomsByType(cb: CB, start: string, end: string, excludeReservationID = ''): Promise<Map<string, AvailableRoom[]>> {
  const [roomsJson, reservations, blocksJson] = await Promise.all([
    cbGet(cb, 'getRooms', { propertyIDs: cb.propertyId, pageSize: 100 }),
    listReservations(cb, { checkInTo: end, checkOutFrom: start, includeAllRooms: true }),
    cbGet(cb, 'getRoomBlocks', { propertyID: cb.propertyId, startDate: start, endDate: end }).catch(() => ({ data: {} })),
  ])

  const occupied = new Set<string>()
  for (const r of reservations) {
    if (!ACTIVE(r.status) || String(r.reservationID) === excludeReservationID) continue
    for (const room of (r.rooms as Json[]) ?? []) {
      if (!room.roomID) continue
      const s = String(room.roomCheckIn ?? r.startDate)
      const e = String(room.roomCheckOut ?? r.endDate)
      if (s < end && e > start) occupied.add(String(room.roomID))
    }
  }
  for (const b of (((blocksJson.data ?? {}) as Json).roomBlocks as Json[]) ?? []) {
    if (!(String(b.startDate) < end && String(b.endDate) >= start)) continue
    for (const room of (b.rooms as Json[]) ?? []) occupied.add(String(room.roomID))
  }

  const out = new Map<string, AvailableRoom[]>()
  for (const prop of (roomsJson.data as Json[]) ?? []) {
    for (const r of (prop.rooms as Json[]) ?? []) {
      if (r.isVirtual) continue
      const id = String(r.roomID)
      const typeID = String(r.roomTypeID)
      if (!out.has(typeID)) out.set(typeID, [])
      if (!occupied.has(id)) out.get(typeID)!.push({ id, name: String(r.roomName ?? '') })
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return out
}

/** Physical rooms of a room type that are free for [start, end) — for the panel's "change room" picker. */
export async function availableRoomsOfType(
  cb: CB,
  roomTypeID: string,
  start: string,
  end: string,
  excludeReservationID: string
): Promise<AvailableRoom[]> {
  return (await freeRoomsByType(cb, start, end, excludeReservationID)).get(roomTypeID) ?? []
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
  blocks: { roomBlockID: string; type: string; roomID: string; start: string; end: string; reason: string }[]
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
      blocks.push({ roomBlockID: String(b.roomBlockID ?? ''), type: String(b.roomBlockType ?? ''), roomID: String(room.roomID), start: String(b.startDate), end: String(b.endDate), reason: String(b.roomBlockReason ?? b.roomBlockType ?? 'Blocked') })
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
// Reservations list (the panel's Reservations page)
// ---------------------------------------------------------------------------

export interface ReservationRoomRef {
  roomTypeID: string
  roomTypeName: string
  roomID: string | null
  roomName: string | null
}

export interface ReservationSummary {
  reservationID: string
  guestID: string | null
  guestName: string
  /** Day the reservation was made (YYYY-MM-DD), '' when unknown. */
  bookedOn: string
  startDate: string
  endDate: string
  status: string
  total: number | null
  rooms: ReservationRoomRef[]
}

function roomRefs(r: Json): ReservationRoomRef[] {
  return ((r.rooms as Json[]) ?? []).map((x) => ({
    roomTypeID: String(x.roomTypeID ?? ''),
    roomTypeName: String(x.roomTypeName ?? ''),
    roomID: (x.roomID as string) || null,
    roomName: (x.roomName as string) || null,
  }))
}

/** A page of reservations, most recently BOOKED first, for the panel's Reservations list. */
export async function listReservationsSummary(
  cb: CB,
  page: number
): Promise<{ rows: ReservationSummary[]; hasMore: boolean }> {
  const pageSize = 50
  // Cheap: list fields only, up to 1000 reservations, then sort by booking date —
  // Cloudbeds' own pageNumber order isn't booking-date order, so this has to be
  // pulled and sorted here rather than paginated directly from the API.
  const all = await listReservations(cb, { includeAllRooms: true, status: 'confirmed' }, 10)
  const sorted = all
    .map((r) => ({
      reservationID: String(r.reservationID ?? ''),
      guestID: (r.guestID as string) ?? null,
      guestName: String(r.guestName ?? ''),
      startDate: String(r.startDate ?? ''),
      endDate: String(r.endDate ?? ''),
      status: String(r.status ?? ''),
      rooms: roomRefs(r),
      dateCreated: String(r.dateCreated ?? ''),
    }))
    .sort((a, b) => b.dateCreated.localeCompare(a.dateCreated))
  const start = (Math.max(1, page) - 1) * pageSize
  const slice = sorted.slice(start, start + pageSize)

  // Amount isn't on the list response — one detail call per shown row, bounded concurrency.
  const totals = await mapLimit(slice, 8, async (r) => {
    try {
      return (await getReservationDetail(cb, r.reservationID)).total
    } catch {
      return null
    }
  })
  const rows: ReservationSummary[] = slice.map(({ dateCreated, ...r }, i) => ({ ...r, bookedOn: dateCreated.slice(0, 10), total: totals[i] }))
  return { rows, hasMore: start + pageSize < sorted.length }
}

/** Every field Cloudbeds holds on a guest's profile — home phone, country, email preferences, ID, notes, etc. */
export async function getGuestProfile(cb: CB, guestID: string): Promise<Record<string, unknown>> {
  const json = await cbGet(cb, 'getGuest', { propertyID: cb.propertyId, guestID })
  return (json.data ?? {}) as Json
}

/**
 * The guest's phone/email, read the way the rest of the app already reads
 * them reliably: nested at getReservations' guestList[guestID] (confirmed
 * against real data) — NOT flat on getReservation/getGuest, which don't
 * carry it the same way for this account.
 */
export async function getReservationGuestContact(
  cb: CB,
  reservationID: string
): Promise<{ phone: string | null; email: string | null; country: string | null }> {
  const json = await cbGet(cb, 'getReservations', {
    propertyID: cb.propertyId,
    reservationID,
    includeGuestsDetails: true,
    pageSize: 1,
  })
  const match = ((json.data as Json[]) ?? [])[0]
  if (!match) return { phone: null, email: null, country: null }
  const guestID = match.guestID as string | undefined
  const guestList = (match.guestList as Record<string, Json>) ?? {}
  const g = guestID ? guestList[guestID] : undefined
  const phone = ((g?.guestPhone as string) || (g?.guestCellPhone as string) || '').trim() || null
  const email = ((g?.guestEmail as string) || '').trim() || null
  const country = ((g?.guestCountry as string) || (match.guestCountry as string) || '').trim() || null
  return { phone, email, country }
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
  // Counted per room type from the physical rooms, so a type's number never includes other categories.
  const free = await freeRoomsByType(cb, start, end).catch(() => null)
  const out: AvailableRoomType[] = []
  for (const prop of (json.data as Json[]) ?? []) {
    for (const rt of (prop.propertyRooms as Json[]) ?? []) {
      const own = free?.get(String(rt.roomTypeID))
      if ((own ? own.length : Number(rt.roomsAvailable ?? 0)) < 1) continue
      out.push({
        roomTypeID: String(rt.roomTypeID),
        name: String(rt.roomTypeName ?? ''),
        maxGuests: Number(rt.maxGuests ?? 0),
        roomsAvailable: free?.get(String(rt.roomTypeID)) ? free.get(String(rt.roomTypeID))!.length : Number(rt.roomsAvailable ?? 0),
        total: rt.roomRate !== undefined && rt.roomRate !== null ? Number(rt.roomRate) : null,
        roomRateID: rt.roomRateID ? String(rt.roomRateID) : null,
        ratePlan: (rt.ratePlanNamePublic as string) || null,
        rooms: free?.get(String(rt.roomTypeID))
          ? free.get(String(rt.roomTypeID))!.map((r) => ({ roomID: r.id, roomName: r.name }))
          : ((rt.individualRooms as Json[]) ?? []).map((r) => ({ roomID: String(r.roomID), roomName: String(r.roomName ?? '') })),
      })
    }
  }
  return out.sort((a, b) => (a.total ?? 0) - (b.total ?? 0))
}

/**
 * Cloudbeds (API v1.3) only accepts "s-{id}" for primary sources and "ss-{id}-0|1" for
 * third-party ones. Older shapes ("12", "s-12-1") are converted; anything else is dropped
 * so the booking falls back to the property's default source instead of failing.
 */
export function normalizeSourceId(raw: unknown): string | null {
  const v = String(raw ?? '').trim()
  if (/^s-\d+$/.test(v) || /^ss-\d+-[01]$/.test(v)) return v
  const primary = v.match(/^s-(\d+)-\d$/) ?? v.match(/^(\d+)$/)
  return primary ? `s-${primary[1]}` : null
}

/** Finds every source entry in a getSources response, whether it is a flat list or grouped (e.g. per property). */
function collectSources(node: unknown, depth = 0): Json[] {
  if (!node || depth > 4) return []
  if (Array.isArray(node)) return node.flatMap((n) => collectSources(n, depth + 1))
  if (typeof node === 'object') {
    const o = node as Json
    if ('sourceID' in o || 'sourceId' in o) return [o]
    return Object.values(o).flatMap((v) => collectSources(v, depth + 1))
  }
  return []
}

/** Booking sources and payment methods set up in Cloudbeds. */
export async function bookingOptions(cb: CB) {
  let sourcesError: string | null = null
  const [sources, payments] = await Promise.all([
    cbGet(cb, 'getSources', { propertyIDs: cb.propertyId }).catch((err) => {
      sourcesError = err instanceof Error ? err.message : 'failed'
      console.error('[cloudbeds] getSources failed', err)
      return { data: [] } as Json
    }),
    cbGet(cb, 'getPaymentMethods', { propertyID: cb.propertyId }).catch(() => ({ data: {} })),
  ])
  const pd = (payments.data ?? {}) as Json
  return {
    sourcesError,
    sources: collectSources(sources.data)
      .filter((s) => !s.isThirdParty && s.status !== false && s.status !== 'false')
      .map((s) => ({ id: normalizeSourceId(s.sourceID ?? s.sourceId), name: String(s.sourceName ?? s.name ?? '').trim() }))
      .filter((s): s is { id: string; name: string } => Boolean(s.id))
      .map((s) => ({ ...s, name: s.name || s.id })),
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
  /** Price the staff member wants for the whole stay, when it differs from the set price. */
  customTotal?: number
  /** The set price for the whole stay shown when the room was chosen. */
  listTotal?: number
}

/** Creates the reservation in Cloudbeds and returns its reservation ID. */
export async function createReservation(cb: CB, r: NewReservation): Promise<{ id: string; priceWarning?: string }> {
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
  const sourceID = normalizeSourceId(r.sourceID)
  if (sourceID) f.sourceID = sourceID
  if (r.roomRateID) f['rooms[0][roomRateID]'] = r.roomRateID
  if (r.roomID) {
    f['rooms[0][roomID]'] = r.roomID
    f['adults[0][roomID]'] = r.roomID
    f['children[0][roomID]'] = r.roomID
  }
  const json = await cbPost(cb, 'postReservation', f)
  const id = (json.reservationID ?? (json.data as Json | undefined)?.reservationID) as string | undefined
  if (!id) throw new Error('Cloudbeds did not return a reservation number')
  const out: { id: string; priceWarning?: string } = { id: String(id) }

  // Cloudbeds books at the set rate; a different price is applied as a rate adjustment (Cloudbeds subtracts the amount, so we send set total minus new total).
  if (r.customTotal != null && r.listTotal != null) {
    const delta = Math.round((r.customTotal - r.listTotal) * 100) / 100
    if (Math.abs(delta) >= 0.01) {
      try {
        await cbPost(cb, 'postAdjustment', {
          reservationID: out.id,
          type: 'rate',
          // Cloudbeds treats a positive adjustment amount as a reduction of the rate, so the sign is flipped.
          amount: String(-delta),
          notes: `Price set when booking: MXN ${r.customTotal} (set price MXN ${r.listTotal})`,
        })
        // Read the reservation back so a wrong total is noticed instead of silently left in Cloudbeds.
        try {
          const actual = (await getReservationDetail(cb, out.id)).total
          console.log('[cloudbeds] custom price', JSON.stringify({ reservationID: out.id, listTotal: r.listTotal, customTotal: r.customTotal, delta, actualTotal: actual }))
          if (actual != null && Math.abs(actual - r.customTotal) > 1) {
            out.priceWarning = `Cloudbeds shows a total of ${Math.round(actual).toLocaleString('en-US')} for this reservation, but you asked for ${Math.round(r.customTotal).toLocaleString('en-US')}. Please check it in Cloudbeds.`
          }
        } catch {
          // Reading back is best-effort.
        }
      } catch (err) {
        out.priceWarning = `The reservation was created at the set price, but the custom price could not be applied (${err instanceof Error ? err.message : 'Cloudbeds error'}). Please adjust it in Cloudbeds.`
      }
    }
  }
  return out
}

/** Blocks a room for the given dates ("blocked_dates") or takes it out of service, without a reservation. */
export async function createRoomBlock(
  cb: CB,
  b: { roomID: string; startDate: string; endDate: string; type: 'blocked_dates' | 'out_of_service'; reason?: string }
): Promise<void> {
  await cbPost(cb, 'postRoomBlock', {
    roomBlockType: b.type,
    roomBlockReason: b.reason?.trim() || (b.type === 'out_of_service' ? 'Out of service' : 'Blocked'),
    startDate: b.startDate,
    endDate: b.endDate,
    'rooms[0][roomID]': b.roomID,
  })
}

/** Every physical room grouped by room type — for blocking dates, where availability shouldn't gate the choice. */
export async function allRoomsByType(cb: CB): Promise<{ typeName: string; rooms: { id: string; name: string }[] }[]> {
  const json = await cbGet(cb, 'getRooms', { propertyIDs: cb.propertyId, pageSize: 100 })
  const types = new Map<string, { typeName: string; rooms: { id: string; name: string }[] }>()
  for (const prop of (json.data as Json[]) ?? []) {
    for (const r of (prop.rooms as Json[]) ?? []) {
      if (r.isVirtual) continue
      const id = String(r.roomTypeID)
      if (!types.has(id)) types.set(id, { typeName: String(r.roomTypeName ?? 'Rooms'), rooms: [] })
      types.get(id)!.rooms.push({ id: String(r.roomID), name: String(r.roomName ?? '') })
    }
  }
  for (const t of types.values()) t.rooms.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  return [...types.values()]
}

/** Removes a room block (all rooms that share it) so the dates open up again. */
export async function deleteRoomBlock(cb: CB, roomBlockID: string): Promise<void> {
  const params = { propertyID: cb.propertyId, roomBlockID }
  const attempts: { label: string; run: () => Promise<Response> }[] = [
    { label: 'DELETE query', run: () => fetch(`${BASE}/deleteRoomBlock?${new URLSearchParams(params)}`, { method: 'DELETE', headers: { 'x-api-key': cb.apiKey }, signal: AbortSignal.timeout(20000) }) },
    { label: 'DELETE form', run: () => fetch(`${BASE}/deleteRoomBlock`, { method: 'DELETE', headers: { 'x-api-key': cb.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20000) }) },
    { label: 'POST form', run: () => fetch(`${BASE}/deleteRoomBlock`, { method: 'POST', headers: { 'x-api-key': cb.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(20000) }) },
  ]
  const errors: string[] = []
  for (const a of attempts) {
    const res = await a.run().catch((e) => null as Response | null)
    if (!res) { errors.push(`${a.label}: no response`); continue }
    const text = await res.text()
    let json: Json = {}
    try { json = JSON.parse(text) as Json } catch { /* not json */ }
    if (res.ok && json.success !== false) return
    const msg = (json.message as string) ?? text.slice(0, 160)
    console.error('[deleteRoomBlock]', a.label, res.status, msg)
    errors.push(`${a.label} ${res.status}: ${msg}`)
  }
  throw new Error(`Cloudbeds wouldn't remove the block (${errors.join(' | ')})`)
}
