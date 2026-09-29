import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sendWhatsAppMessage } from '@/lib/whatsapp-send'

export const maxDuration = 60

const COOLDOWN_HOURS = 4

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

    const phoneNumberId = (whatsappIntegration.config as { phone_number_id?: string })
      ?.phone_number_id
    if (!phoneNumberId) continue

    // Only tasks actually due today or overdue count as urgent — deliberately
    // different from Beta's own pacer, which counted every open task
    // regardless of due date and caused repeated indefinite deferrals.
    const { data: dueTasks } = await supabase
      .from('maintenance_tasks')
      .select('id, title, due_date, assigned_to, last_reminded_at')
      .eq('tenant_id', tenant.id)
      .in('status', ['open', 'in_progress'])
      .not('assigned_to', 'is', null)
      .not('due_date', 'is', null)
      .lte('due_date', today)

    const eligible = (dueTasks ?? []).filter(
      (t) => !t.last_reminded_at || t.last_reminded_at < cooldownCutoff
    )

    if (eligible.length === 0) continue

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

      const taskLines = tasks
        .map((t) => `• ${t.title}${t.due_date === today ? ' (due today)' : ' (overdue)'}`)
        .join('\n')

      const messageText = `Hi ${staffMember.name}, you have ${tasks.length} maintenance task${tasks.length > 1 ? 's' : ''} needing attention:\n\n${taskLines}`

      const sendResult = await sendWhatsAppMessage(
        phoneNumberId,
        whatsappIntegration.credentials,
        staffMember.phone,
        messageText
      )

      if (sendResult.success) {
        await supabase
          .from('maintenance_tasks')
          .update({ last_reminded_at: new Date().toISOString() })
          .in(
            'id',
            tasks.map((t) => t.id)
          )
      }

      results.push({
        tenantId: tenant.id,
        staffId,
        staffName: staffMember.name,
        taskCount: tasks.length,
        sendResult,
      })
    }
  }

  return NextResponse.json({ today, results })
}
