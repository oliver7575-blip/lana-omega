import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

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

export async function DELETE(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: callerRow } = await supabase
    .from('staff_users')
    .select('role, tenant_id')
    .eq('auth_uid', user.id)
    .single()

  // Owner only — deleting the whole tenant is more destructive than editing
  // settings, so it's held to a stricter bar than the owner/admin settings edit.
  if (!callerRow || callerRow.role !== 'owner') {
    return NextResponse.json(
      { error: 'Only an owner can delete the tenant' },
      { status: 403 }
    )
  }

  const body = (await request.json()) as { confirmName?: string }

  const serviceClient = createServiceClient()

  const { data: tenant } = await serviceClient
    .from('tenants')
    .select('id, name')
    .eq('id', callerRow.tenant_id)
    .single()

  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  if (body.confirmName !== tenant.name) {
    return NextResponse.json(
      { error: 'Confirmation text did not match the tenant name' },
      { status: 400 }
    )
  }

  // Collect every staff auth_uid BEFORE deleting the tenant, since the
  // tenants -> staff_users cascade removes the staff_users rows (but never
  // touches auth.users) — same orphan-risk pattern as staff removal, applied
  // here for every staff member on the whole tenant at once.
  const { data: allStaff } = await serviceClient
    .from('staff_users')
    .select('auth_uid')
    .eq('tenant_id', tenant.id)

  const { error: deleteError } = await serviceClient
    .from('tenants')
    .delete()
    .eq('id', tenant.id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  // Clean up every staff member's auth account now that the tenant and all
  // its FK-cascaded rows (staff_users, tenant_integrations, guests,
  // conversations, messages) are gone.
  for (const staff of allStaff ?? []) {
    await serviceClient.auth.admin.deleteUser(staff.auth_uid)
  }

  return NextResponse.json({ success: true })
}
