import { normalizePhone } from './phone'

interface CloudbedsRoom {
  roomName?: string
  roomTypeName?: string
}

interface CloudbedsGuestDetail {
  guestEmail?: string
  guestPhone?: string
  guestCellPhone?: string
  rooms?: CloudbedsRoom[]
}

function extractGuestDetail(reservation: Record<string, unknown>): CloudbedsGuestDetail | undefined {
  const guestID = reservation.guestID as string | undefined
  const guestList = reservation.guestList as Record<string, CloudbedsGuestDetail> | undefined
  if (!guestID || !guestList) return undefined
  return guestList[guestID]
}

function extractPhone(guestDetail: CloudbedsGuestDetail | undefined): string | undefined {
  if (!guestDetail) return undefined
  const phone = guestDetail.guestPhone?.trim() || guestDetail.guestCellPhone?.trim()
  return phone || undefined
}

export interface ReservationLookupResult {
  found: boolean
  reservationID?: string
  guestName?: string
  guestEmail?: string
  guestPhone?: string
  startDate?: string
  endDate?: string
  status?: string
  roomName?: string
  roomTypeName?: string
  adults?: string
  children?: string
  balance?: number
  sourceName?: string
  error?: string
}

export async function lookupReservation(
  apiKey: string,
  propertyId: string,
  confirmationNumber: string
): Promise<ReservationLookupResult> {
  try {
    const url = `https://api.cloudbeds.com/api/v1.3/getReservations?propertyID=${encodeURIComponent(propertyId)}&pageSize=100&includeGuestsDetails=true`

    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
    })

    if (!response.ok) {
      const errText = await response.text()
      return { found: false, error: `Cloudbeds API error: ${response.status} ${errText}` }
    }

    const data = await response.json()
    if (!data.success) {
      return { found: false, error: 'Cloudbeds API returned success=false' }
    }

    const reservations = data.data ?? []
    const match = reservations.find(
      (r: { thirdPartyIdentifier?: string; reservationID?: string }) =>
        r.thirdPartyIdentifier === confirmationNumber || r.reservationID === confirmationNumber
    )

    if (!match) {
      return { found: false }
    }

    const guestDetail = extractGuestDetail(match)
    const room = guestDetail?.rooms?.[0]

    return {
      found: true,
      reservationID: match.reservationID,
      guestName: match.guestName,
      guestEmail: guestDetail?.guestEmail,
      guestPhone: extractPhone(guestDetail),
      startDate: match.startDate,
      endDate: match.endDate,
      status: match.status,
      roomName: room?.roomName,
      roomTypeName: room?.roomTypeName,
      adults: match.adults,
      children: match.children,
      balance: match.balance,
      sourceName: match.sourceName,
    }
  } catch (err) {
    return { found: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export interface UpdateArrivalResult {
  success: boolean
  error?: string
}

export async function updateArrivalTime(
  apiKey: string,
  propertyId: string,
  confirmationNumber: string,
  arrivalTime: string
): Promise<UpdateArrivalResult> {
  try {
    const lookup = await lookupReservation(apiKey, propertyId, confirmationNumber)

    if (!lookup.found) {
      if (lookup.error) {
        return {
          success: false,
          error: `Could not reach the reservation system to verify this: ${lookup.error}. This is not necessarily a problem with the confirmation number.`,
        }
      }
      return { success: false, error: 'No reservation found for that confirmation number' }
    }

    if (!lookup.reservationID) {
      return { success: false, error: 'Reservation found but has no reservationID' }
    }

    const response = await fetch('https://api.cloudbeds.com/api/v1.3/putReservation', {
      method: 'PUT',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        propertyID: propertyId,
        reservationID: lookup.reservationID,
        estimatedArrivalTime: arrivalTime,
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return { success: false, error: `Cloudbeds API error: ${response.status} ${errText}` }
    }

    const data = await response.json()
    if (!data.success) {
      return { success: false, error: data.message ?? 'Cloudbeds API returned success=false' }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export interface UpcomingArrival {
  reservationID: string
  guestName?: string
  email?: string
  status?: string
  endDate?: string
  startDate?: string
  roomName?: string
  roomTypeName?: string
  phone?: string
}

export interface GetArrivalsResult {
  success: boolean
  arrivals: UpcomingArrival[]
  error?: string
}

export async function getArrivalsInWindow(
  apiKey: string,
  propertyId: string,
  date: string
): Promise<GetArrivalsResult> {
  try {
    const url = `https://api.cloudbeds.com/api/v1.3/getReservations?propertyID=${encodeURIComponent(propertyId)}&checkInFrom=${date}&checkInTo=${date}&pageSize=100&includeGuestsDetails=true`

    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
    })

    if (!response.ok) {
      const errText = await response.text()
      return { success: false, arrivals: [], error: `Cloudbeds API error: ${response.status} ${errText}` }
    }

    const data = await response.json()
    if (!data.success) {
      return { success: false, arrivals: [], error: 'Cloudbeds API returned success=false' }
    }

    const reservations = (data.data ?? []) as Record<string, unknown>[]

    const arrivals: UpcomingArrival[] = reservations.map((r) => {
      const guestDetail = extractGuestDetail(r)
      const room = guestDetail?.rooms?.[0]
      return {
        reservationID: r.reservationID as string,
        guestName: r.guestName as string | undefined,
        email: guestDetail?.guestEmail,
        status: r.status as string | undefined,
        startDate: r.startDate as string | undefined,
        endDate: r.endDate as string | undefined,
        roomName: room?.roomName,
        roomTypeName: room?.roomTypeName,
        phone: extractPhone(guestDetail),
      }
    })

    return { success: true, arrivals }
  } catch (err) {
    return { success: false, arrivals: [], error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export interface RecentDeparture {
  reservationID: string
  guestName?: string
  email?: string
  status?: string
  startDate?: string
  endDate?: string
  roomTypeName?: string
  phone?: string
}

export interface GetDeparturesResult {
  success: boolean
  departures: RecentDeparture[]
  error?: string
}

export async function getDeparturesInWindow(
  apiKey: string,
  propertyId: string,
  date: string
): Promise<GetDeparturesResult> {
  try {
    const url = `https://api.cloudbeds.com/api/v1.3/getReservations?propertyID=${encodeURIComponent(propertyId)}&pageSize=100&includeGuestsDetails=true`

    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
    })

    if (!response.ok) {
      const errText = await response.text()
      return { success: false, departures: [], error: `Cloudbeds API error: ${response.status} ${errText}` }
    }

    const data = await response.json()
    if (!data.success) {
      return { success: false, departures: [], error: 'Cloudbeds API returned success=false' }
    }

    const reservations = (data.data ?? []) as Record<string, unknown>[]
    const matching = reservations.filter((r) => r.endDate === date)

    const departures: RecentDeparture[] = matching.map((r) => {
      const guestDetail = extractGuestDetail(r)
      const room = guestDetail?.rooms?.[0]
      return {
        reservationID: r.reservationID as string,
        guestName: r.guestName as string | undefined,
        email: guestDetail?.guestEmail,
        status: r.status as string | undefined,
        startDate: r.startDate as string | undefined,
        endDate: r.endDate as string | undefined,
        roomTypeName: room?.roomTypeName,
        phone: extractPhone(guestDetail),
      }
    })

    return { success: true, departures }
  } catch (err) {
    return { success: false, departures: [], error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export interface NewReservation {
  reservationID: string
  guestName?: string
  startDate?: string
  endDate?: string
  roomTypeName?: string
  phone?: string
}

export interface GetNewReservationsResult {
  success: boolean
  reservations: NewReservation[]
  error?: string
}

export async function getRecentlyCreatedReservations(
  apiKey: string,
  propertyId: string,
  sinceHoursAgo: number
): Promise<GetNewReservationsResult> {
  try {
    const url = `https://api.cloudbeds.com/api/v1.3/getReservations?propertyID=${encodeURIComponent(propertyId)}&pageSize=100&includeGuestsDetails=true`

    const response = await fetch(url, {
      headers: { 'x-api-key': apiKey },
    })

    if (!response.ok) {
      const errText = await response.text()
      return { success: false, reservations: [], error: `Cloudbeds API error: ${response.status} ${errText}` }
    }

    const data = await response.json()
    if (!data.success) {
      return { success: false, reservations: [], error: 'Cloudbeds API returned success=false' }
    }

    const cutoff = Date.now() - sinceHoursAgo * 60 * 60 * 1000
    const all = (data.data ?? []) as Record<string, unknown>[]

    // dateCreated is a plain "YYYY-MM-DD HH:MM:SS" string with no timezone
    // marker in real data seen so far — treated as UTC here for a
    // deliberately generous cutoff window; a wrong assumption here means
    // catching a booking a bit early or late, not missing it or double
    // sending (sent_reminders dedup still protects against a repeat).
    const recent = all.filter((r) => {
      const created = r.dateCreated as string | undefined
      if (!created) return false
      const createdMs = new Date(created.replace(' ', 'T') + 'Z').getTime()
      return !Number.isNaN(createdMs) && createdMs >= cutoff
    })

    const reservations: NewReservation[] = recent.map((r) => {
      const guestDetail = extractGuestDetail(r)
      const room = guestDetail?.rooms?.[0]
      return {
        reservationID: r.reservationID as string,
        guestName: r.guestName as string | undefined,
        startDate: r.startDate as string | undefined,
        endDate: r.endDate as string | undefined,
        roomTypeName: room?.roomTypeName,
        phone: extractPhone(guestDetail),
      }
    })

    return { success: true, reservations }
  } catch (err) {
    return { success: false, reservations: [], error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export interface RoomTypePhotos {
  roomTypeName: string
  photos: string[]
}

/** Every room type with its photo URLs, straight from Cloudbeds. */
export async function getRoomTypePhotos(
  apiKey: string,
  propertyId: string
): Promise<{ success: boolean; roomTypes: RoomTypePhotos[]; error?: string }> {
  try {
    const res = await fetch(
      `https://api.cloudbeds.com/api/v1.3/getRoomTypes?propertyID=${encodeURIComponent(propertyId)}&pageSize=100`,
      { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(15000) }
    )
    if (!res.ok) {
      return { success: false, roomTypes: [], error: `Cloudbeds API error: ${res.status}` }
    }
    const data = await res.json()
    if (!data.success) return { success: false, roomTypes: [], error: 'Cloudbeds API returned success=false' }
    const roomTypes = ((data.data ?? []) as Record<string, unknown>[]).map((rt) => {
      const raw = (rt.roomTypePhotos ?? []) as unknown[]
      const photos = raw
        .map((p) => (typeof p === 'string' ? p : ((p as { image?: string; url?: string })?.image ?? (p as { url?: string })?.url)))
        .filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u))
      return { roomTypeName: String(rt.roomTypeName ?? ''), photos }
    })
    return { success: true, roomTypes }
  } catch (err) {
    return { success: false, roomTypes: [], error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

function normalizeRoomName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(room|unit|the|habitacion|cuarto|suite|with|con|de|la|el)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Picks the room type a guest meant ("rooftop", "king room", "bungalow"…). */
export function matchRoomType(query: string, roomTypes: RoomTypePhotos[]): RoomTypePhotos | undefined {
  const q = normalizeRoomName(query)
  if (!q) return undefined
  const scored = roomTypes.map((rt) => {
    const n = normalizeRoomName(rt.roomTypeName)
    if (n === q) return { rt, score: 100 }
    if (n.includes(q) || q.includes(n)) return { rt, score: 80 }
    const qWords = q.split(' ')
    const hits = qWords.filter((w) => w.length > 2 && n.split(' ').includes(w)).length
    return { rt, score: hits ? (hits / qWords.length) * 60 : 0 }
  })
  const best = scored.sort((a, b) => b.score - a.score)[0]
  return best && best.score > 0 ? best.rt : undefined
}

/** Two numbers match if one ends with the other's last 10 digits (Cloudbeds often drops the country code). */
function phonesMatch(a: string | undefined, b: string): boolean {
  const na = normalizePhone(a)
  const nb = normalizePhone(b)
  if (na.length < 8 || nb.length < 8) return false
  const tail = (x: string) => x.slice(-10)
  return na.endsWith(tail(nb)) || nb.endsWith(tail(na))
}

/**
 * Finds the guest's current or upcoming reservation from their WhatsApp
 * number (Beta's "phone match"). Returns found:false if none or several match.
 */
export async function findReservationByPhone(
  apiKey: string,
  propertyId: string,
  phone: string
): Promise<ReservationLookupResult & { matches?: number }> {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const url = `https://api.cloudbeds.com/api/v1.3/getReservations?propertyID=${encodeURIComponent(propertyId)}&checkOutFrom=${today}&pageSize=100&includeGuestsDetails=true`
    const response = await fetch(url, { headers: { 'x-api-key': apiKey }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) return { found: false, error: `Cloudbeds API error: ${response.status}` }
    const data = await response.json()
    if (!data.success) return { found: false, error: 'Cloudbeds API returned success=false' }

    const matches = ((data.data ?? []) as Record<string, unknown>[]).filter((r) => {
      const status = String(r.status ?? '').toLowerCase()
      if (['canceled', 'cancelled', 'no_show', 'checked_out'].includes(status)) return false
      return phonesMatch(extractPhone(extractGuestDetail(r)), phone)
    })
    if (matches.length !== 1) return { found: false, matches: matches.length }

    const match = matches[0]
    const guestDetail = extractGuestDetail(match)
    const room = guestDetail?.rooms?.[0]
    return {
      found: true,
      reservationID: match.reservationID as string,
      guestName: match.guestName as string | undefined,
      guestEmail: guestDetail?.guestEmail,
      guestPhone: extractPhone(guestDetail),
      startDate: match.startDate as string | undefined,
      endDate: match.endDate as string | undefined,
      status: match.status as string | undefined,
      roomName: room?.roomName,
      roomTypeName: room?.roomTypeName,
      adults: match.adults as string | undefined,
      children: match.children as string | undefined,
      balance: match.balance as number | undefined,
      sourceName: match.sourceName as string | undefined,
      matches: 1,
    }
  } catch (err) {
    return { found: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
