import ReservationsList from '@/components/cloudbeds/ReservationsList'

export const dynamic = 'force-dynamic'

/** Live Cloudbeds reservations — name, stay dates, amount; click a row for every guest detail on file. */
export default function ReservationsPage() {
  return (
    <div className="p-2 md:p-3">
      <ReservationsList />
    </div>
  )
}
