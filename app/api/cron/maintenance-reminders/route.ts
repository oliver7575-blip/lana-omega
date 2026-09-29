import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { EncryptedPayload } from '@/lib/crypto'
import { getMaintenanceTemplate, sendMaintenanceTemplate } from '@/lib/maintenance-template'

export const maxDuration = 60

const COOLDOWN_HOURS = 4

function formatDue(dueDate: string, today: string): string {
  if (dueDate === today) return 'Hoy'
  const [, m, d] = dueDate.split('-')
  return `${d}/${m} (atrasada)`
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const today = new Date().toISOString().slice(0, 10)
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString()

  const { data: tenants } = await supabase.from('tenants').select('id')
  const results: Record<string, unknown>[] = []

  for (const tenant of tenants ?? []) {
    const { data: whatsappIntegration } = await supabase
      .from('tenant_integrations')
      .select('status, credentials, config')
      .eq('tenant_id', tenant.id)
      .eq('integration_type', 'whatsapp')
      .maybeSingle()

    if (whatsappIntegration?.status !== 'connected') continue

    const config = whatsappIntegration.config as { phone_number_id?: string; waba_id?: string }
    const phoneNumberId = config?.phone_number_id
    if (!phoneNumberId) continue
    const credentials = whatsappIntegration.credentials as EncryptedPayload

    // Only tasks actually due today or overdue count as urgent — deliberately
    // different from Beta's own pacer, which counted every open task
    // regardless of due date and caused repeated indefinite deferrals.
    const { data: dueTasks } = await supabase
      .from('maintenance_tasks')
      .select('id, title, location, due_date, assigned_to, last_reminded_at')
      .eq('tenant_id', tenant.id)
      .in('status', ['open', 'in_progress'])
      .not('assigned_to', 'is', null)
      .not('due_date', 'is', null)
      .lte('due_date', today)

    const eligible = (dueTasks ?? []).filter(
      (t) => !t.last_reminded_at || t.last_reminded_at < cooldownCutoff
    )

    if (eligible.length === 0) continue

    // Reminders go out as the Meta-approved template, so they're delivered
    // even outside WhatsApp's 24-hour window. No approved template = no send.
    let templateStatus = 'UNKNOWN'
    try {
      const info = config.waba_id
        ? await getMaintenanceTemplate(config.waba_id, credentials)
        : { exists: false }
      templateStatus = info.exists ? (info.status ?? 'UNKNOWN') : 'NOT_SUBMITTED'
    } catch (err) {
      templateStatus = `CHECK_FAILED: ${err instanceof Error ? err.message : 'unknown'}`
    }
    if (templateStatus !== 'APPROVED') {
      results.push({
        tenantId: tenant.id,
        skipped: `maintenance template not approved (${templateStatus})`,
        dueTasks: eligible.length,
      })
      continue
    }

    const { data: staff } = await supabase
      .from('maintenance_staff')
      .select('id, name, phone')
      .eq('tenant_id', tenant.id)

    const staffMap = new Map((staff ?? []).map((s) => [s.id, s]))

    const byStaff = new Map<string, typeof eligible>()
    for (const task of eligible) {
      const list = byStaff.get(task.assigned_to as string) ?? []
      list.push(task)
      byStaff.set(task.assigned_to as string, list)
    }

    for (const [staffId, tasks] of byStaff) {
      const staffMember = staffMap.get(staffId)
      if (!staffMember?.phone) {
        results.push({
          tenantId: tenant.id,
          staffId,
          skipped: 'no phone on file for this staff member',
        })
        continue
      }

      const firstName = staffMember.name.split(' ')[0]

      // One template message per task: each carries its own buttons, so a
      // tap always updates the right task.
      for (const task of tasks) {
        const sendResult = await sendMaintenanceTemplate(
          phoneNumberId,
          credentials,
          staffMember.phone,
          {
            firstName,
            task: task.title,
            location: (task.location as string | null) ?? '—',
            due: formatDue(task.due_date as string, today),
          },
          task.id
        )

        if (sendResult.success) {
          await supabase
            .from('maintenance_tasks')
            .update({ last_reminded_at: new Date().toISOString() })
            .eq('id', task.id)
          await supabase.from('maintenance_task_events').insert({
            tenant_id: tenant.id,
            task_id: task.id,
            event_type: 'reminder_sent',
            detail: `WhatsApp reminder sent to ${staffMember.name}`,
          })
        }

        results.push({
          tenantId: tenant.id,
          staffId,
          staffName: staffMember.name,
          taskId: task.id,
          sendResult,
        })
      }
    }
  }

  return NextResponse.json({ today, results })
}
