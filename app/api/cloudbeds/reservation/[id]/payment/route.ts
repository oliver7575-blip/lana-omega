import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { addReservationPayment, getReservationDetail } from '@/lib/cloudbeds-ops'
import { lodgifyForCaller } from '@/lib/lodgify-caller'
import { lodgifyDetail } from '@/lib/lodgify-detail'
import { createServiceClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

/** Adds a payment (or a refund) to a reservation in Cloudbeds. Body: { kind: 'payment' | 'refund', amount, method, note? } */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await cloudbedsForCaller()
  const b = (await request.json().catch(() => ({}))) as { kind?: string; amount?: number | string; method?: string; note?: string }
  const amount = Number(b.amount)
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Enter an amount greater than zero.' }, { status: 400 })
  if (!b.method?.trim()) return NextResponse.json({ error: 'Choose or type a payment method.' }, { status: 400 })
  if ('error' in c) {
    // Lodgify (Lalo) can't record payments, so they are kept in the panel's own table.
    const l = await lodgifyForCaller()
    if (!l) return c.error
    try {
      if (b.kind === 'refund') {
        // Lalo: "Refund" cancels the most recent payment entered in the panel; again, the one before it, and so on.
        const db = createServiceClient()
        const { data: last } = await db.from('pms_manual_payments').select('id').eq('tenant_id', l.tenantId).eq('reservation_id', id).order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (!last) return NextResponse.json({ error: 'There is no payment entered in the panel to cancel.' }, { status: 400 })
        const { error: delError } = await db.from('pms_manual_payments').delete().eq('id', last.id as string)
        if (delError) throw new Error(delError.message)
        return NextResponse.json({ reservation: await lodgifyDetail(l, id) })
      }
      const detail = await lodgifyDetail(l, id)
      if (/airbnb|booking|expedia|homeaway|vrbo|ical/i.test(detail.source ?? '')) {
        return NextResponse.json({ error: 'Channel bookings are prepaid through the channel.' }, { status: 400 })
      }
      const { data: { user } } = await (await createClient()).auth.getUser()
      const { error } = await createServiceClient().from('pms_manual_payments').insert({
        tenant_id: l.tenantId,
        reservation_id: id,
        amount: Math.round(amount * 100) / 100,
        method: b.method.trim().slice(0, 80),
        note: b.note?.trim().slice(0, 200) || null,
        created_by: user?.email ?? null,
      })
      if (error) throw new Error(error.message)
      return NextResponse.json({ reservation: await lodgifyDetail(l, id) })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not record the payment' }, { status: 502 })
    }
  }
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
