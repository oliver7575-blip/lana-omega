import crypto from 'crypto'
import { NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials, type EncryptedPayload } from '@/lib/crypto'
import { processNewReservation } from '@/lib/new-reservation-notify'

export const maxDuration = 60

/**
 * Lodgify webhook receiver, one URL per tenant.
 *
 * Lodgify signs every delivery: header `ms-signature: sha256=<HEX>` (upper
 * case), an HMAC-SHA256 of the raw JSON body keyed with the per-webhook
 * secret it returned when the subscription was created. Those secrets are
 * stored encrypted on the tenant's pms_lodgify integration
 * (credentials.webhook_secrets) by app/api/admin/subscribe-lodgify-webhook.
 *
 * Anything other than a 200 makes Lodgify retry (up to 10 times), so valid
 * deliveries are acknowledged straight away and processed after the
 * response; new-booking messages are deduplicated in sent_reminders.
 */
function signatureMatches(rawBody: string, header: string | null, secrets: string[]): boolean {
  if (!header) return false
  const given = header.trim().replace(/^sha256=/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(given)) return false
  return secrets.some((secret) => {
    const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'))
  })
}

const NEW_BOOKING_EVENTS = new Set(['booking_new_status_booked', 'booking_status_change_booked'])

export async function POST(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params
  const rawBody = await request.text()

  const supabase = createServiceClient()
  const { data: integration } = await supabase
    .from('tenant_integrations')
    .select('status, credentials')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'pms_lodgify')
    .maybeSingle()

  if (integration?.status !== 'connected' || !integration.credentials) {
    // 410 tells Lodgify this endpoint is gone for good.
    return NextResponse.json({ error: 'Lodgify is not connected for this hotel' }, { status: 410 })
  }

  let secrets: string[] = []
  try {
    secrets = decryptCredentials<{ webhook_secrets?: string[] }>(integration.credentials as EncryptedPayload).webhook_secrets ?? []
  } catch {
    secrets = []
  }
  if (!signatureMatches(rawBody, request.headers.get('ms-signature'), secrets)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let parsed: unknown = {}
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ received: true, ignored: 'not JSON' })
  }
  // Lodgify's payload shape isn't fixed: accept an object or a list, with the id under booking.id, id or booking_id.
  const first = (Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown> | undefined
  const bk = (first?.booking ?? first?.data ?? first) as Record<string, unknown> | undefined
  const idRaw = (bk?.id ?? bk?.booking_id ?? first?.booking_id ?? first?.id) as string | number | undefined
  const bookingId = idRaw !== undefined && idRaw !== null ? String(idRaw) : undefined
  // The subscribed event is also in our own URL (?event=...), which is the fallback when the body doesn't say.
  const action = ((first?.action ?? first?.event ?? new URL(request.url).searchParams.get('event')) as string | null) ?? undefined
  await supabase.from('welcome_log').insert({ tenant_id: tenantId, reservation_id: bookingId ?? null, source: 'webhook_received', result: { action, raw: rawBody.slice(0, 1500) } })
  const body = { action }
  if (bookingId && body.action && NEW_BOOKING_EVENTS.has(body.action)) {
    after(async () => {
      // Same dedup table the cron jobs use: a retry or a second "booked"
      // event for the same booking must not send the welcome twice.
      const { data: already } = await supabase
        .from('sent_reminders')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('reservation_id', bookingId)
        .eq('message_type', 'new_reservation')
        .maybeSingle()
      if (already) return
      const result = await processNewReservation(tenantId, bookingId, 'webhook')
      console.log('[lodgify-webhook]', body.action, bookingId, JSON.stringify(result).slice(0, 500))
    })
  }

  return NextResponse.json({ received: true })
}
