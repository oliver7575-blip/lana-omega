import type { CB } from './cloudbeds-ops'
import { dashList } from './cloudbeds-ops'
import { hotelToday } from './tz'

/**
 * Bar / restaurant POS: charges to a guest's room in Cloudbeds.
 *
 * Uses the documented POS flow: list checked-in reservations, post the sale to the guest's
 * folio with postCustomItem (one line per product, our receipt id in referenceID so a
 * retry can never charge twice), and void with postVoidItem.
 *
 * NOTE (stage 1): the exact field names of the items array are not shown in Cloudbeds' public
 * reference pages, so the payload below follows the POS guide and must be confirmed with the
 * first live test. The panel runs in TEST MODE until that is switched off in POS → Manage.
 */
const BASE = 'https://api.cloudbeds.com/api/v1.3'

export interface InHouseGuest {
  reservationID: string
  guestName: string
  room: string
}

export interface PosLine {
  /** Our menu item id: Cloudbeds needs a stable id per product (appItemID). */
  itemId: string
  name: string
  category: string
  price: number
  quantity: number
}

/** Checked-in guests only (Cloudbeds' POS rule: only in-house guests are listed). */
export async function inHouseGuests(cb: CB): Promise<InHouseGuest[]> {
  const rows = await dashList(cb, 'inhouse', hotelToday())
  return rows
    .map((r) => ({ reservationID: r.reservationID, guestName: r.guestName, room: r.room }))
    .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }))
}

async function cbForm(cb: CB, method: string, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'x-api-key': cb.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ propertyID: cb.propertyId, ...fields }),
    signal: AbortSignal.timeout(20000),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || json.success === false) {
    throw new Error((json.message as string) ?? `Cloudbeds ${method} failed: ${res.status}`)
  }
  return json
}

/** Posts one sale to the room's folio. Left unpaid so reception collects it at check-out. */
export async function postRoomCharge(
  cb: CB,
  a: { reservationID: string; referenceID: string; lines: PosLine[]; guestName?: string | null }
): Promise<Record<string, unknown>> {
  const fields: Record<string, string> = {
    reservationID: a.reservationID,
    referenceID: a.referenceID,
    itemPaid: 'false',
  }
  if (a.guestName) fields.guestName = a.guestName
  a.lines.forEach((l, i) => {
    fields[`items[${i}][appItemID]`] = l.itemId
    // Field names as Cloudbeds' postCustomItem asks for them (found with the /api/pos/probe check).
    fields[`items[${i}][itemName]`] = l.name
    fields[`items[${i}][itemCategoryName]`] = l.category
    fields[`items[${i}][itemPrice]`] = l.price.toFixed(2)
    fields[`items[${i}][itemQuantity]`] = String(l.quantity)
    fields[`items[${i}][itemNote]`] = `Bar POS ${a.referenceID}`
  })
  return cbForm(cb, 'postCustomItem', fields)
}

/** Voids one posted folio item by its Cloudbeds id. */
export async function voidSoldProduct(cb: CB, reservationID: string, soldProductID: string): Promise<void> {
  await cbForm(cb, 'postVoidItem', { reservationID, soldProductID })
}

/** Folio item ids in a postCustomItem response, whatever shape it comes back in. */
export function soldProductIds(resp: unknown): string[] {
  const ids: string[] = []
  const walk = (v: unknown) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) return v.forEach(walk)
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (/^soldProductID$/i.test(k) && (typeof val === 'string' || typeof val === 'number')) ids.push(String(val))
      else walk(val)
    }
  }
  walk(resp)
  return [...new Set(ids)]
}
