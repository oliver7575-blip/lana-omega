import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials } from '@/lib/crypto'
import { getRecentlyCreatedReservations } from '@/lib/cloudbeds'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'
import { generateReply } from '@/lib/anthropic'

export const maxDuration = 60

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

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

    const newReservationsResult = await getRecentlyCreatedReservations(api_key, propertyId, 3)
    if (!newReservationsResult.success) {
      results.push({ tenantId: tenant.id, error: newReservationsResult.error })
      continue
    }

    for (const reservation of newReservationsResult.reservations) {
      const { data: alreadySent } = await supabase
        .from('sent_reminders')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('reservation_id', reservation.reservationID)
        .eq('message_type', 'new_reservation')
        .maybeSingle()

      if (alreadySent) continue

      if (!reservation.phone) {
        results.push({
          tenantId: tenant.id,
          reservationID: reservation.reservationID,
          skipped: 'no phone number found on this reservation',
        })
        continue
      }

      const systemPrompt =
        (tenant.ai_persona_prompt ?? 'You are a warm, helpful hotel concierge.') +
        `\n\nWrite a short, warm WhatsApp welcome message to ${reservation.guestName ?? 'the guest'}, confirming their new reservation from ${reservation.startDate} to ${reservation.endDate}. Invite them to reach out with any questions before their stay. Do not ask any questions yourself, just send the welcome.`

      let messageText: string
      try {
        const result = await generateReply(systemPrompt, [
          { role: 'user', content: 'Write the welcome message now.' },
        ])
        messageText = result.text
      } catch (err) {
        results.push({
          tenantId: tenant.id,
          reservationID: reservation.reservationID,
          error: err instanceof Error ? err.message : 'AI generation failed',
        })
        continue
      }

      const sendResult = await sendWhatsAppMessage(
        phoneNumberId,
        whatsappIntegration.credentials,
        reservation.phone,
        messageText
      )

      if (sendResult.success) {
        await supabase.from('sent_reminders').insert({
          tenant_id: tenant.id,
          reservation_id: reservation.reservationID,
          message_type: 'new_reservation',
        })
      }

      results.push({
        tenantId: tenant.id,
        reservationID: reservation.reservationID,
        guestName: reservation.guestName,
        sendResult,
      })
    }
  }

  return NextResponse.json({ results })
}