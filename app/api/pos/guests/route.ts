import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { inHouseGuests } from '@/lib/cloudbeds-pos'

export const maxDuration = 30

/** Guests currently checked in (the only ones a room charge may go to). */
export async function GET() {
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  try {
    return NextResponse.json({ guests: await inHouseGuests(c.cb) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load guests' }, { status: 502 })
  }
}
