import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { lodgifyForCaller } from '@/lib/lodgify-caller'
import { availabilityLodgify } from '@/lib/lodgify-ops'
import { allRoomsByType, availability, availableRoomsOfType, bookingOptions } from '@/lib/cloudbeds-ops'

export const maxDuration = 60

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * ?options=1 → booking sources and payment methods
 * ?start&end&adults&children → available room types with prices
 */
export async function GET(request: Request) {
  const c = await cloudbedsForCaller()
  const url = new URL(request.url)
  if ('error' in c) {
    const l = await lodgifyForCaller()
    if (!l) return c.error
    try {
      if (url.searchParams.get('options')) return NextResponse.json({ pms: 'lodgify', sources: [], paymentMethods: [] })
      if (url.searchParams.get('allRooms')) return NextResponse.json({ groups: [] })
      const start = url.searchParams.get('start') ?? ''
      const end = url.searchParams.get('end') ?? ''
      if (!DATE.test(start) || !DATE.test(end) || end <= start) return NextResponse.json({ error: 'Check-out must be after check-in' }, { status: 400 })
      const adults = Math.max(1, Math.min(12, Number(url.searchParams.get('adults')) || 1))
      const children = Math.max(0, Math.min(12, Number(url.searchParams.get('children')) || 0))
      return NextResponse.json({ roomTypes: await availabilityLodgify(l.auth, start, end, adults, children) })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Lodgify error' }, { status: 502 })
    }
  }
  try {
    if (url.searchParams.get('options')) return NextResponse.json(await bookingOptions(c.cb))
    if (url.searchParams.get('allRooms')) return NextResponse.json({ groups: await allRoomsByType(c.cb) })
    const start = url.searchParams.get('start') ?? ''
    const end = url.searchParams.get('end') ?? ''
    if (!DATE.test(start) || !DATE.test(end) || end <= start) {
      return NextResponse.json({ error: 'Check-out must be after check-in' }, { status: 400 })
    }
    const typeID = url.searchParams.get('roomTypeID')
    if (url.searchParams.get('freeRooms') && typeID) {
      return NextResponse.json({ rooms: await availableRoomsOfType(c.cb, typeID, start, end, '') })
    }
    const adults = Math.max(1, Math.min(12, Number(url.searchParams.get('adults')) || 1))
    const children = Math.max(0, Math.min(12, Number(url.searchParams.get('children')) || 0))
    return NextResponse.json({ roomTypes: await availability(c.cb, start, end, adults, children) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
