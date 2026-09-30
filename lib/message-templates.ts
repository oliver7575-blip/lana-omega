import type { EncryptedPayload } from './crypto'
import { decryptCredentials } from './crypto'
import { fetchTemplates, type RawTemplate } from './maintenance-template'

const GRAPH = 'https://graph.facebook.com/v21.0'

/** Automated messages a hotel can back with an approved WhatsApp template. */
export const MESSAGE_PURPOSES = {
  new_reservation: {
    label: 'New reservation',
    help: 'Sent to the guest as soon as a new booking arrives from Cloudbeds.',
  },
  arrival_reminder: {
    label: 'Arrival information (2 days before)',
    help: 'Sent 2 days before check-in — or right away if the booking is made less than 2 days before arrival.',
  },
  post_stay: {
    label: 'Post-stay feedback',
    help: 'Sent the day after check-out. Only runs when post-stay messages are turned on in Settings.',
  },
  staff_escalation: {
    label: 'Staff escalation alert',
    help: 'Sent to staff when the concierge escalates a guest issue.',
  },
} as const

export type MessagePurpose = keyof typeof MESSAGE_PURPOSES

export const RESERVATION_FIELDS = [
  { key: 'guest_first_name', label: 'Guest first name' },
  { key: 'guest_name', label: 'Guest full name' },
  { key: 'check_in', label: 'Check-in date' },
  { key: 'check_out', label: 'Check-out date' },
  { key: 'reservation_id', label: 'Reservation number' },
  { key: 'room_type', label: 'Room type' },
  { key: 'property_name', label: 'Hotel name' },
] as const

export const ESCALATION_FIELDS = [
  { key: 'category', label: 'Category' },
  { key: 'room', label: 'Room number' },
  { key: 'issue', label: 'Issue summary' },
  { key: 'urgency', label: 'Urgency' },
  { key: 'guest_name', label: 'Guest name' },
  { key: 'guest_phone', label: 'Guest phone' },
] as const

export function fieldsFor(purpose: MessagePurpose) {
  return purpose === 'staff_escalation' ? ESCALATION_FIELDS : RESERVATION_FIELDS
}

export interface TemplateMapping {
  name: string
  language: string
  /** Field key for each header variable, in order ({{1}}, …). */
  header: string[]
  /** Field key for each body variable, in order ({{1}}, {{2}}, …). */
  body: string[]
}

export function getMapping(stored: unknown, purpose: MessagePurpose): TemplateMapping | null {
  const m = (stored as Record<string, Partial<TemplateMapping>> | null)?.[purpose]
  if (!m?.name || !m?.language) return null
  return {
    name: m.name,
    language: m.language,
    header: Array.isArray(m.header) ? m.header : [],
    body: Array.isArray(m.body) ? m.body : [],
  }
}

function countVars(text: string | undefined): number {
  const nums = (text?.match(/\{\{(\d+)\}\}/g) ?? []).map((v) => Number(v.replace(/[{}]/g, '')))
  return nums.length ? Math.max(...nums) : 0
}

export interface PickerTemplate {
  name: string
  language: string
  status: string
  category?: string
  headerText?: string
  body?: string
  headerVars: number
  bodyVars: number
  buttons: string[]
  usable: boolean
  reason?: string
}

function describe(t: RawTemplate): PickerTemplate {
  const header = t.components?.find((c) => c.type === 'HEADER')
  const body = t.components?.find((c) => c.type === 'BODY')?.text
  const buttons = t.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? []
  let reason: string | undefined
  if (t.status !== 'APPROVED') reason = `Not approved (${t.status})`
  else if (t.parameter_format === 'NAMED') reason = 'Uses named variables — needs numbered ones like {{1}}'
  else if (header && header.format !== 'TEXT') reason = 'Has an image, video or document header'
  else if (buttons.some((b) => b.type === 'URL' && /\{\{/.test((b as { url?: string }).url ?? '')))
    reason = 'Has a link button with a variable'
  return {
    name: t.name,
    language: t.language,
    status: t.status,
    category: t.category,
    headerText: header?.format === 'TEXT' ? header.text : undefined,
    body,
    headerVars: header?.format === 'TEXT' ? countVars(header.text) : 0,
    bodyVars: countVars(body),
    buttons: buttons.map((b) => b.text ?? ''),
    usable: !reason,
    reason,
  }
}

export async function listTemplates(
  wabaId: string,
  credentials: EncryptedPayload
): Promise<PickerTemplate[]> {
  const all = await fetchTemplates(wabaId, credentials)
  return all
    .map(describe)
    .sort((a, b) => Number(b.usable) - Number(a.usable) || a.name.localeCompare(b.name))
}

/** Checks a chosen template still exists and its variable counts match the mapping. */
export async function validateMapping(
  wabaId: string,
  credentials: EncryptedPayload,
  mapping: TemplateMapping,
  purpose: MessagePurpose
): Promise<string | null> {
  const all = await fetchTemplates(wabaId, credentials, mapping.name)
  const t = all.find((x) => x.name === mapping.name && x.language === mapping.language)
  if (!t) return 'That template was not found in your WhatsApp account.'
  const d = describe(t)
  if (!d.usable) return d.reason ?? 'That template cannot be used'
  if (mapping.header.length !== d.headerVars || mapping.body.length !== d.bodyVars) {
    return 'Every variable in the template needs a value chosen.'
  }
  const allowed = new Set(fieldsFor(purpose).map((f) => f.key as string))
  if ([...mapping.header, ...mapping.body].some((k) => !allowed.has(k))) {
    return 'One of the chosen values is not available for this message.'
  }
  return null
}

// WhatsApp rejects parameters with newlines/tabs or 4+ spaces in a row.
function clean(s: string | undefined): string {
  return (s ?? '').replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 900) || '—'
}

export async function sendMappedTemplate(
  phoneNumberId: string,
  credentials: EncryptedPayload,
  to: string,
  mapping: TemplateMapping,
  values: Record<string, string | undefined>
): Promise<{ success: boolean; error?: string }> {
  const components: Record<string, unknown>[] = []
  if (mapping.header.length) {
    components.push({
      type: 'header',
      parameters: mapping.header.map((k) => ({ type: 'text', text: clean(values[k]) })),
    })
  }
  if (mapping.body.length) {
    components.push({
      type: 'body',
      parameters: mapping.body.map((k) => ({ type: 'text', text: clean(values[k]) })),
    })
  }
  try {
    const token = decryptCredentials<{ access_token: string }>(credentials).access_token
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: to.replace(/[^\d]/g, ''),
        type: 'template',
        template: {
          name: mapping.name,
          language: { code: mapping.language },
          ...(components.length ? { components } : {}),
        },
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) {
      return { success: false, error: `WhatsApp template send failed: ${res.status} ${(await res.text()).slice(0, 300)}` }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/** "2026-10-03" → "3 de octubre de 2026" (in the given language). */
export function formatStayDate(date: string | undefined, language: string): string {
  if (!date) return ''
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  try {
    return new Intl.DateTimeFormat(language.replace('_', '-'), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(d)
  } catch {
    return date
  }
}

export function reservationValues(
  r: { reservationID?: string; guestName?: string; startDate?: string; endDate?: string; roomTypeName?: string },
  language: string,
  propertyName: string
): Record<string, string> {
  const full = (r.guestName ?? '').trim()
  return {
    guest_first_name: full.split(/\s+/)[0] ?? '',
    guest_name: full,
    check_in: formatStayDate(r.startDate, language),
    check_out: formatStayDate(r.endDate, language),
    reservation_id: r.reservationID ?? '',
    room_type: r.roomTypeName ?? '',
    property_name: propertyName,
  }
}

/** The template's text with its variables filled in, for the conversation log. */
export async function renderMappedTemplateText(
  wabaId: string,
  credentials: EncryptedPayload,
  mapping: TemplateMapping,
  values: Record<string, string | undefined>
): Promise<string | null> {
  try {
    const all = await fetchTemplates(wabaId, credentials, mapping.name)
    const t = all.find((x) => x.name === mapping.name && x.language === mapping.language)
    if (!t) return null
    const fill = (text: string | undefined, keys: string[]) =>
      (text ?? '').replace(/\{\{(\d+)\}\}/g, (m, n: string) => values[keys[Number(n) - 1]] ?? m)
    const header = t.components?.find((c) => c.type === 'HEADER')
    const body = t.components?.find((c) => c.type === 'BODY')?.text
    return [header?.format === 'TEXT' ? fill(header.text, mapping.header) : null, fill(body, mapping.body)]
      .filter(Boolean)
      .join('\n\n')
  } catch {
    return null
  }
}
