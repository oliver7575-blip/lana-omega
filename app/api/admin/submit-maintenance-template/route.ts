import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { decryptCredentials } from '@/lib/crypto'

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`

  if (!process.env.CRON_SECRET || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const tenantId = searchParams.get('tenantId') ?? 'f6598de8-83f0-4a06-add7-e1d4e80cab7a'

  const supabase = createServiceClient()

  const { data: whatsappIntegration } = await supabase
    .from('tenant_integrations')
    .select('credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'whatsapp')
    .maybeSingle()

  if (!whatsappIntegration) {
    return NextResponse.json({ error: 'No WhatsApp integration found for this tenant' }, { status: 404 })
  }

  const { access_token } = decryptCredentials<{ access_token: string }>(
    whatsappIntegration.credentials
  )
  const wabaId = (whatsappIntegration.config as { waba_id?: string })?.waba_id

  if (!wabaId) {
    return NextResponse.json({ error: 'No waba_id configured for this tenant' }, { status: 400 })
  }

  // Body/buttons text confirmed directly from Beta's own real, already
  // Meta-approved template — same content, submitted fresh to Omega's own
  // separate test WABA rather than reusing Beta's live one.
  const templateBody = {
    name: 'maintenance_task_reminder_es',
    language: 'es_MX',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Hola {{1}}. Tienes una tarea de mantenimiento:\n\n{{2}}\n\n📍 {{3}}\n🕐 Vence: {{4}}\n\nPor favor confirma abajo.',
        example: {
          body_text: [['Juan', 'Revisar aire acondicionado', 'Cuarto 5', 'Hoy 5pm']],
        },
      },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Acepto' },
          { type: 'QUICK_REPLY', text: 'Necesito Ayuda' },
          { type: 'QUICK_REPLY', text: 'Terminado' },
        ],
      },
    ],
  }

  const response = await fetch(`https://graph.facebook.com/v21.0/${wabaId}/message_templates`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(templateBody),
  })

  const data = await response.json()

  return NextResponse.json({ status: response.status, data })
}
