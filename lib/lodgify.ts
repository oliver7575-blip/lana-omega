/**
 * Lodgify Public API client (https://api.lodgify.com, X-ApiKey header).
 *
 * Field names follow Lodgify's published v2 docs (bookings list/get,
 * properties/{id}/rooms, webhooks v1). Like the Cloudbeds code, anything
 * marked "verify" must be checked against a real raw booking from the
 * hotel's account (app/api/debug/lodgify-raw) before relying on it — reads
 * here are deliberately defensive so a renamed field degrades to "unknown",
 * never to a crash.
 */
import { normalizePhone } from './phone'
import type {
  GetArrivalsResult,
  GetDeparturesResult,
  GetNewReservationsResult,
  ReservationLookupResult,
  RoomTypePhotos,
} from './cloudbeds'

const BASE = 'https://api.lodgify.com'
const PAGE_SIZE = 50
const MAX_PAGES = 10

export interface LodgifyAuth {
  apiKey: string
  /** Optional: limit everything to one Lodgify property (accounts can hold several). */
  propertyId?: string
}

type Raw = Record<string, unknown>

async function lodgifyFetch(auth: LodgifyAuth, path: string, init?: RequestInit): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'X-ApiKey': auth.apiKey,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(15000),
  })
  const text = await res.text()
  if (!res.ok) return { ok: false, status: res.status, error: `Lodgify API error: ${res.status} ${text.slice(0, 300)}` }
  try {
    return { ok: true, data: text ? JSON.parse(text) : null }
  } catch {
    return { ok: false, status: res.status, error: 'Lodgify returned a response that is not JSON' }
  }
}

// ---- Booking → Lana's reservation shape ---------------------------------------

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined
  const s = String(v).trim()
  return s ? s : undefined
}

/**
 * Lodgify statuses (Open = enquiry, Tentative, Booked, Declined) mapped onto
 * the lowercase words the rest of Omega already understands.
 */
export function mapLodgifyStatus(b: Raw): string {
  if (b.canceled_at || b.is_deleted === true) return 'canceled'
  const s = String(b.status ?? '').toLowerCase()
  if (s === 'booked') return 'confirmed'
  if (s === 'declined') return 'canceled'
  if (s === 'open') return 'enquiry'
  return s || 'unknown'
}

function guestOf(b: Raw): Raw {
  return (b.guest as Raw | undefined) ?? {}
}

/** verify: the v2 list example shows only name/email; the schema lists phone. */
function phoneOf(b: Raw): string | undefined {
  const g = guestOf(b)
  return str(g.phone) ?? str(g.phone_number) ?? str(g.mobile)
}

function amount(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && 'amount' in v) {
    const n = Number((v as { amount: unknown }).amount)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function peopleOf(b: Raw): { adults?: string; children?: string } {
  const rooms = (b.rooms as Raw[] | undefined) ?? []
  let adults = 0
  let children = 0
  let seen = false
  for (const r of rooms) {
    const gb = r.guest_breakdown as Raw | undefined
    if (gb) {
      seen = true
      adults += Number(gb.adults ?? 0) || 0
      children += (Number(gb.children ?? 0) || 0) + (Number(gb.infants ?? 0) || 0)
    } else if (r.people !== undefined) {
      seen = true
      adults += Number(r.people) || 0
    }
  }
  return seen ? { adults: String(adults), children: String(children) } : {}
}

/**
 * Lodgify `source` values → the channel names guests and staff use.
 * (Real data: "AirbnbIntegration", "BookingCom", "Manual".)
 */
const SOURCE_LABELS: Record<string, string> = {
  airbnb: 'Airbnb',
  airbnbintegration: 'Airbnb',
  bookingcom: 'Booking.com',
  expedia: 'Expedia',
  homeaway: 'Vrbo',
  nineflats: '9flats',
  oh: 'Website',
  manual: 'Direct (entered manually)',
  publicapi: 'Direct (API)',
  email: 'Email',
  facebookmessenger: 'Facebook Messenger',
  ical: 'iCal',
  other: 'Other',
}

export function sourceLabel(b: Raw): string | undefined {
  const source = str(b.source)
  if (!source) return undefined
  return SOURCE_LABELS[source.toLowerCase()] ?? source
}

/**
 * The channel's own confirmation number(s), which guests quote far more often
 * than Lodgify's id. Real data: Airbnb puts JSON in source_text with
 * "confirmationCode"; Booking.com puts "resNumber|otherNumber".
 */
export function channelCodes(b: Raw): string[] {
  const text = str(b.source_text)
  if (!text) return []
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text) as Record<string, unknown>
      return [str(j.confirmationCode), str(j.reservationId), str(j.reservation_id)].filter((c): c is string => !!c)
    } catch {
      return []
    }
  }
  return text
    .split(/[|,;\s]+/)
    .map((c) => c.trim())
    .filter((c) => /^[A-Za-z0-9-]{4,}$/.test(c))
}

export function toLookupResult(b: Raw, roomNames?: Map<string, string>): ReservationLookupResult {
  const g = guestOf(b)
  const firstRoom = ((b.rooms as Raw[] | undefined) ?? [])[0]
  const roomTypeId = str(firstRoom?.room_type_id)
  return {
    found: true,
    reservationID: str(b.id),
    guestName: str(g.name),
    guestEmail: str(g.email),
    guestPhone: phoneOf(b),
    startDate: str(b.arrival)?.slice(0, 10),
    endDate: str(b.departure)?.slice(0, 10),
    status: mapLodgifyStatus(b),
    roomTypeName: roomTypeId ? (roomNames?.get(roomTypeId) ?? undefined) : undefined,
    ...peopleOf(b),
    balance: amount(b.amount_due),
    sourceName: sourceLabel(b),
    channelConfirmation: channelCodes(b)[0],
  }
}

function inProperty(auth: LodgifyAuth, b: Raw): boolean {
  return !auth.propertyId || String(b.property_id ?? '') === auth.propertyId
}

// ---- Reads -----------------------------------------------------------------------

async function listBookings(auth: LodgifyAuth, query: string): Promise<{ ok: true; rows: Raw[] } | { ok: false; error: string }> {
  const rows: Raw[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await lodgifyFetch(auth, `/v2/reservations/bookings?${query}&page=${page}&size=${PAGE_SIZE}`)
    if (!r.ok) return { ok: false, error: r.error }
    const data = r.data as { items?: Raw[] } | Raw[] | null
    const batch = Array.isArray(data) ? data : (data?.items ?? [])
    rows.push(...batch.filter((b) => inProperty(auth, b)))
    if (batch.length < PAGE_SIZE) break
  }
  return { ok: true, rows }
}

/** Room type id → name for the configured property (cached briefly). */
const roomNameCache = new Map<string, { at: number; names: Map<string, string>; photos: RoomTypePhotos[] }>()

async function loadRooms(auth: LodgifyAuth): Promise<{ names: Map<string, string>; photos: RoomTypePhotos[]; error?: string }> {
  const key = `${auth.propertyId ?? 'all'}:${auth.apiKey.slice(-6)}`
  const hit = roomNameCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit

  const propertyIds: string[] = []
  if (auth.propertyId) propertyIds.push(auth.propertyId)
  else {
    const props = await lodgifyFetch(auth, '/v2/properties?page=1&size=50')
    if (!props.ok) return { names: new Map(), photos: [], error: props.error }
    const d = props.data as { items?: Raw[] } | Raw[] | null
    for (const p of Array.isArray(d) ? d : (d?.items ?? [])) if (p.id !== undefined) propertyIds.push(String(p.id))
  }

  const names = new Map<string, string>()
  const photos: RoomTypePhotos[] = []
  for (const pid of propertyIds.slice(0, 20)) {
    const r = await lodgifyFetch(auth, `/v2/properties/${encodeURIComponent(pid)}/rooms`)
    if (!r.ok) continue
    const list = Array.isArray(r.data) ? (r.data as Raw[]) : (((r.data as { items?: Raw[] })?.items) ?? [])
    for (const room of list) {
      const id = str(room.id)
      const name = str(room.name) ?? ''
      if (id) names.set(id, name)
      const urls = [
        ...(((room.images as Raw[] | undefined) ?? []).map((i) => str(i.url))),
        str(room.image_url),
      ].filter((u): u is string => !!u && /^https?:\/\//.test(u))
      photos.push({ roomTypeName: name, photos: Array.from(new Set(urls)) })
    }
  }
  const entry = { at: Date.now(), names, photos }
  roomNameCache.set(key, entry)
  return entry
}

async function roomNames(auth: LodgifyAuth): Promise<Map<string, string>> {
  try {
    return (await loadRooms(auth)).names
  } catch {
    return new Map()
  }
}

export async function lookupReservation(auth: LodgifyAuth, confirmationNumber: string): Promise<ReservationLookupResult> {
  try {
    const raw = String(confirmationNumber ?? '').trim().replace(/^#/, '')
    if (!raw) return { found: false }

    // 1. Lodgify's own booking id (shown as "B12345" in places).
    const asId = raw.replace(/^B(?=\d+$)/i, '')
    if (/^\d{1,9}$/.test(asId)) {
      const r = await lodgifyFetch(auth, `/v2/reservations/bookings/${asId}`)
      if (r.ok) {
        const b = r.data as Raw | null
        if (b && b.id !== undefined && inProperty(auth, b)) return toLookupResult(b, await roomNames(auth))
      } else if (r.status !== 404 && r.status !== 400) {
        return { found: false, error: r.error }
      }
    }

    // 2. A channel confirmation number (Booking.com, Airbnb, …) on a current
    //    or upcoming stay.
    const wanted = raw.toLowerCase()
    if (!/^[a-z0-9-]{4,}$/.test(wanted)) return { found: false }
    const [current, upcoming] = await Promise.all([
      listBookings(auth, 'stayFilter=Current'),
      listBookings(auth, 'stayFilter=Upcoming'),
    ])
    if (!current.ok) return { found: false, error: current.error }
    if (!upcoming.ok) return { found: false, error: upcoming.error }
    const hits = [...current.rows, ...upcoming.rows].filter((b) =>
      channelCodes(b).some((c) => c.toLowerCase() === wanted)
    )
    // Prefer a live booking over a cancelled copy of the same code.
    const best = hits.find((b) => mapLodgifyStatus(b) !== 'canceled') ?? hits[0]
    return best ? toLookupResult(best, await roomNames(auth)) : { found: false }
  } catch (err) {
    return { found: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

function phonesMatch(a: string | undefined, b: string): boolean {
  const na = normalizePhone(a)
  const nb = normalizePhone(b)
  if (na.length < 8 || nb.length < 8) return false
  const tail = (x: string) => x.slice(-10)
  return na.endsWith(tail(nb)) || nb.endsWith(tail(na))
}

export async function findReservationByPhone(auth: LodgifyAuth, phone: string): Promise<ReservationLookupResult & { matches?: number }> {
  try {
    const [current, upcoming] = await Promise.all([
      listBookings(auth, 'stayFilter=Current'),
      listBookings(auth, 'stayFilter=Upcoming'),
    ])
    if (!current.ok) return { found: false, error: current.error }
    if (!upcoming.ok) return { found: false, error: upcoming.error }
    const seen = new Set<string>()
    const matches = [...current.rows, ...upcoming.rows].filter((b) => {
      const id = String(b.id)
      if (seen.has(id)) return false
      seen.add(id)
      const status = mapLodgifyStatus(b)
      if (status === 'canceled' || status === 'enquiry') return false
      return phonesMatch(phoneOf(b), phone)
    })
    if (matches.length !== 1) return { found: false, matches: matches.length }
    return { ...toLookupResult(matches[0], await roomNames(auth)), matches: 1 }
  } catch (err) {
    return { found: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

async function bookingsOnDate(auth: LodgifyAuth, filter: 'ArrivalDate' | 'DepartureDate', date: string) {
  const list = await listBookings(auth, `stayFilter=${filter}&stayFilterDate=${encodeURIComponent(date)}`)
  if (!list.ok) return list
  const field = filter === 'ArrivalDate' ? 'arrival' : 'departure'
  // Belt and braces: keep only exact-date matches even if the filter is looser than documented.
  return { ok: true as const, rows: list.rows.filter((b) => String(b[field] ?? '').slice(0, 10) === date) }
}

export async function getArrivalsInWindow(auth: LodgifyAuth, date: string): Promise<GetArrivalsResult> {
  try {
    const list = await bookingsOnDate(auth, 'ArrivalDate', date)
    if (!list.ok) return { success: false, arrivals: [], error: list.error }
    const names = await roomNames(auth)
    return {
      success: true,
      arrivals: list.rows.map((b) => {
        const r = toLookupResult(b, names)
        return {
          reservationID: r.reservationID ?? '',
          guestName: r.guestName,
          email: r.guestEmail,
          status: r.status,
          startDate: r.startDate,
          endDate: r.endDate,
          roomTypeName: r.roomTypeName,
          phone: r.guestPhone,
        }
      }),
    }
  } catch (err) {
    return { success: false, arrivals: [], error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getDeparturesInWindow(auth: LodgifyAuth, date: string): Promise<GetDeparturesResult> {
  try {
    const list = await bookingsOnDate(auth, 'DepartureDate', date)
    if (!list.ok) return { success: false, departures: [], error: list.error }
    const names = await roomNames(auth)
    return {
      success: true,
      departures: list.rows.map((b) => {
        const r = toLookupResult(b, names)
        return {
          reservationID: r.reservationID ?? '',
          guestName: r.guestName,
          email: r.guestEmail,
          status: r.status,
          startDate: r.startDate,
          endDate: r.endDate,
          roomTypeName: r.roomTypeName,
          phone: r.guestPhone,
        }
      }),
    }
  } catch (err) {
    return { success: false, departures: [], error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getRecentlyCreatedReservations(auth: LodgifyAuth, sinceHoursAgo: number): Promise<GetNewReservationsResult> {
  try {
    const cutoff = Date.now() - sinceHoursAgo * 3600 * 1000
    const since = new Date(cutoff).toISOString()
    const list = await listBookings(auth, `stayFilter=All&updatedSince=${encodeURIComponent(since)}`)
    if (!list.ok) return { success: false, reservations: [], error: list.error }
    const names = await roomNames(auth)
    return {
      success: true,
      reservations: list.rows
        .filter((b) => {
          const created = Date.parse(String(b.created_at ?? ''))
          return Number.isFinite(created) && created >= cutoff && mapLodgifyStatus(b) === 'confirmed'
        })
        .map((b) => {
          const r = toLookupResult(b, names)
          return {
            reservationID: r.reservationID ?? '',
            guestName: r.guestName,
            startDate: r.startDate,
            endDate: r.endDate,
            roomTypeName: r.roomTypeName,
            phone: r.guestPhone,
          }
        }),
    }
  } catch (err) {
    return { success: false, reservations: [], error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function getRoomTypePhotos(auth: LodgifyAuth): Promise<{ success: boolean; roomTypes: RoomTypePhotos[]; error?: string }> {
  try {
    const rooms = await loadRooms(auth)
    if (rooms.error && rooms.photos.length === 0) return { success: false, roomTypes: [], error: rooms.error }
    return { success: true, roomTypes: rooms.photos }
  } catch (err) {
    return { success: false, roomTypes: [], error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/** Health check: the key is accepted and (if set) the property exists. */
export async function testConnection(auth: LodgifyAuth): Promise<{ ok: boolean; detail?: string; error?: string }> {
  const r = await lodgifyFetch(auth, '/v2/reservations/bookings?stayFilter=Upcoming&page=1&size=1')
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'Lodgify rejected the API key (check Settings → Public API, and that the plan includes API access)' }
    return { ok: false, error: r.error }
  }
  if (auth.propertyId) {
    const rooms = await lodgifyFetch(auth, `/v2/properties/${encodeURIComponent(auth.propertyId)}/rooms`)
    if (!rooms.ok) return { ok: false, error: `API key works, but property ${auth.propertyId} was not found in this Lodgify account` }
  }
  return { ok: true, detail: 'API reachable, key accepted' }
}

/** One raw booking, unmodified — for checking real field names (debug only). */
export async function getBookingRaw(auth: LodgifyAuth, id: string) {
  return lodgifyFetch(auth, `/v2/reservations/bookings/${encodeURIComponent(id)}`)
}

/** The account's properties with their ids and names (debug only). */
export async function listPropertiesRaw(auth: LodgifyAuth) {
  return lodgifyFetch(auth, '/v2/properties?page=1&size=50')
}

/** The first few upcoming bookings, raw (debug only). */
export async function listUpcomingRaw(auth: LodgifyAuth, size = 3) {
  return lodgifyFetch(auth, `/v2/reservations/bookings?stayFilter=Upcoming&page=1&size=${size}`)
}

// ---- Webhooks (v1) -------------------------------------------------------------

export async function listWebhooks(auth: LodgifyAuth) {
  return lodgifyFetch(auth, '/webhooks/v1/list')
}

export async function subscribeWebhook(auth: LodgifyAuth, event: string, targetUrl: string) {
  return lodgifyFetch(auth, '/webhooks/v1/subscribe', {
    method: 'POST',
    body: JSON.stringify({ target_url: targetUrl, event }),
  })
}

export async function unsubscribeWebhook(auth: LodgifyAuth, id: string) {
  return lodgifyFetch(auth, '/webhooks/v1/unsubscribe', {
    method: 'DELETE',
    body: JSON.stringify({ id }),
  })
}
