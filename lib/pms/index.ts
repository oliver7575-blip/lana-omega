/**
 * The single entry point for "which PMS does this hotel use, and give me
 * access to it". Every guest-facing path calls pmsForTenant() instead of
 * reading Cloudbeds credentials itself.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptCredentials, type EncryptedPayload } from '../crypto'
import { cloudbedsAdapter } from './cloudbeds'
import type { PmsAdapter } from './types'

export type { PmsAdapter, PmsKind } from './types'

/** Integration types that are a PMS, in order of preference if (wrongly) more than one is connected. */
export const PMS_INTEGRATION_TYPES = ['pms_cloudbeds'] as const

export function isPmsIntegrationType(type: string): boolean {
  return (PMS_INTEGRATION_TYPES as readonly string[]).includes(type)
}

interface IntegrationRow {
  integration_type: string
  status: string | null
  credentials: unknown
  config: unknown
}

/**
 * Builds the adapter for one tenant_integrations row. Null if the row is not
 * a connected PMS or is missing what the adapter needs (e.g. property_id).
 */
export function pmsFromIntegration(row: IntegrationRow | null | undefined): PmsAdapter | null {
  if (!row || row.status !== 'connected' || !row.credentials) return null
  const config = (row.config ?? {}) as Record<string, string | undefined>

  switch (row.integration_type) {
    case 'pms_cloudbeds': {
      const propertyId = config.property_id
      if (!propertyId) return null
      let apiKey: string
      try {
        apiKey = decryptCredentials<{ api_key: string }>(row.credentials as EncryptedPayload).api_key
      } catch (err) {
        // Unreadable credentials must never take a guest conversation down —
        // treat the PMS as not connected (the Integrations test will show it).
        console.error('[pms] could not decrypt Cloudbeds credentials', err)
        return null
      }
      return cloudbedsAdapter(apiKey, propertyId)
    }
    default:
      return null
  }
}

/**
 * The connected PMS for a tenant, or null if none is connected.
 *
 * Works with both the service client (background jobs — pass tenantId) and a
 * signed-in staff client (RLS already limits rows to their own tenant;
 * tenantId is still applied when given).
 */
export async function pmsForTenant(db: SupabaseClient, tenantId?: string | null): Promise<PmsAdapter | null> {
  let query = db
    .from('tenant_integrations')
    .select('integration_type, status, credentials, config')
    .in('integration_type', PMS_INTEGRATION_TYPES as unknown as string[])
    .eq('status', 'connected')
  if (tenantId) query = query.eq('tenant_id', tenantId)

  const { data } = await query
  const rows = (data ?? []) as IntegrationRow[]
  for (const type of PMS_INTEGRATION_TYPES) {
    const adapter = pmsFromIntegration(rows.find((r) => r.integration_type === type))
    if (adapter) return adapter
  }
  return null
}
