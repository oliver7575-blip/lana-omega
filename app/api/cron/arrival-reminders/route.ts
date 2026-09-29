import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials } from '@/lib/crypto'
import { getArrivalsInWindow } from '@/lib/cloudbeds'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'
import { generateReply } from '@/lib/anthropic'

export const maxDuration = 60

function twoDaysFromNowISO(): string {
  const d = new Date()
  d.setDate(d.getDate() + 2)
  return d.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const targetDate = twoDaysFromNowISO()

  const { data: tenants } = await supabase.from('tenants').select('id, ai_persona_prompt')
  const results: Record<string, unknown>[] = []

  for (const tenant of tenants ?? []) {
    const { data: cloudbedsIntegration } = await supabase
      .from('tenant_integrations')
      .select('status, credentials, config')
      .eq('tenant_id', tenant.id)
      .eq('integration_type', 'pms_cloudbeds')
      .maybeSingle()

    const { data: whatsappIntegration } = await supabase
      .from('tenant_integrations')
      .select('status, credentials, config')
      .eq('tenant_id', tenant.id)
      .eq('integration_type', 'whatsapp')
      .maybeSingle()

    if (cloudbedsIntegration?.status !== 'connected' || whatsappIntegration?.status !== 'connected') {
      continue
    }

    const { api_key } = decryptCredentials<{ api_key: string }>(cloudbedsIntegration.credentials)
    const propertyId = (cloudbedsIntegration.config as { property_id?: string })?.property_id
    const phoneNumberId = (whatsappIntegration.config as { phone_number_id?: string })
      ?.phone_number_id

    if (!propertyId || !phoneNumberId) continue

    const arrivalsResult = await getArrivalsInWindow(api_key, propertyId, targetDate)
    if (!arrivalsResult.success) {
      results.push({ tenantId: tenant.id, error: arrivalsResult.error })
      continue
    }

    for (const arrival of arrivalsResult.arrivals) {
      const { data: alreadySent } = await supabase
        .from('sent_reminders')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('reservation_id', arrival.reservationID)
        .eq('message_type', 'arrival_reminder')
        .maybeSingle()

      if (alreadySent) continue

      if (!arrival.phone) {
        results.push({
          tenantId: tenant.id,
          reservationID: arrival.reservationID,
          skipped: 'no phone number found on this reservation',
        })
        continue
      }

      const systemPrompt =
        (tenant.ai_persona_prompt ?? 'You are a warm, helpful hotel concierge.') +
        `\n\nWrite a short, warm WhatsApp message to ${arrival.guestName ?? 'the guest'} reminding them their stay begins in 2 days (check-in date: ${arrival.startDate}). Invite them to reach out with any questions before arrival. Do not ask any questions yourself, just send the reminder.\n\nIMPORTANT: Output ONLY the exact raw text of the WhatsApp message itself, nothing else — no title, no markdown headers, no horizontal rules, no notes to yourself, no commentary about the message. Whatever you output will be sent to the guest exactly as-is.`

      let messageText: string
      try {
        messageText = await generateReply(systemPrompt, [
          { role: 'user', content: 'Write the reminder message now.' },
        ])
      } catch (err) {
        results.push({
          tenantId: tenant.id,
          reservationID: arrival.reservationID,
          error: err instanceof Error ? err.message : 'AI generation failed',
        })
        continue
      }

      const sendResult = await sendWhatsAppMessage(
        phoneNumberId,
        whatsappIntegration.credentials,
        arrival.phone,
        messageText
      )

      if (sendResult.success) {
        await supabase.from('sent_reminders').insert({
          tenant_id: tenant.id,
          reservation_id: arrival.reservationID,
          message_type: 'arrival_reminder',
        })
      }

      results.push({
        tenantId: tenant.id,
        reservationID: arrival.reservationID,
        guestName: arrival.guestName,
        sendResult,
      })
    }
  }

  return NextResponse.json({ targetDate, results })
}
