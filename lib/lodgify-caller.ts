import { createClient } from './supabase/server'
import { decryptCredentials, type EncryptedPayload } from './crypto'
import type { LodgifyAuth } from './lodgify'

/** Lodgify access for the signed-in staff member's hotel. Null if not signed in or not connected. */
export async function lodgifyForCaller(): Promise<{ auth: LodgifyAuth; tz: string; tenantId: string } | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data: staff } = await supabase.from('staff_users').select('tenant_id').eq('auth_uid', user.id).single()
  if (!staff) return null
  const [{ data: integration }, { data: tenant }] = await Promise.all([
    supabase.from('tenant_integrations').select('status, credentials, config').eq('integration_type', 'pms_lodgify').maybeSingle(),
    supabase.from('tenants').select('timezone').eq('id', staff.tenant_id).single(),
  ])
  if (integration?.status !== 'connected' || !integration.credentials) return null
  try {
    const { api_key } = decryptCredentials<{ api_key: string }>(integration.credentials as EncryptedPayload)
    const propertyId = (integration.config as { property_id?: string } | null)?.property_id?.trim() || undefined
    return { tenantId: staff.tenant_id as string, auth: { apiKey: api_key, propertyId }, tz: (tenant?.timezone as string) || 'America/Mexico_City' }
  } catch {
    return null
  }
}
