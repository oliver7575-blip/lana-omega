import { NextResponse } from 'next/server'
import { createClient } from './supabase/server'
import { decryptCredentials } from './crypto'
import type { CB } from './cloudbeds-ops'

/** Cloudbeds access for the signed-in staff member's hotel. */
export async function cloudbedsForCaller(): Promise<{ cb: CB; tz: string } | { error: NextResponse }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { data: staff } = await supabase.from('staff_users').select('tenant_id').eq('auth_uid', user.id).single()
  if (!staff) return { error: NextResponse.json({ error: 'No tenant record found' }, { status: 404 }) }

  const [{ data: integration }, { data: tenant }] = await Promise.all([
    supabase.from('tenant_integrations').select('status, credentials, config').eq('integration_type', 'pms_cloudbeds').maybeSingle(),
    supabase.from('tenants').select('timezone').eq('id', staff.tenant_id).single(),
  ])
  const propertyId = (integration?.config as { property_id?: string } | null)?.property_id
  if (integration?.status !== 'connected' || !integration.credentials || !propertyId) {
    return { error: NextResponse.json({ error: 'Cloudbeds is not connected — connect it under Integrations.' }, { status: 400 }) }
  }
  const { api_key } = decryptCredentials<{ api_key: string }>(integration.credentials)
  return { cb: { apiKey: api_key, propertyId }, tz: (tenant?.timezone as string) || 'America/Mexico_City' }
}
