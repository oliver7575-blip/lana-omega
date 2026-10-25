import ReservationsList from '@/components/cloudbeds/ReservationsList'
import { requireStaff } from '@/lib/staff-context'
import { unreadConversationIds } from '@/lib/inbox'

export const dynamic = 'force-dynamic'

/** Live Cloudbeds reservations — name, stay dates, amount; click a row for every guest detail on file. */
export default async function ReservationsPage() {
  const { supabase, staff } = await requireStaff()
  if (staff) {
    // The sidebar's red bubble here is reservation-linked conversation activity — this
    // page doesn't show those conversations anymore, so clear it just by arriving here.
    const ids = await unreadConversationIds(supabase, staff.id, { reservationsOnly: true })
    if (ids.length) {
      const now = new Date().toISOString()
      await supabase.from('conversation_reads').upsert(
        ids.map((id) => ({ conversation_id: id, staff_user_id: staff.id, tenant_id: staff.tenant_id, read_at: now })),
        { onConflict: 'conversation_id,staff_user_id' }
      )
    }
  }
  return (
    <main className="px-5 py-6 md:px-8">
      <ReservationsList />
    </main>
  )
}
