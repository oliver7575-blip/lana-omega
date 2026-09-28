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
    const url = `https://api.cloudbeds.com/api/v1.3/getReservations?propertyID=${encodeURIComponent(propertyId)}&pageSize=100`

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
      (r: { thirdPartyIdentifier?: string }) => r.thirdPartyIdentifier === confirmationNumber
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
      // lookup.error is only set when the lookup call itself failed (e.g. an
      // invalid API key or a Cloudbeds outage) — a genuinely wrong
      // confirmation number leaves it unset. These need different guidance:
      // one is worth asking the guest to double-check, the other is not.
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
