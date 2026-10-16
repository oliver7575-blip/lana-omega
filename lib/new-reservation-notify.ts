import { createServiceClient } from './supabase/service'
import { pmsForTenant } from './pms'
import {
  daysUntil,
  isActiveReservation,
  loadMessagingContext,
  recordReservation,
  sendGuestMessage,
} from './guest-messages'

/**
 * Runs when the hotel's PMS reports a new booking: sends the new-reservation
 * message, and — if arrival is 2 days away or less — the arrival
 * information right away too, since the daily 2-day job would miss it.
 */
export async function processNewReservation(tenantId: string, reservationID: string) {
  const supabase = createServiceClient()

  const pms = await pmsForTenant(supabase, tenantId)
  if (!pms) {
    return { step: 'integration_check', ok: false, detail: 'No PMS connected (or it is missing its property ID)' }
  }

  const lookup = await pms.lookupReservation(reservationID)
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
