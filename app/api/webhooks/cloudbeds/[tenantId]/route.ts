import { NextResponse, after } from 'next/server'
import { processNewReservation } from '@/lib/new-reservation-notify'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params
  const body = (await request.json()) as Record<string, unknown>

  const reservationID = body.reservationID as string | undefined
  const event = body.event as string | undefined

  if (reservationID && event === 'reservation/created') {
    after(() => processNewReservation(tenantId, reservationID))
  }

  return NextResponse.json({ received: true })
}
