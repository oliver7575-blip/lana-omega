import { createServiceClient } from './supabase/service'
import { pmsForTenant } from './pms'
import { cloudbedsForTenant } from './cloudbeds-tenant'
import { findReservationByClues, findReservationByConfirmation, getReservationDetail, setEstimatedArrival } from './cloudbeds-ops'
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
  check_out_date?: string | null
  guest_name?: string | null
  guest_message?: string | null
}

export type ArrivalMail = ReplyMail

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december']

/** Check-in / check-out dates as printed in relayed emails ("26 November 2026 … 1 December 2026"), when the AI didn't read them. */
function datesFromMail(mail: ArrivalMail): { checkIn: string; checkOut: string | null } | null {
  const text = `${mail.subject}\n${mail.bodyText ?? ''}`
  const found: string[] = []
  for (const m of text.matchAll(/(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/gi)) {
    found.push(`${m[3]}-${String(MONTHS.indexOf(m[2].toLowerCase()) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`)
    if (found.length === 2) break
  }
  return found.length ? { checkIn: found[0], checkOut: found[1] ?? null } : null
}

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
  let pmsLabel = 'Cloudbeds'
  {
    try {
      const cb = await cloudbedsForTenant(db, tenantId)
      if (!cb) {
        const pms = await pmsForTenant(db, tenantId)
        if (pms?.kind !== 'lodgify') {
          problem = 'No reservation system is connected, so the arrival time was not saved.'
        } else {
          pmsLabel = 'Lodgify'
          let found = number ? await pms.lookupReservation(number) : null
          if (!found?.found && !number) {
            // No booking number: match today's arrivals on the check-in date by guest name.
            const checkIn = arrival.check_in_date || datesFromMail(mail)?.checkIn || null
            if (!checkIn) problem = `Guest gave an arrival time (${time}) but no booking number or check-in date — add it by hand.`
            else {
              const first = (arrival.guest_name || mail.fromName || '').trim().split(/\s+/)[0]?.toLowerCase()
              const arr = await pms.getArrivalsInWindow(checkIn)
              const hits = (arr.arrivals ?? []).filter((a) => first && (a.guestName ?? '').toLowerCase().includes(first))
              if (hits.length === 1) {
                found = await pms.lookupReservation(hits[0].reservationID)
                savedNote = ` (identified from the check-in date ${checkIn} and guest name "${arrival.guest_name ?? ''}", no booking number in the email)`
              } else problem = hits.length
                ? `Guest gave an arrival time (${time}) with no booking number, and several stays match ${checkIn}: ${hits.map((c) => `${c.guestName} #${c.reservationID}`).join('; ')} — add it by hand.`
                : `Guest gave an arrival time (${time}) with no booking number, and no stay checking in on ${checkIn} matched — add it by hand.`
            }
          }
          if (found?.found && found.reservationID) {
            const st = (found.status ?? '').toLowerCase()
            if (/cancel|declin|checked.?out|no.?show/.test(st)) {
              problem = `Booking ${number || found.reservationID} is ${found.status} in Lodgify, so the arrival time (${time}) was not saved.`
            } else {
              const r = await pms.updateArrivalTime(found.reservationID, time)
              if (!r.success) problem = `Could not save the arrival time (${time}): ${r.error ?? 'Lodgify error'}`
              else saved = { id: found.reservationID, guestName: found.guestName ?? '', startDate: found.startDate ?? '', endDate: found.endDate ?? '', room: (found.rooms ?? []).map((x) => x.roomName ?? x.roomTypeName).filter(Boolean).join(', ') || found.roomName || '' }
            }
          } else if (!problem) problem = `Couldn't find booking ${number} in Lodgify — add the arrival time (${time}) by hand.`
        }
      } else {
        let found = number ? await findReservationByConfirmation(cb, number, arrival.check_in_date) : null
        let viaClues = ''
        if (!found && !number) {
          // No booking number (e.g. an Airbnb relay): work out who it is from the dates, first name, channel and room type.
          const checkIn = arrival.check_in_date || datesFromMail(mail)?.checkIn || null
          const checkOut = arrival.check_out_date || datesFromMail(mail)?.checkOut || null
          if (checkIn) {
            const clue = await findReservationByClues(cb, {
              checkIn,
              checkOut,
              guestName: arrival.guest_name,
              channel: /airbnb/i.test(mail.fromEmail) ? 'airbnb' : /booking\.com/i.test(mail.fromEmail) ? 'booking' : null,
              roomTypeHint: mail.subject,
            })
            if (clue.match) { found = clue.match; viaClues = ` (identified from the check-in date ${checkIn} and guest name "${arrival.guest_name ?? ''}", no booking number in the email)` }
            else problem = clue.candidates.length
              ? `Guest gave an arrival time (${time}) with no booking number, and several stays match ${checkIn}: ${clue.candidates.map((c) => `${c.guestName} #${c.reservationID}`).join('; ')} — add it by hand.`
              : `Guest gave an arrival time (${time}) with no booking number, and no stay checking in on ${checkIn} matched — add it by hand.`
          } else problem = `Guest gave an arrival time (${time}) but no booking number or check-in date — add it in Cloudbeds by hand.`
          if (found) savedNote = viaClues
        }
        if (!found) {
          problem ??= `Couldn't find booking ${number} in Cloudbeds — add the arrival time (${time}) by hand.`
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
            if (d.estimatedArrivalTime && d.estimatedArrivalTime !== time) savedNote += ` (was ${d.estimatedArrivalTime})`
          }
        }
      }
    } catch (err) {
      problem = `Could not save the arrival time (${time}): ${err instanceof Error ? err.message : 'Cloudbeds error'}`
    }
  }
  const notes: string[] = []
  if (saved) notes.push(`Arrival time ${time} saved to ${pmsLabel} for ${saved.guestName} · #${saved.id}${savedNote}`)
  else notes.push(problem ?? 'Arrival time not saved.')
  if (kind === 'request') notes.push('early check-in requested — staff to reply')
  await db.from('inbound_emails').update({ action: saved ? 'arrival_saved' : 'arrival_not_saved', action_detail: notes.join(' · ') }).eq('id', mail.id)

  // ---- 2. Reply to the guest -------------------------------------------------
  const { data: tenant } = await db
    .from('tenants')
    .select(REPLY_TENANT_COLUMNS)
    .eq('id', tenantId)
    .single<ReplyTenant>()

  if (saved && tenant) {
    await replyToGuest(db, tenantId, tenant, mail, arrival, time, kind, situation)
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
      pmsLabel,
    })
    notes.push(alerted ? 'late arrival — staff alerted on WhatsApp' : "late arrival — couldn't alert staff on WhatsApp, please check")
    await db.from('inbound_emails').update({ action_detail: notes.join(' · ') }).eq('id', mail.id)
  }

  // An arrival time that was received and saved to Cloudbeds is handled, full stop —
  // even when it also needed a reply-sent check, an early-check-in note, or a staff
  // alert for an off-hours arrival above: those are side notes, not a reason to leave
  // the email sitting in "To handle".
  if (saved) {
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
  const d = await composeEmailReply(tenant, mail, arrival.guest_message || '', { time, kind, situation }, tenantId)
  if (!d) {
    await setReply({ reply_status: 'failed', reply_detail: "Lana couldn't write a reply — please answer the guest yourself." })
    return false
  }
  if (d.decision === 'none') {
    await setReply({ reply_status: 'not_sent', reply_detail: `No reply needed — ${d.reason || 'nothing to answer'}.` })
    return true
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
    pmsLabel: string
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
    info.saved ? `${info.pmsLabel} #${info.saved.id}` : `NO se pudo guardar en ${info.pmsLabel}`,
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
