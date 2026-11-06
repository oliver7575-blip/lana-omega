import { NextResponse } from 'next/server'
import { runLanaWatchdog } from '@/lib/lana-reliability'

export const maxDuration = 60

/** Every 5 minutes: re-answers guests Lana missed and alerts staff about guests left waiting. */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const results = await runLanaWatchdog(new URL(request.url).origin)
  return NextResponse.json({ ranAt: new Date().toISOString(), results })
}
