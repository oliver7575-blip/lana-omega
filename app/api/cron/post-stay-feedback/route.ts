import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials } from '@/lib/crypto'
import { getDeparturesInWindow } from '@/lib/cloudbeds'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'
import { generateReply } from '@/lib/anthropic'

export const maxDuration = 60

function yesterdayISO(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const targetDate = yesterdayISO()

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

    const departuresResult = await getDeparturesInWindow(api_key, propertyId, targetDate)
    if (!departuresResult.success) {
      results.push({ tenantId: tenant.id, error: departuresResult.error })
      continue
    }

    for (const departure of departuresResult.departures) {
      const { data: alreadySent } = await supabase
        .from('sent_reminders')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('reservation_id', departure.reservationID)
        .eq('message_type', 'post_stay_feedback')
        .maybeSingle()

      if (alreadySent) continue

      if (!departure.phone) {
        results.push({
          tenantId: tenant.id,
          reservationID: departure.reservationID,
          skipped: 'no phone number found on this reservation',
        })
        continue
      }

      const systemPrompt =
        (tenant.ai_persona_prompt ?? 'You are a warm, helpful hotel concierge.') +
        `\n\nWrite a short, warm WhatsApp message to ${departure.guestName ?? 'the guest'} thanking them for their recent stay, and asking if they'd be willing to share quick feedback or a review. Keep it brief and genuine, not pushy. Do not ask more than one question.`

      let messageText: string
      try {
        messageText = await generateReply(systemPrompt, [
          { role: 'user', content: 'Write the feedback request message now.' },
        ])
      } catch (err) {
        results.push({
          tenantId: tenant.id,
          reservationID: departure.reservationID,
          error: err instanceof Error ? err.message : 'AI generation failed',
        })
        continue
      }

      const sendResult = await sendWhatsAppMessage(
        phoneNumberId,
        whatsappIntegration.credentials,
        departure.phone,
        messageText
      )

      if (sendResult.success) {
        await supabase.from('sent_reminders').insert({
          tenant_id: tenant.id,
          reservation_id: departure.reservationID,
          message_type: 'post_stay_feedback',
        })
      }

      results.push({
        tenantId: tenant.id,
        reservationID: departure.reservationID,
        guestName: departure.guestName,
        sendResult,
      })
    }
  }

  return NextResponse.json({ targetDate, results })
}
