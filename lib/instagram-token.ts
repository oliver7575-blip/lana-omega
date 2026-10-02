/**
 * Keeps Instagram Login tokens alive. They last 60 days and can be renewed
 * (once they're at least 24 hours old) for another 60 — indefinitely, as long
 * as it happens before they expire. We renew weekly.
 */
import { createServiceClient } from './supabase/service'
import { decryptCredentials, encryptCredentials, type EncryptedPayload } from './crypto'
import { sendWhatsAppMessage } from './whatsapp-send'
import { findEscalationContact, parseEscalationContacts } from './escalation-contacts'

const RENEW_AFTER_DAYS = 7
const WARN_WITHIN_DAYS = 10

export interface RenewResult {
  tenantId: string
  status: 'renewed' | 'not_due' | 'skipped' | 'failed'
  expiresAt?: string
  error?: string
}

export async function renewInstagramTokens(): Promise<RenewResult[]> {
  const db = createServiceClient()
  const { data: rows } = await db
    .from('tenant_integrations')
    .select('id, tenant_id, status, credentials, config')
    .eq('integration_type', 'instagram')
    .eq('status', 'connected')

  const results: RenewResult[] = []
  for (const row of rows ?? []) {
    const config = (row.config ?? {}) as Record<string, string | undefined>
    const tenantId = row.tenant_id as string

    // Facebook Page tokens don't use this renewal (they can be made permanent).
    if (config.page_id) {
      results.push({ tenantId, status: 'skipped' })
      continue
    }
    const last = config.token_refreshed_at ? Date.parse(config.token_refreshed_at) : 0
    if (last && Date.now() - last < RENEW_AFTER_DAYS * 86400000) {
      results.push({ tenantId, status: 'not_due', expiresAt: config.token_expires_at })
      continue
    }

    const creds = decryptCredentials<{ access_token: string; app_secret?: string }>(row.credentials as EncryptedPayload)
    try {
      const res = await fetch(
        `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(creds.access_token)}`,
        { signal: AbortSignal.timeout(15000) }
      )
      const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: { message?: string } }
      if (!res.ok || !json.access_token) throw new Error(json.error?.message ?? `Instagram token renewal failed (${res.status})`)

      const expiresAt = new Date(Date.now() + (json.expires_in ?? 60 * 86400) * 1000).toISOString()
      await db
        .from('tenant_integrations')
        .update({
          credentials: encryptCredentials({ ...creds, access_token: json.access_token }),
          config: { ...config, token_refreshed_at: new Date().toISOString(), token_expires_at: expiresAt, token_refresh_error: null },
        })
        .eq('id', row.id)
      results.push({ tenantId, status: 'renewed', expiresAt })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Renewal failed'
      await db.from('tenant_integrations').update({ config: { ...config, token_refresh_error: message } }).eq('id', row.id)
      results.push({ tenantId, status: 'failed', error: message })

      // Warn the hotel on WhatsApp if the token is about to run out.
      // (A brand-new token can't be renewed for 24 hours; with no known expiry
      // yet we just retry tomorrow rather than raise a false alarm.)
      const expires = config.token_expires_at ? Date.parse(config.token_expires_at) : null
      if (expires && expires - Date.now() < WARN_WITHIN_DAYS * 86400000) {
        await warnHotel(tenantId, message, config.token_expires_at).catch(() => {})
      }
    }
  }
  return results
}

async function warnHotel(tenantId: string, error: string, expiresAt?: string) {
  const db = createServiceClient()
  const [{ data: tenant }, { data: wa }] = await Promise.all([
    db.from('tenants').select('escalation_contacts').eq('id', tenantId).single(),
    db.from('tenant_integrations').select('status, credentials, config').eq('tenant_id', tenantId).eq('integration_type', 'whatsapp').maybeSingle(),
  ])
  const contacts = parseEscalationContacts(tenant?.escalation_contacts)
  const contact = findEscalationContact(contacts, 'oliver') ?? contacts[0]
  const phoneId = (wa?.config as { phone_number_id?: string } | null)?.phone_number_id
  if (!contact || wa?.status !== 'connected' || !wa.credentials || !phoneId) return
  await sendWhatsAppMessage(
    phoneId,
    wa.credentials as EncryptedPayload,
    contact.phone,
    `⚠️ Lana: the Instagram connection could not renew its access token${expiresAt ? ` (it expires ${expiresAt.slice(0, 10)})` : ''}. ` +
      `Generate a new token in Meta (Lana - IG → API setup with Instagram login) and reconnect Instagram under Integrations. Error: ${error.slice(0, 200)}`
  )
}
