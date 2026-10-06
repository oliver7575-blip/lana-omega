import { createServiceClient } from '../supabase/service'
import { cloudbedsForTenant } from '../cloudbeds-tenant'
import { findReservationByConfirmation, getReservationRaw, type CB } from '../cloudbeds-ops'
import { findReservationByPhone } from '../cloudbeds'
import { samePhone } from '../phone'
import { evaluate, factsFromRaw, round2, type PaymentKind, type ReservationFacts } from './rules'
import { createPaymentLink, loadPaymentContext, type PaymentContext, type PaymentRequestRow } from './service'

/**
 * Lana's payment tools. The model only ever says WHICH reservation (number +
 * last name) and WHICH option ("deposit" or "balance"). Everything else is
 * decided here: who the guest is, whether this reservation may get a link,
 * the amount, and what Lana may claim about payment status.
 */

export interface PaymentToolContext {
  tenantId: string
  conversationId: string
  guestId: string | null
  channel: 'whatsapp' | 'instagram' | 'widget'
  /** The guest's WhatsApp number, when known (identity by phone). */
  senderPhone: string | null
  /** Sends a Billing alert to staff (WhatsApp + Escalations list). */
  escalate: (summary: string) => Promise<unknown>
}

export interface PaymentToolInput {
  confirmationNumber?: string
  lastName?: string
  option?: string
  language?: string
}

type Json = Record<string, unknown>

export interface PaymentTool {
  paymentOptions(input: PaymentToolInput): Promise<Json>
  requestPaymentLink(input: PaymentToolInput): Promise<{ result: Json; paymentUrl?: string; buttonText?: string }>
  paymentStatus(input: PaymentToolInput): Promise<Json>
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** The guest's phone on the Cloudbeds reservation, if the record carries one. */
function phoneFromRaw(raw: Json): string | null {
  const list = (raw.guestList ?? {}) as Record<string, Json>
  const main = list[String(raw.guestID ?? '')]
  const candidates = [main, ...Object.values(list)].filter(Boolean) as Json[]
  for (const g of candidates) {
    const p = String(g.guestPhone ?? g.guestCellPhone ?? '').trim()
    if (p) return p
  }
  const direct = String(raw.guestPhone ?? raw.guestCellPhone ?? '').trim()
  return direct || null
}

/** A last name must match a NON-first word of the guest's name (a first name alone is not enough). */
function lastNameMatches(given: string | undefined, guestName: string): boolean {
  const g = norm(given ?? '')
  if (g.length < 2) return false
  const words = norm(guestName).split(' ').filter(Boolean)
  const lastWords = words.length > 1 ? words.slice(1) : words
  const parts = g.split(' ').filter((p) => p.length >= 2)
  return parts.length > 0 && parts.every((p) => lastWords.includes(p))
}

const todayIn = (tz: string) => new Date().toLocaleDateString('en-CA', { timeZone: tz })

type Resolved = { ok: true; raw: Json; facts: ReservationFacts } | { ok: false; result: Json }

export function makePaymentTool(ctx: PaymentToolContext): PaymentTool {
  const db = createServiceClient()

  async function setup(): Promise<{ cb: CB; pctx: PaymentContext } | { error: Json }> {
    const cb = await cloudbedsForTenant(db, ctx.tenantId)
    if (!cb) {
      return { error: { status: 'unavailable', instruction: 'Payments are not available right now. Tell the guest a team member will help with the payment shortly.' } }
    }
    return { cb, pctx: await loadPaymentContext(db, ctx.tenantId) }
  }

  /** Finds the reservation AND proves it belongs to this guest. Reveals nothing until identity is established. */
  async function resolve(cb: CB, input: PaymentToolInput): Promise<Resolved> {
    const number = String(input.confirmationNumber ?? '').trim()
    if (number) {
      let raw: Json | null = null
      if (/^\d{6,}$/.test(number)) {
        try {
          const r = await getReservationRaw(cb, number)
          if (r.reservationID) raw = r
        } catch {
          /* not a Cloudbeds id */
        }
      }
      if (!raw) {
        const found = await findReservationByConfirmation(cb, number)
        if (found) {
          try {
            raw = await getReservationRaw(cb, found.reservationID)
          } catch {
            raw = null
          }
        }
      }
      if (!raw || !raw.reservationID) {
        return { ok: false, result: { status: 'not_found', instruction: 'No reservation was found with that number. Ask the guest to double-check the confirmation number.' } }
      }
      const resPhone = phoneFromRaw(raw)
      const phoneOk = Boolean(ctx.senderPhone && resPhone && samePhone(ctx.senderPhone, resPhone))
      if (!phoneOk && !lastNameMatches(input.lastName, String(raw.guestName ?? ''))) {
        return {
          ok: false,
          result: {
            status: 'needs_verification',
            instruction: "For the guest's security, ask them for the last name on the reservation, then call this tool again with lastName. Do not reveal anything about the reservation yet.",
          },
        }
      }
      return { ok: true, raw, facts: factsFromRaw(raw) }
    }

    // No number: use the guest's own WhatsApp number.
    if (ctx.senderPhone) {
      const byPhone = await findReservationByPhone(cb.apiKey, cb.propertyId, ctx.senderPhone)
      if (byPhone.found && byPhone.reservationID) {
        try {
          const raw = await getReservationRaw(cb, byPhone.reservationID)
          if (raw.reservationID) return { ok: true, raw, facts: factsFromRaw(raw) }
        } catch {
          /* fall through */
        }
      }
    }
    return {
      ok: false,
      result: {
        status: 'not_identified',
        instruction: 'This phone number could not be matched to a single reservation. Ask the guest for their confirmation number and the last name on the reservation.',
      },
    }
  }

  /** One Billing alert per conversation per 6 hours. */
  async function escalateOnce(summary: string): Promise<void> {
    const since = new Date(Date.now() - 6 * 3600_000).toISOString()
    const { data } = await db
      .from('escalations')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .eq('conversation_id', ctx.conversationId)
      .eq('category', 'billing')
      .like('summary', 'Pago:%')
      .gte('created_at', since)
      .limit(1)
    if (data && data.length > 0) return
    try {
      await ctx.escalate(summary)
    } catch (err) {
      console.error('[payment-tool] billing escalation failed', err)
    }
  }

  const staffSummary = (facts: ReservationFacts, why: string) =>
    `Pago: el huésped quiere pagar. Reserva #${facts.reservationId} (origen: ${facts.source || 'desconocido'}) — ${why}. Saldo en Cloudbeds: ${round2(facts.balance).toFixed(2)} MXN. Contactar al huésped.`

  /** What Lana may do for a reservation that can't get a link. */
  async function ineligible(facts: ReservationFacts, code: string, message: string): Promise<Json> {
    switch (code) {
      case 'third_party':
        return {
          status: 'third_party',
          instruction:
            'This booking was made through a travel platform (Booking.com, Airbnb, etc.), which handles the payment directly. Do NOT mention any balance and do NOT offer a payment link. Reassure the guest that their reservation is confirmed and that payment is handled by the platform where they booked.',
        }
      case 'walk_in':
      case 'manual_source':
      case 'below_minimum':
        await escalateOnce(staffSummary(facts, code === 'walk_in' ? 'reserva Walk-In, se gestiona manualmente' : 'se gestiona manualmente'))
        return {
          status: 'handled_by_staff',
          instruction:
            'Tell the guest warmly that a member of the team will help them with the payment shortly (the team has already been notified). Do NOT mention any balance or amount and do NOT offer a payment link.',
        }
      case 'no_balance':
        return { status: 'nothing_to_pay', instruction: 'There is no outstanding balance on this reservation. Tell the guest that nothing is due.' }
      default:
        return { status: 'not_payable', detail: message, instruction: 'This reservation cannot be paid online right now. Tell the guest kindly, and that a team member can help if they need.' }
    }
  }

  return {
    async paymentOptions(input) {
      const s = await setup()
      if ('error' in s) return s.error
      const r = await resolve(s.cb, input)
      if (!r.ok) return r.result
      const el = evaluate(r.facts, s.pctx.settings, todayIn(s.pctx.tz))
      if (!el.eligible) return ineligible(r.facts, el.code, el.message)
      return {
        status: 'ok',
        confirmationNumber: r.facts.reservationId,
        guestFirstName: r.facts.guestName.split(' ')[0] ?? '',
        currency: 'MXN',
        balance: round2(r.facts.balance),
        options: el.options.map((o) => ({ option: o.kind, amount: o.amount })),
        instruction: 'Tell the guest the balance and offer the available options (amounts in MXN). When they choose, call request_payment_link with that option. Never invent or change an amount.',
      }
    },

    async requestPaymentLink(input) {
      const fail = (result: Json) => ({ result })
      const option = input.option === 'deposit' || input.option === 'balance' ? (input.option as PaymentKind) : null
      if (!option) return fail({ status: 'error', instruction: 'option must be "deposit" or "balance".' })
      const s = await setup()
      if ('error' in s) return fail(s.error)
      const r = await resolve(s.cb, input)
      if (!r.ok) return fail(r.result)
      const el = evaluate(r.facts, s.pctx.settings, todayIn(s.pctx.tz))
      if (!el.eligible) return fail(await ineligible(r.facts, el.code, el.message))

      const language = (input.language ?? '').toLowerCase().slice(0, 5) || null
      const created = await createPaymentLink(db, s.cb, s.pctx, {
        reservationId: r.facts.reservationId,
        kind: option,
        createdBy: 'lana',
        conversationId: ctx.conversationId,
        guestId: ctx.guestId,
        channel: ctx.channel,
        language,
      })
      if (!created.ok) {
        if (created.code === 'payment_in_verification' || created.code === 'in_progress') {
          return fail({ status: 'payment_in_verification', instruction: 'A payment for this reservation is being processed or verified. Ask the guest to wait a few minutes. Do NOT create another link.' })
        }
        if (created.code === 'option_unavailable') {
          return fail({ status: 'option_unavailable', instruction: 'That option is not available. Call get_payment_options to see what can be paid.' })
        }
        await escalateOnce(staffSummary(r.facts, `no se pudo crear el link de pago (${created.code})`))
        return fail({ status: 'link_failed', instruction: 'Tell the guest warmly that a member of the team will help with the payment shortly (the team has been notified). Do not mention technical details.' })
      }
      const req: PaymentRequestRow = created.request
      const spanish = (language ?? 'es').startsWith('es')
      return {
        paymentUrl: req.link_url ?? undefined,
        buttonText: spanish ? 'Pagar ahora' : 'Pay now',
        result: {
          status: 'link_ready',
          option,
          amount: Number(req.amount),
          currency: 'MXN',
          validForHours: s.pctx.settings.linkExpiryDays * 24,
          instruction:
            'The secure payment button is sent automatically right after your message — do NOT write, copy or paraphrase any URL. Tell the guest the amount (in MXN), that the link is valid for 24 hours, and that they enter their card details only on the secure payment page. Never ask for card details in chat. Do NOT say the payment is done: that is only known once check_payment_status says so.',
        },
      }
    },

    async paymentStatus(input) {
      const s = await setup()
      if ('error' in s) return s.error
      const r = await resolve(s.cb, input)
      if (!r.ok) return r.result
      const el = evaluate(r.facts, s.pctx.settings, todayIn(s.pctx.tz))
      if (!el.eligible && ['third_party', 'walk_in', 'manual_source'].includes(el.code)) return ineligible(r.facts, el.code, el.message)

      const { data } = await db
        .from('payment_requests')
        .select('*')
        .eq('tenant_id', ctx.tenantId)
        .eq('reservation_id', r.facts.reservationId)
        .order('created_at', { ascending: false })
        .limit(1)
      const last = (data?.[0] ?? null) as PaymentRequestRow | null
      if (!last) return { status: 'no_payment_link', instruction: 'No payment link has been sent for this reservation. If the guest wants to pay, call get_payment_options.' }
      switch (last.status) {
        case 'paid':
          return { status: 'paid', option: last.kind, amount: Number(last.amount), currency: 'MXN', instruction: 'The payment has been verified. You may confirm it to the guest.' }
        case 'paid_unverified':
        case 'needs_review':
          return { status: 'verifying', instruction: 'A payment was reported but is still being confirmed in our system. Do NOT tell the guest it is confirmed yet — say it is being verified and the team will confirm shortly.' }
        case 'link_active':
          return { status: 'awaiting_payment', option: last.kind, amount: Number(last.amount), currency: 'MXN', instruction: 'The guest has not completed the payment yet. NEVER say it is paid. They can use the link they were already sent.' }
        default:
          return { status: 'link_expired', instruction: 'The last payment link is no longer valid and nothing was paid. Offer to create a new one if the guest still wants to pay.' }
      }
    },
  }
}
