import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { getReservationDetail, getReservationGuestContact } from '@/lib/cloudbeds-ops'
import { createClient } from '@/lib/supabase/server'
import { findOrCreateGuest, ensureConversation } from '@/lib/guest-records'

export const maxDuration = 30

/** The guest's WhatsApp conversation for this reservation — for the reservation modal's "Messages" link. */
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: staff } = await supabase.from('staff_users').select('tenant_id').eq('auth_uid', user.id).single()
  if (!staff) return NextResponse.json({ error: 'No tenant record found' }, { status: 404 })

  try {
    const [reservation, contact] = await Promise.all([getReservationDetail(c.cb, id), getReservationGuestContact(c.cb, id)])
    const phone = contact.phone ?? reservation.guestPhone
    if (!phone) {
      return NextResponse.json({ error: 'This guest has no phone number on file.' }, { status: 404 })
    }
    const guest = await findOrCreateGuest(supabase, staff.tenant_id as string, phone, {
      name: reservation.guestName,
      email: contact.email ?? reservation.guestEmail ?? undefined,
    })
    if (!guest) return NextResponse.json({ error: 'Could not match this guest to a WhatsApp number.' }, { status: 404 })
    const conversationId = await ensureConversation(supabase, staff.tenant_id as string, guest.id as string)
    if (!conversationId) return NextResponse.json({ error: 'Could not open a conversation for this guest.' }, { status: 500 })
    return NextResponse.json({ conversationId })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
