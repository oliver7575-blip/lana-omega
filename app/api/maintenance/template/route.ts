import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { EncryptedPayload } from '@/lib/crypto'
import {
  getMaintenanceTemplate,
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
    .select('role')
    .eq('auth_uid', user.id)
    .single()
  if (!staffRow) {
    return { error: NextResponse.json({ error: 'No tenant record found' }, { status: 404 }) }
  }

  // RLS scopes this to the caller's own hotel.
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

  return {
    role: staffRow.role as string,
    wabaId,
    credentials: whatsapp.credentials as EncryptedPayload,
  }
}

export async function GET() {
  const ctx = await loadContext()
  if ('error' in ctx) return ctx.error

  try {
    const info = await getMaintenanceTemplate(ctx.wabaId, ctx.credentials)
    return NextResponse.json({
      template: info,
      name: MAINTENANCE_TEMPLATE_NAME,
      buttons: MAINTENANCE_TEMPLATE_BUTTONS,
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

  const { body } = (await request.json()) as { body?: string }
  const problem = validateTemplateBody(body ?? '')
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  try {
    const result = await submitMaintenanceTemplate(ctx.wabaId, ctx.credentials, body!)
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
