import { decryptCredentials, type EncryptedPayload } from './crypto'

/**
 * WhatsApp templates used for maintenance reminders.
 *
 * Each hotel either uses Omega's own template (created and edited from the
 * Maintenance page, under a fixed name) or picks one of its own templates
 * that WhatsApp has already approved. Either way the template must have:
 *   - 4 body variables: {{1}} staff first name, {{2}} task, {{3}} location, {{4}} due
 *   - 3 quick-reply buttons, in order: accept, need help, done
 * Button taps are matched by position (via payloads), so the button labels
 * can be anything.
 */
export const MAINTENANCE_TEMPLATE_NAME = 'maintenance_task_reminder_es'
export const MAINTENANCE_TEMPLATE_LANGUAGE = 'es_MX'
export const MAINTENANCE_TEMPLATE_BUTTONS = ['Acepto', 'Necesito Ayuda', 'Terminado'] as const
export const MAINTENANCE_TEMPLATE_DEFAULT_BODY =
  'Hola {{1}}. Tienes una tarea de mantenimiento:\n\n{{2}}\n\n📍 {{3}}\n🕐 Vence: {{4}}\n\nPor favor confirma abajo.'
const EXAMPLE_VALUES = ['Juan', 'Revisar aire acondicionado', 'Cuarto 5', 'Hoy']

// Button index -> the action encoded in each button's payload.
export const BUTTON_ACTIONS = ['accept', 'help', 'done'] as const
export type MaintenanceAction = (typeof BUTTON_ACTIONS)[number]

const GRAPH = 'https://graph.facebook.com/v21.0'

export interface TemplateChoice {
  name: string
  language: string
}

/** The template a hotel uses: its own pick, or Omega's default. */
export function resolveTemplateChoice(stored: unknown): TemplateChoice & { custom: boolean } {
  const s = stored as Partial<TemplateChoice> | null | undefined
  if (s?.name && s?.language) return { name: s.name, language: s.language, custom: true }
  return { name: MAINTENANCE_TEMPLATE_NAME, language: MAINTENANCE_TEMPLATE_LANGUAGE, custom: false }
}

export interface TemplateInfo {
  exists: boolean
  id?: string
  name?: string
  language?: string
  status?: string // APPROVED | PENDING | REJECTED | PAUSED | DISABLED | ...
  rejectedReason?: string | null
  body?: string
  buttons?: string[]
}

export interface TemplateListItem extends TemplateInfo {
  compatible: boolean
  reason?: string
}

export interface RawTemplate {
  id: string
  name: string
  status: string
  language: string
  category?: string
  parameter_format?: string
  rejected_reason?: string
  components?: {
    type: string
    format?: string
    text?: string
    buttons?: { type: string; text?: string }[]
  }[]
}

function token(credentials: EncryptedPayload): string {
  return decryptCredentials<{ access_token: string }>(credentials).access_token
}

function toInfo(t: RawTemplate): TemplateInfo {
  return {
    exists: true,
    id: t.id,
    name: t.name,
    language: t.language,
    status: t.status,
    rejectedReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
    body: t.components?.find((c) => c.type === 'BODY')?.text,
    buttons: (t.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? []).map((b) => b.text ?? ''),
  }
}

/** Why a template can't be used for maintenance reminders (null = it can). */
export function compatibilityProblem(t: RawTemplate): string | null {
  if (t.status !== 'APPROVED') return `Not approved (${t.status})`
  if (t.parameter_format === 'NAMED') return 'Uses named variables — needs {{1}} to {{4}}'

  const header = t.components?.find((c) => c.type === 'HEADER')
  if (header && (header.format !== 'TEXT' || /\{\{/.test(header.text ?? ''))) {
    return 'Has a header with media or variables'
  }

  const body = t.components?.find((c) => c.type === 'BODY')?.text ?? ''
  const vars = new Set((body.match(/\{\{(\d+)\}\}/g) ?? []).map((v) => v.replace(/[{}]/g, '')))
  const expected = ['1', '2', '3', '4']
  if (vars.size !== 4 || !expected.every((v) => vars.has(v))) {
    return `Message needs exactly {{1}} to {{4}} (has ${vars.size ? [...vars].sort().map((v) => `{{${v}}}`).join(' ') : 'none'})`
  }

  const buttons = t.components?.find((c) => c.type === 'BUTTONS')?.buttons ?? []
  if (buttons.length !== 3 || buttons.some((b) => b.type !== 'QUICK_REPLY')) {
    return `Needs exactly 3 quick-reply buttons (has ${buttons.length} button${buttons.length === 1 ? '' : 's'})`
  }
  return null
}

export async function fetchTemplates(
  wabaId: string,
  credentials: EncryptedPayload,
  nameFilter?: string
): Promise<RawTemplate[]> {
  const fields = 'id,name,status,language,category,parameter_format,rejected_reason,components'
  let url: string | null =
    `${GRAPH}/${encodeURIComponent(wabaId)}/message_templates?fields=${fields}&limit=100` +
    (nameFilter ? `&name=${encodeURIComponent(nameFilter)}` : '')
  const all: RawTemplate[] = []

  // Follow pagination, capped so a huge account can't hang the request.
  for (let page = 0; url && page < 5; page++) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${token(credentials)}` },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) {
      throw new Error(`Meta API ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }
    const data = (await res.json()) as { data?: RawTemplate[]; paging?: { next?: string } }
    all.push(...(data.data ?? []))
    url = data.paging?.next ?? null
  }
  return all
}

/** Looks up one template (defaults to Omega's own). */
export async function getMaintenanceTemplate(
  wabaId: string,
  credentials: EncryptedPayload,
  choice: TemplateChoice = { name: MAINTENANCE_TEMPLATE_NAME, language: MAINTENANCE_TEMPLATE_LANGUAGE }
): Promise<TemplateInfo> {
  const templates = await fetchTemplates(wabaId, credentials, choice.name)
  const match = templates.find((t) => t.name === choice.name && t.language === choice.language)
  return match ? toInfo(match) : { exists: false, name: choice.name, language: choice.language }
}

/** Every template in the account, marked usable or not (with the reason). */
export async function listTemplatesForPicker(
  wabaId: string,
  credentials: EncryptedPayload
): Promise<TemplateListItem[]> {
  const templates = await fetchTemplates(wabaId, credentials)
  return templates
    .map((t) => {
      const problem = compatibilityProblem(t)
      return { ...toInfo(t), compatible: !problem, reason: problem ?? undefined }
    })
    .sort((a, b) => Number(b.compatible) - Number(a.compatible) || (a.name ?? '').localeCompare(b.name ?? ''))
}

/** Confirms a template exists, is approved and fits the reminder format. */
export async function checkTemplateUsable(
  wabaId: string,
  credentials: EncryptedPayload,
  choice: TemplateChoice
): Promise<string | null> {
  const templates = await fetchTemplates(wabaId, credentials, choice.name)
  const match = templates.find((t) => t.name === choice.name && t.language === choice.language)
  if (!match) return 'That template was not found in your WhatsApp account.'
  return compatibilityProblem(match)
}

export function validateTemplateBody(body: string): string | null {
  const text = body.trim()
  if (!text) return 'The message text is empty.'
  if (text.length > 1024) return 'The message text must be 1,024 characters or less.'
  for (const n of [1, 2, 3, 4]) {
    const count = text.split(`{{${n}}}`).length - 1
    if (count !== 1) {
      return `The text must contain {{${n}}} exactly once (it has ${count}).`
    }
  }
  const stray = text.match(/\{\{(?![1-4]\}\})[^}]*\}\}/)
  if (stray) return `Only {{1}} to {{4}} are allowed — remove "${stray[0]}".`
  if (/^\{\{\d\}\}/.test(text) || /\{\{\d\}\}$/.test(text)) {
    return 'WhatsApp does not allow the text to start or end with a variable.'
  }
  return null
}

function buildComponents(body: string) {
  return [
    {
      type: 'BODY',
      text: body.trim(),
      example: { body_text: [EXAMPLE_VALUES] },
    },
    {
      type: 'BUTTONS',
      buttons: MAINTENANCE_TEMPLATE_BUTTONS.map((text) => ({ type: 'QUICK_REPLY', text })),
    },
  ]
}

/**
 * Creates Omega's own template if it doesn't exist yet, otherwise edits it.
 * Either way Meta reviews it again before it can be used.
 */
export async function submitMaintenanceTemplate(
  wabaId: string,
  credentials: EncryptedPayload,
  body: string
): Promise<{ ok: boolean; created: boolean; status?: string; error?: string }> {
  const existing = await getMaintenanceTemplate(wabaId, credentials)
  // Meta only allows edits to templates that are approved, rejected or
  // paused — not while a review is still running.
  if (existing.exists && (existing.status === 'PENDING' || existing.status === 'IN_APPEAL')) {
    return {
      ok: false,
      created: false,
      error:
        'This template is still being reviewed by Meta, so it can’t be edited right now. Wait until it is approved or rejected, then try again.',
    }
  }
  const headers = {
    Authorization: `Bearer ${token(credentials)}`,
    'Content-Type': 'application/json',
  }

  const res = existing.exists
    ? await fetch(`${GRAPH}/${existing.id}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ components: buildComponents(body) }),
      })
    : await fetch(`${GRAPH}/${encodeURIComponent(wabaId)}/message_templates`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: MAINTENANCE_TEMPLATE_NAME,
          language: MAINTENANCE_TEMPLATE_LANGUAGE,
          category: 'UTILITY',
          components: buildComponents(body),
        }),
      })

  const text = await res.text()
  if (!res.ok) {
    let message = text.slice(0, 400)
    try {
      const parsed = JSON.parse(text) as {
        error?: { message?: string; error_user_title?: string; error_user_msg?: string }
      }
      message =
        [parsed.error?.error_user_title, parsed.error?.error_user_msg].filter(Boolean).join(': ') ||
        parsed.error?.message ||
        message
    } catch {
      // keep raw text
    }
    return { ok: false, created: !existing.exists, error: message }
  }

  let status: string | undefined
  try {
    status = (JSON.parse(text) as { status?: string }).status
  } catch {
    status = undefined
  }
  return { ok: true, created: !existing.exists, status: status ?? 'PENDING' }
}

/**
 * Sends the hotel's reminder template to one staff member for one task. Each
 * button carries a payload naming the task and the action, so a tap is
 * matched to the right task even when someone has several open tasks.
 */
export async function sendMaintenanceTemplate(
  phoneNumberId: string,
  credentials: EncryptedPayload,
  to: string,
  params: { firstName: string; task: string; location: string; due: string },
  taskId: string,
  choice: TemplateChoice = { name: MAINTENANCE_TEMPLATE_NAME, language: MAINTENANCE_TEMPLATE_LANGUAGE }
): Promise<{ success: boolean; error?: string }> {
  // WhatsApp rejects parameters containing newlines/tabs or 4+ spaces in a row.
  const clean = (s: string) =>
    s.replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 900) || '—'

  try {
    const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token(credentials)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: choice.name,
          language: { code: choice.language },
          components: [
            {
              type: 'body',
              parameters: [params.firstName, params.task, params.location, params.due].map(
                (text) => ({ type: 'text', text: clean(text) })
              ),
            },
            ...BUTTON_ACTIONS.map((action, index) => ({
              type: 'button',
              sub_type: 'quick_reply',
              index: String(index),
              parameters: [{ type: 'payload', payload: `mt:${taskId}:${action}` }],
            })),
          ],
        },
      }),
    })
    if (!res.ok) {
      return { success: false, error: `WhatsApp template send failed: ${res.status} ${await res.text()}` }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/** Parses a button payload like "mt:<task uuid>:done". */
export function parseMaintenancePayload(
  text: string
): { taskId: string; action: MaintenanceAction } | null {
  const m = text.match(/^mt:([0-9a-f-]{36}):(accept|help|done|still)$/i)
  if (!m) return null
  return { taskId: m[1].toLowerCase(), action: m[2].toLowerCase() as MaintenanceAction }
}
