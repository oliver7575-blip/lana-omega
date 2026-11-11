import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { addReservationPayment, getReservationDetail } from '@/lib/cloudbeds-ops'

/** Adds a payment (or a refund) to a reservation in Cloudbeds. Body: { kind: 'payment' | 'refund', amount, method, note? } */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const b = (await request.json().catch(() => ({}))) as { kind?: string; amount?: number | string; method?: string; note?: string }
  const amount = Number(b.amount)
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Enter an amount greater than zero.' }, { status: 400 })
  if (!b.method) return NextResponse.json({ error: 'Choose a payment method.' }, { status: 400 })
  const refund = b.kind === 'refund'
  try {
    if (refund) {
      const before = await getReservationDetail(c.cb, id)
      const paid = before.breakdown.paid
      if (paid !== null && amount > paid + 0.005) {
        return NextResponse.json({ error: `Only MXN ${paid.toLocaleString('en-US')} has been paid on this reservation, so that much is the most that can be refunded.` }, { status: 400 })
      }
    }
    await addReservationPayment(c.cb, { reservationID: id, methodCode: b.method, amount, refund, note: b.note })
    return NextResponse.json({ reservation: await getReservationDetail(c.cb, id) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
