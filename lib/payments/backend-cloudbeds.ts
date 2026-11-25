import { findReservationByConfirmation, getReservationRaw, type CB } from '../cloudbeds-ops'
import { findReservationByPhone } from '../cloudbeds'
import { evaluate, factsFromRaw } from './rules'
import { createPayByLink, getPayByLink } from './paylink'
import type { PaymentBackend } from './backend'

type Json = Record<string, unknown>

/** The original Cloudbeds payment logic, unchanged — just behind the PaymentBackend interface. */
export function cloudbedsPaymentBackend(cb: CB): PaymentBackend {
  const getRaw = async (id: string): Promise<Json | null> => {
    try {
      const r = await getReservationRaw(cb, id)
      return r.reservationID ? r : null
    } catch {
      return null
    }
  }

  return {
    kind: 'cloudbeds',
    label: 'Cloudbeds',
    canCancelLinks: false,
    getRaw,

    async findRaw(number) {
      if (/^\d{6,}$/.test(number)) {
        const r = await getRaw(number)
        if (r) return r
      }
      const found = await findReservationByConfirmation(cb, number)
      return found ? getRaw(found.reservationID) : null
    },

    async findRawByPhone(phone) {
      const byPhone = await findReservationByPhone(cb.apiKey, cb.propertyId, phone)
      return byPhone.found && byPhone.reservationID ? getRaw(byPhone.reservationID) : null
    },

    phoneOf(raw) {
      const list = (raw.guestList ?? {}) as Record<string, Json>
      const main = list[String(raw.guestID ?? '')]
      const candidates = [main, ...Object.values(list)].filter(Boolean) as Json[]
      for (const g of candidates) {
        const p = String(g.guestPhone ?? g.guestCellPhone ?? '').trim()
        if (p) return p
      }
      const direct = String(raw.guestPhone ?? raw.guestCellPhone ?? '').trim()
      return direct || null
    },

    facts: (raw) => ({ ...factsFromRaw(raw), currency: 'MXN' }),
    evaluate: async (facts, settings, today) => evaluate(facts, settings, today),
    createLink: (p) => createPayByLink(cb, { reservationId: p.facts.reservationId, amount: p.amount, description: p.description, expiresAfterDays: p.expiresAfterDays }),

    async linkState(linkId) {
      const r = await getPayByLink(cb, linkId)
      if (!r.ok) return r
      const s = r.status.toLowerCase()
      const state = r.paid || s === 'paid' ? 'paid' : s === 'expired' ? 'expired' : s === 'cancelled' || s === 'canceled' ? 'cancelled' : 'open'
      return { ok: true, state, raw: r.status, readyForPayment: r.readyForPayment || s === '3dsprocessing' }
    },

    async paidNow(id) {
      const raw = await getRaw(id)
      return raw ? factsFromRaw(raw).paid : null
    },
  }
}
