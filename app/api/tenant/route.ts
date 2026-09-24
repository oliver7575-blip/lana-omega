import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: staffRow } = await supabase
    .from('staff_users')
    .select('role, tenant_id')
    .eq('auth_uid', user.id)
    .single()

  if (!staffRow) {
    return NextResponse.json({ error: 'No tenant record found' }, { status: 404 })
  }

  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('name, status, ai_persona_prompt')
    .eq('id', staffRow.tenant_id)
    .single()

  if (error || !tenant) {
    return NextResponse.json({ error: error?.message ?? 'Tenant not found' }, { status: 500 })
  }

  return NextResponse.json({ tenant, role: staffRow.role })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: staffRow } = await supabase
    .from('staff_users')
    .select('tenant_id')
    .eq('auth_uid', user.id)
    .single()

  if (!staffRow) {
    return NextResponse.json({ error: 'No tenant record found' }, { status: 404 })
  }

  const body = (await request.json()) as { name?: string; ai_persona_prompt?: string }
  const updates: { name?: string; ai_persona_prompt?: string } = {}
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim()
  if (typeof body.ai_persona_prompt === 'string' && body.ai_persona_prompt.trim()) {
    updates.ai_persona_prompt = body.ai_persona_prompt.trim()
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  // RLS restricts this to owner/admin roles — a plain 'staff' user's update
  // will be silently rejected by the policy (0 rows affected), not error.
  const { data: updated, error } = await supabase
    .from('tenants')
    .update(updates)
    .eq('id', staffRow.tenant_id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!updated) {
    return NextResponse.json(
      { error: 'Update not permitted — owner or admin role required' },
      { status: 403 }
    )
  }

  return NextResponse.json({ tenant: updated })
}
