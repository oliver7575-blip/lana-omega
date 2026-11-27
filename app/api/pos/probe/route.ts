import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'

export const maxDuration = 30

/**
 * Checks, without posting anything, whether this hotel's Cloudbeds key is allowed to do what the bar POS needs.
 * The write check posts to a reservation id that does not exist (a long number, because "0" is treated as empty): Cloudbeds either refuses the key (a permission
 * message) or reaches validation and says the reservation was not found (so the key is allowed to post).
 */
export async function GET() {
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const { apiKey, propertyId } = c.cb
  const base = 'https://api.cloudbeds.com/api/v1.3'

  async function call(method: string, init: RequestInit, qs = '') {
    try {
      const res = await fetch(`${base}/${method}${qs}`, { ...init, headers: { 'x-api-key': apiKey, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15000), cache: 'no-store' })
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>
      return { http: res.status, success: j.success ?? null, message: (j.message as string) ?? null }
    } catch (e) {
      return { http: 0, success: null, message: e instanceof Error ? e.message : 'failed' }
    }
  }

  const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ propertyID: propertyId, ...o }) })

  const [readReservations, readItems, postCustomItem, postVoidItem] = await Promise.all([
    call('getReservations', { method: 'GET' }, `?propertyID=${propertyId}&pageSize=1`),
    call('getItems', { method: 'GET' }, `?propertyID=${propertyId}&pageSize=1`),
    call('postCustomItem', form({ reservationID: '999999999999', referenceID: 'probe-no-charge', 'items[0][appItemID]': 'probe-item', 'items[0][name]': 'PROBE', 'items[0][price]': '1.00', 'items[0][quantity]': '1', 'items[0][itemCategoryName]': 'Probe' })),
    call('postVoidItem', form({ reservationID: '999999999999', soldProductID: '999999999999' })),
  ])
  return NextResponse.json({
    note: 'Nothing was posted. Look at each message: a "not found / invalid reservation" style answer means the key reached validation (allowed); a permission / scope / unauthorized answer means it is blocked.',
    propertyId, readReservations, readItems, postCustomItem, postVoidItem,
  })
}
