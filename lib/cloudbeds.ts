export interface ReservationLookupResult {
  found: boolean
  reservationID?: string
  guestName?: string
  startDate?: string
  endDate?: string
  status?: string
  roomTypeName?: string
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

    return {
      found: true,
      reservationID: match.reservationID,
      guestName: match.guestName,
      startDate: match.startDate,
      endDate: match.endDate,
      status: match.status,
      roomTypeName: match.assigned?.[0]?.roomTypeName,
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
  startDate?: string
  roomTypeName?: string
  phone?: string
}

export interface GetArrivalsResult {
  success: boolean
  arrivals: UpcomingArrival[]
  error?: string
}

function extractPhone(reservation: Record<string, unknown>): string | undefined {
  const candidates = ['phone', 'guestPhone', 'phone1', 'cellPhone']
  for (const key of candidates) {
    const value = reservation[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
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

    const arrivals: UpcomingArrival[] = reservations.map((r) => ({
      reservationID: r.reservationID as string,
      guestName: r.guestName as string | undefined,
      startDate: r.startDate as string | undefined,
      roomTypeName: (r.assigned as { roomTypeName?: string }[] | undefined)?.[0]?.roomTypeName,
      phone: extractPhone(r),
    }))

    return { success: true, arrivals }
  } catch (err) {
    return { success: false, arrivals: [], error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
