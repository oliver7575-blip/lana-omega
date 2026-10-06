import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { createServiceClient } from './supabase/service'
import { decryptCredentials, type EncryptedPayload } from './crypto'
import { cloudbedsForTenant } from './cloudbeds-tenant'
import { findReservationByConfirmation, getReservationDetail, setEstimatedArrival } from './cloudbeds-ops'

/**
 * Reads the hotel's inbox (read-only: nothing is moved, deleted or marked as
 * read), sorts each new email with Claude, and files reviews and inquiries.
 * Automated mail (booking confirmations, cancellations, system notices,
 * newsletters) is recognised and kept out of the lists.
 */

const SORT_MODEL = 'claude-haiku-4-5-20251001'
const FIRST_RUN_DAYS = 3
const MAX_PER_RUN = 15

export type EmailCategory = 'review' | 'inquiry' | 'reservation' | 'billing' | 'job' | 'sales' | 'other' | 'automated'

interface ArrivalInfo {
  confirmation_number?: string | null
  time?: string | null
  kind?: 'stated' | 'request' | null
  check_in_date?: string | null
}

interface Sorted {
  category: EmailCategory
  summary: string
  arrival?: ArrivalInfo | null
  review?: {
    platform?: string | null
    guest_name?: string | null
    rating?: number | null
    rating_scale?: number | null
    sentiment?: 'positive' | 'neutral' | 'negative' | null
    review_text?: string | null
  } | null
}

export interface PollResult {
  tenantId: string
  fetched: number
  filed: number
  error?: string
}

export async function pollInbox(tenantId: string): Promise<PollResult> {
  const db = createServiceClient()
  const { data: integ } = await db
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'email')
    .maybeSingle()
  if (integ?.status !== 'connected' || !integ.credentials) return { tenantId, fetched: 0, filed: 0, error: 'Email not connected' }

  const config = (integ.config ?? {}) as { smtp_host?: string; smtp_user?: string; imap_host?: string }
  const host = config.imap_host?.trim() || (config.smtp_host ?? '').replace(/^smtp\./i, 'imap.')
  if (!host || !config.smtp_user) return { tenantId, fetched: 0, filed: 0, error: 'Email host or username missing' }
  const { smtp_password } = decryptCredentials<{ smtp_password: string }>(integ.credentials as EncryptedPayload)
  const ownAddress = config.smtp_user.toLowerCase()

  const { data: state } = await db.from('email_poll_state').select('*').eq('tenant_id', tenantId).maybeSingle()
  const client = new ImapFlow({ host, port: 993, secure: true, auth: { user: config.smtp_user, pass: smtp_password }, logger: false })

  let fetched = 0
  let filed = 0
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX', { readOnly: true })
    try {
      const mailbox = client.mailbox as { uidValidity?: bigint | number; uidNext?: number }
      const uidValidity = Number(mailbox.uidValidity ?? 0)
      const newestUid = Math.max(0, Number(mailbox.uidNext ?? 1) - 1)
      const resetCursor = !state || Number(state.uid_validity ?? 0) !== uidValidity
      let uids: number[]
      if (resetCursor) {
        const since = new Date(Date.now() - FIRST_RUN_DAYS * 86_400_000)
        uids = ((await client.search({ since }, { uid: true })) || []) as number[]
      } else {
        uids = ((await client.search({ uid: `${Number(state.last_uid) + 1}:*` }, { uid: true })) || []) as number[]
        uids = uids.filter((u) => u > Number(state.last_uid))
      }
      uids.sort((a, b) => a - b)
      const batch = uids.slice(0, MAX_PER_RUN)
      let lastUid = resetCursor ? 0 : Number(state?.last_uid ?? 0)

      const started = Date.now()
      for (const uid of batch) {
        // Stay inside the function's time limit; the rest is picked up on the next run.
        if (Date.now() - started > 40_000) break
        // BODY.PEEK — reading doesn't mark the email as read.
        const msg = await client.fetchOne(String(uid), { source: true, internalDate: true }, { uid: true })
        lastUid = Math.max(lastUid, uid)
        if (!msg || !msg.source) continue
        fetched++
        const parsed = await simpleParser(msg.source)
        const messageId = parsed.messageId ?? `uid-${uidValidity}-${uid}`
        const from = parsed.from?.value?.[0]
        const fromEmail = (from?.address ?? '').toLowerCase()
        if (fromEmail && fromEmail === ownAddress) continue // our own sent mail
        const subject = parsed.subject ?? '(no subject)'
        const text = (parsed.text ?? htmlToText(typeof parsed.html === 'string' ? parsed.html : '') ?? '').trim()
        const receivedAt = (parsed.date ?? (msg.internalDate instanceof Date ? msg.internalDate : new Date())).toISOString()

        const { data: dup } = await db.from('inbound_emails').select('id').eq('tenant_id', tenantId).eq('message_id', messageId).maybeSingle()
        if (dup) continue

        const sorted = await sortEmail(fromEmail, from?.name ?? '', subject, text, parsed.headers)
        const { data: row } = await db
          .from('inbound_emails')
          .insert({
            tenant_id: tenantId,
            message_id: messageId,
            imap_uid: uid,
            from_email: fromEmail || null,
            from_name: from?.name || null,
            subject,
            body_text: text.slice(0, 20_000),
            received_at: receivedAt,
            category: sorted.category,
            summary: sorted.summary,
            status: sorted.category === 'automated' ? 'done' : 'new',
          })
          .select('id')
          .single()
        if (row && sorted.category !== 'automated') filed++
        if (row && sorted.arrival?.time) await applyArrival(tenantId, row.id as string, sorted.arrival)
        if (row && sorted.category === 'review') {
          const r = sorted.review ?? {}
          await db.from('reviews').insert({
            tenant_id: tenantId,
            source: 'email',
            platform: r.platform ?? null,
            guest_name: r.guest_name ?? from?.name ?? null,
            rating: typeof r.rating === 'number' ? r.rating : null,
            rating_scale: typeof r.rating_scale === 'number' ? r.rating_scale : null,
            sentiment: r.sentiment ?? null,
            review_text: (r.review_text ?? '').slice(0, 5000) || null,
            summary: sorted.summary,
            email_id: row.id,
            received_at: receivedAt,
          })
        }
      }

      await db.from('email_poll_state').upsert({
        tenant_id: tenantId,
        uid_validity: uidValidity,
        // First run with nothing recent: start from the newest email, never from the start of the inbox.
        last_uid: batch.length ? lastUid : resetCursor ? newestUid : Number(state?.last_uid ?? 0),
        last_polled_at: new Date().toISOString(),
        last_error: null,
      })
    } finally {
      lock.release()
    }
    await client.logout()
    return { tenantId, fetched, filed }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    await db.from('email_poll_state').upsert({ tenant_id: tenantId, last_polled_at: new Date().toISOString(), last_error: error.slice(0, 500), last_uid: Number(state?.last_uid ?? 0), uid_validity: state?.uid_validity ?? null })
    try { await client.logout() } catch { /* already closed */ }
    return { tenantId, fetched, filed, error }
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
}

const SORT_PROMPT = `You sort incoming emails for a small boutique hotel. Reply with ONLY a JSON object, no other text:
{"category": "...", "summary": "...", "review": {...} or null, "arrival": {...} or null}

category — exactly one of:
- "review": a guest review or feedback about a stay, written directly by a guest OR a notification from Booking.com, Airbnb, Google, TripAdvisor, Expedia etc. that a guest left a review / rating.
- "inquiry": a person asking a question (availability, prices, services, directions, groups, events) who is not yet clearly a booked guest.
- "reservation": a PERSON writing about an existing booking (change dates, special request, arrival details, cancellation request written by the guest).
- "billing": invoices, payments, refunds, tax/factura requests, bank or payout questions written by a person or a supplier.
- "job": job applications, CVs, volunteering, artist residency requests.
- "sales": suppliers, marketing agencies, partnership or advertising offers, influencer collaborations.
- "other": anything written by a person that fits none of the above.
- "automated": machine-sent mail that needs no attention: booking confirmations, new/modified/cancelled reservation notices from Cloudbeds/Booking.com/Airbnb/Expedia/channel managers, payment receipts, system alerts, newsletters, promotions, password resets, delivery notices, social media notifications.
A review notification from an OTA is "review", not "automated".

summary — one short sentence in English saying what the email is about and what (if anything) the hotel should do.

arrival — only when the email says or asks WHEN the guest will arrive / check in on an existing booking, else null:
{"confirmation_number": the booking or confirmation number shown in the email (e.g. "Confirmation number: 5503861769", an Airbnb code) or null, "time": "HH:MM" in 24-hour format, "kind": "stated" or "request", "check_in_date": "YYYY-MM-DD" if the email shows the check-in date, else null}
- kind "stated": the guest says when they will arrive ("we'll arrive around 5 pm", "llegamos a las 8").
- kind "request": the guest asks whether they may check in at a time ("can we check in at 12:00?", "early check-in at 12:00-13:00"). For a time range use the START of the range.
- "5 pm" = "17:00". If the time is vague ("in the afternoon", "late at night") or there is no time, set arrival to null.
Arrival times often appear inside Booking.com / Airbnb relayed guest messages — read the guest's own words.

review — only when category is "review", else null:
{"platform": "booking"|"airbnb"|"google"|"tripadvisor"|"expedia"|"direct"|other lowercase name, "guest_name": string or null, "rating": number or null, "rating_scale": the maximum of that rating (e.g. 10 for Booking, 5 for Airbnb/Google) or null, "sentiment": "positive"|"neutral"|"negative", "review_text": the guest's own words, as written, or null if the email only links to the review}`

/**
 * A guest told us when they'll arrive: save it on their reservation in Cloudbeds
 * and record what happened on the email. A plain "we'll arrive around 5 pm" is
 * fully handled; an early check-in *request* stays open for staff to answer
 * (Lana never promises early check-in).
 */
async function applyArrival(tenantId: string, emailId: string, arrival: ArrivalInfo): Promise<void> {
  const db = createServiceClient()
  const fail = async (detail: string) => {
    await db.from('inbound_emails').update({ action: 'arrival_not_saved', action_detail: detail }).eq('id', emailId)
  }
  const time = (arrival.time ?? '').trim()
  const number = (arrival.confirmation_number ?? '').trim()
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return
  if (!number) return fail(`Guest gave an arrival time (${time}) but no booking number — add it in Cloudbeds by hand.`)

  try {
    const cb = await cloudbedsForTenant(db, tenantId)
    if (!cb) return fail('Cloudbeds is not connected, so the arrival time was not saved.')
    const found = await findReservationByConfirmation(cb, number, arrival.check_in_date)
    if (!found) return fail(`Couldn't find booking ${number} in Cloudbeds — add the arrival time (${time}) by hand.`)
    const detail = await getReservationDetail(cb, found.reservationID)
    if (['canceled', 'cancelled', 'no_show', 'checked_out'].includes(detail.status.toLowerCase())) {
      return fail(`Booking ${number} is ${detail.status} in Cloudbeds, so the arrival time (${time}) was not saved.`)
    }
    await setEstimatedArrival(cb, found.reservationID, time)
    const was = detail.estimatedArrivalTime && detail.estimatedArrivalTime !== time ? ` (was ${detail.estimatedArrivalTime})` : ''
    const request = arrival.kind === 'request'
    await db
      .from('inbound_emails')
      .update({
        action: 'arrival_saved',
        action_detail: `Arrival time ${time} saved to Cloudbeds for ${detail.guestName} · #${found.reservationID}${was}${request ? ' · early check-in requested — staff to reply' : ''}`,
        status: request ? 'new' : 'done',
      })
      .eq('id', emailId)
  } catch (err) {
    await fail(`Could not save the arrival time (${time}): ${err instanceof Error ? err.message : 'Cloudbeds error'}`)
  }
}

async function sortEmail(fromEmail: string, fromName: string, subject: string, text: string, headers: Map<string, unknown>): Promise<Sorted> {
  const autoHints = ['list-unsubscribe', 'auto-submitted', 'precedence'].filter((h) => headers.has(h)).join(', ')
  const content = `From: ${fromName} <${fromEmail}>\nSubject: ${subject}${autoHints ? `\nHeaders present: ${autoHints}` : ''}\n\n${text.slice(0, 6000)}`
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: SORT_MODEL, max_tokens: 600, system: SORT_PROMPT, messages: [{ role: 'user', content }] }),
    })
    const data = (await res.json()) as { content?: { type: string; text?: string }[]; error?: { message?: string } }
    if (!res.ok) throw new Error(data.error?.message ?? `HTTP ${res.status}`)
    const raw = (data.content ?? []).map((b) => b.text ?? '').join('').replace(/```json|```/g, '').trim()
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Sorted
    const valid: EmailCategory[] = ['review', 'inquiry', 'reservation', 'billing', 'job', 'sales', 'other', 'automated']
    return {
      category: valid.includes(json.category) ? json.category : 'other',
      summary: String(json.summary ?? '').slice(0, 400),
      review: json.category === 'review' ? json.review ?? null : null,
      arrival: json.category !== 'automated' && json.category !== 'review' ? json.arrival ?? null : null,
    }
  } catch (err) {
    console.error('[email-inbox] sorting failed', err)
    // If sorting fails, keep the email visible rather than hiding it.
    return { category: 'other', summary: 'Could not sort this email automatically.' }
  }
}
