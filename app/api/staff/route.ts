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

  // tenant_id comes from the CALLER's own resolved tenant (server-side, via
  // their authenticated session) — never taken from client input, so there's
  // no way for a request to add staff to a different tenant than the caller's own.
  const serviceClient = createServiceClient()

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
