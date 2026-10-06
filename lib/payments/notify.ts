import { createServiceClient } from '../supabase/service'
import { sendWhatsAppMessage } from '../whatsapp-send'
import type { EncryptedPayload } from '../crypto'
import { logPaymentEvent, type PaymentRequestRow } from './service'

/**
 * Tells the guest their payment arrived — only ever called once the payment is
 * VERIFIED (Cloudbeds says paid and the folio shows it). Sent once per payment.
 */
export async function notifyGuestPaid(row: PaymentRequestRow): Promise<void> {
  if (row.guest_notified_at || !row.conversation_id) return
  const db = createServiceClient()

  // Claim first, so a second check can never send it twice.
  const { data: claimed } = await db
    .from('payment_requests')
    .update({ guest_notified_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('guest_notified_at', null)
    .select('id')
    .maybeSingle()
  if (!claimed) return

  const first = (row.guest_name ?? '').trim().split(/\s+/)[0] ?? ''
  const amount = Number(row.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const spanish = (row.language ?? 'es').toLowerCase().startsWith('es')
  const text = spanish
    ? `¡Pago recibido! ✅ Recibimos tu pago de ${amount} MXN para tu reservación #${row.reservation_id}. Gracias${first ? `, ${first}` : ''}. ¡Te esperamos en Zipolite! 🌴`
    : `Payment received! ✅ We received your payment of ${amount} MXN for reservation #${row.reservation_id}. Thank you${first ? `, ${first}` : ''} — we look forward to welcoming you in Zipolite! 🌴`

  await db.from('messages').insert({ tenant_id: row.tenant_id, conversation_id: row.conversation_id, sender_type: 'lana', content: text })

  let delivered = false
  if (row.channel === 'whatsapp') {
    const [{ data: conv }, { data: wa }] = await Promise.all([
      db.from('conversations').select('guest_id').eq('id', row.conversation_id).maybeSingle(),
      db.from('tenant_integrations').select('status, credentials, config').eq('tenant_id', row.tenant_id).eq('integration_type', 'whatsapp').maybeSingle(),
    ])
    const { data: guest } = conv?.guest_id ? await db.from('guests').select('phone').eq('id', conv.guest_id).maybeSingle() : { data: null }
    const phoneNumberId = (wa?.config as { phone_number_id?: string } | null)?.phone_number_id
    if (wa?.status === 'connected' && wa.credentials && phoneNumberId && guest?.phone) {
      const res = await sendWhatsAppMessage(phoneNumberId, wa.credentials as EncryptedPayload, String(guest.phone), text)
      delivered = res.success
    }
  }
  await logPaymentEvent(db, row.tenant_id, row.id, 'guest_notified', { channel: row.channel, delivered })
}
