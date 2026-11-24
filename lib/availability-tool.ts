import { localDate } from './tz'
import type { PmsAdapter } from './pms'
import type { AvailabilityResult } from './pms/types'

const MAX_NIGHTS = 30

export interface AvailabilityToolInput {
  checkIn: string
  checkOut: string
  adults?: number
  children?: number
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Lana's availability tool for one connected property. Undefined when the PMS can't report availability. */
export function buildAvailabilityTool(pms: PmsAdapter, tz = 'America/Mexico_City') {
  const check = pms.checkAvailability?.bind(pms)
  if (!check) return undefined
  return {
    checkAvailability: async (input: AvailabilityToolInput): Promise<AvailabilityResult | { success: false; error: string }> => {
      const { checkIn, checkOut } = input
      if (!DATE.test(checkIn ?? '') || !DATE.test(checkOut ?? '')) return { success: false, error: 'Dates must be YYYY-MM-DD.' }
      const today = localDate(new Date(), tz)
      if (checkIn < today) return { success: false, error: `Check-in ${checkIn} is in the past (today is ${today}). Ask the guest for a future date.` }
      const nights = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000)
      if (!(nights >= 1)) return { success: false, error: 'Check-out must be after check-in.' }
      if (nights > MAX_NIGHTS) return { success: false, error: `Stays over ${MAX_NIGHTS} nights need staff — tell the guest a team member will help with that.` }
      const adults = Math.min(20, Math.max(1, Math.round(Number(input.adults) || 2)))
      const children = Math.min(20, Math.max(0, Math.round(Number(input.children) || 0)))
      return check(checkIn, checkOut, adults, children)
    },
  }
}

/** Appended after the booking-link instruction: availability CAN now be answered directly. */
export const AVAILABILITY_INSTRUCTION =
  '\n\nAVAILABILITY: You can check real availability with the check_availability tool. This REPLACES any earlier rule that says you cannot know whether dates are available. When a guest asks if there is room (e.g. "any rooms tonight?", "free from 28 Nov for 2 nights?"), get the check-in and check-out dates (ask for the missing one, or the number of nights; assume 2 adults if they do not say), call check_availability, and answer yes or no directly. If rooms are free, name the room types and the price per night when the result gives one, in the amounts given (never convert currencies or invent prices). If nothing is free, say so kindly. Do NOT send the booking link in that first answer; send it only if the guest wants to book, asks how, or the tool fails. A "yes" is not a reservation: never promise a room is held. If the tool returns an error, tell the guest you cannot check right now and give the booking link instead if you have one.'
