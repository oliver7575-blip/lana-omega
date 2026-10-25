import ReservationsList from '@/components/cloudbeds/ReservationsList'

export const dynamic = 'force-dynamic'

/** Live Cloudbeds reservations — name, stay dates, amount; click a row for every guest detail on file. */
export default function ReservationsPage() {
  return (
    <main className="px-5 py-6 md:px-8">
      <ReservationsList />
    </main>
  )
}
