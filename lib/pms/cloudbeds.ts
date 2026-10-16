/**
 * Cloudbeds adapter. A thin wrapper: every method calls the existing,
 * real-data-verified functions in lib/cloudbeds.ts with exactly the same
 * arguments as before, so Cloudbeds tenants behave identically.
 */
import {
  findReservationByPhone,
  getArrivalsInWindow,
  getDeparturesInWindow,
  getRecentlyCreatedReservations,
  getRoomTypePhotos,
  lookupReservation,
  updateArrivalTime,
} from '../cloudbeds'
import type { PmsAdapter } from './types'

export function cloudbedsAdapter(apiKey: string, propertyId: string): PmsAdapter {
  return {
    kind: 'cloudbeds',
    label: 'Cloudbeds',
    cacheKey: `cloudbeds:${propertyId}`,
    cloudbeds: { apiKey, propertyId },

    lookupReservation: (confirmationNumber) => lookupReservation(apiKey, propertyId, confirmationNumber),
    findReservationByPhone: (phone) => findReservationByPhone(apiKey, propertyId, phone),
    updateArrivalTime: (confirmationNumber, arrivalTime) =>
      updateArrivalTime(apiKey, propertyId, confirmationNumber, arrivalTime),

    getArrivalsInWindow: (date) => getArrivalsInWindow(apiKey, propertyId, date),
    getDeparturesInWindow: (date) => getDeparturesInWindow(apiKey, propertyId, date),
    getRecentlyCreatedReservations: (hours) => getRecentlyCreatedReservations(apiKey, propertyId, hours),

    getRoomTypePhotos: () => getRoomTypePhotos(apiKey, propertyId),

    async testConnection() {
      // A deliberately fake confirmation number: "found: false" with no error
      // means the API was reachable and the key was accepted, which is all a
      // health check needs to know.
      const result = await lookupReservation(apiKey, propertyId, '__healthcheck__')
      if (result.error) return { ok: false, error: result.error.slice(0, 300) }
      return { ok: true, detail: 'API reachable, key accepted' }
    },
  }
}
