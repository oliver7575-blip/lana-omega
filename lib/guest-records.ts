import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhone } from './phone'

/**
 * Finds a guest by phone regardless of formatting: Cloudbeds may give
 * "+52 55 1367 4153" while WhatsApp sends "5215513674153". The last 10
 * digits identify the number.
 */
export async function findGuestByPhone(db: SupabaseClient, tenantId: string, phone: string) {
  const digits = normalizePhone(phone)
  if (digits.length < 8) return null
  const { data: exact } = await db.from('guests').select('*').eq('tenant_id', tenantId).in('phone', [phone, digits]).limit(1)
  if (exact?.length) return exact[0]
  const { data: similar } = await db
    .from('guests')
    .select('*')
    .eq('tenant_id', tenantId)
    .like('phone', `%${digits.slice(-10)}`)
    .limit(2)
  return similar?.length === 1 ? similar[0] : null
}

export async function findOrCreateGuest(
  db: SupabaseClient,
  tenantId: string,
  phone: string,
  details: { name?: string; email?: string } = {}
) {
  const existing = await findGuestByPhone(db, tenantId, phone)
  if (existing) {
    const updates: Record<string, string> = {}
    if (!existing.name && details.name) updates.name = details.name
    if (!existing.email && details.email) updates.email = details.email
    if (Object.keys(updates).length) await db.from('guests').update(updates).eq('id', existing.id)
    return { ...existing, ...updates }
  }
  const { data } = await db
    .from('guests')
    .upsert(
      { tenant_id: tenantId, phone: normalizePhone(phone), name: details.name ?? null, email: details.email ?? null },
      { onConflict: 'tenant_id,phone' }
    )
    .select()
    .single()
  return data
}

/** The guest's open WhatsApp conversation, created if needed. */
export async function ensureConversation(db: SupabaseClient, tenantId: string, guestId: string): Promise<string | null> {
  const { data: open } = await db
    .from('conversations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('guest_id', guestId)
    .eq('channel', 'whatsapp')
    .neq('status', 'closed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (open) return open.id as string
  const { data } = await db
    .from('conversations')
    .insert({ tenant_id: tenantId, guest_id: guestId, channel: 'whatsapp', status: 'active', last_message_at: new Date().toISOString() })
    .select('id')
    .single()
  return (data?.id as string) ?? null
}

/** Records something Lana sent on her own in the guest's conversation. */
export async function logLanaMessage(db: SupabaseClient, tenantId: string, conversationId: string, content: string) {
  await db.from('messages').insert({ tenant_id: tenantId, conversation_id: conversationId, sender_type: 'lana', content })
  await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)
}
