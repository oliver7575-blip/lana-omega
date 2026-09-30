import { createServiceClient } from './supabase/service'
import { decryptCredentials } from './crypto'
import { lookupReservation } from './cloudbeds'
import {
  daysUntil,
  isActiveReservation,
  loadMessagingContext,
  recordReservation,
  sendGuestMessage,
} from './guest-messages'

/**
 * Runs when Cloudbeds reports a new booking: sends the new-reservation
 * message, and — if arrival is 2 days away or less — the arrival
 * information right away too, since the daily 2-day job would miss it.
 */
export async function processNewReservation(tenantId: string, reservationID: string) {
  const supabase = createServiceClient()

  const { data: cloudbeds } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'pms_cloudbeds')
    .maybeSingle()

  if (cloudbeds?.status !== 'connected') {
    return { step: 'integration_check', ok: false, detail: 'Cloudbeds not connected' }
  }

  const { api_key } = decryptCredentials<{ api_key: string }>(cloudbeds.credentials)
  const propertyId = (cloudbeds.config as { property_id?: string })?.property_id
  if (!propertyId) return { step: 'config_check', ok: false, detail: 'Missing property_id' }

  const lookup = await lookupReservation(api_key, propertyId, reservationID)
  if (!lookup.found || !lookup.reservationID) {
    return { step: 'lookup', ok: false, detail: 'Reservation not found', lookup }
  }
  if (!isActiveReservation(lookup.status)) {
    return { step: 'lookup', ok: false, detail: `Reservation is ${lookup.status}`, lookup }
  }

  const ctx = await loadMessagingContext(tenantId)
  if (!ctx) return { step: 'tenant', ok: false, detail: 'Tenant not found' }

  const reservation = {
    reservationID: lookup.reservationID,
    guestName: lookup.guestName,
    guestPhone: lookup.guestPhone,
    guestEmail: lookup.guestEmail,
    startDate: lookup.startDate,
    endDate: lookup.endDate,
    roomTypeName: lookup.roomTypeName,
  }

  // Show the booking in the panel straight away (guest, reservation, conversation).
  const conversationId = await recordReservation(tenantId, { ...reservation, status: lookup.status })

  const newReservation = await sendGuestMessage(ctx, 'new_reservation', reservation)

  // Nothing was sent (no template chosen yet) — leave a note so the booking still appears.
  if (conversationId && !newReservation.whatsapp.sent && !newReservation.email.sent) {
    const { logLanaMessage } = await import('./guest-records')
    const { createServiceClient } = await import('./supabase/service')
    await logLanaMessage(
      createServiceClient(),
      tenantId,
      conversationId,
      `[New reservation #${reservation.reservationID} · ${reservation.startDate} → ${reservation.endDate}${reservation.roomTypeName ? ` · ${reservation.roomTypeName}` : ''} — no welcome message sent: ${newReservation.whatsapp.skipped ?? newReservation.whatsapp.error ?? 'WhatsApp not sent'}]`
    )
  }

  const days = daysUntil(lookup.startDate)
  const arrival =
    days !== null && days >= 0 && days <= 2
      ? await sendGuestMessage(ctx, 'arrival_reminder', reservation)
      : null

  return { step: 'send', ok: true, reservation, newReservation, arrival }
}
