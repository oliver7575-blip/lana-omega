import { createServiceClient } from './supabase/service'
import { samePhone } from './phone'
import { handleStaffReply, loadEngineContext, parseStaffReply, type StaffRow } from './maintenance-engine'

export interface ButtonReplyResult {
  handled: boolean
  detail?: string
}

/**
 * A WhatsApp message from a maintenance staff member. Only task replies
 * ("CD9B91 TERMINADO", "ACEPTO", button taps…) are handled here — anything
 * else from staff goes to the concierge like any other message.
 */
export async function processMaintenanceButtonReply(
  tenantId: string,
  fromPhone: string,
  text: string
): Promise<ButtonReplyResult> {
  if (!parseStaffReply(text)) return { handled: false, detail: 'Not a task reply' }

  const db = createServiceClient()
  const { data: staff } = await db
    .from('maintenance_staff')
    .select('id, name, phone, active, language, quiet_hours_start, quiet_hours_end, weekly_days_off, unavailable_from, unavailable_until')
    .eq('tenant_id', tenantId)
  const worker = ((staff ?? []) as StaffRow[]).find((s) => samePhone(s.phone, fromPhone))
  if (!worker) return { handled: false, detail: 'Not a maintenance staff number' }

  const ctx = await loadEngineContext(tenantId, db)
  const handled = await handleStaffReply(ctx, worker, text)
  return { handled }
}
