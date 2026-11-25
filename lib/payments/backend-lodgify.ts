import {
  amount,
  channelCodes,
  findReservationByPhone,
  getBookingRaw,
  guestOf,
  listBookings,
  lodgifyFetch,
  mapLodgifyStatus,
  type LodgifyAuth,
} from '../lodgify'
import { evaluateLodgify, round2, type Eligibility, type ReservationFacts } from './rules'
import type { CreateLinkResult, PaymentBackend } from './backend'

/**
 * Lodgify payments.
 *
 * Lodgify hosts the payment page for a booking's quote and charges it through
 * the Stripe account connected to that rental in Lodgify; the payment then
 * shows on the booking itself (amount_paid / amount_due). We never see card
 * details and never choose an amount freely:
 *
 *   GET  /v2/reservations/bookings/{id}/quote/paymentLink → the NEXT payment in
 *        Lodgify's own payment schedule: { url, amount, currency }
 *   POST /v2/reservations/bookings/{id}/quote/paymentLink { amount, currency, description }
 *        → a link for an exact amount (used only for the full outstanding balance)
 *
 * Lodgify has no link-status endpoint, so a payment counts as made only when
 * the booking's amount_paid has risen by the link amount.
 */

type Json = Record<string, unknown>

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim())

interface LodgifyLink {
  url: string
  amount: number
  currency: string
}

function readLink(data: unknown): LodgifyLink | null {
  const d = (data ?? {}) as Json
  const inner = ((d.data as Json | undefined) ?? d) as Json
  const url = str(inner.url ?? inner.payment_url ?? inner.link)
  const amt = Number(inner.amount ?? NaN)
  if (!/^https:\/\//.test(url) || !Number.isFinite(amt) || amt <= 0) return null
  return { url, amount: round2(amt), currency: str(inner.currency ?? inner.currency_code).toUpperCase() }
}

export function lodgifyPaymentBackend(auth: LodgifyAuth): PaymentBackend {
  const inProperty = (b: Json) => !auth.propertyId || String(b.property_id ?? '') === auth.propertyId

  const getRaw = async (id: string): Promise<Json | null> => {
    const clean = id.trim().replace(/^#/, '').replace(/^B(?=\d+$)/i, '')
    if (!/^\d{1,10}$/.test(clean)) return null
    const r = await getBookingRaw(auth, clean)
    if (!r.ok) return null
    const b = r.data as Json | null
    return b && b.id !== undefined && inProperty(b) ? b : null
  }

  const nextLink = async (bookingId: string): Promise<LodgifyLink | null> => {
    const r = await lodgifyFetch(auth, `/v2/reservations/bookings/${encodeURIComponent(bookingId)}/quote/paymentLink`)
    return r.ok ? readLink(r.data) : null
  }

  const taxesOf = (raw: Json) => {
    const sub = (raw.subtotals as Json | undefined) ?? {}
    return round2((amount(sub.taxes) ?? 0) + (amount(sub.vat) ?? 0))
  }

  const facts = (raw: Json): ReservationFacts => ({
    reservationId: str(raw.id),
    guestName: str(guestOf(raw).name),
    source: str(raw.source),
    sourceId: str(raw.source),
    thirdPartyId: '', // Lodgify's source enum is decisive; source_text is free text and not used for this.
    status: mapLodgifyStatus(raw),
    balance: round2(amount(raw.amount_due) ?? 0),
    paid: round2(amount(raw.amount_paid) ?? 0),
    suggestedDeposit: 0,
    startDate: str(raw.arrival).slice(0, 10),
    endDate: str(raw.departure).slice(0, 10),
    currency: str(raw.currency_code).toUpperCase() || 'MXN',
    taxes: taxesOf(raw),
  })

  return {
    kind: 'lodgify',
    label: 'Lodgify',
    canCancelLinks: false,
    getRaw,

    async findRaw(number) {
      const byId = await getRaw(number)
      if (byId) return byId
      // A channel number (Booking.com, Airbnb …): found so Lana can answer "the platform handles payment".
      const wanted = number.trim().replace(/^#/, '').toLowerCase()
      if (!/^[a-z0-9-]{4,}$/.test(wanted)) return null
      const [current, upcoming] = await Promise.all([listBookings(auth, 'stayFilter=Current'), listBookings(auth, 'stayFilter=Upcoming')])
      const rows = [...(current.ok ? current.rows : []), ...(upcoming.ok ? upcoming.rows : [])]
      const hits = rows.filter((b) => channelCodes(b).some((c) => c.toLowerCase() === wanted))
      const best = hits.find((b) => mapLodgifyStatus(b) !== 'canceled') ?? hits[0]
      return best ? getRaw(str(best.id)) : null
    },

    async findRawByPhone(phone) {
      const r = await findReservationByPhone(auth, phone)
      return r.found && r.reservationID ? getRaw(r.reservationID) : null
    },

    phoneOf(raw) {
      const g = guestOf(raw)
      return str(g.phone ?? g.phone_number ?? g.mobile) || null
    },

    facts,

    async evaluate(f, settings, today): Promise<Eligibility> {
      const base = evaluateLodgify(f, settings, today)
      if (!base.eligible) return base
      // Lodgify's payment schedule: if its next payment is a real part of the balance, offer it as the deposit.
      const next = await nextLink(f.reservationId)
      const options = [...base.options]
      if (next && next.amount >= settings.minAmount && next.amount < f.balance - 0.01) {
        options.unshift({ kind: 'deposit', amount: next.amount })
      }
      return { ...base, options }
    },

    async createLink(p): Promise<CreateLinkResult> {
      const id = p.facts.reservationId
      // 1. Lodgify's own scheduled link, when it is exactly what was chosen.
      const next = await nextLink(id)
      if (next && Math.abs(next.amount - p.amount) < 0.005) {
        return { ok: true, id: `lodgify:${id}:${p.amount.toFixed(2)}`, url: next.url, expiresAt: null }
      }
      // A deposit is only ever Lodgify's scheduled amount — never one we make up.
      if (p.kind === 'deposit') return { ok: false, status: 409, message: "Lodgify's payment schedule no longer offers this deposit amount." }

      // 2. The full balance as an exact-amount link.
      const r = await lodgifyFetch(auth, `/v2/reservations/bookings/${encodeURIComponent(id)}/quote/paymentLink`, {
        method: 'POST',
        body: JSON.stringify({ amount: p.amount, currency: p.facts.currency, description: p.description }),
      })
      if (!r.ok) return { ok: false, status: r.status, message: r.error }
      // The response is either the link or { succeeded }: read it, else fetch it, and accept it only for the exact amount.
      const made = readLink(r.data) ?? (await nextLink(id))
      if ((r.data as Json | null)?.succeeded === false) return { ok: false, status: 422, message: 'Lodgify could not create a link for this amount (a scheduled payment may be pending).' }
      if (!made || Math.abs(made.amount - p.amount) >= 0.005) {
        return { ok: false, status: 422, message: 'Lodgify did not return a payment link for the exact balance.' }
      }
      return { ok: true, id: `lodgify:${id}:${p.amount.toFixed(2)}`, url: made.url, expiresAt: null }
    },

    // No status endpoint: verification happens on the booking's paid amount.
    linkState: async () => ({ ok: true, state: 'unknown', raw: 'n/a', readyForPayment: false }),

    async paidNow(id) {
      const raw = await getRaw(id)
      return raw ? facts(raw).paid : null
    },
  }
}
