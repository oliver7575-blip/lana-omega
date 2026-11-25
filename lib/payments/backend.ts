import type { PmsAdapter } from '../pms'
import type { Eligibility, PaymentKind, PaymentSettings, ReservationFacts } from './rules'

/**
 * The PMS-specific half of payments. Everything that decides WHO may pay and
 * how a payment is VERIFIED is written once (service.ts, lana-tool.ts); each
 * PMS only has to answer these questions.
 *
 *   Cloudbeds → native Pay-by-Link (backend-cloudbeds.ts)
 *   Lodgify   → Lodgify payment link on the booking's quote, paid through the
 *               Stripe account connected to that rental in Lodgify (backend-lodgify.ts)
 */

type Json = Record<string, unknown>

export type CreateLinkResult =
  | { ok: true; id: string; url: string; expiresAt: string | null }
  | { ok: false; status: number; message: string }

/** Normalised link state. 'unknown' = the PMS has no link status (Lodgify): rely on the reservation's paid amount. */
export type LinkState =
  | { ok: true; state: 'open' | 'paid' | 'expired' | 'cancelled' | 'unknown'; raw: string; readyForPayment: boolean }
  | { ok: false; status: number; message: string }

export interface PaymentBackend {
  kind: 'cloudbeds' | 'lodgify'
  /** "Cloudbeds" / "Lodgify" — for staff messages. */
  label: string

  /** The raw reservation for its PMS id, or null. */
  getRaw(reservationId: string): Promise<Json | null>
  /** The raw reservation for anything a guest might quote (PMS id or channel number), or null. */
  findRaw(confirmationNumber: string): Promise<Json | null>
  /** The guest's single current/upcoming reservation for this phone, or null. */
  findRawByPhone(phone: string): Promise<Json | null>
  phoneOf(raw: Json): string | null
  facts(raw: Json): ReservationFacts

  /** Who qualifies and which options exist (amounts always from the PMS). */
  evaluate(facts: ReservationFacts, settings: PaymentSettings, today: string): Promise<Eligibility>
  createLink(p: { facts: ReservationFacts; kind: PaymentKind; amount: number; description: string; expiresAfterDays: number }): Promise<CreateLinkResult>
  linkState(linkId: string): Promise<LinkState>
  /** Total paid on the reservation right now (for verification), or null if it can't be read. */
  paidNow(reservationId: string): Promise<number | null>
  /** Whether staff can cancel a link at the PMS (neither can today). */
  canCancelLinks: boolean
}

/** Builds the payment backend for a tenant's PMS, or null when that PMS has no payment support. */
export async function paymentBackendFor(pms: PmsAdapter | null | undefined): Promise<PaymentBackend | null> {
  if (!pms) return null
  if (pms.cloudbeds) {
    const { cloudbedsPaymentBackend } = await import('./backend-cloudbeds')
    return cloudbedsPaymentBackend(pms.cloudbeds)
  }
  if (pms.lodgify) {
    const { lodgifyPaymentBackend } = await import('./backend-lodgify')
    return lodgifyPaymentBackend(pms.lodgify)
  }
  return null
}
