import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { EncryptedPayload } from '@/lib/crypto'
import {
  checkTemplateUsable,
  getMaintenanceTemplate,
  listTemplatesForPicker,
  resolveTemplateChoice,
  submitMaintenanceTemplate,
  validateTemplateBody,
  MAINTENANCE_TEMPLATE_DEFAULT_BODY,
  MAINTENANCE_TEMPLATE_BUTTONS,
  MAINTENANCE_TEMPLATE_NAME,
} from '@/lib/maintenance-template'

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

  // RLS scopes both reads to the caller's own hotel.
  const { data: whatsapp } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('integration_type', 'whatsapp')
    .maybeSingle()

  const wabaId = (whatsapp?.config as { waba_id?: string } | null)?.waba_id
  if (whatsapp?.status !== 'connected' || !whatsapp.credentials || !wabaId) {
    return {
      error: NextResponse.json(
        { error: 'Connect WhatsApp (with its WhatsApp Business Account ID) under Integrations first.' },
        { status: 400 }
      ),
    }
  }

  const { data: tenant } = await supabase
    .from('tenants')
    .select('maintenance_template')
    .eq('id', staffRow.tenant_id)
    .single()

  return {
    supabase,
    tenantId: staffRow.tenant_id as string,
    role: staffRow.role as string,
    wabaId,
    credentials: whatsapp.credentials as EncryptedPayload,
    choice: resolveTemplateChoice(tenant?.maintenance_template),
  }
}

export async function GET(request: Request) {
  const ctx = await loadContext()
  if ('error' in ctx) return ctx.error

  const wantList = new URL(request.url).searchParams.get('list') === '1'

  try {
    if (wantList) {
      const templates = await listTemplatesForPicker(ctx.wabaId, ctx.credentials)
      return NextResponse.json({ templates })
    }
    const info = await getMaintenanceTemplate(ctx.wabaId, ctx.credentials, ctx.choice)
    return NextResponse.json({
      template: info,
      usingCustom: ctx.choice.custom,
      defaultName: MAINTENANCE_TEMPLATE_NAME,
      buttons: ctx.choice.custom ? (info.buttons ?? []) : MAINTENANCE_TEMPLATE_BUTTONS,
      defaultBody: MAINTENANCE_TEMPLATE_DEFAULT_BODY,
      canEdit: ['owner', 'admin'].includes(ctx.role),
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not reach WhatsApp' },
      { status: 502 }
    )
  }
}

export async function POST(request: Request) {
  const ctx = await loadContext()
  if ('error' in ctx) return ctx.error
  if (!['owner', 'admin'].includes(ctx.role)) {
    return NextResponse.json(
      { error: 'Only owners or admins can change the template' },
      { status: 403 }
    )
  }

  const payload = (await request.json()) as {
    action?: 'submit' | 'select' | 'use_default'
    body?: string
    name?: string
    language?: string
  }
  const action = payload.action ?? 'submit'

  try {
    if (action === 'select') {
      if (!payload.name || !payload.language) {
        return NextResponse.json({ error: 'name and language are required' }, { status: 400 })
      }
      const problem = await checkTemplateUsable(ctx.wabaId, ctx.credentials, {
        name: payload.name,
        language: payload.language,
      })
      if (problem) return NextResponse.json({ error: problem }, { status: 400 })

      const { data: updated, error } = await ctx.supabase
        .from('tenants')
        .update({ maintenance_template: { name: payload.name, language: payload.language } })
        .eq('id', ctx.tenantId)
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!updated?.length) {
        return NextResponse.json({ error: 'Update not permitted' }, { status: 403 })
      }
      return NextResponse.json({ ok: true })
    }

    if (action === 'use_default') {
      const { data: updated, error } = await ctx.supabase
        .from('tenants')
        .update({ maintenance_template: null })
        .eq('id', ctx.tenantId)
        .select('id')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      if (!updated?.length) {
        return NextResponse.json({ error: 'Update not permitted' }, { status: 403 })
      }
      return NextResponse.json({ ok: true })
    }

    // action === 'submit': create/edit Omega's own template.
    const problem = validateTemplateBody(payload.body ?? '')
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })

    const result = await submitMaintenanceTemplate(ctx.wabaId, ctx.credentials, payload.body!)
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? 'Meta rejected the request' }, { status: 400 })
    }
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not reach WhatsApp' },
      { status: 502 }
    )
  }
}
