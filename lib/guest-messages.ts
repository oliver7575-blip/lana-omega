import { createServiceClient } from './supabase/service'
import type { EncryptedPayload } from './crypto'
import { getMapping, reservationValues, sendMappedTemplate } from './message-templates'
import { renderEmailTemplate, sendTenantEmail } from './email'

export type GuestPurpose = 'new_reservation' | 'arrival_reminder' | 'post_stay'

// sent_reminders.message_type values — kept stable so past sends still dedupe.
const WHATSAPP_TYPE: Record<GuestPurpose, string> = {
  new_reservation: 'new_reservation',
  arrival_reminder: 'arrival_reminder',
  post_stay: 'post_stay_feedback',
}

export interface GuestReservation {
  reservationID: string
  guestName?: string
  guestPhone?: string
  guestEmail?: string
  startDate?: string
  endDate?: string
  roomTypeName?: string
}

export interface MessagingContext {
  tenantId: string
  tenantName: string
  messageTemplates: unknown
  whatsapp: { phoneNumberId: string; credentials: EncryptedPayload } | null
}

export async function loadMessagingContext(tenantId: string): Promise<MessagingContext | null> {
  const supabase = createServiceClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, name, message_templates')
    .eq('id', tenantId)
    .single()
  if (!tenant) return null

  const { data: wa } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'whatsapp')
    .maybeSingle()
  const phoneNumberId = (wa?.config as { phone_number_id?: string } | null)?.phone_number_id

  return {
    tenantId,
    tenantName: tenant.name as string,
    messageTemplates: tenant.message_templates,
    whatsapp:
      wa?.status === 'connected' && wa.credentials && phoneNumberId
        ? { phoneNumberId, credentials: wa.credentials as EncryptedPayload }
        : null,
  }
}

async function alreadySent(tenantId: string, reservationID: string, type: string) {
  const { data } = await createServiceClient()
    .from('sent_reminders')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('reservation_id', reservationID)
    .eq('message_type', type)
    .maybeSingle()
  return Boolean(data)
}

async function markSent(tenantId: string, reservationID: string, type: string) {
  await createServiceClient()
    .from('sent_reminders')
    .insert({ tenant_id: tenantId, reservation_id: reservationID, message_type: type })
}

export interface ChannelResult {
  sent: boolean
  skipped?: string
  error?: string
}

/**
 * Sends one automated guest message (WhatsApp template + email) for a
 * reservation. Each channel is independent and sent at most once.
 */
export async function sendGuestMessage(
  ctx: MessagingContext,
  purpose: GuestPurpose,
  r: GuestReservation
): Promise<{ whatsapp: ChannelResult; email: ChannelResult }> {
  const mapping = getMapping(ctx.messageTemplates, purpose)
  const language = mapping?.language ?? 'es_MX'
  const values = reservationValues(r, language, ctx.tenantName)

  // ---- WhatsApp -------------------------------------------------------------
  let whatsapp: ChannelResult
  const waType = WHATSAPP_TYPE[purpose]
  if (!ctx.whatsapp) whatsapp = { sent: false, skipped: 'WhatsApp not connected' }
  else if (!mapping) whatsapp = { sent: false, skipped: 'No WhatsApp template chosen for this message' }
  else if (!r.guestPhone) whatsapp = { sent: false, skipped: 'No phone number on the reservation' }
  else if (await alreadySent(ctx.tenantId, r.reservationID, waType))
    whatsapp = { sent: false, skipped: 'Already sent' }
  else {
    const res = await sendMappedTemplate(
      ctx.whatsapp.phoneNumberId,
      ctx.whatsapp.credentials,
      r.guestPhone,
      mapping,
      values
    )
    if (res.success) await markSent(ctx.tenantId, r.reservationID, waType)
    whatsapp = { sent: res.success, error: res.error }
  }

  // ---- Email ----------------------------------------------------------------
  let email: ChannelResult
  const emailType = `${waType}_email`
  const { data: tpl } = await createServiceClient()
    .from('email_templates')
    .select('enabled, subject, body_html')
    .eq('tenant_id', ctx.tenantId)
    .eq('purpose', purpose)
    .maybeSingle()

  if (!tpl?.enabled) email = { sent: false, skipped: 'Email turned off for this message' }
  else if (!tpl.subject?.trim() || !tpl.body_html?.trim()) email = { sent: false, skipped: 'Email template is empty' }
  else if (!r.guestEmail) email = { sent: false, skipped: 'No email on the reservation' }
  else if (await alreadySent(ctx.tenantId, r.reservationID, emailType))
    email = { sent: false, skipped: 'Already sent' }
  else {
    const res = await sendTenantEmail(
      ctx.tenantId,
      r.guestEmail,
      renderEmailTemplate(tpl.subject, values, false),
      renderEmailTemplate(tpl.body_html, values, true)
    )
    if (res.success) await markSent(ctx.tenantId, r.reservationID, emailType)
    email = { sent: res.success, error: res.error }
  }

  return { whatsapp, email }
}

/** Whole days from today (hotel-agnostic, UTC) until a YYYY-MM-DD date. */
export function daysUntil(date: string | undefined): number | null {
  if (!date) return null
  const target = Date.parse(`${date.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(target)) return null
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  return Math.round((target - today) / 86400000)
}

const INACTIVE_STATUSES = new Set(['canceled', 'cancelled', 'no_show'])
export function isActiveReservation(status: string | undefined): boolean {
  return !INACTIVE_STATUSES.has((status ?? '').toLowerCase())
}
