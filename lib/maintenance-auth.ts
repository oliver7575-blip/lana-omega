import { NextResponse } from 'next/server'
import { createClient } from './supabase/server'

/** The signed-in staff member's hotel, for maintenance API routes. */
export async function maintenanceCaller() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: staff } = await supabase.from('staff_users').select('id, tenant_id').eq('auth_uid', user.id).single()
  if (!staff) return { error: NextResponse.json({ error: 'No tenant record found' }, { status: 404 }) }
  return { supabase, tenantId: staff.tenant_id as string, staffUserId: staff.id as string }
}

export const RECURRENCE_RULES = ['none', 'daily', 'weekly', 'monthly', 'seasonal', 'interval'] as const
