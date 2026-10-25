import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { availableRoomsOfType, getReservationDetail } from '@/lib/cloudbeds-ops'

export const maxDuration = 30

/** Physical room numbers of ?roomTypeID= that are free for this reservation's stay — for the "change room" picker. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const roomTypeID = new URL(request.url).searchParams.get('roomTypeID')
  if (!roomTypeID) return NextResponse.json({ error: 'roomTypeID is required' }, { status: 400 })
  try {
    const detail = await getReservationDetail(c.cb, id)
    const rooms = await availableRoomsOfType(c.cb, roomTypeID, detail.startDate, detail.endDate, id)
    return NextResponse.json({ rooms })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
