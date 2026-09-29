import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { KNOWLEDGE_BASE_MAX_CHARS } from '@/lib/knowledge-base'

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
    .select('name, status, ai_persona_prompt, knowledge_base, escalation_contacts, booking_config')
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

  const body = (await request.json()) as {
    name?: string
    ai_persona_prompt?: string
    knowledge_base?: string
    escalation_contacts?: Record<string, string>
    booking_config?: { booking_engine_code?: string; currency?: string }
    activate?: boolean
  }

  if (body.activate) {
    const serviceClient = createServiceClient()
    const { count: connectedIntegrations } = await serviceClient
      .from('tenant_integrations')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', staffRow.tenant_id)
      .eq('status', 'connected')

    if ((connectedIntegrations ?? 0) === 0) {
      return NextResponse.json(
        {
          error:
            'Connect at least one channel (WhatsApp, email, etc.) before activating — the widget channel is always available and does not need to be "connected" here.',
        },
        { status: 400 }
      )
    }

    const { data: updated, error } = await supabase
      .from('tenants')
      .update({ status: 'active' })
      .eq('id', staffRow.tenant_id)
      .select()
      .single()

    if (error || !updated) {
      return NextResponse.json(
        { error: error?.message ?? 'Activation not permitted — owner or admin role required' },
        { status: error ? 500 : 403 }
      )
    }

    return NextResponse.json({ tenant: updated })
  }

  const updates: {
    name?: string
    ai_persona_prompt?: string
    knowledge_base?: string | null
    escalation_contacts?: Record<string, string>
    booking_config?: { booking_engine_code?: string; currency?: string }
  } = {}
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim()
  if (typeof body.ai_persona_prompt === 'string' && body.ai_persona_prompt.trim()) {
    updates.ai_persona_prompt = body.ai_persona_prompt.trim()
  }
  if (typeof body.knowledge_base === 'string') {
    if (body.knowledge_base.length > KNOWLEDGE_BASE_MAX_CHARS) {
      return NextResponse.json(
        { error: `The knowledge base must be under ${KNOWLEDGE_BASE_MAX_CHARS.toLocaleString('en-US')} characters` },
        { status: 400 }
      )
    }
    // An empty box clears the knowledge base.
    updates.knowledge_base = body.knowledge_base.trim() || null
  }
  if (body.escalation_contacts && typeof body.escalation_contacts === 'object') {
    const cleaned: Record<string, string> = {}
    for (const [key, value] of Object.entries(body.escalation_contacts)) {
      if (typeof value === 'string' && value.trim()) cleaned[key] = value.trim()
    }
    updates.escalation_contacts = cleaned
  }
  if (body.booking_config && typeof body.booking_config === 'object') {
    const code = body.booking_config.booking_engine_code?.trim()
    const currency = body.booking_config.currency?.trim()
    updates.booking_config = {
      ...(code ? { booking_engine_code: code } : {}),
      ...(currency ? { currency: currency.toLowerCase() } : {}),
    }
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

  for (const staff of allStaff ?? []) {
    await serviceClient.auth.admin.deleteUser(staff.auth_uid)
  }

  return NextResponse.json({ success: true })
}
