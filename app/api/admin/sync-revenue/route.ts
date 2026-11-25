import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials, type EncryptedPayload } from '@/lib/crypto'
import { syncRevenueLodgify } from '@/lib/lodgify-ops'

export const maxDuration = 60

/**
 * Revenue backfill for a Lodgify hotel (CRON_SECRET-gated admin tool). One slice per call:
 *   POST /api/admin/sync-revenue?tenantId=<uuid>&offset=0&limit=40
 * The answer carries nextOffset (null when done): call again with it.
 */
export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const q = new URL(request.url).searchParams
  const tenantId = q.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  const offset = Math.max(0, Number(q.get('offset') ?? 0) || 0)
  const limit = Math.min(80, Math.max(1, Number(q.get('limit') ?? 40) || 40))

  const db = createServiceClient()
  const { data: integration } = await db.from('tenant_integrations').select('status, credentials, config').eq('tenant_id', tenantId).eq('integration_type', 'pms_lodgify').maybeSingle()
  if (integration?.status !== 'connected' || !integration.credentials) return NextResponse.json({ error: 'Lodgify is not connected for this tenant' }, { status: 404 })
  try {
    const { api_key } = decryptCredentials<{ api_key: string }>(integration.credentials as EncryptedPayload)
    const propertyId = (integration.config as { property_id?: string } | null)?.property_id?.trim() || undefined
    return NextResponse.json(await syncRevenueLodgify({ apiKey: api_key, propertyId }, tenantId, db, offset, limit))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'sync failed' }, { status: 502 })
  }
}
