import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptCredentials, type EncryptedPayload } from './crypto'
import type { CB } from './cloudbeds-ops'

/** Cloudbeds access for background jobs (no signed-in staff member). Null if not connected. */
export async function cloudbedsForTenant(db: SupabaseClient, tenantId: string): Promise<CB | null> {
  const { data } = await db
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'pms_cloudbeds')
    .maybeSingle()
  const propertyId = (data?.config as { property_id?: string } | null)?.property_id
  if (data?.status !== 'connected' || !data.credentials || !propertyId) return null
  const { api_key } = decryptCredentials<{ api_key: string }>(data.credentials as EncryptedPayload)
  return { apiKey: api_key, propertyId }
}
