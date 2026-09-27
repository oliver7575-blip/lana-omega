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

  const { data: staff, error } = await supabase
    .from('staff_users')
    .select('id, email, full_name, role, created_at')
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ staff })
}

export async function POST(request: Request) {
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

  if (!callerRow || !['owner', 'admin'].includes(callerRow.role)) {
    return NextResponse.json(
      { error: 'Only owners or admins can invite staff' },
      { status: 403 }
    )
  }

  const body = (await request.json()) as {
    email?: string
    password?: string
    fullName?: string
    role?: string
  }
  const { email, password, fullName, role } = body

  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 })
  }

  const finalRole = role && ['owner', 'admin', 'staff'].includes(role) ? role : 'staff'

  const serviceClient = createServiceClient()

  // Same real gap as signup had: an email already registered anywhere on
  // the platform (another tenant's owner, existing staff elsewhere) would
  // otherwise surface Supabase's raw internal error instead of a clear one.
  const { data: existingStaff } = await serviceClient
    .from('staff_users')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existingStaff) {
    return NextResponse.json(
      { error: 'An account with this email already exists on the platform' },
      { status: 409 }
    )
  }

  const { data: newAuthUser, error: authError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (authError || !newAuthUser?.user) {
    return NextResponse.json(
      { error: `Failed to create account: ${authError?.message}` },
      { status: 500 }
    )
  }

  const { data: newStaffRow, error: staffError } = await serviceClient
    .from('staff_users')
    .insert({
      tenant_id: callerRow.tenant_id,
      auth_uid: newAuthUser.user.id,
      email,
      full_name: fullName ?? null,
      role: finalRole,
    })
    .select()
    .single()

  if (staffError) {
    await serviceClient.auth.admin.deleteUser(newAuthUser.user.id)
    return NextResponse.json(
      { error: `Failed to create staff record: ${staffError.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ staff: newStaffRow })
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
    .select('id, role, tenant_id')
    .eq('auth_uid', user.id)
    .single()

  if (!callerRow || !['owner', 'admin'].includes(callerRow.role)) {
    return NextResponse.json(
      { error: 'Only owners or admins can remove staff' },
      { status: 403 }
    )
  }

  const { staffId } = (await request.json()) as { staffId?: string }
  if (!staffId) {
    return NextResponse.json({ error: 'staffId is required' }, { status: 400 })
  }

  if (staffId === callerRow.id) {
    return NextResponse.json({ error: 'You cannot remove your own account' }, { status: 400 })
  }

  const serviceClient = createServiceClient()

  const { data: targetRow, error: fetchError } = await serviceClient
    .from('staff_users')
    .select('id, auth_uid, role, tenant_id')
    .eq('id', staffId)
    .single()

  if (fetchError || !targetRow) {
    return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })
  }

  if (targetRow.tenant_id !== callerRow.tenant_id) {
    return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })
  }

  if (targetRow.role === 'owner') {
    const { count } = await serviceClient
      .from('staff_users')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', callerRow.tenant_id)
      .eq('role', 'owner')

    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: 'Cannot remove the last owner of a tenant' },
        { status: 400 }
      )
    }
  }

  const { error: deleteError } = await serviceClient
    .from('staff_users')
    .delete()
    .eq('id', staffId)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  await serviceClient.auth.admin.deleteUser(targetRow.auth_uid)

  return NextResponse.json({ success: true })
}
