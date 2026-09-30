import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { searchReservations } from '@/lib/cloudbeds-ops'

export const maxDuration = 60

export async function GET(request: Request) {
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const q = new URL(request.url).searchParams.get('q') ?? ''
  try {
    return NextResponse.json({ rows: await searchReservations(c.cb, q.slice(0, 80)) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
