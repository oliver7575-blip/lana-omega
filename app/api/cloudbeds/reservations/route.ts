import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { createReservation, type NewReservation } from '@/lib/cloudbeds-ops'

export const maxDuration = 60

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Creates a reservation in Cloudbeds from the Dashboard's "Create new reservation" window. */
export async function POST(request: Request) {
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const b = (await request.json()) as Partial<NewReservation>

  const problems: string[] = []
  if (!DATE.test(b.startDate ?? '') || !DATE.test(b.endDate ?? '') || (b.endDate ?? '') <= (b.startDate ?? '')) problems.push('valid dates')
  if (!b.roomTypeID) problems.push('a room type')
  if (!b.firstName?.trim() || !b.lastName?.trim()) problems.push("the guest's first and last name")
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email ?? '')) problems.push('a valid email')
  if (!/^[A-Za-z]{2}$/.test(b.country ?? '')) problems.push('the country')
  if (!b.paymentMethod) problems.push('a payment method')
  if (problems.length) return NextResponse.json({ error: `Please add ${problems.join(', ')}.` }, { status: 400 })

  try {
    const reservationID = await createReservation(c.cb, {
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
    })
    return NextResponse.json({ reservationID })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
