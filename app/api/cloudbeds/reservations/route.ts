import { NextResponse, after } from 'next/server'
import { processNewReservation } from '@/lib/new-reservation-notify'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { lodgifyForCaller } from '@/lib/lodgify-caller'
import { createBookingLodgify } from '@/lib/lodgify-ops'
import { createServiceClient } from '@/lib/supabase/service'
import { createReservation, listReservationsSummary, type NewReservation } from '@/lib/cloudbeds-ops'

export const maxDuration = 60

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Lists reservations for the panel's Reservations page. ?page=1,2,… */
export async function GET(request: Request) {
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const page = Number(new URL(request.url).searchParams.get('page') ?? '1') || 1
  try {
    return NextResponse.json(await listReservationsSummary(c.cb, page))
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}

/** Creates a reservation in Cloudbeds from the Dashboard's "Create new reservation" window. */
export async function POST(request: Request) {
  const c = await cloudbedsForCaller()
  const b = (await request.json()) as Partial<NewReservation> & { withQuote?: boolean }
  if ('error' in c) {
    const l = await lodgifyForCaller()
    if (!l) return c.error
    const need: string[] = []
    if (!DATE.test(b.startDate ?? '') || !DATE.test(b.endDate ?? '') || (b.endDate ?? '') <= (b.startDate ?? '')) need.push('valid dates')
    if (!b.roomTypeID) need.push('a rental')
    if (!b.firstName?.trim() || !b.lastName?.trim()) need.push("the guest's first and last name")
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email ?? '')) need.push('a valid email')
    if (!/^[A-Za-z]{2}$/.test(b.country ?? '')) need.push('the country')
    if (!(Number(b.customTotal) > 0)) need.push('the price per night')
    if (need.length) return NextResponse.json({ error: `Please add ${need.join(', ')}.` }, { status: 400 })
    try {
      const { id: reservationID, quoteWarning } = await createBookingLodgify(l.auth, {
        propertyId: b.roomTypeID!,
        start: b.startDate!,
        end: b.endDate!,
        adults: Math.max(1, Number(b.adults) || 1),
        children: Math.max(0, Number(b.children) || 0),
        firstName: b.firstName!.trim(),
        lastName: b.lastName!.trim(),
        email: b.email!.trim(),
        phone: b.phone?.trim() || undefined,
        country: b.country!.toUpperCase(),
        skipQuote: true,
        total: b.customTotal != null && Number.isFinite(Number(b.customTotal)) && Number(b.customTotal) >= 0 ? Number(b.customTotal) : undefined,
      })
      // Lodgify cannot store notes through its API: keep a panel-only note that this booking has no quote.
      await createServiceClient().from('pms_reservation_notes').insert({
        tenant_id: l.tenantId, reservation_id: reservationID,
        text: `No quote: price set manually in the Lana panel (MXN ${Number(b.customTotal).toLocaleString('en-US')} total).`,
      })
      // Lodgify has no arrival-time field: keep it in Lana's own table, like her WhatsApp updates.
      if (b.arrivalTime) {
        await createServiceClient().from('pms_arrival_times').upsert(
          { tenant_id: l.tenantId, reservation_id: reservationID, arrival_time: b.arrivalTime, source: 'panel', updated_at: new Date().toISOString() },
          { onConflict: 'tenant_id,reservation_id' },
        )
      }
      // The welcome message is sent by Lodgify's booking webhook, as for any other new booking.
      return NextResponse.json({ reservationID, priceWarning: quoteWarning })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Lodgify error' }, { status: 502 })
    }
  }

  const problems: string[] = []
  if (!DATE.test(b.startDate ?? '') || !DATE.test(b.endDate ?? '') || (b.endDate ?? '') <= (b.startDate ?? '')) problems.push('valid dates')
  if (!b.roomTypeID) problems.push('a room type')
  if (!b.firstName?.trim() || !b.lastName?.trim()) problems.push("the guest's first and last name")
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email ?? '')) problems.push('a valid email')
  if (!/^[A-Za-z]{2}$/.test(b.country ?? '')) problems.push('the country')
  if (!b.paymentMethod) problems.push('a payment method')
  if (problems.length) return NextResponse.json({ error: `Please add ${problems.join(', ')}.` }, { status: 400 })

  try {
    const { id: reservationID, priceWarning } = await createReservation(c.cb, {
      startDate: b.startDate!,
      endDate: b.endDate!,
      adults: Math.max(1, Number(b.adults) || 1),
      children: Math.max(0, Number(b.children) || 0),
      roomTypeID: b.roomTypeID!,
      roomID: b.roomID || undefined,
      roomRateID: b.roomRateID || undefined,
      firstName: b.firstName!.trim(),
      lastName: b.lastName!.trim(),
      email: b.email!.trim(),
      phone: b.phone?.trim() || undefined,
      country: b.country!,
      arrivalTime: b.arrivalTime || undefined,
      sourceID: b.sourceID || undefined,
      paymentMethod: b.paymentMethod!,
      sendEmail: Boolean(b.sendEmail),
      customTotal: Number.isFinite(Number(b.customTotal)) && b.customTotal != null && Number(b.customTotal) >= 0 ? Number(b.customTotal) : undefined,
      listTotal: Number.isFinite(Number(b.listTotal)) && b.listTotal != null ? Number(b.listTotal) : undefined,
    })
    // Cloudbeds doesn't reliably notify us about bookings made through its API, so
    // send the welcome message ourselves (duplicates are skipped if the webhook also fires).
    after(async () => {
      try {
        const res = await processNewReservation(c.tenantId, reservationID)
        console.log('[new-reservation] panel booking', reservationID, JSON.stringify({ step: res.step, ok: res.ok, detail: 'detail' in res ? res.detail : undefined }))
      } catch (e) {
        console.error('[new-reservation] notify failed', reservationID, e)
      }
    })
    return NextResponse.json({ reservationID, priceWarning })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
