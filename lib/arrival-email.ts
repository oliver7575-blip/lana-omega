import { createServiceClient } from './supabase/service'
import { cloudbedsForTenant } from './cloudbeds-tenant'
import { findReservationByConfirmation, getReservationDetail, setEstimatedArrival } from './cloudbeds-ops'
import { notifyStaff } from './escalation'
import { parseEscalationContacts, findEscalationContact } from './escalation-contacts'
import {
  arrivalSituation,
  composeEmailReply,
  deliverReply,
  repliesEnabled,
  replyGuard,
  REPLY_TENANT_COLUMNS,
  type ReplyMail,
  type ReplyTenant,
} from './email-reply'
import type { EncryptedPayload } from './crypto'

/**
 * A guest emailed when they will arrive. Lana:
 *  1. saves the time on their reservation in Cloudbeds,
 *  2. answers the guest by email (the arrival time, plus anything else they asked
 *     that the knowledge base covers),
 *  3. for arrivals outside check-in hours (after 9 PM / before 8 AM), alerts
 *     the reservations contact on WhatsApp so a person can arrange it.
 * What happened is recorded on the email so staff can see it.
 */

export interface ArrivalInfo {
  confirmation_number?: string | null
  time?: string | null
  kind?: 'stated' | 'request' | null
  check_in_date?: string | null
  guest_name?: string | null
  guest_message?: string | null
}

export type ArrivalMail = ReplyMail

export async function handleArrivalEmail(tenantId: string, mail: ArrivalMail, arrival: ArrivalInfo): Promise<void> {
  const db = createServiceClient()
  const time = (arrival.time ?? '').trim()
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return
  const number = (arrival.confirmation_number ?? '').trim()
  const kind = arrival.kind === 'request' ? 'request' : 'stated'
  const situation = arrivalSituation(time)

  // ---- 1. Save the arrival time in Cloudbeds -------------------------------
  let saved: { id: string; guestName: string; startDate: string; endDate: string; room: string } | null = null
  let problem: string | null = null
  let savedNote = ''
  if (!number) {
    problem = `Guest gave an arrival time (${time}) but no booking number — add it in Cloudbeds by hand.`
  } else {
    try {
      const cb = await cloudbedsForTenant(db, tenantId)
      if (!cb) {
        problem = 'Cloudbeds is not connected, so the arrival time was not saved.'
      } else {
        const found = await findReservationByConfirmation(cb, number, arrival.check_in_date)
        if (!found) {
          problem = `Couldn't find booking ${number} in Cloudbeds — add the arrival time (${time}) by hand.`
        } else {
          const d = await getReservationDetail(cb, found.reservationID)
          if (['canceled', 'cancelled', 'no_show', 'checked_out'].includes(d.status.toLowerCase())) {
            problem = `Booking ${number} is ${d.status} in Cloudbeds, so the arrival time (${time}) was not saved.`
          } else {
            await setEstimatedArrival(cb, found.reservationID, time)
            saved = {
              id: found.reservationID,
              guestName: d.guestName,
              startDate: d.startDate,
              endDate: d.endDate,
              room: d.rooms.map((r) => r.roomName ?? r.roomTypeName).filter(Boolean).join(', '),
            }
            if (d.estimatedArrivalTime && d.estimatedArrivalTime !== time) savedNote = ` (was ${d.estimatedArrivalTime})`
          }
        }
      }
    } catch (err) {
      problem = `Could not save the arrival time (${time}): ${err instanceof Error ? err.message : 'Cloudbeds error'}`
    }
  }
  const notes: string[] = []
  if (saved) notes.push(`Arrival time ${time} saved to Cloudbeds for ${saved.guestName} · #${saved.id}${savedNote}`)
  else notes.push(problem ?? 'Arrival time not saved.')
  if (kind === 'request') notes.push('early check-in requested — staff to reply')
  await db.from('inbound_emails').update({ action: saved ? 'arrival_saved' : 'arrival_not_saved', action_detail: notes.join(' · ') }).eq('id', mail.id)

  // ---- 2. Reply to the guest -------------------------------------------------
  const { data: tenant } = await db
    .from('tenants')
    .select(REPLY_TENANT_COLUMNS)
    .eq('id', tenantId)
    .single<ReplyTenant>()

  let replySent = false
  if (saved && tenant) {
    replySent = await replyToGuest(db, tenantId, tenant, mail, arrival, time, kind, situation)
  }

  // ---- 3. Arrivals outside check-in hours → alert staff ---------------------
  if (situation === 'special' && tenant) {
    const alerted = await alertStaff(db, tenantId, tenant, {
      guestName: saved?.guestName || arrival.guest_name || mail.fromName,
      time,
      reason: time > '21:00' ? 'después de las 21:00' : time < '06:00' ? 'de madrugada, después de medianoche' : 'antes de las 8:00',
      number,
      saved,
      mail,
    })
    notes.push(alerted ? 'late arrival — staff alerted on WhatsApp' : "late arrival — couldn't alert staff on WhatsApp, please check")
    await db.from('inbound_emails').update({ action_detail: notes.join(' · ') }).eq('id', mail.id)
  }

  // A plain "we'll arrive around X" that was saved and answered needs nothing more.
  if (saved && replySent && kind === 'stated' && situation !== 'special') {
    await db.from('inbound_emails').update({ status: 'done' }).eq('id', mail.id)
  }
}

// ---------------------------------------------------------------------------
// Reply
// ---------------------------------------------------------------------------

/** Returns whether the guest was fully answered (sent, and nothing left for a person). */
async function replyToGuest(
  db: ReturnType<typeof createServiceClient>,
  tenantId: string,
  tenant: ReplyTenant,
  mail: ReplyMail,
  arrival: ArrivalInfo,
  time: string,
  kind: 'stated' | 'request',
  situation: ReturnType<typeof arrivalSituation>
): Promise<boolean> {
  const setReply = (patch: Record<string, unknown>) => db.from('inbound_emails').update(patch).eq('id', mail.id)

  if (!repliesEnabled(tenant)) {
    await setReply({ reply_status: 'not_sent', reply_detail: 'Email replies are switched off (Integrations → Guest channels).' })
    return false
  }
  const guard = await replyGuard(db, tenantId, mail)
  if (!guard.allow) {
    await setReply({ reply_status: 'not_sent', reply_detail: guard.detail })
    return false
  }
  const d = await composeEmailReply(tenant, mail, arrival.guest_message || '', { time, kind, situation })
  if (!d) {
    await setReply({ reply_status: 'failed', reply_detail: "Lana couldn't write a reply — please answer the guest yourself." })
    return false
  }
  if (d.decision === 'staff' || !d.reply) {
    await setReply({ reply_status: 'not_sent', reply_detail: `Lana didn't reply — ${d.reason || 'needs a person'}.` })
    return false
  }
  const sent = await deliverReply(db, tenantId, mail, d.reply, guard.canSend, d.needsStaff ? `part of it needs a person: ${d.reason}` : undefined)
  return sent && !d.needsStaff
}

// ---------------------------------------------------------------------------
// Staff alert (late / very early arrivals)
// ---------------------------------------------------------------------------

async function alertStaff(
  db: ReturnType<typeof createServiceClient>,
  tenantId: string,
  tenant: ReplyTenant,
  info: {
    guestName: string
    time: string
    reason: string
    number: string
    saved: { id: string; startDate: string; endDate: string; room: string } | null
    mail: ArrivalMail
  }
): Promise<boolean> {
  const contact = findEscalationContact(parseEscalationContacts(tenant.escalation_contacts), 'reservations')
  const { data: wa } = await db
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'whatsapp')
    .maybeSingle()
  const phoneNumberId = (wa?.config as { phone_number_id?: string } | null)?.phone_number_id

  // One line (WhatsApp template fields can't hold line breaks).
  const parts = [
    `Llegada fuera de horario: ${info.guestName} llegará a las ${info.time} (${info.reason})`,
    info.number ? `Reserva ${info.number}` : null,
    info.saved ? `Cloudbeds #${info.saved.id}` : 'NO se pudo guardar en Cloudbeds',
    info.saved ? `${info.saved.startDate} → ${info.saved.endDate}` : null,
    info.saved?.room ? info.saved.room : null,
    `por email (${info.mail.fromEmail})`,
    'Contactar al huésped para coordinar',
  ].filter(Boolean)
  const summary = parts.join(' · ')

  let delivered = false
  if (contact && wa?.status === 'connected' && wa.credentials && phoneNumberId) {
    const result = await notifyStaff(
      phoneNumberId,
      wa.credentials as EncryptedPayload,
      contact.phone,
      info.number ? `Reserva ${info.number}` : info.mail.fromEmail,
      { category: 'reservations', summary, urgency: 'normal' },
      tenant.message_templates,
      info.guestName
    )
    delivered = result.success
    if (!result.success) console.error('[arrival-email] staff alert failed', result.error)
  }
  await db.from('escalations').insert({
    tenant_id: tenantId,
    conversation_id: null,
    guest_id: null,
    category: 'reservations',
    urgency: 'normal',
    summary,
    room: null,
    delivered,
  })
  return delivered
}
