import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { decryptCredentials, type EncryptedPayload } from '@/lib/crypto'

const GRAPH = 'https://graph.facebook.com/v21.0'

/**
 * Whether Meta delivers this hotel's WhatsApp messages to Omega.
 * Omega's Meta app is "subscribed" to the WhatsApp Business Account:
 *   GET    → is it subscribed? (and which apps are)
 *   POST   → start receiving (subscribe)
 *   DELETE → stop receiving (unsubscribe) — the way back
 */
async function context() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: staff } = await supabase.from('staff_users').select('role').eq('auth_uid', user.id).single()
  if (!staff) return { error: NextResponse.json({ error: 'No tenant record found' }, { status: 404 }) }
  const { data: wa } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('integration_type', 'whatsapp')
    .maybeSingle()
  const wabaId = (wa?.config as { waba_id?: string } | null)?.waba_id
  if (wa?.status !== 'connected' || !wa.credentials || !wabaId) {
    return { error: NextResponse.json({ error: 'Connect WhatsApp (with its Business Account ID) first' }, { status: 400 }) }
  }
  const { access_token } = decryptCredentials<{ access_token: string }>(wa.credentials as EncryptedPayload)
  return { token: access_token, wabaId, canEdit: ['owner', 'admin'].includes(staff.role as string) }
}

async function graph(method: string, url: string, token: string) {
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error((json.error as { message?: string } | undefined)?.message ?? `Meta error ${res.status}`)
  return json
}

/** The Meta app this token belongs to (that's Omega's app). */
async function ownAppId(token: string): Promise<string | null> {
  try {
    const j = await graph('GET', `${GRAPH}/app`, token)
    return (j.id as string) ?? null
  } catch {
    return null
  }
}

export async function GET() {
  const c = await context()
  if ('error' in c) return c.error
  try {
    const [subs, appId] = await Promise.all([graph('GET', `${GRAPH}/${c.wabaId}/subscribed_apps`, c.token), ownAppId(c.token)])
    const apps = ((subs.data as { whatsapp_business_api_data?: { id?: string; name?: string } }[]) ?? []).map((a) => ({
      id: a.whatsapp_business_api_data?.id ?? '',
      name: a.whatsapp_business_api_data?.name ?? '',
    }))
    return NextResponse.json({ subscribed: appId ? apps.some((a) => a.id === appId) : null, appId, apps, canEdit: c.canEdit })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Meta error' }, { status: 502 })
  }
}

export async function POST() {
  const c = await context()
  if ('error' in c) return c.error
  if (!c.canEdit) return NextResponse.json({ error: 'Only owners or admins can do this' }, { status: 403 })
  try {
    await graph('POST', `${GRAPH}/${c.wabaId}/subscribed_apps`, c.token)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Meta error' }, { status: 502 })
  }
}

export async function DELETE() {
  const c = await context()
  if ('error' in c) return c.error
  if (!c.canEdit) return NextResponse.json({ error: 'Only owners or admins can do this' }, { status: 403 })
  try {
    await graph('DELETE', `${GRAPH}/${c.wabaId}/subscribed_apps`, c.token)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Meta error' }, { status: 502 })
  }
}
