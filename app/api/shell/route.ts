import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { unreadConversationIds } from '@/lib/inbox'
import { unreadCounts } from '@/lib/item-reads'

/** Sidebar data: who is signed in, hotel name and the unread badges. */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: staff } = await supabase
    .from('staff_users')
    .select('id, tenant_id')
    .eq('auth_uid', user.id)
    .single()
  if (!staff) return NextResponse.json({ error: 'No tenant' }, { status: 404 })

  const [{ data: tenant }, { count: newEscalations }, unreadReservations, unread, { count: paymentsAttention }] = await Promise.all([
    supabase.from('tenants').select('name').eq('id', staff.tenant_id).single(),
    supabase.from('escalations').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    unreadConversationIds(supabase, staff.id as string, { reservationsOnly: true }).then((ids) => ids.length),
    unreadCounts(supabase, staff.id as string),
    supabase.from('payment_requests').select('id', { count: 'exact', head: true }).in('status', ['needs_review', 'paid_unverified']),
  ])

  return NextResponse.json({
    email: user.email ?? '',
    tenantName: tenant?.name ?? '',
    unreadReservations,
    unreadEmails: unread.emails,
    unreadReviews: unread.reviews,
    paymentsAttention: paymentsAttention ?? 0,
    newEscalations: newEscalations ?? 0,
  })
}
