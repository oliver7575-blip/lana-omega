import { NextResponse } from 'next/server'
import { paymentsCaller } from '@/lib/payments/caller'
import { createPaymentLink } from '@/lib/payments/service'
import { getReservationDetail, getReservationGuestContact } from '@/lib/cloudbeds-ops'
import { findOrCreateGuest, ensureConversation } from '@/lib/guest-records'
import { sendTenantEmail } from '@/lib/email'
import { sendWhatsAppInteractiveButton } from '@/lib/whatsapp-send'
import { detectLang } from '@/lib/lana-reliability'
import { loadWhatsApp, sendHelloTemplate, whatsappWindowOpen } from '@/lib/hello-template'

export const maxDuration = 60

const SPANISH_COUNTRIES = ['MX', 'ES', 'AR', 'CO', 'CL', 'PE', 'VE', 'EC', 'GT', 'CU', 'BO', 'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY', 'PR']
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

type SendState = { status: 'sent' | 'skipped' | 'failed'; detail: string }

/**
 * Staff creates the guest's balance payment link (same rules and amount as when Lana creates it) and it goes out
 * straight away to the email and WhatsApp number on the reservation.
 */
export async function POST(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await paymentsCaller()
  if ('error' in c) return c.error
  if (!c.canManage) return NextResponse.json({ error: 'Only owners or admins can create payment links' }, { status: 403 })
  const tenantId = c.ctx.tenantId

  const created = await createPaymentLink(c.supabase, c.cb, c.ctx, { reservationId: id, kind: 'balance', createdBy: 'staff', staffUserId: c.staffId })
  if (!created.ok) return NextResponse.json({ error: created.message, code: created.code }, { status: 422 })
  const req = created.request
  const url = req.link_url
  if (!url) return NextResponse.json({ error: 'Cloudbeds created the link but did not return its address.' }, { status: 502 })
  const amount = Number(req.amount)
  const amountText = `${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`
  const hours = c.ctx.settings.linkExpiryDays * 24

  const out = { url, amount, reused: created.reused, email: { status: 'skipped', detail: '' } as SendState, whatsapp: { status: 'skipped', detail: '' } as SendState }

  try {
    const [reservation, contact] = await Promise.all([getReservationDetail(c.cb, id), getReservationGuestContact(c.cb, id)])
    const email = contact.email ?? reservation.guestEmail
    const phone = contact.phone ?? reservation.guestPhone
    const country = (contact.country ?? reservation.guestCountry ?? '').toUpperCase()
    const first = reservation.guestName.trim().split(/\s+/)[0] || ''

    // The guest's conversation (created if needed) — messages sent here show up on the Messages page.
    let conversationId: string | null = null
    if (phone) {
      const guest = await findOrCreateGuest(c.supabase, tenantId, phone, { name: reservation.guestName, email: email ?? undefined })
      if (guest) conversationId = await ensureConversation(c.supabase, tenantId, guest.id as string)
    }
    const win = conversationId ? await whatsappWindowOpen(c.supabase, conversationId) : { open: false, lastGuestText: null }
    const lang: 'es' | 'en' = win.lastGuestText ? (detectLang(win.lastGuestText) === 'es' ? 'es' : 'en') : SPANISH_COUNTRIES.includes(country) ? 'es' : 'en'
    const es = lang === 'es'
    const record = async (content: string) => {
      if (!conversationId) return
      await c.supabase.from('messages').insert({ tenant_id: tenantId, conversation_id: conversationId, sender_type: 'staff', content })
      await c.supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)
    }

    // ---- Email -------------------------------------------------------------------
    if (!email) {
      out.email = { status: 'skipped', detail: 'No email on the reservation' }
    } else {
      const { data: tenant } = await c.supabase.from('tenants').select('channel_settings').eq('id', tenantId).single()
      const signature = String((tenant?.channel_settings as Record<string, unknown> | null)?.email_signature ?? '').trim()
      const lines = es
        ? [
            `Hola${first ? ` ${first}` : ''},`,
            `Te compartimos el link para pagar el saldo de tu reservación #${id}: ${amountText}.`,
            `Haz clic aquí para pagar de forma segura con tarjeta:`,
            url,
            `El link es válido por ${hours} horas. Ingresa los datos de tu tarjeta únicamente en la página de pago; nunca te los pediremos por mensaje. Si tienes cualquier duda, responde a este correo.`,
            `Gracias, Soirée`,
          ]
        : [
            `Hi${first ? ` ${first}` : ''},`,
            `Here is the link to pay the balance of your reservation #${id}: ${amountText}.`,
            `Click here to pay securely by card:`,
            url,
            `The link is valid for ${hours} hours. Please enter your card details only on the payment page; we will never ask for them in a message. If you have any questions, just reply to this email.`,
            `Thank you, Soirée`,
          ]
      const text = lines.join('\n\n') + (signature ? `\n\n${signature}` : '')
      const html =
        lines.map((l) => (l === url ? `<p><a href="${esc(url)}">${esc(url)}</a></p>` : `<p>${esc(l)}</p>`)).join('') +
        (signature ? `<p style="margin-top:20px">${esc(signature).replace(/\n/g, '<br>')}</p>` : '')
      const res = await sendTenantEmail(tenantId, email, 'Soiree Payment Link', html, { text })
      out.email = res.success ? { status: 'sent', detail: `Sent to ${email}` } : { status: 'failed', detail: res.error ?? 'The email could not be sent' }
      if (res.success) await record(`[Email sent to ${email}: Soiree Payment Link]\n\n${lines.join('\n\n')}`)
    }

    // ---- WhatsApp ----------------------------------------------------------------
    if (!phone || !conversationId) {
      out.whatsapp = { status: 'skipped', detail: 'No phone number on the reservation' }
    } else if (win.open) {
      const wa = await loadWhatsApp(c.supabase, tenantId)
      if (!wa) {
        out.whatsapp = { status: 'failed', detail: 'WhatsApp integration not fully configured' }
      } else {
        // Lana's payment wording, plus who we are and which reservation: the guest didn't ask for this link in a chat.
        const short = `${amount.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 })} MXN`
        const body = es
          ? `Hola${first ? ` ${first}` : ''}, te escribimos de Soirée, en Zipolite 🌴 Aquí está tu link de pago seguro por **${short}** para tu reservación #${id}. Es válido por ${hours} horas, y ingresarás los datos de tu tarjeta solo en esa página segura.`
          : `Hi${first ? ` ${first}` : ''}, this is Soirée in Zipolite 🌴 Here's your secure payment link for **${short}** for your reservation #${id}. It's valid for ${hours} hours, and you'll enter your card details only on that secure page.`
        const res = await sendWhatsAppInteractiveButton(wa.phoneNumberId, wa.credentials, phone, body, url, es ? 'Pagar ahora' : 'Pay now')
        out.whatsapp = res.success ? { status: 'sent', detail: `Sent to ${phone}` } : { status: 'failed', detail: res.error ?? 'WhatsApp did not deliver it' }
        if (res.success) await record(`${body}\n[Payment button]`)
      }
    } else {
      // Outside the 24-hour window: the approved hello template, with the link in its reason sentence.
      const reason = es ? `Aquí está tu link de pago por ${amountText}: ${url}` : `Here is your payment link for ${amountText}: ${url}`
      const res = await sendHelloTemplate(c.supabase, { tenantId, conversationId, phone, firstName: first || (es ? 'hola' : 'there'), reason, lang })
      out.whatsapp = res.success ? { status: 'sent', detail: `Sent to ${phone} as the Soirée hello message` } : { status: 'failed', detail: res.error ?? 'Could not send' }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not look up the guest'
    if (out.email.status === 'skipped' && !out.email.detail) out.email = { status: 'failed', detail: msg }
    if (out.whatsapp.status === 'skipped' && !out.whatsapp.detail) out.whatsapp = { status: 'failed', detail: msg }
  }
  return NextResponse.json(out)
}
