import InboxView from '@/components/InboxView'

export const dynamic = 'force-dynamic'

/** Conversations with guests who have a reservation on file. */
export default async function ReservationsInboxPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
  return <InboxView title="Reservations" basePath="/reservations" reservationsOnly q={q} />
}
