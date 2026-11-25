import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials, type EncryptedPayload } from '@/lib/crypto'
import { syncRevenueLodgify } from '@/lib/lodgify-ops'

export const maxDuration = 60

/** Nightly: refreshes the revenue ledger of every Lodgify hotel (new bookings, price changes, cancellations). */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = createServiceClient()
  const { data: integrations } = await db.from('tenant_integrations').select('tenant_id, credentials, config').eq('integration_type', 'pms_lodgify').eq('status', 'connected')
  const results: Record<string, unknown>[] = []
  const started = Date.now()
  for (const i of integrations ?? []) {
    try {
      const { api_key } = decryptCredentials<{ api_key: string }>(i.credentials as EncryptedPayload)
      const propertyId = (i.config as { property_id?: string } | null)?.property_id?.trim() || undefined
      let offset: number | null = 0
      while (offset !== null && Date.now() - started < 45_000) {
        const r: Awaited<ReturnType<typeof syncRevenueLodgify>> = await syncRevenueLodgify({ apiKey: api_key, propertyId }, i.tenant_id as string, db, offset, 40)
        results.push({ tenantId: i.tenant_id, ...r })
        offset = r.nextOffset
      }
      if (offset !== null) results.push({ tenantId: i.tenant_id, incomplete: true, nextOffset: offset })
    } catch (e) {
      results.push({ tenantId: i.tenant_id, error: e instanceof Error ? e.message : 'failed' })
    }
  }
  return NextResponse.json({ results })
}
