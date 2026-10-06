import { NextResponse } from 'next/server'
import { paymentsCaller } from '@/lib/payments/caller'
import { lookupReservationForPayment } from '@/lib/payments/service'

/** What could be paid on this reservation? (read-only) */
export async function GET(request: Request) {
  const c = await paymentsCaller()
  if ('error' in c) return c.error
  const reservationId = (new URL(request.url).searchParams.get('reservationId') ?? '').trim()
  if (!/^\d{6,}$/.test(reservationId)) return NextResponse.json({ error: 'Enter a Cloudbeds reservation number' }, { status: 400 })
  const result = await lookupReservationForPayment(c.cb, c.ctx, reservationId)
  if (!result.found) return NextResponse.json({ found: false, message: result.message })
  const el = result.eligibility
  const f = el.facts
  return NextResponse.json({
    found: true,
    reservation: { id: f.reservationId, guestName: f.guestName, source: f.source, status: f.status, balance: f.balance, paid: f.paid, startDate: f.startDate, endDate: f.endDate },
    eligible: el.eligible,
    options: el.eligible ? el.options : [],
    code: el.eligible ? null : el.code,
    message: el.eligible ? null : el.message,
  })
}
