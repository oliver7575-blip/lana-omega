import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { EncryptedPayload } from '@/lib/crypto'
import { notifyStaff, isWithinHours } from '@/lib/escalation'
import { parseEscalationContacts } from '@/lib/escalation-contacts'

export const maxDuration = 60

/**
 * Runs when working hours start (8:00 am hotel time = 14:00 UTC; Mexico has no daylight saving).
 * Alerts that were held overnight for a contact with working hours (e.g. cleaning) go out as
 * one list. If the send fails they stay on hold for the next run.
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const db = createServiceClient()
  const { data: tenants } = await db.from('tenants').select('id, timezone, escalation_contacts, message_templates')
  const results: Record<string, unknown>[] = []

  for (const t of tenants ?? []) {
    const tz = (t.timezone as string) || 'America/Mexico_City'
    const contacts = parseEscalationContacts(t.escalation_contacts).filter((c) => c.hours)
    if (!contacts.length) continue
    const { data: wa } = await db
      .from('tenant_integrations')
      .select('status, credentials, config')
      .eq('tenant_id', t.id)
      .eq('integration_type', 'whatsapp')
      .maybeSingle()
    const phoneNumberId = (wa?.config as { phone_number_id?: string } | null)?.phone_number_id
    if (wa?.status !== 'connected' || !wa.credentials || !phoneNumberId) continue

    for (const contact of contacts) {
      if (!isWithinHours(contact.hours, tz)) {
        results.push({ tenantId: t.id, category: contact.key, skipped: 'Outside working hours' })
        continue
      }
      const { data: held } = await db
        .from('escalations')
        .select('id, room, summary, created_at')
        .eq('tenant_id', t.id)
        .eq('category', contact.key)
        .eq('held', true)
        .order('created_at', { ascending: true })
        .limit(40)
      if (!held?.length) continue

      const lines = held.map((e, i) => `${i + 1}. ${e.room ? `Hab. ${e.room}: ` : ''}${String(e.summary).slice(0, 200)}`)
      const summary = `${held.length} pendiente${held.length === 1 ? '' : 's'} de anoche:\n${lines.join('\n')}`
      const res = await notifyStaff(
        phoneNumberId,
        wa.credentials as EncryptedPayload,
        contact.phone,
        'Sistema',
        { category: contact.key, summary, urgency: 'normal' },
        t.message_templates,
        'Lana'
      )
      if (res.success) {
        await db.from('escalations').update({ held: false, delivered: true }).in('id', held.map((e) => e.id))
        results.push({ tenantId: t.id, category: contact.key, sent: held.length })
      } else {
        console.error('[held-escalations] send failed', t.id, contact.key, res.error)
        results.push({ tenantId: t.id, category: contact.key, error: res.error })
      }
    }
  }
  console.log('[held-escalations]', JSON.stringify(results).slice(0, 1500))
  return NextResponse.json({ results })
}
