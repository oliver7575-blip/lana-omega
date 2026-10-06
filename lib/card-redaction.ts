/**
 * Guests must never share card details in chat. This removes card-like numbers
 * (14–19 digits that pass the Luhn check) and security codes BEFORE a message is
 * stored or shown to the model. Ordinary numbers — phones, confirmation numbers,
 * dates — don't pass the Luhn check at that length, so they are left alone.
 */

function luhnValid(digits: string): boolean {
  let sum = 0
  let alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (alt) {
      n *= 2
      if (n > 9) n -= 9
    }
    sum += n
    alt = !alt
  }
  return sum % 10 === 0
}

const CARD_CANDIDATE = /(?<![\d])(?:\d[ -]?){12,18}\d(?![\d])/g
const SECURITY_CODE = /\b(cvv2?|cvc2?|csc|cid|c[oó]digo\s+de\s+seguridad|security\s+code)\b[\s:=#-]*\d{3,4}\b/gi

export const CARD_NOTE =
  '[Card details were removed from this message for the guest\'s security. Never ask for or accept card details in chat — send the secure payment link instead.]'

export function redactCardData(text: string): { text: string; redacted: boolean } {
  if (!text) return { text, redacted: false }
  let redacted = false
  let out = text.replace(CARD_CANDIDATE, (m) => {
    const digits = m.replace(/[ -]/g, '')
    // 13-digit numbers are left alone: Cloudbeds reservation numbers have 13 digits, and 1 in 10 would pass the check by chance.
    if (digits.length >= 14 && digits.length <= 19 && luhnValid(digits)) {
      redacted = true
      return '[card number removed]'
    }
    return m
  })
  out = out.replace(SECURITY_CODE, () => {
    redacted = true
    return '[security code removed]'
  })
  return { text: redacted ? `${out}\n${CARD_NOTE}` : out, redacted }
}
