import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { pmsForTenant } from '@/lib/pms'
import { isActiveReservation, loadMessagingContext, sendGuestMessage } from '@/lib/guest-messages'

export const maxDuration = 60

function yesterdayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const targetDate = yesterdayISO()
  // Only hotels that turned post-stay messages on in Settings.
  const { data: tenants } = await supabase.from('tenants').select('id').eq('post_stay_enabled', true)
  const results: Record<string, unknown>[] = []

  for (const tenant of tenants ?? []) {
    const pms = await pmsForTenant(supabase, tenant.id)
    if (!pms) continue

    const ctx = await loadMessagingContext(tenant.id)
    if (!ctx) continue

    const departures = await pms.getDeparturesInWindow(targetDate)
    if (!departures.success) {
      results.push({ tenantId: tenant.id, error: departures.error })
      continue
    }

    for (const d of departures.departures) {
      if (!isActiveReservation(d.status)) continue
      const outcome = await sendGuestMessage(ctx, 'post_stay', {
        reservationID: d.reservationID,
        guestName: d.guestName,
        guestPhone: d.phone,
        guestEmail: d.email,
        startDate: d.startDate,
        endDate: d.endDate,
        roomTypeName: d.roomTypeName,
      })
      results.push({ tenantId: tenant.id, reservationID: d.reservationID, ...outcome })
    }
  }

  return NextResponse.json({ targetDate, results })
}
