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

  // postCustomItem: keep adding whatever field Cloudbeds says is missing, on a reservation that does not exist,
  // until it gets as far as "reservation not found". That shows the exact field names to send.
  const fields: Record<string, string> = { reservationID: '999999999999', referenceID: 'probe-no-charge', 'items[0][appItemID]': 'probe-item', 'items[0][itemName]': 'PROBE', 'items[0][itemQuantity]': '1' }
  const discovered: { param: string; where: string }[] = []
  let postCustomItem: { http: number; success: unknown; message: string | null } = { http: 0, success: null, message: null }
  for (let n = 0; n < 10; n++) {
    postCustomItem = await call('postCustomItem', form(fields))
    const msg = postCustomItem.message ?? ''
    // "Parameter x is required", or "At least one of the following parameter(s): [ a, b ]" (then the first one is added).
    const m = /Parameter (\w+) is required/i.exec(msg) ?? /At least one of the following parameter\(s\):\s*\[\s*(\w+)/i.exec(msg)
    if (!m) break
    const param = m[1]
    const value = /quantity/i.test(param) ? '1' : /price|amount|total/i.test(param) ? '1.00' : /id$/i.test(param) ? 'probe-item' : 'PROBE'
    const inItem = `items[0][${param}]`
    if (!(inItem in fields)) { fields[inItem] = value; discovered.push({ param, where: 'inside each item' }) }
    else if (!(param in fields)) { fields[param] = value; discovered.push({ param, where: 'top level' }) }
    else break
  }
  const [readReservations, readItems, postVoidItem] = await Promise.all([
    call('getReservations', { method: 'GET' }, `?propertyID=${propertyId}&pageSize=1`),
    call('getItems', { method: 'GET' }, `?propertyID=${propertyId}&pageSize=1`),
    call('postVoidItem', form({ reservationID: '999999999999', soldProductID: '999999999999' })),
  ])
  return NextResponse.json({
    note: 'Nothing was posted. Look at each message: a "not found / invalid reservation" style answer means the key reached validation (allowed); a permission / scope / unauthorized answer means it is blocked.',
    propertyId, readReservations, readItems, postCustomItem, postVoidItem, fieldsSentToCloudbeds: Object.keys(fields), addedWhileDiscovering: discovered,
  })
}
