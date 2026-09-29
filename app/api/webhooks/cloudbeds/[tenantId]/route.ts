import { NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials } from '@/lib/crypto'
import { lookupReservation } from '@/lib/cloudbeds'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'
import { generateReply } from '@/lib/anthropic'

export const maxDuration = 60

async function processNewReservation(tenantId: string, reservationID: string) {
  const supabase = createServiceClient()

  const { data: tenant } = await supabase
    .from('tenants')
    .select('ai_persona_prompt')
    .eq('id', tenantId)
    .single()

  const { data: cloudbedsIntegration } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'pms_cloudbeds')
    .maybeSingle()

  const { data: whatsappIntegration } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'whatsapp')
    .maybeSingle()

  if (cloudbedsIntegration?.status !== 'connected' || whatsappIntegration?.status !== 'connected') {
    return
  }

  const { data: alreadySent } = await supabase
    .from('sent_reminders')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('reservation_id', reservationID)
    .eq('message_type', 'new_reservation')
    .maybeSingle()

  if (alreadySent) return

  const { api_key } = decryptCredentials<{ api_key: string }>(cloudbedsIntegration.credentials)
  const propertyId = (cloudbedsIntegration.config as { property_id?: string })?.property_id
  const phoneNumberId = (whatsappIntegration.config as { phone_number_id?: string })
    ?.phone_number_id

  if (!propertyId || !phoneNumberId) return

  // Reuses the same lookupReservation already proven correct against real
  // data earlier this session — the webhook payload only gives us a bare
  // reservationID, so a real lookup is needed to get guest name/phone/dates.
  const lookup = await lookupReservation(api_key, propertyId, reservationID)
  if (!lookup.found || !lookup.guestPhone) return

  const systemPrompt =
    (tenant?.ai_persona_prompt ?? 'You are a warm, helpful hotel concierge.') +
    `\n\nWrite a short, warm WhatsApp welcome message to ${lookup.guestName ?? 'the guest'}, confirming their new reservation from ${lookup.startDate} to ${lookup.endDate}. Invite them to reach out with any questions before their stay. Do not ask any questions yourself, just send the welcome.`

  let messageText: string
  try {
    messageText = await generateReply(systemPrompt, [
      { role: 'user', content: 'Write the welcome message now.' },
    ])
  } catch {
    return
  }

  const sendResult = await sendWhatsAppMessage(
    phoneNumberId,
    whatsappIntegration.credentials,
    lookup.guestPhone,
    messageText
  )

  if (sendResult.success) {
    await supabase.from('sent_reminders').insert({
      tenant_id: tenantId,
      reservation_id: reservationID,
      message_type: 'new_reservation',
    })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params
  const body = (await request.json()) as Record<string, unknown>

  // Cloudbeds retries aggressively on anything but a fast 2XX (their own
  // docs: >2s is treated as a timeout and retried). Acknowledge immediately,
  // then do the real work via after() so a slow AI call or WhatsApp send
  // never risks that timeout.
  const reservationID = body.reservationID as string | undefined
  const event = body.event as string | undefined

  if (reservationID && event === 'reservation/created') {
    after(() => processNewReservation(tenantId, reservationID))
  }

  return NextResponse.json({ received: true })
}
