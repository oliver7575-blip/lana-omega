import { sendWhatsAppMessage } from './whatsapp-send'
import type { EncryptedPayload } from './crypto'
import { getMapping, sendMappedTemplate } from './message-templates'

export interface EscalationInput {
  category: string
  roomNumber?: string
  summary: string
  urgency?: string
}

export interface EscalationResult {
  success: boolean
  error?: string
}

/**
 * Alerts a staff member. Uses the hotel's approved "staff escalation"
 * WhatsApp template when one is chosen (works any time), otherwise plain
 * text (only delivered if that staff member messaged the number in the
 * last 24 hours).
 */
export async function notifyStaff(
  phoneNumberId: string,
  whatsappCredentials: EncryptedPayload,
  staffNumber: string,
  guestIdentifier: string,
  input: EscalationInput,
  messageTemplates?: unknown,
  guestName?: string | null
): Promise<EscalationResult> {
  const mapping = getMapping(messageTemplates, 'staff_escalation')
  if (mapping) {
    const res = await sendMappedTemplate(phoneNumberId, whatsappCredentials, staffNumber, mapping, {
      category: input.category,
      room: input.roomNumber || '—',
      issue: input.summary,
      urgency: input.urgency || 'normal',
      guest_name: guestName || '—',
      guest_phone: guestIdentifier,
    })
    if (res.success) return res
    console.error('[escalation] template send failed, falling back to text', res.error)
  }

  const messageText = [
    `🔔 ${input.category.toUpperCase()}${input.urgency === 'urgent' ? ' — URGENT' : ''} — guest needs attention`,
    input.roomNumber ? `Room: ${input.roomNumber}` : null,
    `Guest: ${guestName ? `${guestName} (${guestIdentifier})` : guestIdentifier}`,
    `Issue: ${input.summary}`,
  ]
    .filter(Boolean)
    .join('\n')

  return sendWhatsAppMessage(phoneNumberId, whatsappCredentials, staffNumber, messageText)
}
