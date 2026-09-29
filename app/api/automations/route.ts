import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { EncryptedPayload } from '@/lib/crypto'
import {
  MESSAGE_PURPOSES,
  fieldsFor,
  getMapping,
  listTemplates,
  reservationValues,
  validateMapping,
  type MessagePurpose,
  type TemplateMapping,
} from '@/lib/message-templates'
import {
  EMAIL_PURPOSES,
  EMAIL_VARIABLES,
  renderEmailTemplate,
  sendTenantEmail,
  type EmailPurpose,
} from '@/lib/email'

export const maxDuration = 30

async function loadContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: staffRow } = await supabase
    .from('staff_users')
    .select('role, tenant_id')
    .eq('auth_uid', user.id)
    .single()
  if (!staffRow) {
    return { error: NextResponse.json({ error: 'No tenant record found' }, { status: 404 }) }
  }

  const { data: whatsapp } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('integration_type', 'whatsapp')
    .maybeSingle()
  const wabaId = (whatsapp?.config as { waba_id?: string } | null)?.waba_id

  return {
    supabase,
    tenantId: staffRow.tenant_id as string,
    canEdit: ['owner', 'admin'].includes(staffRow.role as string),
    wa:
      whatsapp?.status === 'connected' && whatsapp.credentials && wabaId
        ? { wabaId, credentials: whatsapp.credentials as EncryptedPayload }
        : null,
  }
}

export async function GET(request: Request) {
  const ctx = await loadContext()
  if ('error' in ctx) return ctx.error

  if (new URL(request.url).searchParams.get('list') === '1') {
    if (!ctx.wa) {
      return NextResponse.json(
        { error: 'Connect WhatsApp (with its WhatsApp Business Account ID) under Integrations first.' },
        { status: 400 }
      )
    }
    try {
      return NextResponse.json({ templates: await listTemplates(ctx.wa.wabaId, ctx.wa.credentials) })
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Could not reach WhatsApp' },
        { status: 502 }
      )
    }
  }

  const [{ data: tenant }, { data: emails }, { data: smtp }] = await Promise.all([
    ctx.supabase.from('tenants').select('message_templates, post_stay_enabled').eq('id', ctx.tenantId).single(),
    ctx.supabase.from('email_templates').select('purpose, enabled, subject, body_html'),
    ctx.supabase
      .from('tenant_integrations')
      .select('status')
      .eq('integration_type', 'email')
      .maybeSingle(),
  ])

  const purposes = (Object.keys(MESSAGE_PURPOSES) as MessagePurpose[]).map((key) => ({
    key,
    ...MESSAGE_PURPOSES[key],
    fields: fieldsFor(key),
    mapping: getMapping(tenant?.message_templates, key),
  }))

  const emailTemplates = (Object.keys(EMAIL_PURPOSES) as EmailPurpose[]).map((key) => {
    const row = (emails ?? []).find((e) => e.purpose === key)
    return {
      key,
      ...EMAIL_PURPOSES[key],
      enabled: row?.enabled ?? false,
      subject: row?.subject ?? '',
      body_html: row?.body_html ?? '',
    }
  })

  return NextResponse.json({
    purposes,
    emailTemplates,
    emailVariables: EMAIL_VARIABLES,
    postStayEnabled: tenant?.post_stay_enabled ?? false,
    whatsappReady: Boolean(ctx.wa),
    smtpConnected: smtp?.status === 'connected',
    canEdit: ctx.canEdit,
  })
}

export async function POST(request: Request) {
  const ctx = await loadContext()
  if ('error' in ctx) return ctx.error
  if (!ctx.canEdit) {
    return NextResponse.json({ error: 'Only owners or admins can change automated messages' }, { status: 403 })
  }

  const payload = (await request.json()) as {
    action?: 'set_template' | 'save_email' | 'test_email'
    to?: string
    purpose?: string
    mapping?: TemplateMapping | null
    enabled?: boolean
    subject?: string
    body_html?: string
  }

  if (payload.action === 'set_template') {
    const purpose = payload.purpose as MessagePurpose
    if (!(purpose in MESSAGE_PURPOSES)) {
      return NextResponse.json({ error: 'Unknown message' }, { status: 400 })
    }
    const { data: tenant } = await ctx.supabase
      .from('tenants')
      .select('message_templates')
      .eq('id', ctx.tenantId)
      .single()
    const current = { ...((tenant?.message_templates as Record<string, unknown>) ?? {}) }

    if (payload.mapping) {
      if (!ctx.wa) return NextResponse.json({ error: 'WhatsApp is not connected' }, { status: 400 })
      const mapping: TemplateMapping = {
        name: String(payload.mapping.name ?? ''),
        language: String(payload.mapping.language ?? ''),
        header: (payload.mapping.header ?? []).map(String),
        body: (payload.mapping.body ?? []).map(String),
      }
      try {
        const problem = await validateMapping(ctx.wa.wabaId, ctx.wa.credentials, mapping, purpose)
        if (problem) return NextResponse.json({ error: problem }, { status: 400 })
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Could not reach WhatsApp' },
          { status: 502 }
        )
      }
      current[purpose] = mapping
    } else {
      delete current[purpose]
    }

    const { data: updated, error } = await ctx.supabase
      .from('tenants')
      .update({ message_templates: current })
      .eq('id', ctx.tenantId)
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!updated?.length) return NextResponse.json({ error: 'Update not permitted' }, { status: 403 })
    return NextResponse.json({ ok: true })
  }

  if (payload.action === 'save_email') {
    const purpose = payload.purpose as EmailPurpose
    if (!(purpose in EMAIL_PURPOSES)) {
      return NextResponse.json({ error: 'Unknown email' }, { status: 400 })
    }
    const subject = (payload.subject ?? '').trim()
    const body = (payload.body_html ?? '').trim()
    if (payload.enabled && (!subject || !body)) {
      return NextResponse.json({ error: 'Add a subject and a message before turning this email on' }, { status: 400 })
    }
    if (body.length > 50000) {
      return NextResponse.json({ error: 'The email is too long (50,000 characters max)' }, { status: 400 })
    }
    const { error } = await ctx.supabase.from('email_templates').upsert(
      {
        tenant_id: ctx.tenantId,
        purpose,
        enabled: Boolean(payload.enabled),
        subject,
        body_html: body,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,purpose' }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (payload.action === 'test_email') {
    const purpose = payload.purpose as EmailPurpose
    const to = (payload.to ?? '').trim()
    if (!(purpose in EMAIL_PURPOSES) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return NextResponse.json({ error: 'Enter a valid email address' }, { status: 400 })
    }
    const { data: tenant } = await ctx.supabase.from('tenants').select('name').eq('id', ctx.tenantId).single()
    const values = reservationValues(
      {
        reservationID: '1234567890',
        guestName: 'Ana García',
        startDate: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
        roomTypeName: 'Studio with Kitchen',
      },
      'es_MX',
      (tenant?.name as string) ?? ''
    )
    const res = await sendTenantEmail(
      ctx.tenantId,
      to,
      `[TEST] ${renderEmailTemplate(payload.subject ?? '', values, false)}`,
      renderEmailTemplate(payload.body_html ?? '', values, true)
    )
    if (!res.success) return NextResponse.json({ error: res.error }, { status: 502 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
