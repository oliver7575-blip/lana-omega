import type { SupabaseClient } from '@supabase/supabase-js'
import { readPaymentSettings, type Eligibility, type PaymentKind, type PaymentSettings } from './rules'
import type { PaymentBackend } from './backend'
import { notifyGuestPaid } from './notify'

export type PaymentStatus = 'creating' | 'link_active' | 'paid_unverified' | 'paid' | 'expired' | 'cancelled' | 'failed' | 'needs_review'

export interface PaymentRequestRow {
  id: string
  tenant_id: string
  reservation_id: string
  confirmation_ref: string | null
  guest_name: string | null
  kind: PaymentKind
  amount: number | string
  currency: string
  status: PaymentStatus
  link_id: string | null
  link_url: string | null
  link_status: string | null
  expires_at: string | null
  paid_before: number | string | null
  created_by: string
  staff_user_id: string | null
  conversation_id: string | null
  guest_id: string | null
  channel: string | null
  error: string | null
  check_count: number | null
  last_checked_at: string | null
  paid_at: string | null
  language: string | null
  guest_notified_at: string | null
  created_at: string
  updated_at: string
}

export interface PaymentContext {
  tenantId: string
  tz: string
  settings: PaymentSettings
}

const MAX_LINKS_PER_RESERVATION_PER_DAY = 3
const LIVE: PaymentStatus[] = ['creating', 'link_active', 'paid_unverified']

export async function loadPaymentContext(db: SupabaseClient, tenantId: string): Promise<PaymentContext> {
  const { data } = await db.from('tenants').select('payment_settings, timezone').eq('id', tenantId).single()
  return { tenantId, tz: (data?.timezone as string) || 'America/Mexico_City', settings: readPaymentSettings(data?.payment_settings) }
}

const todayIn = (tz: string) => new Date().toLocaleDateString('en-CA', { timeZone: tz })

export async function logPaymentEvent(db: SupabaseClient, tenantId: string, requestId: string, event: string, detail?: Record<string, unknown>) {
  await db.from('payment_events').insert({ tenant_id: tenantId, payment_request_id: requestId, event, detail: detail ?? null })
}

export type LookupResult = { found: false; message: string } | { found: true; eligibility: Eligibility }

/** Reads the reservation from the hotel's PMS and decides whether (and for how much) a link may be created. */
export async function lookupReservationForPayment(be: PaymentBackend, ctx: PaymentContext, reservationId: string): Promise<LookupResult> {
  try {
    const raw = await be.getRaw(reservationId)
    if (!raw) return { found: false, message: `Reservation not found in ${be.label}.` }
    return { found: true, eligibility: await be.evaluate(be.facts(raw), ctx.settings, todayIn(ctx.tz)) }
  } catch (err) {
    return { found: false, message: err instanceof Error ? err.message : `${be.label} is not reachable right now.` }
  }
}

export interface CreateInput {
  reservationId: string
  kind: PaymentKind
  createdBy: string // 'lana' or 'staff'
  staffUserId?: string | null
  conversationId?: string | null
  guestId?: string | null
  channel?: string | null
  language?: string | null
}

export type CreateResult =
  | { ok: true; request: PaymentRequestRow; reused: boolean }
  | { ok: false; code: string; message: string }

const fail = (code: string, message: string): CreateResult => ({ ok: false, code, message })

/**
 * Creates (or reuses) a payment link. The amount ALWAYS comes from the PMS
 * through the rules — callers only choose "deposit" or "balance".
 */
export async function createPaymentLink(db: SupabaseClient, be: PaymentBackend, ctx: PaymentContext, input: CreateInput): Promise<CreateResult> {
  const found = await lookupReservationForPayment(be, ctx, input.reservationId)
  if (!found.found) return fail('not_found', found.message)
  const el = found.eligibility
  if (!el.eligible) return fail(el.code, el.message)
  const option = el.options.find((o) => o.kind === input.kind)
  if (!option) return fail('option_unavailable', input.kind === 'deposit' ? 'No deposit is due on this reservation — only the full balance can be paid.' : 'That payment option is not available.')

  const { data: live } = await db
    .from('payment_requests')
    .select('*')
    .eq('tenant_id', ctx.tenantId)
    .eq('reservation_id', el.facts.reservationId)
    .in('status', LIVE)
  for (const row of (live ?? []) as PaymentRequestRow[]) {
    if (row.status === 'paid_unverified') return fail('payment_in_verification', 'A payment for this reservation is being verified. Please wait a few minutes.')
    if (row.status === 'creating') {
      if (Date.now() - Date.parse(row.created_at) < 120_000) return fail('in_progress', 'A link for this reservation is being created right now.')
      await db.from('payment_requests').update({ status: 'failed', error: 'Link creation did not finish', updated_at: new Date().toISOString() }).eq('id', row.id)
      await logPaymentEvent(db, ctx.tenantId, row.id, 'failed', { reason: 'creation timed out' })
      continue
    }
    // An active link: reuse it when it is the same thing and still valid; otherwise close it first.
    const stillValid = !row.expires_at || Date.parse(row.expires_at) > Date.now() + 60_000
    if (row.kind === input.kind && Math.abs(Number(row.amount) - option.amount) < 0.005 && stillValid && row.link_url) {
      return { ok: true, request: row, reused: true }
    }
    await db.from('payment_requests').update({ status: 'cancelled', error: 'Replaced by a newer link', updated_at: new Date().toISOString() }).eq('id', row.id)
    await logPaymentEvent(db, ctx.tenantId, row.id, 'superseded', { note: `${be.label} cannot cancel API-created links; the old one may stay payable until it expires.` })
  }

  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { count } = await db
    .from('payment_requests')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ctx.tenantId)
    .eq('reservation_id', el.facts.reservationId)
    .gte('created_at', since)
    .neq('status', 'failed')
  if ((count ?? 0) >= MAX_LINKS_PER_RESERVATION_PER_DAY) {
    return fail('rate_limited', 'Too many payment links were created for this reservation today. A team member will help.')
  }

  const { data: inserted, error: insertError } = await db
    .from('payment_requests')
    .insert({
      tenant_id: ctx.tenantId,
      reservation_id: el.facts.reservationId,
      confirmation_ref: el.facts.reservationId,
      guest_name: el.facts.guestName,
      kind: input.kind,
      amount: option.amount,
      currency: el.facts.currency || 'MXN',
      status: 'creating',
      paid_before: el.facts.paid,
      created_by: input.createdBy,
      staff_user_id: input.staffUserId ?? null,
      conversation_id: input.conversationId ?? null,
      guest_id: input.guestId ?? null,
      channel: input.channel ?? null,
      language: input.language ?? null,
    })
    .select('*')
    .single()
  if (insertError || !inserted) return fail('conflict', 'A link for this reservation is already being created.')
  const row = inserted as PaymentRequestRow

  const created = await be.createLink({
    facts: el.facts,
    kind: input.kind,
    amount: option.amount,
    description: `Payment link (${input.kind}) ${row.id.slice(0, 8)}`,
    expiresAfterDays: ctx.settings.linkExpiryDays,
  })
  if (!created.ok) {
    await db.from('payment_requests').update({ status: 'failed', error: `${be.label} (${created.status}): ${created.message}`, updated_at: new Date().toISOString() }).eq('id', row.id)
    await logPaymentEvent(db, ctx.tenantId, row.id, 'failed', { status: created.status, message: created.message })
    const hint = created.status === 401 || created.status === 403 ? ` The ${be.label} API key probably lacks permission to create payment links.` : ''
    return fail('pms_error', `${be.label} could not create the link (${created.status}).${hint} ${created.message}`.trim())
  }

  const expiresAt = created.expiresAt && !Number.isNaN(Date.parse(created.expiresAt)) ? new Date(created.expiresAt).toISOString() : new Date(Date.now() + ctx.settings.linkExpiryDays * 86400_000).toISOString()
  const { data: active } = await db
    .from('payment_requests')
    .update({ status: 'link_active', link_id: created.id, link_url: created.url, link_status: 'sent', expires_at: expiresAt, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .select('*')
    .single()
  await logPaymentEvent(db, ctx.tenantId, row.id, 'created', { kind: input.kind, amount: option.amount, by: input.createdBy })
  return { ok: true, request: (active ?? row) as PaymentRequestRow, reused: false }
}

/** True once the folio shows the money: paid amount rose by at least the link amount. */
async function folioShowsPayment(be: PaymentBackend, row: PaymentRequestRow): Promise<boolean> {
  try {
    const paid = await be.paidNow(row.reservation_id)
    return paid !== null && paid >= Number(row.paid_before ?? 0) + Number(row.amount) - 0.01
  } catch {
    return false
  }
}

/**
 * One status check. A request becomes "paid" only when the reservation in the
 * PMS shows the payment (Cloudbeds: the link is paid AND the folio shows it;
 * Lodgify, which has no link status: amount_paid rose by the link amount).
 */
export async function pollPayment(db: SupabaseClient, be: PaymentBackend, ctx: PaymentContext, row: PaymentRequestRow): Promise<PaymentRequestRow> {
  const nowIso = new Date().toISOString()
  const patch: Record<string, unknown> = { last_checked_at: nowIso, check_count: (row.check_count ?? 0) + 1, updated_at: nowIso }
  let event: { name: string; detail?: Record<string, unknown> } | null = null

  const confirmPaid = async (firstSeen: string) => {
    if (await folioShowsPayment(be, row)) {
      patch.status = 'paid'
      patch.paid_at = firstSeen
      patch.error = null
      event = { name: 'paid', detail: { amount: Number(row.amount) } }
    } else {
      patch.status = 'paid_unverified'
      patch.paid_at = firstSeen
      event = { name: 'paid_unverified', detail: { note: `${be.label} says the link was paid; waiting for the reservation to show it.` } }
    }
  }

  if (row.status === 'link_active' && row.link_id) {
    const r = await be.linkState(row.link_id)
    if (!r.ok) {
      patch.error = `Status check failed (${r.status}): ${r.message}`
      const tooOld = row.expires_at && Date.parse(row.expires_at) < Date.now() - 24 * 3600_000
      if (tooOld) {
        patch.status = 'needs_review'
        event = { name: 'needs_review', detail: { reason: 'Could not read the link status for over a day after it expired.' } }
      }
    } else {
      patch.error = null
      if (r.state !== 'unknown') patch.link_status = r.raw
      if (r.state === 'unknown') {
        // No link status at the PMS (Lodgify): the reservation's paid amount is the only truth.
        if (await folioShowsPayment(be, row)) {
          patch.status = 'paid'
          patch.paid_at = nowIso
          event = { name: 'paid', detail: { amount: Number(row.amount), verified: 'reservation' } }
        } else if (row.expires_at && Date.parse(row.expires_at) < Date.now() - 15 * 60_000) {
          patch.status = 'expired'
          event = { name: 'expired', detail: { note: `Past its expiry time in Omega. ${be.label} may still accept a payment on this link.` } }
        }
      } else if (r.state === 'paid') {
        await confirmPaid(nowIso)
      } else if (r.state === 'expired') {
        patch.status = 'expired'
        event = { name: 'expired' }
      } else if (r.state === 'cancelled') {
        patch.status = 'cancelled'
        event = { name: 'cancelled', detail: { by: be.kind } }
      } else if (row.expires_at && Date.parse(row.expires_at) < Date.now() - 15 * 60_000 && !r.readyForPayment) {
        patch.status = 'expired'
        event = { name: 'expired', detail: { note: 'Past its expiry time.' } }
      }
    }
  } else if (row.status === 'paid_unverified') {
    if (await folioShowsPayment(be, row)) {
      patch.status = 'paid'
      patch.error = null
      event = { name: 'paid', detail: { amount: Number(row.amount), verified: 'folio' } }
    } else if (row.paid_at && Date.now() - Date.parse(row.paid_at) > 20 * 60_000) {
      patch.status = 'needs_review'
      patch.error = `${be.label} reports the link as paid but the reservation does not show the payment yet. Please check the reservation in ${be.label}.`
      event = { name: 'needs_review', detail: { reason: 'folio mismatch after 20 minutes' } }
    }
  }

  const { data } = await db.from('payment_requests').update(patch).eq('id', row.id).select('*').single()
  const ev = event as { name: string; detail?: Record<string, unknown> } | null
  if (ev) await logPaymentEvent(db, ctx.tenantId, row.id, ev.name, ev.detail)
  const result = ((data as PaymentRequestRow | null) ?? row) as PaymentRequestRow
  // Verified payment → tell the guest (once). Best effort: never breaks the check.
  if (result.status === 'paid' && row.status !== 'paid') {
    await notifyGuestPaid(result).catch((err) => console.error('[payments] could not notify the guest', err))
  }
  return result
}

/** Staff closes a request on our side. Neither PMS can cancel API links, so a closed link may still be payable until it expires. */
export async function closePaymentRequest(db: SupabaseClient, ctx: PaymentContext, row: PaymentRequestRow, by: string): Promise<void> {
  await db.from('payment_requests').update({ status: 'cancelled', error: null, updated_at: new Date().toISOString() }).eq('id', row.id)
  await logPaymentEvent(db, ctx.tenantId, row.id, 'closed', { by, note: 'Closed in Omega; the link at the PMS may remain payable until it expires.' })
}
