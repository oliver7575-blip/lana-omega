import { NextResponse } from 'next/server'
import { posCaller, posTestMode } from '@/lib/pos-auth'

export async function GET() {
  const c = await posCaller()
  if ('error' in c) return c.error
  return NextResponse.json({ testMode: await posTestMode(c.db, c.tenantId) })
}

/** { live: true } sends charges to Cloudbeds for real; { live: false } goes back to test mode. */
export async function PUT(req: Request) {
  const c = await posCaller()
  if ('error' in c) return c.error
  const { live } = (await req.json().catch(() => ({}))) as { live?: boolean }
  const { data } = await c.db.from('tenants').select('channel_settings').eq('id', c.tenantId).single()
  const next = { ...((data?.channel_settings as Record<string, unknown>) ?? {}), pos_live: live === true }
  const { error } = await c.db.from('tenants').update({ channel_settings: next }).eq('id', c.tenantId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ testMode: live !== true })
}
