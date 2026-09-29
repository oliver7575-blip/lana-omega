/**
 * Normalises a phone number to the digits-only form WhatsApp uses
 * (e.g. "+31 6 2903 0860" -> "31629030860").
 *
 * Mexican mobiles can arrive with the legacy "1" after the country code
 * (521 + 10 digits); those are folded to 52 + 10 digits so both forms match.
 */
export function normalizePhone(raw: string | null | undefined): string {
  let digits = (raw ?? '').replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length === 13 && digits.startsWith('521')) digits = `52${digits.slice(3)}`
  return digits
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a)
  return na.length > 0 && na === normalizePhone(b)
}
