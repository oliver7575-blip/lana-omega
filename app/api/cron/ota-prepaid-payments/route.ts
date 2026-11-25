import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { pmsForTenant } from '@/lib/pms'
import { addLocalDays, localDate } from '@/lib/tz'
import { addReservationPayment, bookingOptions, getReservationDetail } from '@/lib/cloudbeds-ops'

export const maxDuration = 60

const TYPE = 'ota_prepaid_payment'

/** The Cloudbeds payment method to use for each channel (matched by name, ignoring case and punctuation). */
const CHANNELS: { test: RegExp; method: string }[] = [
  { test: /booking\.?com/i, method: 'Booking - Prepaid Check' },
  { test: /airbnb/i, method: 'AirBnB - Prepaid Check' },
]
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * 3:00 am hotel time (09:00 UTC; Mexico has no daylight saving): for bookings that checked in
 * the day before, records the open balance of Booking.com / Airbnb reservations as a payment
 * on the folio ("Booking - Prepaid Check" / "AirBnB - Prepaid Check"). Everything else is left
 * for staff. Cloudbeds only (Lalo's Lodgify has no API to record a payment).
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceClient()
  const { data: tenants } = await db.from('tenants').select('id, timezone')
  const results: Record<string, unknown>[] = []

  for (const tenant of tenants ?? []) {
    const pms = await pmsForTenant(db, tenant.id)
    if (!pms?.cloudbeds) continue
    const cb = pms.cloudbeds
    const tz = (tenant.timezone as string) || 'America/Mexico_City'
    const checkInDay = localDate(addLocalDays(new Date(), -1, tz), tz)

    const arrivals = await pms.getArrivalsInWindow(checkInDay)
    if (!arrivals.success) {
      results.push({ tenantId: tenant.id, error: arrivals.error })
      continue
    }
    const options = await bookingOptions(cb).catch(() => null)
    const methods = options?.paymentMethods ?? []

    for (const a of arrivals.arrivals) {
      const id = a.reservationID
      try {
        const detail = await getReservationDetail(cb, id)
        if (/cancel|no.?show/i.test(detail.status)) {
          results.push({ tenantId: tenant.id, reservationID: id, skipped: `Status ${detail.status}` })
          continue
        }
        const channel = CHANNELS.find((c) => c.test.test(detail.source ?? ''))
        if (!channel) {
          results.push({ tenantId: tenant.id, reservationID: id, skipped: `Not Booking.com/Airbnb (${detail.source ?? 'no source'})` })
          continue
        }
        const balance = detail.balance ?? 0
        if (!(balance > 0.005)) {
          results.push({ tenantId: tenant.id, reservationID: id, skipped: 'No balance due' })
          continue
        }
        const method = methods.find((m) => norm(m.name) === norm(channel.method) || norm(m.code) === norm(channel.method))
        if (!method) {
          results.push({ tenantId: tenant.id, reservationID: id, error: `Payment method "${channel.method}" not found in Cloudbeds` })
          continue
        }

        // One payment per booking, ever: claim first, undo the claim if Cloudbeds refuses.
        const { error: claimError } = await db.from('sent_reminders').insert({ tenant_id: tenant.id, reservation_id: id, message_type: TYPE })
        if (claimError) {
          results.push({ tenantId: tenant.id, reservationID: id, skipped: 'Already processed' })
          continue
        }
        try {
          await addReservationPayment(cb, { reservationID: id, methodCode: method.code, amount: balance, refund: false, note: channel.method })
          results.push({ tenantId: tenant.id, reservationID: id, paid: balance, method: method.name })
        } catch (e) {
          await db.from('sent_reminders').delete().eq('tenant_id', tenant.id).eq('reservation_id', id).eq('message_type', TYPE)
          throw e
        }
      } catch (e) {
        console.error('[ota-prepaid-payments] failed', id, e)
        results.push({ tenantId: tenant.id, reservationID: id, error: e instanceof Error ? e.message : 'failed' })
      }
    }
  }
  console.log('[ota-prepaid-payments]', JSON.stringify(results).slice(0, 1500))
  return NextResponse.json({ results })
}
