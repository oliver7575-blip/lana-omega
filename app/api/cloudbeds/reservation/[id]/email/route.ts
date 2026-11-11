import { NextResponse } from 'next/server'
import { cloudbedsForCaller } from '@/lib/cloudbeds-caller'
import { getReservationDetail, getReservationGuestContact } from '@/lib/cloudbeds-ops'
import { createClient } from '@/lib/supabase/server'
import { sendTenantEmail } from '@/lib/email'
import { findOrCreateGuest, ensureConversation } from '@/lib/guest-records'

export const maxDuration = 30

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Staff email to the guest of a reservation, sent through the same mailbox Lana's automatic emails use. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await cloudbedsForCaller()
  if ('error' in c) return c.error

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: staff } = await supabase.from('staff_users').select('tenant_id').eq('auth_uid', user.id).single()
  if (!staff) return NextResponse.json({ error: 'No tenant record found' }, { status: 404 })
  const tenantId = staff.tenant_id as string

  const body = (await request.json().catch(() => ({}))) as { subject?: string; body?: string; signature?: string }
  const subject = (body.subject ?? '').trim()
  const message = (body.body ?? '').trim()
  const signature = (body.signature ?? '').trim().slice(0, 1500)
  const text = signature ? `${message}\n\n${signature}` : message
  if (!subject || !message) return NextResponse.json({ error: 'Add a subject and a message.' }, { status: 400 })

  try {
    // The address comes from Cloudbeds, never from the browser.
    const [reservation, contact] = await Promise.all([getReservationDetail(c.cb, id), getReservationGuestContact(c.cb, id)])
    const to = contact.email ?? reservation.guestEmail
    if (!to) return NextResponse.json({ error: 'This guest has no email address on file.' }, { status: 404 })

    // The message and the signature are separate blocks; the signature keeps its own line breaks.
    const html =
      message
        .split(/\n{2,}/)
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('') +
      (signature ? `<p style="margin-top:20px">${escapeHtml(signature).replace(/\n/g, '<br>')}</p>` : '')
    const res = await sendTenantEmail(tenantId, to, subject, html, { text })
    if (!res.success) return NextResponse.json({ error: res.error ?? 'The email could not be sent.' }, { status: 502 })

    // Show it in the guest's conversation, like the automatic emails.
    const phone = contact.phone ?? reservation.guestPhone
    if (phone) {
      const guest = await findOrCreateGuest(supabase, tenantId, phone, { name: reservation.guestName, email: to })
      if (guest) {
        const conversationId = await ensureConversation(supabase, tenantId, guest.id as string)
        if (conversationId) {
          await supabase.from('messages').insert({
            tenant_id: tenantId,
            conversation_id: conversationId,
            sender_type: 'staff',
            content: `[Email sent to ${to}: ${subject}]\n\n${text}`,
          })
          await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)
        }
      }
    }
    return NextResponse.json({ ok: true, to })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cloudbeds error' }, { status: 502 })
  }
}
