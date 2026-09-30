import { normalizePhone } from './phone'

export interface StaffInput {
  name?: string
  phone?: string
  language?: string
  specialties?: string[] | string
  quiet_hours_start?: string
  quiet_hours_end?: string
  weekly_days_off?: number[]
  unavailable_from?: string | null
  unavailable_until?: string | null
  active?: boolean
}

/** Validates and cleans staff fields (shared by create and edit). */
export function cleanStaff(body: StaffInput, partial: boolean): { values?: Record<string, unknown>; error?: string } {
  const v: Record<string, unknown> = {}
  if (!partial || body.name !== undefined) {
    if (!body.name?.trim()) return { error: 'Full name is required' }
    v.name = body.name.trim()
  }
  if (!partial || body.phone !== undefined) {
    const phone = normalizePhone(body.phone)
    if (phone.length < 8) return { error: 'Enter the full WhatsApp number including country code, e.g. +52 958 123 4567' }
    v.phone = phone
  }
  if (body.language !== undefined) v.language = body.language === 'en' ? 'en' : 'es'
  if (body.specialties !== undefined) {
    const list = Array.isArray(body.specialties) ? body.specialties : body.specialties.split(',')
    v.specialties = list.map((s) => s.trim()).filter(Boolean).slice(0, 20)
  }
  const time = /^\d{2}:\d{2}$/
  if (body.quiet_hours_start !== undefined) {
    if (!time.test(body.quiet_hours_start)) return { error: 'Quiet hours start must be HH:MM' }
    v.quiet_hours_start = body.quiet_hours_start
  }
  if (body.quiet_hours_end !== undefined) {
    if (!time.test(body.quiet_hours_end)) return { error: 'Quiet hours end must be HH:MM' }
    v.quiet_hours_end = body.quiet_hours_end
  }
  if (body.weekly_days_off !== undefined) {
    v.weekly_days_off = [...new Set(body.weekly_days_off.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
  }
  if (body.unavailable_from !== undefined) v.unavailable_from = body.unavailable_from || null
  if (body.unavailable_until !== undefined) v.unavailable_until = body.unavailable_until || null
  if (v.unavailable_from && v.unavailable_until && String(v.unavailable_until) < String(v.unavailable_from)) {
    return { error: '"Days off until" must be on or after "Days off from"' }
  }
  if (body.active !== undefined) v.active = Boolean(body.active)
  return { values: v }
}

