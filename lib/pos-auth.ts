import { NextResponse } from 'next/server'
import { createClient } from './supabase/server'
import { createServiceClient } from './supabase/service'

export type PosCaller = { tenantId: string; email: string; db: ReturnType<typeof createServiceClient> }

/** Signed-in staff member + their hotel, plus a service client for the POS tables. */
export async function posCaller() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: staff } = await supabase.from('staff_users').select('tenant_id').eq('auth_uid', user.id).single()
  if (!staff) return { error: NextResponse.json({ error: 'No tenant' }, { status: 404 }) }
  return { tenantId: staff.tenant_id as string, email: user.email ?? '', db: createServiceClient() } as PosCaller
}

/** POS test mode: while on (the default), charges are only logged and never sent to Cloudbeds. */
export async function posTestMode(db: ReturnType<typeof createServiceClient>, tenantId: string): Promise<boolean> {
  const { data } = await db.from('tenants').select('channel_settings').eq('id', tenantId).single()
  return (data?.channel_settings as { pos_live?: boolean } | null)?.pos_live !== true
}

/** While set, live mode only accepts charges for this one reservation (used for the first real test). */
export async function posLockedReservation(db: ReturnType<typeof createServiceClient>, tenantId: string): Promise<string | null> {
  const { data } = await db.from('tenants').select('channel_settings').eq('id', tenantId).single()
  const v = (data?.channel_settings as { pos_lock_reservation?: string } | null)?.pos_lock_reservation
  return typeof v === 'string' && v ? v : null
}
