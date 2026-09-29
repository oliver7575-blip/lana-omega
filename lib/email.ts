import nodemailer from 'nodemailer'
import { createServiceClient } from './supabase/service'
import { decryptCredentials } from './crypto'

export type EmailPurpose = 'new_reservation' | 'arrival_reminder' | 'post_stay'

export const EMAIL_PURPOSES: Record<EmailPurpose, { label: string; help: string }> = {
  new_reservation: {
    label: 'New reservation email',
    help: 'Sent as soon as a new booking arrives from Cloudbeds.',
  },
  arrival_reminder: {
    label: 'Arrival information email',
    help: 'Sent 2 days before check-in (or right away for last-minute bookings).',
  },
  post_stay: {
    label: 'Post-stay feedback email',
    help: 'Sent the day after check-out, only when post-stay messages are on.',
  },
}

export const EMAIL_VARIABLES = [
  'guest_first_name',
  'guest_name',
  'check_in',
  'check_out',
  'reservation_id',
  'room_type',
  'property_name',
] as const

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Fills {{variable}} placeholders. Values are HTML-escaped when html is true. */
export function renderEmailTemplate(
  template: string,
  values: Record<string, string>,
  html: boolean
): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, key: string) => {
    const v = values[key] ?? ''
    return html ? escapeHtml(v) : v
  })
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function sendTenantEmail(
  tenantId: string,
  to: string,
  subject: string,
  html: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = createServiceClient()
  const { data: integration } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'email')
    .maybeSingle()

  if (integration?.status !== 'connected' || !integration.credentials) {
    return { success: false, error: 'Email (SMTP) is not connected' }
  }
  const config = (integration.config ?? {}) as {
    smtp_host?: string
    smtp_port?: string
    smtp_user?: string
    from_name?: string
  }
  if (!config.smtp_host || !config.smtp_user) {
    return { success: false, error: 'SMTP host or username missing' }
  }
  const { smtp_password } = decryptCredentials<{ smtp_password: string }>(integration.credentials)
  const port = Number(config.smtp_port) || 465

  try {
    const transporter = nodemailer.createTransport({
      host: config.smtp_host,
      port,
      secure: port === 465,
      auth: { user: config.smtp_user, pass: smtp_password },
      connectionTimeout: 15000,
    })
    await transporter.sendMail({
      from: config.from_name ? `"${config.from_name}" <${config.smtp_user}>` : config.smtp_user,
      to,
      subject,
      html,
      text: htmlToText(html),
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Email send failed' }
  }
}
