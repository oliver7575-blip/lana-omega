import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Hotels the signed-in login belongs to, and switching between them.
 *
 *   GET  → { tenants: [{ tenant_id, name, role, is_current }] }
 *   POST { tenantId } → switches; the database checks the login belongs to it.
 *
 * Every other route keeps working unchanged: RLS and current_tenant_id()
 * follow the selected hotel.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase.rpc('my_tenants')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tenants: data ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = (await request.json().catch(() => ({}))) as { tenantId?: string }
  if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })

  const { data: ok, error } = await supabase.rpc('switch_tenant', { target: tenantId })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!ok) return NextResponse.json({ error: 'You do not have access to that hotel' }, { status: 403 })
  return NextResponse.json({ success: true })
}
