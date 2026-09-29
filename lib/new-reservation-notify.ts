import { createServiceClient } from './supabase/service'
import { decryptCredentials } from './crypto'
import { lookupReservation } from './cloudbeds'
import { sendWhatsAppMessage } from './whatsapp-send'
import { generateReply } from './anthropic'

export async function processNewReservation(tenantId: string, reservationID: string) {
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
    return { step: 'integration_check', ok: false, detail: 'Cloudbeds or WhatsApp not connected' }
  }

  const { data: alreadySent } = await supabase
    .from('sent_reminders')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('reservation_id', reservationID)
    .eq('message_type', 'new_reservation')
    .maybeSingle()

  if (alreadySent) {
    return { step: 'dedup_check', ok: false, detail: 'Already sent for this reservation' }
  }

  const { api_key } = decryptCredentials<{ api_key: string }>(cloudbedsIntegration.credentials)
  const propertyId = (cloudbedsIntegration.config as { property_id?: string })?.property_id
  const phoneNumberId = (whatsappIntegration.config as { phone_number_id?: string })
    ?.phone_number_id

  if (!propertyId || !phoneNumberId) {
    return { step: 'config_check', ok: false, detail: 'Missing property_id or phone_number_id config' }
  }

  const lookup = await lookupReservation(api_key, propertyId, reservationID)
  if (!lookup.found) {
    return { step: 'lookup', ok: false, detail: 'Reservation not found', lookup }
  }
  if (!lookup.guestPhone) {
    return { step: 'lookup', ok: false, detail: 'Reservation found but no guest phone', lookup }
  }

  const systemPrompt =
    (tenant?.ai_persona_prompt ?? 'You are a warm, helpful hotel concierge.') +
    `\n\nWrite a short, warm WhatsApp welcome message to ${lookup.guestName ?? 'the guest'}, confirming their new reservation from ${lookup.startDate} to ${lookup.endDate}. Invite them to reach out with any questions before their stay. Do not ask any questions yourself, just send the welcome.\n\nIMPORTANT: Output ONLY the exact raw text of the WhatsApp message itself, nothing else — no title, no markdown headers, no horizontal rules, no notes to yourself, no commentary about the message. Whatever you output will be sent to the guest exactly as-is.`

  let messageText: string
  try {
    const result = await generateReply(systemPrompt, [
      { role: 'user', content: 'Write the welcome message now.' },
    ])
    messageText = result.text
  } catch (err) {
    return {
      step: 'ai_generation',
      ok: false,
      detail: err instanceof Error ? err.message : 'AI generation failed',
    }
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

  return { step: 'send', ok: sendResult.success, lookup, messageText, sendResult }
}