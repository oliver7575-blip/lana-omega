import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { pmsForTenant } from '@/lib/pms'
import { isActiveReservation, loadMessagingContext, sendGuestMessage } from '@/lib/guest-messages'

export const maxDuration = 60

function twoDaysFromNowISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  return d.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const targetDate = twoDaysFromNowISO()
  const { data: tenants } = await supabase.from('tenants').select('id')
  const results: Record<string, unknown>[] = []

  for (const tenant of tenants ?? []) {
    const pms = await pmsForTenant(supabase, tenant.id)
    if (!pms) continue

    const ctx = await loadMessagingContext(tenant.id)
    if (!ctx) continue

    const arrivals = await pms.getArrivalsInWindow(targetDate)
    if (!arrivals.success) {
      results.push({ tenantId: tenant.id, error: arrivals.error })
      continue
    }

    for (const a of arrivals.arrivals) {
      if (!isActiveReservation(a.status)) continue
      const outcome = await sendGuestMessage(ctx, 'arrival_reminder', {
        reservationID: a.reservationID,
        guestName: a.guestName,
        guestPhone: a.phone,
        guestEmail: a.email,
        startDate: a.startDate,
        endDate: a.endDate,
        roomTypeName: a.roomTypeName,
      })
      results.push({ tenantId: tenant.id, reservationID: a.reservationID, ...outcome })
    }
  }

  return NextResponse.json({ targetDate, results })
}
