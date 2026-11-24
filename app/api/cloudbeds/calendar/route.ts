import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { addDays, calendar, cloudbedsLinks } from '@/lib/cloudbeds-ops'
import { localDate } from '@/lib/tz'
import { lodgifyForCaller } from '@/lib/lodgify-caller'
import { calendarLodgify } from '@/lib/lodgify-ops'

export const maxDuration = 60

/** ?start=YYYY-MM-DD&days=19 (defaults: yesterday, 19 days — like Beta) */
export async function GET(request: Request) {
  const c = await cloudbedsForCaller()
  const url = new URL(request.url)
  if ('error' in c) {
    const l = await lodgifyForCaller()
    if (!l) return c.error
    const today = localDate(new Date(), l.tz)
    const sp = url.searchParams.get('start')
    const st = sp && /^\d{4}-\d{2}-\d{2}$/.test(sp) ? sp : addDays(today, -1)
    const n = Math.min(62, Math.max(7, Number(url.searchParams.get('days')) || 19))
    try {
      return NextResponse.json({ today, links: { newReservation: '' }, ...(await calendarLodgify(l.auth, st, n, today)) })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Lodgify error' }, { status: 502 })
    }
  }
  const today = localDate(new Date(), c.tz)
  const startParam = url.searchParams.get('start')
  const start = startParam && /^\d{4}-\d{2}-\d{2}$/.test(startParam) ? startParam : addDays(today, -1)
  const days = Math.min(62, Math.max(7, Number(url.searchParams.get('days')) || 19))
  try {
    const data = await calendar(c.cb, start, days)
    return NextResponse.json({ today, links: { newReservation: cloudbedsLinks(c.cb.propertyId).newReservation }, ...data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
