import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const CHANNELS = ['whatsapp', 'widget', 'instagram'] as const

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

export async function GET() {
  const c = await caller()
  if ('error' in c) return c.error
  const { data } = await c.supabase.from('tenants').select('channel_settings').eq('id', c.tenantId).single()
  const s = (data?.channel_settings ?? {}) as Record<string, boolean>
  return NextResponse.json({ whatsapp: s.whatsapp !== false, widget: s.widget !== false, instagram: s.instagram !== false, canEdit: c.canEdit })
}

/** { channel: 'whatsapp' | 'widget', enabled: boolean } */
export async function PATCH(request: Request) {
  const c = await caller()
  if ('error' in c) return c.error
  if (!c.canEdit) return NextResponse.json({ error: 'Only owners or admins can change channels' }, { status: 403 })
  const { channel, enabled } = (await request.json()) as { channel?: string; enabled?: boolean }
  if (!CHANNELS.includes(channel as never) || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'Unknown channel' }, { status: 400 })
  }
  const { data } = await c.supabase.from('tenants').select('channel_settings').eq('id', c.tenantId).single()
  const next = { ...((data?.channel_settings ?? {}) as Record<string, boolean>), [channel as string]: enabled }
  const { error } = await c.supabase.from('tenants').update({ channel_settings: next }).eq('id', c.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
