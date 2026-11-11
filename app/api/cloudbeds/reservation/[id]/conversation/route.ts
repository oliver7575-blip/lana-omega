import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { getReservationDetail, getReservationGuestContact } from '@/lib/cloudbeds-ops'
import { createClient } from '@/lib/supabase/server'
import { findOrCreateGuest, ensureConversation } from '@/lib/guest-records'
import { detectLang } from '@/lib/lana-reliability'

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
    // WhatsApp only allows free text within 24 hours of the guest's last message; after that a template is needed.
    const { data: last } = await supabase
      .from('messages')
      .select('content, created_at')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'guest')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const lastAt = last?.created_at ? new Date(last.created_at as string).getTime() : 0
    const windowOpen = Date.now() - lastAt < 24 * 3600_000
    const language = last?.content ? detectLang(String(last.content)) : null
    return NextResponse.json({ conversationId, windowOpen, language })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
