/**
 * Lodgify adapter. Reads come from the Lodgify API (lib/lodgify.ts).
 *
 * Arrival times: Lodgify has no confirmed "estimated arrival time" field
 * (its /checkin endpoint records an actual check-in, which must not be used
 * for an estimate), so Lana's arrival-time updates are saved in Omega's own
 * pms_arrival_times table instead and shown to staff from there.
 */
import {
  findReservationByPhone,
  getArrivalsInWindow,
  getDeparturesInWindow,
  getRecentlyCreatedReservations,
  getRoomTypePhotos,
  lookupReservation,
  testConnection,
  type LodgifyAuth,
} from '../lodgify'
import { createServiceClient } from '../supabase/service'
import type { PmsAdapter } from './types'

export function lodgifyAdapter(tenantId: string, auth: LodgifyAuth): PmsAdapter {
  return {
    kind: 'lodgify',
    label: 'Lodgify',
    cacheKey: `lodgify:${tenantId}:${auth.propertyId ?? 'all'}`,

    lookupReservation: (confirmationNumber) => lookupReservation(auth, confirmationNumber),
    findReservationByPhone: (phone) => findReservationByPhone(auth, phone),

    async updateArrivalTime(confirmationNumber, arrivalTime) {
      const lookup = await lookupReservation(auth, confirmationNumber)
      if (!lookup.found) {
        if (lookup.error) {
          return {
            success: false,
            error: `Could not reach the reservation system to verify this: ${lookup.error}. This is not necessarily a problem with the confirmation number.`,
          }
        }
        return { success: false, error: 'No reservation found for that confirmation number' }
      }
      if (!lookup.reservationID) return { success: false, error: 'Reservation found but has no id' }

      const db = createServiceClient()
      const { error } = await db.from('pms_arrival_times').upsert(
        {
          tenant_id: tenantId,
          reservation_id: lookup.reservationID,
          arrival_time: arrivalTime,
          source: 'lana',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tenant_id,reservation_id' }
      )
      if (error) return { success: false, error: error.message }
      return { success: true }
    },

    getArrivalsInWindow: (date) => getArrivalsInWindow(auth, date),
    getDeparturesInWindow: (date) => getDeparturesInWindow(auth, date),
    getRecentlyCreatedReservations: (hours) => getRecentlyCreatedReservations(auth, hours),
    getRoomTypePhotos: () => getRoomTypePhotos(auth),
    testConnection: () => testConnection(auth),
  }
}
