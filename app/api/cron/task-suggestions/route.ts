import { NextResponse } from 'next/server'
import { runWeeklyTaskSuggestions } from '@/lib/maintenance-suggestions'

export const maxDuration = 60

/** Monday morning: Lana sends the owner this week's suggested task tweaks. */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({ ranAt: new Date().toISOString(), results: await runWeeklyTaskSuggestions() })
}
