import { sendWhatsAppMessage } from './whatsapp-send'
import type { EncryptedPayload } from './crypto'
import { getMapping, sendMappedTemplate } from './message-templates'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EscalationContact } from './escalation-contacts'
import { hhmmToMinutes, zonedParts } from './tz'

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
      issue: input.summary.replace(/\s*\n\s*/g, ' | '),
      urgency: input.urgency || 'normal',
      guest_name: guestName || '—',
      guest_phone: guestIdentifier,
    })
    if (res.success) return res
    console.error('[escalation] template send failed, falling back to text', res.error)
  }

  const messageText = [
    `🔔 ${input.category.toUpperCase()}${input.urgency === 'urgent' ? ' — URGENTE' : ''}`,
    input.roomNumber ? `Habitación: ${input.roomNumber}` : null,
    `Huésped: ${guestName ? `${guestName} (${guestIdentifier})` : guestIdentifier}`,
    `Asunto: ${input.summary}`,
    '*Favor de atender al huésped*',
  ]
    .filter(Boolean)
    .join('\n')

  return sendWhatsAppMessage(phoneNumberId, whatsappCredentials, staffNumber, messageText)
}

/** True when `now` falls inside the contact's working hours in the hotel's timezone (no hours = always). */
export function isWithinHours(hours: EscalationContact['hours'], tz: string, now = new Date()): boolean {
  if (!hours) return true
  const start = hhmmToMinutes(hours.start)
  const end = hhmmToMinutes(hours.end)
  if (start == null || end == null) return true
  const p = zonedParts(now, tz)
  const m = p.hour * 60 + p.minute
  return m >= start && m < end
}

export interface DispatchArgs {
  db: SupabaseClient
  tenantId: string
  contact: EscalationContact
  phoneNumberId: string
  credentials: EncryptedPayload
  guestIdentifier: string
  input: EscalationInput
  messageTemplates?: unknown
  guestName?: string | null
  conversationId: string | null
  guestId: string | null
  /** Set when the guest wrote by email: where Lana sends the team's answer back to them. */
  emailReply?: { to: string; messageId: string; references: string | null; subject: string; snippet: string } | null
}

/**
 * Sends the staff alert now, or, when the contact has working hours and it is outside them,
 * saves it as "held" so the morning digest sends it. Always records the escalation row.
 */
export async function dispatchEscalation(a: DispatchArgs): Promise<EscalationResult & { held?: boolean; note?: string }> {
  let held = false
  if (a.contact.hours) {
    const { data } = await a.db.from('tenants').select('timezone').eq('id', a.tenantId).single()
    const tz = (data?.timezone as string) || 'America/Mexico_City'
    held = !isWithinHours(a.contact.hours, tz)
  }
  const result: EscalationResult = held
    ? { success: true }
    : await notifyStaff(a.phoneNumberId, a.credentials, a.contact.phone, a.guestIdentifier, a.input, a.messageTemplates, a.guestName)
  await a.db.from('escalations').insert({
    tenant_id: a.tenantId,
    conversation_id: a.conversationId,
    guest_id: a.guestId,
    category: a.input.category,
    urgency: a.input.urgency ?? 'normal',
    summary: a.input.summary,
    room: a.input.roomNumber ?? null,
    delivered: held ? false : result.success,
    held,
    ...(a.emailReply ? { email_reply: a.emailReply } : {}),
  })
  if (!held) return result
  return {
    success: true,
    held: true,
    note: `It is outside the team's working hours (${a.contact.hours!.start} to ${a.contact.hours!.end}), so the team has NOT been alerted yet. The request is saved and goes to the team as soon as they start, first thing in the morning. Kindly acknowledge the guest's request, apologise that the team has finished for the day, and ask them to wait for the service first thing in the morning. Do not promise an exact time, and do not say the team was notified just now.`,
  }
}
