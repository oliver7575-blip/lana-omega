import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials, type EncryptedPayload } from '@/lib/crypto'
import { getBookingRaw, listUpcomingRaw, listWebhooks } from '@/lib/lodgify'
import { pmsForTenant } from '@/lib/pms'

/**
 * CRON_SECRET-gated diagnostics for a tenant's Lodgify connection — shows
 * the RAW Lodgify JSON (to confirm real field names) next to what Lana
 * would see after mapping.
 *
 *   GET /api/debug/lodgify-raw?tenantId=<uuid>              → first 3 upcoming bookings + webhooks
 *   GET /api/debug/lodgify-raw?tenantId=<uuid>&id=<booking> → one booking
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const params = new URL(request.url).searchParams
  const tenantId = params.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })

  const supabase = createServiceClient()
  const { data: integration } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'pms_lodgify')
    .maybeSingle()
  if (!integration?.credentials) return NextResponse.json({ error: 'No Lodgify integration for this tenant' }, { status: 404 })

  const { api_key } = decryptCredentials<{ api_key: string }>(integration.credentials as EncryptedPayload)
  const propertyId = (integration.config as { property_id?: string } | null)?.property_id
  const auth = { apiKey: api_key, propertyId }
  const pms = await pmsForTenant(supabase, tenantId)

  const id = params.get('id')
  if (id) {
    const [raw, mapped] = await Promise.all([getBookingRaw(auth, id), pms?.lookupReservation(id)])
    return NextResponse.json({ raw, mapped })
  }
  const [upcoming, webhooks] = await Promise.all([listUpcomingRaw(auth, 3), listWebhooks(auth)])
  return NextResponse.json({ status: integration.status, propertyId: propertyId ?? null, upcoming, webhooks })
}
