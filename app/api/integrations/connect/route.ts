import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encryptCredentials } from '@/lib/crypto'
import { INTEGRATION_TYPES, type IntegrationType } from '@/lib/integrations'

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json()) as {
    integrationType: IntegrationType
    credentials: Record<string, string>
    config?: Record<string, string>
  }
  const { integrationType, credentials, config } = body

  if (!integrationType || !INTEGRATION_TYPES.includes(integrationType)) {
    return NextResponse.json({ error: 'Invalid integrationType' }, { status: 400 })
  }
  if (!credentials || Object.keys(credentials).length === 0) {
    return NextResponse.json({ error: 'credentials are required' }, { status: 400 })
  }

  const { data: tenantId, error: tenantError } = await supabase.rpc('current_tenant_id')
  if (tenantError || !tenantId) {
    return NextResponse.json(
      { error: 'Could not resolve tenant for this account' },
      { status: 403 }
    )
  }

  const { data: staffRow } = await supabase
    .from('staff_users')
    .select('id')
    .eq('auth_uid', user.id)
    .single()

  const encrypted = encryptCredentials(credentials)

  const { error: upsertError } = await supabase.from('tenant_integrations').upsert(
    {
      tenant_id: tenantId,
      integration_type: integrationType,
      status: 'connected',
      credentials: encrypted,
      config: config ?? {},
      connected_at: new Date().toISOString(),
      connected_by: staffRow?.id ?? null,
    },
    { onConflict: 'tenant_id,integration_type' }
  )

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
