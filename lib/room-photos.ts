import { getRoomTypePhotos, matchRoomType } from './cloudbeds'
import type { RoomPhotosResult } from './anthropic'

const MAX_PHOTOS = 6
const CACHE_MS = 10 * 60 * 1000
const cache = new Map<string, { at: number; data: Awaited<ReturnType<typeof getRoomTypePhotos>> }>()

/** Builds the concierge's room-photos tool for one Cloudbeds property. */
export function buildRoomPhotosTool(apiKey: string, propertyId: string) {
  return {
    getRoomPhotos: async (roomType: string): Promise<RoomPhotosResult> => {
      let entry = cache.get(propertyId)
      if (!entry || Date.now() - entry.at > CACHE_MS) {
        entry = { at: Date.now(), data: await getRoomTypePhotos(apiKey, propertyId) }
        if (entry.data.success) cache.set(propertyId, entry)
      }
      const { success, roomTypes, error } = entry.data
      if (!success) return { found: false, error: error ?? 'Could not load room photos' }

      const available = roomTypes.filter((r) => r.photos.length > 0).map((r) => r.roomTypeName)
      const match = matchRoomType(roomType, roomTypes)
      if (!match || match.photos.length === 0) {
        return { found: false, availableRoomTypes: available }
      }
      const photoUrls = match.photos.slice(0, MAX_PHOTOS)
      return { found: true, roomTypeName: match.roomTypeName, photoCount: photoUrls.length, photoUrls }
    },
  }
}
