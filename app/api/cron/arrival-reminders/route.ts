import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials } from '@/lib/crypto'
import { getArrivalsInWindow } from '@/lib/cloudbeds'
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
    const { data: cloudbeds } = await supabase
      .from('tenant_integrations')
      .select('status, credentials, config')
      .eq('tenant_id', tenant.id)
      .eq('integration_type', 'pms_cloudbeds')
      .maybeSingle()
    if (cloudbeds?.status !== 'connected') continue

    const { api_key } = decryptCredentials<{ api_key: string }>(cloudbeds.credentials)
    const propertyId = (cloudbeds.config as { property_id?: string })?.property_id
    if (!propertyId) continue

    const ctx = await loadMessagingContext(tenant.id)
    if (!ctx) continue

    const arrivals = await getArrivalsInWindow(api_key, propertyId, targetDate)
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
