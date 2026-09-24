import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

interface SignupRequest {
  hotelName: string
  slug: string
  timezone: string
  ownerEmail: string
  ownerPassword: string
}

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<SignupRequest>
  const { hotelName, slug, timezone, ownerEmail, ownerPassword } = body

  if (!hotelName || !slug || !timezone || !ownerEmail || !ownerPassword) {
    return NextResponse.json(
      { error: 'hotelName, slug, timezone, ownerEmail, and ownerPassword are all required' },
      { status: 400 }
    )
  }

  if (ownerPassword.length < 8) {
    return NextResponse.json(
      { error: 'Password must be at least 8 characters' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  const { data: existingTenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (existingTenant) {
    return NextResponse.json(
      { error: 'That URL slug is already taken — please choose a different one' },
      { status: 409 }
    )
  }

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({ name: hotelName, slug, timezone, status: 'onboarding' })
    .select()
    .single()

  if (tenantError || !tenant) {
    return NextResponse.json(
      { error: `Failed to create tenant: ${tenantError?.message}` },
      { status: 500 }
    )
  }

  // Real signup: do NOT auto-confirm the email. Supabase will send a real
  // confirmation email, and the owner must verify before they can sign in.
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: false,
  })

  if (authError || !authUser?.user) {
    await supabase.from('tenants').delete().eq('id', tenant.id)
    return NextResponse.json(
      { error: `Failed to create account: ${authError?.message}` },
      { status: 500 }
    )
  }

  const { error: staffError } = await supabase.from('staff_users').insert({
    tenant_id: tenant.id,
    auth_uid: authUser.user.id,
    email: ownerEmail,
    role: 'owner',
  })

  if (staffError) {
    await supabase.auth.admin.deleteUser(authUser.user.id)
    await supabase.from('tenants').delete().eq('id', tenant.id)
    return NextResponse.json(
      { error: `Failed to link owner to tenant: ${staffError.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    tenantId: tenant.id,
    ownerAuthId: authUser.user.id,
    message: 'Account created — check your email to confirm before signing in.',
  })
}
