import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
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

  const serviceClient = createServiceClient()

  const { data: existingTenant } = await serviceClient
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

  const { data: tenant, error: tenantError } = await serviceClient
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

  // Use the regular anon-key client's signUp() here, NOT the admin API —
  // this is the path that actually triggers Supabase's built-in confirmation
  // email. admin.createUser() creates the account silently with no email at all.
  const anonClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: authData, error: authError } = await anonClient.auth.signUp({
    email: ownerEmail,
    password: ownerPassword,
  })

  if (authError || !authData?.user) {
    await serviceClient.from('tenants').delete().eq('id', tenant.id)
    return NextResponse.json(
      { error: `Failed to create account: ${authError?.message}` },
      { status: 500 }
    )
  }

  const { error: staffError } = await serviceClient.from('staff_users').insert({
    tenant_id: tenant.id,
    auth_uid: authData.user.id,
    email: ownerEmail,
    role: 'owner',
  })

  if (staffError) {
    await serviceClient.auth.admin.deleteUser(authData.user.id)
    await serviceClient.from('tenants').delete().eq('id', tenant.id)
    return NextResponse.json(
      { error: `Failed to link owner to tenant: ${staffError.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({
    tenantId: tenant.id,
    ownerAuthId: authData.user.id,
    message: 'Account created — check your email to confirm before signing in.',
  })
}
