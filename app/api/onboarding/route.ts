import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

interface OnboardingRequest {
  hotelName: string
  slug: string
  timezone: string
  ownerEmail: string
  ownerPassword: string
}

export async function POST(request: Request) {
  // Temporary gate until Stage 4 builds real admin-authenticated onboarding.
  // Anyone with this secret can create a tenant + owner account, so treat it
  // like any other production credential.
  const providedSecret = request.headers.get('x-onboarding-secret')
  if (!providedSecret || providedSecret !== process.env.ONBOARDING_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json()) as Partial<OnboardingRequest>
  const { hotelName, slug, timezone, ownerEmail, ownerPassword } = body

  if (!hotelName || !slug || !timezone || !ownerEmail || !ownerPassword) {
    return NextResponse.json(
      { error: 'hotelName, slug, timezone, ownerEmail, and ownerPassword are all required' },
      { status: 400 }
    )
  }

  const supabase = createServiceClient()

  // 1. Create the tenant row first, so we have a tenant_id to attach the
  //    owner account to.
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

  // 2. Create the Supabase auth user for the owner.
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: ownerEmail,
    password: ownerPassword,
    email_confirm: true,
  })

  if (authError || !authUser?.user) {
    // Roll back the orphaned tenant rather than leaving it dangling.
    await supabase.from('tenants').delete().eq('id', tenant.id)
    return NextResponse.json(
      { error: `Failed to create owner account: ${authError?.message}` },
      { status: 500 }
    )
  }

  // 3. Link the auth user to the tenant as its owner.
  const { error: staffError } = await supabase.from('staff_users').insert({
    tenant_id: tenant.id,
    auth_uid: authUser.user.id,
    email: ownerEmail,
    role: 'owner',
  })

  if (staffError) {
    // Roll back both the auth user and the tenant.
    await supabase.auth.admin.deleteUser(authUser.user.id)
    await supabase.from('tenants').delete().eq('id', tenant.id)
    return NextResponse.json(
      { error: `Failed to link owner to tenant: ${staffError.message}` },
      { status: 500 }
    )
  }

  return NextResponse.json({ tenantId: tenant.id, ownerAuthId: authUser.user.id })
}
