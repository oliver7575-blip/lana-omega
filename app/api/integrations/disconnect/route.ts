import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { INTEGRATION_TYPES, type IntegrationType } from '@/lib/integrations'

export async function POST(request: Request) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json()) as { integrationType: IntegrationType }
  const { integrationType } = body

  if (!integrationType || !INTEGRATION_TYPES.includes(integrationType)) {
    return NextResponse.json({ error: 'Invalid integrationType' }, { status: 400 })
  }

  const { data: tenantId, error: tenantError } = await supabase.rpc('current_tenant_id')
  if (tenantError || !tenantId) {
    return NextResponse.json(
      { error: 'Could not resolve tenant for this account' },
      { status: 403 }
    )
  }

  const { error: updateError } = await supabase
    .from('tenant_integrations')
    .update({ status: 'disconnected', credentials: null, connected_at: null, connected_by: null })
    .eq('tenant_id', tenantId)
    .eq('integration_type', integrationType)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
