import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { cloudbedsLinks, dashSummary } from '@/lib/cloudbeds-ops'
import { localDate } from '@/lib/tz'

export const maxDuration = 60

/** Top cards and "Today's activity" for the Dashview. */
export async function GET() {
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const today = localDate(new Date(), c.tz)
  try {
    const summary = await dashSummary(c.cb, today, `${today}T00:00:00`)
    return NextResponse.json({ today, links: { newReservation: cloudbedsLinks(c.cb.propertyId).newReservation }, ...summary })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
