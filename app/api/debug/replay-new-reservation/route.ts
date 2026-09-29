import { NextResponse } from 'next/server'
import { processNewReservation } from '@/lib/new-reservation-notify'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const tenantId = searchParams.get('tenantId') ?? 'f6598de8-83f0-4a06-add7-e1d4e80cab7a'
  const reservationID = searchParams.get('reservationID')

  if (!reservationID) {
    return NextResponse.json({ error: 'reservationID query param is required' }, { status: 400 })
  }

  const result = await processNewReservation(tenantId, reservationID)
  return NextResponse.json(result)
}
