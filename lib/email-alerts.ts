import type { createServiceClient } from './supabase/service'
import { notifyStaff } from './escalation'
import { parseEscalationContacts, findEscalationContact } from './escalation-contacts'
import type { EncryptedPayload } from './crypto'
import type { ReplyMail, ReplyTenant } from './email-reply'

// Who gets complaint alerts: the first of these contacts that exists in Settings → Escalation contacts.
const COMPLAINT_CONTACTS = ['complaints', 'oliver', 'reservations']

/**
 * A guest complained by email. Lana can't answer that herself, so she sends a WhatsApp alert to staff
 * (and logs it on the Escalations page). Returns a short note for the email's record.
 */
export async function alertStaffOfComplaint(
  db: ReturnType<typeof createServiceClient>,
  tenantId: string,
  tenant: ReplyTenant,
  mail: ReplyMail,
  info: { guestName?: string | null; summary: string; bookingNumber?: string | null }
): Promise<string> {
  const contacts = parseEscalationContacts(tenant.escalation_contacts)
  const key = COMPLAINT_CONTACTS.find((k) => findEscalationContact(contacts, k))
  const contact = key ? findEscalationContact(contacts, key) : undefined
  const { data: wa } = await db
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'whatsapp')
    .maybeSingle()
  const phoneNumberId = (wa?.config as { phone_number_id?: string } | null)?.phone_number_id
  const who = info.guestName || mail.fromName || mail.fromEmail

  // One line (WhatsApp template fields can't hold line breaks).
  const summary = [
    `Queja de huésped por email: ${who}`,
    info.bookingNumber ? `Reserva ${info.bookingNumber}` : null,
    info.summary,
    `Responder desde el panel (Emails) — ${mail.fromEmail}`,
  ].filter(Boolean).join(' · ').replace(/\s+/g, ' ').slice(0, 900)

  let delivered = false
  let error = ''
  if (!contact) error = 'no escalation contact set up'
  else if (wa?.status !== 'connected' || !wa.credentials || !phoneNumberId) error = 'WhatsApp is not connected'
  else {
    const r = await notifyStaff(phoneNumberId, wa.credentials as EncryptedPayload, contact.phone, info.bookingNumber ? `Reserva ${info.bookingNumber}` : mail.fromEmail,
      { category: key!, summary, urgency: 'high' }, tenant.message_templates, who)
    delivered = r.success
    if (!r.success) error = String((r as { error?: string }).error ?? 'send failed')
  }
  await db.from('escalations').insert({ tenant_id: tenantId, conversation_id: null, guest_id: null, category: key ?? 'reservations', urgency: 'high', summary, room: null, delivered })
  return delivered ? `complaint — staff alerted on WhatsApp (${key})` : `complaint — couldn't alert staff on WhatsApp (${error}), please check`
}
