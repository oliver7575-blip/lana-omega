import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { cloudbedsForTenant } from '@/lib/cloudbeds-tenant'
import { loadPaymentContext, pollPayment, type PaymentRequestRow } from '@/lib/payments/service'

export const maxDuration = 60

/** Every minute: checks open payment links and verifies paid ones against the folio. */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = createServiceClient()
  const since = new Date(Date.now() - 4 * 86400_000).toISOString()
  const recentlyChecked = new Date(Date.now() - 45_000).toISOString()
  const { data: open } = await db
    .from('payment_requests')
    .select('*')
    .in('status', ['link_active', 'paid_unverified'])
    .gte('created_at', since)
    .or(`last_checked_at.is.null,last_checked_at.lt.${recentlyChecked}`)
    .order('last_checked_at', { ascending: true, nullsFirst: true })
    .limit(30)

  const results: { id: string; status: string }[] = []
  const byTenant = new Map<string, PaymentRequestRow[]>()
  for (const r of (open ?? []) as PaymentRequestRow[]) byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), r])
  const started = Date.now()
  for (const [tenantId, rows] of byTenant) {
    const cb = await cloudbedsForTenant(db, tenantId)
    if (!cb) continue
    const ctx = await loadPaymentContext(db, tenantId)
    for (const row of rows) {
      if (Date.now() - started > 45_000) break
      const updated = await pollPayment(db, cb, ctx, row)
      results.push({ id: updated.id, status: updated.status })
    }
  }
  return NextResponse.json({ checked: results.length, results })
}
