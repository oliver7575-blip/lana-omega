import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { checkIn, cloudbedsLinks, getReservationDetail, setArrivalTime, setStatus, setStayDates, unassignRoom } from '@/lib/cloudbeds-ops'

export const maxDuration = 60

export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  try {
    const reservation = await getReservationDetail(c.cb, id)
    return NextResponse.json({ reservation, link: cloudbedsLinks(c.cb.propertyId).reservation(id) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}

/** check_in · check_out · confirm · cancel · unassign {roomID} · arrival_time {time} · dates {checkin, checkout} */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const body = (await request.json()) as { action?: string; time?: string; checkin?: string; checkout?: string; roomID?: string }
  try {
    if (body.action === 'check_in') {
      await checkIn(c.cb, id)
    } else if (body.action === 'check_out') {
      await setStatus(c.cb, id, 'checked_out')
    } else if (body.action === 'confirm') {
      await setStatus(c.cb, id, 'confirmed')
    } else if (body.action === 'cancel') {
      await setStatus(c.cb, id, 'canceled')
    } else if (body.action === 'unassign') {
      await unassignRoom(c.cb, id, body.roomID)
    } else if (body.action === 'arrival_time') {
      if (!/^\d{2}:\d{2}$/.test(body.time ?? '')) return NextResponse.json({ error: 'Enter a time as HH:MM' }, { status: 400 })
      await setArrivalTime(c.cb, id, body.time!)
    } else if (body.action === 'dates') {
      const d = /^\d{4}-\d{2}-\d{2}$/
      if (!d.test(body.checkin ?? '') || !d.test(body.checkout ?? '') || body.checkout! <= body.checkin!) {
        return NextResponse.json({ error: 'Departure must be after arrival' }, { status: 400 })
      }
      await setStayDates(c.cb, id, body.checkin!, body.checkout!)
    } else {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
    return NextResponse.json({ ok: true, reservation: await getReservationDetail(c.cb, id) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
