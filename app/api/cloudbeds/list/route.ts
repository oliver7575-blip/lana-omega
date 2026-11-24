import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { addDays, dashList } from '@/lib/cloudbeds-ops'
import { localDate } from '@/lib/tz'
import { lodgifyForCaller } from '@/lib/lodgify-caller'
import { addDays as lAddDays, dashListLodgify } from '@/lib/lodgify-ops'

export const maxDuration = 60

/** ?tab=arrivals|departures|stayovers|inhouse&day=today|tomorrow */
export async function GET(request: Request) {
  const c = await cloudbedsForCaller()
  const url = new URL(request.url)
  const tab = url.searchParams.get('tab') ?? 'arrivals'
  if (!['arrivals', 'departures', 'stayovers', 'inhouse'].includes(tab)) {
    return NextResponse.json({ error: 'Unknown tab' }, { status: 400 })
  }
  if ('error' in c) {
    const l = await lodgifyForCaller()
    if (!l) return c.error
    const today = localDate(new Date(), l.tz)
    const day = url.searchParams.get('day') === 'tomorrow' ? lAddDays(today, 1) : today
    try {
      return NextResponse.json({ day, rows: await dashListLodgify(l.auth, tab as 'arrivals', day, today) })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Lodgify error' }, { status: 502 })
    }
  }
  const today = localDate(new Date(), c.tz)
  const day = url.searchParams.get('day') === 'tomorrow' ? addDays(today, 1) : today
  try {
    return NextResponse.json({ day, rows: await dashList(c.cb, tab as 'arrivals', day) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
