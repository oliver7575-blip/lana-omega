import { NextResponse } from 'next/server'
import { createClient } from '../supabase/server'
import { pmsForTenant } from '../pms'
import { loadPaymentContext, type PaymentContext } from './service'
import { paymentBackendFor, type PaymentBackend } from './backend'

/** Signed-in staff member + the hotel's payment backend (Cloudbeds or Lodgify) + payment settings, for the admin payment routes. */
export async function paymentsCaller(): Promise<
  | { supabase: Awaited<ReturnType<typeof createClient>>; be: PaymentBackend; ctx: PaymentContext; staffId: string; canManage: boolean }
  | { error: NextResponse }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: tenantId } = await supabase.rpc('current_tenant_id')
  if (!tenantId) return { error: NextResponse.json({ error: 'No tenant record found' }, { status: 404 }) }
  const { data: staff } = await supabase.from('staff_users').select('id, role').eq('auth_uid', user.id).eq('tenant_id', tenantId).maybeSingle()
  if (!staff) return { error: NextResponse.json({ error: 'No tenant record found' }, { status: 404 }) }
  const be = await paymentBackendFor(await pmsForTenant(supabase, tenantId as string))
  if (!be) return { error: NextResponse.json({ error: 'No property-management system with payment links is connected — connect Cloudbeds or Lodgify under Integrations.' }, { status: 400 }) }
  const ctx = await loadPaymentContext(supabase, tenantId as string)
  return { supabase, be, ctx, staffId: staff.id as string, canManage: ['owner', 'admin'].includes(staff.role as string) }
}
