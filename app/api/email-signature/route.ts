import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const MAX_LENGTH = 1500

async function caller() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: staff } = await supabase.from('staff_users').select('tenant_id, role').eq('auth_uid', user.id).single()
  if (!staff) return { error: NextResponse.json({ error: 'No tenant record found' }, { status: 404 }) }
  return { supabase, tenantId: staff.tenant_id as string, canEdit: ['owner', 'admin'].includes(staff.role as string) }
}

/** The hotel's default signature for emails staff send from the panel. */
export async function GET() {
  const c = await caller()
  if ('error' in c) return c.error
  const { data } = await c.supabase.from('tenants').select('channel_settings').eq('id', c.tenantId).single()
  const signature = String((data?.channel_settings as Record<string, unknown> | null)?.email_signature ?? '')
  return NextResponse.json({ signature, canEdit: c.canEdit })
}

export async function PUT(request: Request) {
  const c = await caller()
  if ('error' in c) return c.error
  if (!c.canEdit) return NextResponse.json({ error: 'Only owners or admins can change the default signature' }, { status: 403 })
  const { signature } = (await request.json().catch(() => ({}))) as { signature?: string }
  if (typeof signature !== 'string') return NextResponse.json({ error: 'signature is required' }, { status: 400 })
  const { data } = await c.supabase.from('tenants').select('channel_settings').eq('id', c.tenantId).single()
  const next = { ...((data?.channel_settings ?? {}) as Record<string, unknown>), email_signature: signature.trim().slice(0, MAX_LENGTH) }
  const { error } = await c.supabase.from('tenants').update({ channel_settings: next }).eq('id', c.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
