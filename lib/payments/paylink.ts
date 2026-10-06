import type { CB } from '../cloudbeds-ops'

/**
 * Cloudbeds native Pay-by-Link (Cloudbeds Payments / Stripe-powered).
 *   POST https://api.cloudbeds.com/payments/v2/pay-by-link
 *   GET  https://api.cloudbeds.com/payments/v2/pay-by-link/{id}
 * Cloudbeds hosts the payment page and, once the guest pays, posts the payment
 * to the reservation's main folio itself. We never see card details.
 */

const BASE = 'https://api.cloudbeds.com/payments/v2/pay-by-link'

function headers(cb: CB): Record<string, string> {
  return {
    Authorization: `Bearer ${cb.apiKey}`,
    'X-Property-Id': cb.propertyId,
    accept: 'application/json',
    'Content-Type': 'application/json',
  }
}

async function readBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return { message: text.slice(0, 200) }
  }
}

const messageOf = (b: Record<string, unknown>, fallback: string) =>
  String(b.message ?? b.error ?? (b.data as Record<string, unknown> | undefined)?.message ?? fallback).slice(0, 300)

export type CreateLinkResult =
  | { ok: true; id: string; url: string; expiresAt: string | null }
  | { ok: false; status: number; message: string }

/** Creates a link for an exact amount on one reservation (a normal charge — not a pre-authorisation). */
export async function createPayByLink(
  cb: CB,
  p: { reservationId: string; amount: number; description: string; expiresAfterDays: number }
): Promise<CreateLinkResult> {
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: headers(cb),
      body: JSON.stringify({
        inventoryObject: { type: 'confirmation_number', id: p.reservationId },
        paid: p.amount,
        description: p.description,
        propertyId: cb.propertyId,
        expires_after: p.expiresAfterDays,
        auth_payment: false,
      }),
      signal: AbortSignal.timeout(20000),
    })
    const body = await readBody(res)
    const d = ((body.data as Record<string, unknown> | undefined) ?? body) as Record<string, unknown>
    const url = String(d.url ?? '')
    const id = String(d.id ?? '')
    if (res.ok && url && id) return { ok: true, id, url, expiresAt: d.expires_at ? String(d.expires_at) : null }
    return { ok: false, status: res.status, message: messageOf(body, `Cloudbeds returned HTTP ${res.status}`) }
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : 'network error' }
  }
}

export type LinkStatusResult =
  | { ok: true; status: string; paid: boolean; readyForPayment: boolean }
  | { ok: false; status: number; message: string }

/** payByLinkStatus is one of: sent, viewed, paid, expired, cancelled, 3DSProcessing. */
export async function getPayByLink(cb: CB, linkId: string): Promise<LinkStatusResult> {
  try {
    const res = await fetch(`${BASE}/${encodeURIComponent(linkId)}`, { headers: headers(cb), cache: 'no-store', signal: AbortSignal.timeout(20000) })
    const body = await readBody(res)
    if (!res.ok) return { ok: false, status: res.status, message: messageOf(body, `Cloudbeds returned HTTP ${res.status}`) }
    const d = ((body.data as Record<string, unknown> | undefined) ?? body) as Record<string, unknown>
    const status = String(d.payByLinkStatus ?? d.status ?? '')
    return { ok: true, status, paid: d.paid === true || status.toLowerCase() === 'paid', readyForPayment: d.readyForPayment === true }
  } catch (err) {
    return { ok: false, status: 0, message: err instanceof Error ? err.message : 'network error' }
  }
}
