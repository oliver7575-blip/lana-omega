import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { runTenantTick } from '@/lib/maintenance-engine'
import { runLanaWatchdog } from '@/lib/lana-reliability'
import { runWeeklyTaskSuggestions } from '@/lib/maintenance-suggestions'

export const maxDuration = 60

/** Runs every 5 minutes: rolls missed recurring tasks forward and sends due reminders. */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = createServiceClient()
  const { data: tenants } = await db.from('tenants').select('id')
  const results = []
  for (const t of tenants ?? []) {
    try {
      results.push(await runTenantTick(t.id as string))
    } catch (err) {
      results.push({ tenantId: t.id, error: err instanceof Error ? err.message : 'failed' })
    }
  }
  // Same 5-minute heartbeat also watches the guest inbox (re-answers missed guests, alerts staff).
  let watchdog: unknown = null
  try {
    watchdog = await runLanaWatchdog(new URL(request.url).origin)
  } catch (err) {
    watchdog = { error: err instanceof Error ? err.message : 'failed' }
  }
  // Monday mornings the same heartbeat sends the owner the weekly task suggestions (a no-op the rest of the week).
  let suggestions: unknown = null
  try {
    suggestions = await runWeeklyTaskSuggestions()
  } catch (err) {
    suggestions = { error: err instanceof Error ? err.message : 'failed' }
  }
  return NextResponse.json({ ranAt: new Date().toISOString(), results, watchdog, suggestions })
}
