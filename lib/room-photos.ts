import { matchRoomType } from './cloudbeds'
import type { RoomPhotosResult } from './anthropic'
import type { PmsAdapter } from './pms'

const MAX_PHOTOS = 6
const CACHE_MS = 10 * 60 * 1000
type PhotosData = Awaited<ReturnType<NonNullable<PmsAdapter['getRoomTypePhotos']>>>
const cache = new Map<string, { at: number; data: PhotosData }>()

/**
 * Builds the concierge's room-photos tool for one connected property.
 * Undefined when the hotel's PMS can't supply room photos.
 */
export function buildRoomPhotosTool(pms: PmsAdapter) {
  const fetchPhotos = pms.getRoomTypePhotos?.bind(pms)
  if (!fetchPhotos) return undefined
  return {
    getRoomPhotos: async (roomType: string): Promise<RoomPhotosResult> => {
      let entry = cache.get(pms.cacheKey)
      if (!entry || Date.now() - entry.at > CACHE_MS) {
        entry = { at: Date.now(), data: await fetchPhotos() }
        if (entry.data.success) cache.set(pms.cacheKey, entry)
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
