import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'

export const maxDuration = 30

/**
 * Read-only. Shows the items set up in Cloudbeds (Settings → Products) and whether an "add item by id" call exists for this key.
 * The write check uses a reservation id that does not exist, so nothing can be posted.
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
      return { http: res.status, body: j }
    } catch (e) {
      return { http: 0, body: { message: e instanceof Error ? e.message : 'failed' } }
    }
  }
  const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ propertyID: propertyId, ...o }) })

  const [getItems, getItemCategories, postItem] = await Promise.all([
    call('getItems', { method: 'GET' }, `?propertyID=${propertyId}&pageSize=50`),
    call('getItemCategories', { method: 'GET' }, `?propertyID=${propertyId}`),
    call('postItem', form({ reservationID: '999999999999', itemID: '999999999999', itemQuantity: '1' })),
  ])
  return NextResponse.json({ note: 'Read-only. Nothing was posted.', getItems, getItemCategories, postItem })
}
