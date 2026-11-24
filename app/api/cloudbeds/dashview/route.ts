import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { cloudbedsLinks, dashSummary } from '@/lib/cloudbeds-ops'
import { localDate } from '@/lib/tz'
import { lodgifyForCaller } from '@/lib/lodgify-caller'
import { dashSummaryLodgify } from '@/lib/lodgify-ops'

export const maxDuration = 60

/** Top cards and "Today's activity" for the Dashview. */
export async function GET() {
  const c = await cloudbedsForCaller()
  if ('error' in c) {
    const l = await lodgifyForCaller()
    if (!l) return c.error
    const today = localDate(new Date(), l.tz)
    try {
      return NextResponse.json({ today, links: { newReservation: '' }, ...(await dashSummaryLodgify(l.auth, today)) })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Lodgify error' }, { status: 502 })
    }
  }
  const today = localDate(new Date(), c.tz)
  try {
    const summary = await dashSummary(c.cb, today, `${today}T00:00:00`)
    return NextResponse.json({ today, links: { newReservation: cloudbedsLinks(c.cb.propertyId).newReservation }, ...summary })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
