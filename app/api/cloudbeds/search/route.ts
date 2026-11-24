import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { searchReservations } from '@/lib/cloudbeds-ops'
import { lodgifyForCaller } from '@/lib/lodgify-caller'
import { searchLodgify } from '@/lib/lodgify-ops'
import { localDate } from '@/lib/tz'

export const maxDuration = 60

export async function GET(request: Request) {
  const c = await cloudbedsForCaller()
  const q = new URL(request.url).searchParams.get('q') ?? ''
  if ('error' in c) {
    const l = await lodgifyForCaller()
    if (!l) return c.error
    try {
      return NextResponse.json({ rows: await searchLodgify(l.auth, q.slice(0, 80), localDate(new Date(), l.tz)) })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Lodgify error' }, { status: 502 })
    }
  }
  try {
    return NextResponse.json({ rows: await searchReservations(c.cb, q.slice(0, 80)) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
