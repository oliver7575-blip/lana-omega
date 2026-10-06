import { NextResponse } from 'next/server'
import { createClient } from '../supabase/server'
import { cloudbedsForCaller } from '../cloudbeds-caller'
import { loadPaymentContext, type PaymentContext } from './service'
import type { CB } from '../cloudbeds-ops'

/** Signed-in staff member + Cloudbeds access + payment settings, for the admin payment routes. */
export async function paymentsCaller(): Promise<
  | { supabase: Awaited<ReturnType<typeof createClient>>; cb: CB; ctx: PaymentContext; staffId: string; canManage: boolean }
  | { error: NextResponse }
> {
  const c = await cloudbedsForCaller()
  if ('error' in c) return c
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: staff } = await supabase.from('staff_users').select('id, tenant_id, role').eq('auth_uid', user?.id ?? '').single()
  if (!staff) return { error: NextResponse.json({ error: 'No tenant record found' }, { status: 404 }) }
  const ctx = await loadPaymentContext(supabase, staff.tenant_id as string)
  return { supabase, cb: c.cb, ctx, staffId: staff.id as string, canManage: ['owner', 'admin'].includes(staff.role as string) }
}
