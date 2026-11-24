import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { pmsForTenant } from '@/lib/pms'
import { isActiveReservation, loadMessagingContext, sendGuestMessage } from '@/lib/guest-messages'
import { getReservationDetail } from '@/lib/cloudbeds-ops'

export const maxDuration = 60

const HOURS_AFTER_ARRIVAL_INFO = 12 // last-minute bookings get the arrival info moments ago — don't nag them straight away

function tomorrowISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Day before check-in: asks guests who haven't given an arrival time to let us know. */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const targetDate = tomorrowISO()
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

    const cutoff = new Date(Date.now() - HOURS_AFTER_ARRIVAL_INFO * 3600_000).toISOString()
    for (const a of arrivals.arrivals) {
      if (!isActiveReservation(a.status)) continue

      // Only guests who already got the arrival information, at least ~half a day ago.
      const { data: info } = await supabase
        .from('sent_reminders')
        .select('sent_at')
        .eq('tenant_id', tenant.id)
        .eq('reservation_id', a.reservationID)
        .in('message_type', ['arrival_reminder', 'arrival_reminder_email'])
        .lte('sent_at', cutoff)
        .limit(1)
      if (!info?.length) {
        results.push({ tenantId: tenant.id, reservationID: a.reservationID, skipped: 'Arrival information not sent 12h+ ago' })
        continue
      }

      // Already told us when they arrive? Then there's nothing to ask.
      if (pms.cloudbeds) {
        const detail = await getReservationDetail(pms.cloudbeds, a.reservationID).catch(() => null)
        if (detail?.estimatedArrivalTime) {
          results.push({ tenantId: tenant.id, reservationID: a.reservationID, skipped: 'Arrival time already known' })
          continue
        }
      }

      // Lodgify has no arrival-time field, so times (from the panel, Lana or an email) are kept in Omega's own table.
      if (pms.kind === 'lodgify') {
        const { data: at } = await supabase
          .from('pms_arrival_times')
          .select('arrival_time')
          .eq('tenant_id', tenant.id)
          .eq('reservation_id', a.reservationID)
          .maybeSingle()
        if (at?.arrival_time) {
          results.push({ tenantId: tenant.id, reservationID: a.reservationID, skipped: 'Arrival time already known' })
          continue
        }
      }

      const outcome = await sendGuestMessage(ctx, 'arrival_time_reminder', {
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
