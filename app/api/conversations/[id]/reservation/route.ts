import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { getReservationDetail, searchReservations } from '@/lib/cloudbeds-ops'

async function ownConversation(id: string) {
  const supabase = await createClient()
  const { data: conversation } = await supabase.from('conversations').select('id, tenant_id, guest_id').eq('id', id).single()
  return conversation && conversation.guest_id ? conversation : null
}

/** Search Cloudbeds reservations by guest name or reservation number, to link one to this chat. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  if (!(await ownConversation(id))) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  const q = new URL(request.url).searchParams.get('q') ?? ''
  try {
    return NextResponse.json({ results: await searchReservations(c.cb, q) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Search failed' }, { status: 502 })
  }
}

/** Link this guest's chat to an existing reservation. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error
  const conversation = await ownConversation(id)
  if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  const { reservationId } = (await request.json().catch(() => ({}))) as { reservationId?: string }
  if (!reservationId) return NextResponse.json({ error: 'Choose a reservation' }, { status: 400 })
  let r
  try {
    r = await getReservationDetail(c.cb, reservationId)
  } catch {
    return NextResponse.json({ error: 'Reservation not found in Cloudbeds' }, { status: 404 })
  }
  const db = createServiceClient()
  const { error } = await db.from('guest_reservations').upsert(
    {
      tenant_id: conversation.tenant_id,
      guest_id: conversation.guest_id,
      confirmation_number: r.reservationID,
      status: r.status ?? null,
      start_date: r.startDate?.slice(0, 10) ?? null,
      end_date: r.endDate?.slice(0, 10) ?? null,
      room_label: r.rooms.map((x) => x.roomTypeName).filter(Boolean).join(', ') || null,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,guest_id' }
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/** Remove the link between this chat's guest and their reservation. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const conversation = await ownConversation(id)
  if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  const db = createServiceClient()
  await db.from('guest_reservations').delete().eq('tenant_id', conversation.tenant_id).eq('guest_id', conversation.guest_id)
  return NextResponse.json({ ok: true })
}
