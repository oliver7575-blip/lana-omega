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

const RATE_LIMIT_WINDOW_MINUTES = 60
const RATE_LIMIT_MAX_ATTEMPTS = 5

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

  // Rate limit BEFORE creating anything — this endpoint is fully public with
  // no platform-level wall in front of it (Vercel Deployment Protection was
  // disabled project-wide), so it needs its own abuse protection. Vercel
  // sets x-forwarded-for automatically; take the first IP in that list (the
  // original client, since the header can carry a chain through proxies).
  const forwardedFor = request.headers.get('x-forwarded-for')
  const clientIp = forwardedFor?.split(',')[0]?.trim() ?? 'unknown'

  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString()

  const { count: recentAttempts } = await serviceClient
    .from('signup_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip', clientIp)
    .gte('created_at', windowStart)

  if ((recentAttempts ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: 'Too many signup attempts — please wait a while and try again.' },
      { status: 429 }
    )
  }

  await serviceClient.from('signup_attempts').insert({ ip: clientIp })

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

  const { data: existingStaff } = await serviceClient
    .from('staff_users')
    .select('id')
    .eq('email', ownerEmail)
    .maybeSingle()

  if (existingStaff) {
    return NextResponse.json(
      { error: 'An account with this email already exists — try signing in instead' },
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

  const anonClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data: authData, error: authError } = await anonClient.auth.signUp({
    email: ownerEmail,
    password: ownerPassword,
  })

  const alreadyRegistered = authData?.user && authData.user.identities?.length === 0

  if (authError || !authData?.user || alreadyRegistered) {
    await serviceClient.from('tenants').delete().eq('id', tenant.id)
    return NextResponse.json(
      {
        error: alreadyRegistered
          ? 'An account with this email already exists — try signing in instead'
          : `Failed to create account: ${authError?.message}`,
      },
      { status: alreadyRegistered ? 409 : 500 }
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
