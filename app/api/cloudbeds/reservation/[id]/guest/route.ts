import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { getGuestProfile, getReservationRaw } from '@/lib/cloudbeds-ops'

export const maxDuration = 30

/** The guest's full Cloudbeds profile (home phone, country, email preferences, ID, notes…) for a reservation. */
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  try {
    const raw = await getReservationRaw(c.cb, id)
    const guestID = raw.guestID as string | undefined
    if (!guestID) return NextResponse.json({ error: 'No guest profile on this reservation.' }, { status: 404 })
    const profile = await getGuestProfile(c.cb, guestID)
    return NextResponse.json({ profile })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
