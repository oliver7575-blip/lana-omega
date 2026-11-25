/**
 * WHO may get a payment link, and for HOW MUCH. This is the only place those
 * decisions are made — Lana and the admin panel both go through it, and the
 * model never supplies an amount.
 *
 *  - Only reservations whose source is on the direct list (default:
 *    "Website/Booking Engine") qualify.
 *  - Third-party (OTA) reservations never do: the platform handles payment and
 *    any Cloudbeds balance on them is ignored.
 *  - Walk-In and any other source are handled manually and go to Billing.
 *  - Anything we cannot positively identify as direct is refused (fails closed).
 */

export interface PaymentSettings {
  directSources: string[]
  linkExpiryDays: number
  minAmount: number
}

export const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  directSources: ['Website/Booking Engine'],
  linkExpiryDays: 1,
  minAmount: 10,
}

export function readPaymentSettings(raw: unknown): PaymentSettings {
  const r = (raw ?? {}) as Partial<{ direct_sources: unknown; link_expiry_days: unknown; min_amount: unknown }>
  const sources = Array.isArray(r.direct_sources) ? r.direct_sources.map((s) => String(s)).filter(Boolean) : []
  const days = Number(r.link_expiry_days)
  const min = Number(r.min_amount)
  return {
    directSources: sources.length ? sources : DEFAULT_PAYMENT_SETTINGS.directSources,
    linkExpiryDays: Number.isFinite(days) && days >= 1 && days <= 14 ? Math.round(days) : DEFAULT_PAYMENT_SETTINGS.linkExpiryDays,
    minAmount: Number.isFinite(min) && min >= 1 ? min : DEFAULT_PAYMENT_SETTINGS.minAmount,
  }
}

export type PaymentKind = 'deposit' | 'balance'

export type IneligibleCode =
  | 'third_party' // OTA: payment handled by the platform — ignore the balance
  | 'walk_in' // handled manually — escalate to Billing
  | 'manual_source' // any other non-listed source — escalate to Billing
  | 'inactive' // cancelled, no-show, checked out …
  | 'ended' // stay already over
  | 'no_balance'
  | 'below_minimum'

export interface ReservationFacts {
  reservationId: string
  guestName: string
  source: string
  sourceId: string
  thirdPartyId: string
  status: string
  balance: number
  paid: number
  suggestedDeposit: number
  startDate: string
  endDate: string
  /** ISO currency of the reservation (Cloudbeds: always MXN here). */
  currency?: string
  /** Taxes on the reservation (Lodgify: subtotals.taxes + subtotals.vat). */
  taxes?: number
}

export function factsFromRaw(d: Record<string, unknown>): ReservationFacts {
  const bd = (d.balanceDetailed ?? {}) as Record<string, unknown>
  return {
    reservationId: String(d.reservationID ?? ''),
    guestName: String(d.guestName ?? ''),
    source: String(d.source ?? d.sourceName ?? ''),
    sourceId: String(d.sourceID ?? ''),
    thirdPartyId: String(d.thirdPartyIdentifier ?? '').trim(),
    status: String(d.status ?? '').toLowerCase(),
    balance: Number(d.balance ?? 0) || 0,
    paid: Number(bd.paid ?? 0) || 0,
    suggestedDeposit: Number.parseFloat(String(bd.suggestedDeposit ?? '0')) || 0,
    startDate: String(d.startDate ?? ''),
    endDate: String(d.endDate ?? ''),
  }
}

export const round2 = (n: number) => Math.round(n * 100) / 100

const OTA_PATTERN = /booking\.com|airbnb|expedia|agoda|vrbo|homeaway|hostelworld|tripadvisor|trip\.com|despegar|hotels\.com|google|kayak|trivago/i
const LIVE_STATUSES = ['confirmed', 'not_confirmed', 'checked_in']

export type Eligibility =
  | { eligible: true; options: { kind: PaymentKind; amount: number }[]; facts: ReservationFacts }
  | { eligible: false; code: IneligibleCode; message: string; facts: ReservationFacts }

export function evaluate(facts: ReservationFacts, settings: PaymentSettings, today: string): Eligibility {
  const no = (code: IneligibleCode, message: string): Eligibility => ({ eligible: false, code, message, facts })
  const source = facts.source.trim().toLowerCase()
  const isDirectSource = settings.directSources.some((s) => s.trim().toLowerCase() === source)

  // Third-party first: the platform's number or an OTA source name is decisive, whatever else is true.
  if (facts.thirdPartyId || OTA_PATTERN.test(facts.source)) {
    return no('third_party', 'Booked through a travel platform: payment is handled by the platform, so no link is created.')
  }
  if (/walk-?\s?in/i.test(facts.source)) {
    return no('walk_in', 'Walk-In reservations are handled manually — no payment link. Billing handles it.')
  }
  if (!isDirectSource) {
    return no('manual_source', `Source "${facts.source || 'unknown'}" is not a direct online booking — handled manually by Billing.`)
  }
  if (!LIVE_STATUSES.includes(facts.status)) {
    return no('inactive', `The reservation is ${facts.status || 'not active'}.`)
  }
  if (facts.endDate && facts.endDate < today) {
    return no('ended', 'The stay has already ended.')
  }
  if (facts.balance <= 0) return no('no_balance', 'There is no balance to pay.')
  if (facts.balance < settings.minAmount) {
    return no('below_minimum', `The balance is below the minimum payment (${settings.minAmount.toFixed(2)} MXN).`)
  }

  const options: { kind: PaymentKind; amount: number }[] = [{ kind: 'balance', amount: round2(facts.balance) }]
  // Deposit = what Cloudbeds suggests, minus anything already paid; only when it is a real part of the balance.
  const depositLeft = round2(Math.max(0, facts.suggestedDeposit - facts.paid))
  if (depositLeft >= settings.minAmount && depositLeft < facts.balance - 0.01) {
    options.unshift({ kind: 'deposit', amount: depositLeft })
  }
  return { eligible: true, options, facts }
}

// ---- Lodgify -----------------------------------------------------------------------

/**
 * Lodgify `source` values (Lodgify API enum): Manual, OH, NineFlats, Airbnb,
 * AirbnbIntegration, HomeAway, BookingCom, Expedia, ICal, Email,
 * FacebookMessenger, PublicApi, Other.
 *
 * Hard rules (not settings) for who may get a payment link:
 *  - "OH" = Lodgify's own booking website / booking engine → yes.
 *  - "PublicApi" = created through the API (e.g. from the Lana panel) → only
 *    when the booking's taxes are more than 0.
 *  - Everything else → no.
 */
export const LODGIFY_DIRECT_SOURCE = 'oh'
export const LODGIFY_API_SOURCE = 'publicapi'
const LODGIFY_OTA_SOURCES = ['airbnb', 'airbnbintegration', 'bookingcom', 'expedia', 'homeaway', 'nineflats', 'ical']

/** Lodgify reservation facts. `balance` = amount_due, `paid` = amount_paid. No suggested deposit (Lodgify's payment schedule decides). */
export function evaluateLodgify(facts: ReservationFacts, settings: PaymentSettings, today: string): Eligibility {
  const no = (code: IneligibleCode, message: string): Eligibility => ({ eligible: false, code, message, facts })
  const source = facts.source.trim().toLowerCase()

  // Third-party first: an OTA source (or an OTA name anywhere in it) is decisive.
  if (LODGIFY_OTA_SOURCES.includes(source) || OTA_PATTERN.test(facts.source)) {
    return no('third_party', 'Booked through a travel platform: payment is handled by the platform, so no link is created.')
  }
  // Lodgify booking website always qualifies; an API booking only with taxes > 0. Manual, Email, Other … and unknown → staff.
  if (source === LODGIFY_API_SOURCE) {
    if (!((facts.taxes ?? 0) > 0)) {
      return no('manual_source', 'Created through the API without taxes — handled manually by Billing.')
    }
  } else if (source !== LODGIFY_DIRECT_SOURCE) {
    return no('manual_source', `Source "${facts.source || 'unknown'}" is not a booking made on the Lodgify booking website — handled manually by Billing.`)
  }
  if (facts.status !== 'confirmed') {
    return no('inactive', `The reservation is ${facts.status || 'not active'}.`)
  }
  if (facts.endDate && facts.endDate < today) {
    return no('ended', 'The stay has already ended.')
  }
  if (facts.balance <= 0) return no('no_balance', 'There is no balance to pay.')
  if (facts.balance < settings.minAmount) {
    return no('below_minimum', `The balance is below the minimum payment (${settings.minAmount.toFixed(2)}).`)
  }
  // Options are filled in by the Lodgify backend from Lodgify's own payment schedule.
  return { eligible: true, options: [{ kind: 'balance', amount: round2(facts.balance) }], facts }
}
