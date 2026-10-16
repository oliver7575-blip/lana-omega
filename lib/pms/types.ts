/**
 * The one shape every property-management system (PMS) is translated into.
 *
 * Everything outside lib/pms talks to a hotel's PMS only through PmsAdapter,
 * so adding a new PMS (Lodgify, …) means writing one adapter file — the
 * WhatsApp, widget and Instagram pipelines, the cron jobs and the new-booking
 * flow stay untouched.
 *
 * The result types are deliberately the same ones the original Cloudbeds code
 * returned (field names included), because Lana's tools pass them to the AI
 * as-is: keeping them identical means Cloudbeds tenants behave exactly as
 * before.
 */
import type {
  GetArrivalsResult,
  GetDeparturesResult,
  GetNewReservationsResult,
  ReservationLookupResult,
  RoomTypePhotos,
  UpdateArrivalResult,
} from '../cloudbeds'

export type {
  GetArrivalsResult,
  GetDeparturesResult,
  GetNewReservationsResult,
  ReservationLookupResult,
  RoomTypePhotos,
  UpdateArrivalResult,
}

/** Which PMS a tenant uses. Matches tenant_integrations.integration_type without the "pms_" prefix. */
export type PmsKind = 'cloudbeds'

export interface PmsAdapter {
  kind: PmsKind
  /** Human name for messages and the panel, e.g. "Cloudbeds". */
  label: string
  /**
   * Stable key for caches (e.g. room photos), unique per connected property.
   * Never contains a secret.
   */
  cacheKey: string

  /** Looks a booking up by confirmation number (the PMS's own id or a channel/OTA number). */
  lookupReservation(confirmationNumber: string): Promise<ReservationLookupResult>
  /** The guest's single current or upcoming booking for this phone number; found:false if none or several. */
  findReservationByPhone(phone: string): Promise<ReservationLookupResult & { matches?: number }>
  /** Saves the guest's estimated arrival time (HH:MM, 24-hour) on the booking. */
  updateArrivalTime(confirmationNumber: string, arrivalTime: string): Promise<UpdateArrivalResult>

  /** Bookings arriving on a date (YYYY-MM-DD). */
  getArrivalsInWindow(date: string): Promise<GetArrivalsResult>
  /** Bookings checking out on a date (YYYY-MM-DD). */
  getDeparturesInWindow(date: string): Promise<GetDeparturesResult>
  /** Bookings created in the last N hours. */
  getRecentlyCreatedReservations(sinceHoursAgo: number): Promise<GetNewReservationsResult>

  /** Room types with photo URLs, for Lana's room-photos tool. Absent if the PMS can't provide them. */
  getRoomTypePhotos?(): Promise<{ success: boolean; roomTypes: RoomTypePhotos[]; error?: string }>

  /** Health check for the Integrations page: reachable + credentials accepted. */
  testConnection(): Promise<{ ok: boolean; detail?: string; error?: string }>

  /**
   * Raw Cloudbeds access for Cloudbeds-only features (payment links,
   * Dashview/Calendar panel pages). Undefined for every other PMS, which is
   * how those features know to switch themselves off.
   */
  cloudbeds?: { apiKey: string; propertyId: string }
}
