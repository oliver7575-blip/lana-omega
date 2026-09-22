export interface ReservationLookupResult {
  found: boolean
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
