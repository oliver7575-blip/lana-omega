import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials } from '@/lib/crypto'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const reservationID = searchParams.get('reservationID')
  if (!reservationID) {
    return NextResponse.json({ error: 'reservationID query param is required' }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: cloudbedsIntegration } = await supabase
    .from('tenant_integrations')
    .select('credentials, config')
    .eq('tenant_id', 'f6598de8-83f0-4a06-add7-e1d4e80cab7a')
    .eq('integration_type', 'pms_cloudbeds')
    .maybeSingle()

  if (!cloudbedsIntegration) {
    return NextResponse.json({ error: 'No Cloudbeds integration found' }, { status: 404 })
  }

  const { api_key } = decryptCredentials<{ api_key: string }>(cloudbedsIntegration.credentials)
  const propertyId = (cloudbedsIntegration.config as { property_id?: string })?.property_id

  const url = `https://api.cloudbeds.com/api/v1.3/getReservations?propertyID=${encodeURIComponent(propertyId ?? '')}&pageSize=100&includeGuestsDetails=true`
  const response = await fetch(url, { headers: { 'x-api-key': api_key } })
  const data = await response.json()

  const match = (data.data ?? []).find(
    (r: { reservationID?: string }) => r.reservationID === reservationID
  )

  if (!match) {
    return NextResponse.json({ error: 'Reservation not found in response', allIDs: (data.data ?? []).map((r: { reservationID?: string }) => r.reservationID) })
  }

  return NextResponse.json({ rawReservation: match })
}
