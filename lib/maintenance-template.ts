import { decryptCredentials, type EncryptedPayload } from './crypto'

/**
 * The WhatsApp template used for maintenance reminders. Each hotel has its
 * own copy in its own WhatsApp Business Account, under this fixed name.
 *
 * The three quick-reply buttons are fixed: the reply handler depends on
 * them. Only the body text is editable, and it must keep all four
 * variables so reminders can be filled in:
 *   {{1}} staff first name   {{2}} task   {{3}} location   {{4}} due
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

export interface TemplateInfo {
  exists: boolean
  id?: string
  status?: string // APPROVED | PENDING | REJECTED | PAUSED | DISABLED | ...
  rejectedReason?: string | null
  body?: string
}

function token(credentials: EncryptedPayload): string {
  return decryptCredentials<{ access_token: string }>(credentials).access_token
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

export async function getMaintenanceTemplate(
  wabaId: string,
  credentials: EncryptedPayload
): Promise<TemplateInfo> {
  const url =
    `${GRAPH}/${encodeURIComponent(wabaId)}/message_templates` +
    `?name=${MAINTENANCE_TEMPLATE_NAME}&fields=id,name,status,language,rejected_reason,components`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token(credentials)}` },
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) {
    throw new Error(`Meta API ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }
  const data = (await res.json()) as {
    data?: {
      id: string
      name: string
      status: string
      language: string
      rejected_reason?: string
      components?: { type: string; text?: string }[]
    }[]
  }
  const match = (data.data ?? []).find(
    (t) => t.name === MAINTENANCE_TEMPLATE_NAME && t.language === MAINTENANCE_TEMPLATE_LANGUAGE
  )
  if (!match) return { exists: false }
  return {
    exists: true,
    id: match.id,
    status: match.status,
    rejectedReason:
      match.rejected_reason && match.rejected_reason !== 'NONE' ? match.rejected_reason : null,
    body: match.components?.find((c) => c.type === 'BODY')?.text,
  }
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
 * Creates the template if it doesn't exist yet, otherwise edits the existing
 * one. Either way Meta reviews it again before it can be used.
 */
export async function submitMaintenanceTemplate(
  wabaId: string,
  credentials: EncryptedPayload,
  body: string
): Promise<{ ok: boolean; created: boolean; status?: string; error?: string }> {
  const existing = await getMaintenanceTemplate(wabaId, credentials)
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
 * Sends the approved template to one staff member for one task. Each button
 * carries a payload naming the task and the action, so a tap is matched to
 * the right task even when someone has several open tasks.
 */
export async function sendMaintenanceTemplate(
  phoneNumberId: string,
  credentials: EncryptedPayload,
  to: string,
  params: { firstName: string; task: string; location: string; due: string },
  taskId: string
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
          name: MAINTENANCE_TEMPLATE_NAME,
          language: { code: MAINTENANCE_TEMPLATE_LANGUAGE },
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
  const m = text.match(/^mt:([0-9a-f-]{36}):(accept|help|done)$/i)
  if (!m) return null
  return { taskId: m[1].toLowerCase(), action: m[2].toLowerCase() as MaintenanceAction }
}
