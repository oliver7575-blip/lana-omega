export function buildBookingLinkInstruction(
  bookingConfig: Record<string, unknown> | null | undefined
): string {
  const code = bookingConfig?.booking_engine_code as string | undefined
  const bookingUrl = (bookingConfig?.booking_url as string | undefined)?.trim()
  const today = new Date().toISOString().slice(0, 10)

  // Cloudbeds booking engine: a deep link with the guest's dates filled in.
  if (code) {
    const currency = ((bookingConfig?.currency as string | undefined) || 'usd').toLowerCase()
    return `\n\nBOOKING LINK: Today's actual date is ${today}. When a guest asks about availability or wants to book, ask for both a check-in and check-out date if you don't have them yet. If the guest gives a date without a year (e.g. "December 20"), assume the NEXT time that date occurs after today (${today}) — never a date that has already passed. Then give them this link with the dates filled in (YYYY-MM-DD format): https://hotels.cloudbeds.com/en/reservation/${code}/?checkin=CHECKIN_DATE&checkout=CHECKOUT_DATE&currency=${currency} — replace CHECKIN_DATE and CHECKOUT_DATE only, keep everything else in the URL exactly as given. This link is the only way to check real availability or book — never claim to know whether specific dates are available yourself.`
  }

  // Any other system (e.g. a Lodgify booking website): one fixed link.
  if (bookingUrl && /^https:\/\//i.test(bookingUrl)) {
    return `\n\nBOOKING LINK: Today's actual date is ${today}. When a guest asks about availability or wants to book, give them this link, where they can pick their dates and see real availability and prices: ${bookingUrl} — use it exactly as given, never add or change anything in it. This link is the only way to check real availability or book — never claim to know whether specific dates are available yourself.`
  }

  return ''
}
