import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { lodgifyForCaller } from '@/lib/lodgify-caller'
import { cancelBookingLodgify, createQuoteLodgify, reservationDetailLodgify } from '@/lib/lodgify-ops'
import { localDate } from '@/lib/tz'
import { assignRoom, checkIn, checkOut, checkOutRoom, cloudbedsLinks, getGuestProfile, getReservationDetail, getReservationGuestContact, getReservationNotes, moveReservation, addReservationNote, deleteReservationNote, updateReservationNote, setArrivalTime, setStatus, setStayDates, unassignRoom } from '@/lib/cloudbeds-ops'

export const maxDuration = 60

export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await cloudbedsForCaller()
  if ('error' in c) {
    const l = await lodgifyForCaller()
    if (!l) return c.error
    try {
      const reservation = await reservationDetailLodgify(l.auth, id, localDate(new Date(), l.tz))
      return NextResponse.json({ reservation, notes: [], link: '' })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Lodgify error' }, { status: 502 })
    }
  }
  try {
    const [reservation, notes] = await Promise.all([
      getReservationDetail(c.cb, id),
      getReservationNotes(c.cb, id).catch(() => []),
    ])
    // getReservation doesn't carry the guest's phone/email for this account; the list endpoint with guest details does.
    if (!reservation.guestPhone || !reservation.guestEmail || !reservation.guestCountry) {
      try {
        const contact = await getReservationGuestContact(c.cb, id)
        reservation.guestPhone ??= contact.phone
        reservation.guestEmail ??= contact.email
        reservation.guestCountry ??= contact.country
      } catch {
        // Best-effort: the window still works without it.
      }
    }
    if (reservation.guestID && (!reservation.guestPhone || !reservation.guestEmail || !reservation.guestCountry)) {
      try {
        const p = await getGuestProfile(c.cb, reservation.guestID)
        const pick = (...keys: string[]) => {
          for (const k of keys) {
            const v = p[k]
            if (typeof v === 'string' && v.trim()) return v.trim()
          }
          return null
        }
        reservation.guestPhone ??= pick('guestCellPhone', 'guestPhone', 'cellPhone', 'phone', 'guestHomePhone', 'homePhone')
        reservation.guestEmail ??= pick('guestEmail', 'email')
        reservation.guestCountry ??= pick('guestCountry', 'country')
      } catch {
        // Best-effort.
      }
    }
    return NextResponse.json({ reservation, notes, link: cloudbedsLinks(c.cb.propertyId).reservation(id) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}

/** check_in · check_out · confirm · cancel · unassign {roomID} · assign_room {subReservationID, reservationRoomID, newRoomID} · arrival_time {time} · dates {checkin, checkout} */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await cloudbedsForCaller()
  if ('error' in c) {
    const l = await lodgifyForCaller()
    if (!l) return c.error
    const lb = (await request.json().catch(() => ({}))) as { action?: string }
    if (lb.action === 'cancel') {
      try {
        await cancelBookingLodgify(l.auth, id)
        return NextResponse.json({ ok: true, reservation: await reservationDetailLodgify(l.auth, id, localDate(new Date(), l.tz)) })
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Lodgify error' }, { status: 502 })
      }
    }
    if (lb.action === 'quote') {
      try {
        await createQuoteLodgify(l.auth, id)
        return NextResponse.json({ ok: true, reservation: await reservationDetailLodgify(l.auth, id, localDate(new Date(), l.tz)) })
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Lodgify error' }, { status: 502 })
      }
    }
    return NextResponse.json({ error: 'Changing reservations from here is not available for Lodgify yet — make the change in Lodgify.' }, { status: 400 })
  }
  const body = (await request.json()) as {
    action?: string
    time?: string
    checkin?: string
    checkout?: string
    roomID?: string
    subReservationID?: string
    reservationRoomID?: string
    newRoomID?: string
    newRoomTypeID?: string
    oldRoomID?: string
    fromTypeID?: string
    fromStart?: string
    adjustPrice?: boolean
    noteID?: string
    text?: string
  }
  try {
    if (body.action === 'note_add') {
      const text = (body.text ?? '').trim()
      if (!text) return NextResponse.json({ error: 'Write the note first' }, { status: 400 })
      await addReservationNote(c.cb, id, text)
      return NextResponse.json({ ok: true, notes: await getReservationNotes(c.cb, id) })
    }
    if (body.action === 'note_update' || body.action === 'note_delete') {
      if (!body.noteID) return NextResponse.json({ error: 'Missing note' }, { status: 400 })
      if (body.action === 'note_update') {
        const text = (body.text ?? '').trim()
        if (!text) return NextResponse.json({ error: 'A note cannot be empty — delete it instead' }, { status: 400 })
        await updateReservationNote(c.cb, id, body.noteID, text)
      } else {
        await deleteReservationNote(c.cb, id, body.noteID)
      }
      return NextResponse.json({ ok: true, notes: await getReservationNotes(c.cb, id) })
    }
    if (body.action === 'check_in') {
      await checkIn(c.cb, id)
    } else if (body.action === 'check_out') {
      await checkOut(c.cb, id)
    } else if (body.action === 'check_out_room') {
      await checkOutRoom(c.cb, id, String(body.roomID))
    } else if (body.action === 'confirm') {
      await setStatus(c.cb, id, 'confirmed')
    } else if (body.action === 'cancel') {
      await setStatus(c.cb, id, 'canceled')
    } else if (body.action === 'unassign') {
      await unassignRoom(c.cb, id, body.roomID)
    } else if (body.action === 'assign_room') {
      if (!body.subReservationID || !body.newRoomID) return NextResponse.json({ error: 'Missing room to assign' }, { status: 400 })
      await assignRoom(c.cb, id, body.subReservationID, body.reservationRoomID ?? null, body.newRoomID)
    } else if (body.action === 'move') {
      if (!body.newRoomID || !body.newRoomTypeID || !body.fromTypeID || !body.fromStart) return NextResponse.json({ error: 'Missing room to move to' }, { status: 400 })
      const d = /^\d{4}-\d{2}-\d{2}$/
      if ((body.checkin || body.checkout) && (!d.test(body.checkin ?? '') || !d.test(body.checkout ?? '') || body.checkout! <= body.checkin!)) {
        return NextResponse.json({ error: 'Departure must be after arrival' }, { status: 400 })
      }
      await moveReservation(c.cb, id, {
        oldRoomID: body.oldRoomID ?? null, fromTypeID: body.fromTypeID, fromStart: body.fromStart,
        newRoomID: body.newRoomID, newRoomTypeID: body.newRoomTypeID, checkin: body.checkin, checkout: body.checkout, adjustPrice: body.adjustPrice,
      })
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
