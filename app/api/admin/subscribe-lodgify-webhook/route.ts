import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials, encryptCredentials, type EncryptedPayload } from '@/lib/crypto'
import { listWebhooks, subscribeWebhook, unsubscribeWebhook } from '@/lib/lodgify'

export const maxDuration = 60

/** Booking events that mean "a confirmed booking now exists". */
const EVENTS = ['booking_new_status_booked', 'booking_status_change_booked'] as const

/**
 * Registers this hotel's Lodgify webhooks (CRON_SECRET-gated admin tool).
 *
 *   POST /api/admin/subscribe-lodgify-webhook?tenantId=<uuid>
 *
 * Removes any existing subscription pointing at this tenant's URL first
 * (Lodgify requires target URLs to be unique, and their secrets can't be
 * fetched again), subscribes the booking events, then stores the returned
 * signing secrets encrypted on the integration so the webhook route can
 * verify every delivery.
 */
export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const tenantId = new URL(request.url).searchParams.get('tenantId')
  if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })

  const supabase = createServiceClient()
  const { data: integration } = await supabase
    .from('tenant_integrations')
    .select('id, status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'pms_lodgify')
    .maybeSingle()
  if (integration?.status !== 'connected' || !integration.credentials) {
    return NextResponse.json({ error: 'Lodgify is not connected for this tenant' }, { status: 404 })
  }

  const creds = decryptCredentials<{ api_key: string; webhook_secrets?: string[] }>(integration.credentials as EncryptedPayload)
  const auth = { apiKey: creds.api_key }
  const origin = new URL(request.url).origin
  const base = `${origin}/api/webhooks/lodgify/${tenantId}`

  // 1. Remove earlier subscriptions for this tenant's URL(s).
  const existing = await listWebhooks(auth)
  const existingList = existing.ok
    ? ((Array.isArray(existing.data) ? existing.data : ((existing.data as { items?: unknown[] })?.items ?? [])) as {
        id?: string
        target_url?: string
        url?: string
        event?: string
      }[])
    : []
  const removed: unknown[] = []
  for (const hook of existingList) {
    const url = hook.target_url ?? hook.url ?? ''
    if (hook.id && url.includes(`/api/webhooks/lodgify/${tenantId}`)) {
      const r = await unsubscribeWebhook(auth, hook.id)
      removed.push({ id: hook.id, url, event: hook.event, ok: r.ok, ...(r.ok ? {} : { error: r.error }) })
    }
  }

  // 2. Subscribe each event on its own URL (target URLs must be unique).
  const secrets: string[] = []
  const created: unknown[] = []
  for (const event of EVENTS) {
    const targetUrl = `${base}?event=${event}`
    const r = await subscribeWebhook(auth, event, targetUrl)
    if (!r.ok) {
      created.push({ event, ok: false, error: r.error })
      continue
    }
    const data = r.data as { id?: string; secret?: string } | null
    if (data?.secret) secrets.push(data.secret)
    created.push({ event, ok: true, id: data?.id, secretReceived: Boolean(data?.secret) })
  }

  // 3. Store the signing secrets (only now available) with the API key.
  if (secrets.length) {
    const { error } = await supabase
      .from('tenant_integrations')
      .update({ credentials: encryptCredentials({ ...creds, webhook_secrets: secrets }) })
      .eq('id', integration.id)
    if (error) return NextResponse.json({ error: `Subscribed, but saving the secrets failed: ${error.message}`, created, removed }, { status: 500 })
  }

  return NextResponse.json({
    listedExisting: existing.ok ? existingList.length : `could not list: ${existing.ok ? '' : existing.error}`,
    removed,
    created,
    secretsStored: secrets.length,
  })
}
