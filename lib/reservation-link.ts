import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhone } from './phone'

const words = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 2)

/** True when every word of the surname the guest gave appears in the booking's guest name (accents and case ignored). */
export function surnameMatches(bookingGuestName: string | undefined, lastName: string | undefined): boolean {
  const given = words(lastName ?? '')
  const have = new Set(words(bookingGuestName ?? ''))
  return given.length > 0 && given.every((w) => have.has(w))
}

export function phoneMatches(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = normalizePhone(a).slice(-10)
  const y = normalizePhone(b).slice(-10)
  return x.length >= 8 && x === y
}

type Found = { found?: boolean; reservationID?: string; guestName?: string; guestPhone?: string; status?: string; startDate?: string; endDate?: string; roomTypeName?: string }

/**
 * A guest who quotes a confirmation number only gets that booking saved as theirs when something checks out:
 * the booking's phone is the number they write from, or the surname they gave is on the booking.
 */
export async function linkIfVerified(
  db: SupabaseClient,
  tenantId: string,
  guestId: string,
  result: Found,
  proof: { phone?: string | null; lastName?: string | null }
): Promise<'phone' | 'surname' | null> {
  if (!result?.found || !result.reservationID) return null
  const by = phoneMatches(result.guestPhone, proof.phone) ? 'phone' : surnameMatches(result.guestName, proof.lastName ?? undefined) ? 'surname' : null
  if (!by) return null
  await db.from('guest_reservations').upsert(
    {
      tenant_id: tenantId,
      guest_id: guestId,
      confirmation_number: String(result.reservationID),
      status: result.status ?? null,
      start_date: (result.startDate ?? '').slice(0, 10) || null,
      end_date: (result.endDate ?? '').slice(0, 10) || null,
      room_label: result.roomTypeName ?? null,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,guest_id' }
  )
  return by
}
