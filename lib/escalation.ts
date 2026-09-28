import { sendWhatsAppMessage } from './whatsapp-send'
import type { EncryptedPayload } from './crypto'

export interface EscalationInput {
  category: string
  roomNumber?: string
  summary: string
}

export interface EscalationResult {
  success: boolean
  error?: string
}

export async function notifyStaff(
  phoneNumberId: string,
  whatsappCredentials: EncryptedPayload,
  staffNumber: string,
  guestIdentifier: string,
  input: EscalationInput
): Promise<EscalationResult> {
  const messageText = [
    `🔔 ${input.category.toUpperCase()} — guest needs attention`,
    input.roomNumber ? `Room: ${input.roomNumber}` : null,
    `Guest: ${guestIdentifier}`,
    `Issue: ${input.summary}`,
  ]
    .filter(Boolean)
    .join('\n')

  return sendWhatsAppMessage(phoneNumberId, whatsappCredentials, staffNumber, messageText)
}
