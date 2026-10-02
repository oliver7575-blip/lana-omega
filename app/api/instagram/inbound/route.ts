import { NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { verifyMetaSignature } from '@/lib/verify-webhook'
import { generateReply, NO_REPLY_TOKEN } from '@/lib/anthropic'
import { decryptCredentials, type EncryptedPayload } from '@/lib/crypto'
import { lookupReservation } from '@/lib/cloudbeds'
import { notifyStaff } from '@/lib/escalation'
import { parseEscalationContacts, findEscalationContact } from '@/lib/escalation-contacts'
import { buildRoomPhotosTool } from '@/lib/room-photos'
import { buildKnowledgeBaseSection } from '@/lib/knowledge-base'
import { buildBookingLinkInstruction } from '@/lib/booking-link'
import { describeImage } from '@/lib/whatsapp-media'
import {
  instagramConnection,
  instagramProfile,
  sendInstagramImage,
  sendInstagramText,
  type InstagramConnection,
} from '@/lib/instagram'

export const maxDuration = 60

const DEBOUNCE_MS = 8000
const HISTORY_LIMIT = 40

interface IgEvent {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    is_deleted?: boolean
    attachments?: { type?: string; payload?: { url?: string } }[]
  }
}

/** Meta's webhook verification handshake. */
export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === process.env.META_VERIFY_TOKEN) {
    return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

export async function POST(request: Request) {
  const raw = await request.text()
  let body: { object?: string; entry?: { id?: string; messaging?: IgEvent[] }[] }
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
  }
  if (body.object !== 'instagram') return NextResponse.json({ ok: true })

  const db = createServiceClient()
  for (const entry of body.entry ?? []) {
    const accountId = String(entry.id ?? '')
    const { data: integration } = await db
      .from('tenant_integrations')
      .select('tenant_id, status, credentials, config')
      .eq('integration_type', 'instagram')
      .eq('config->>account_id', accountId)
      .maybeSingle()
    if (!integration || integration.status !== 'connected' || !integration.credentials) {
      console.warn('[instagram-inbound] no connected integration for account', accountId)
      continue
    }
    const conn = instagramConnection(integration.credentials as EncryptedPayload, integration.config)

    // Only accept messages signed by Meta (the app secret of the app sending them).
    const secret = conn.appSecret ?? process.env.META_APP_SECRET
    if (!secret || !verifyMetaSignature(raw, request.headers.get('x-hub-signature-256'), secret)) {
      console.error('[instagram-inbound] signature check failed for account', accountId)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    for (const ev of entry.messaging ?? []) {
      const senderId = ev.sender?.id
      if (!ev.message || ev.message.is_echo || ev.message.is_deleted || !senderId || senderId === accountId) continue
      after(() =>
        handleMessage(integration.tenant_id as string, conn, accountId, senderId, ev).catch((err) =>
          console.error('[instagram-inbound] failed', err)
        )
      )
    }
  }
  return NextResponse.json({ ok: true })
}

async function describeAttachments(ev: IgEvent): Promise<string[]> {
  const notes: string[] = []
  for (const a of ev.message?.attachments ?? []) {
    if (a.type === 'image' && a.payload?.url) {
      try {
        const res = await fetch(a.payload.url, { signal: AbortSignal.timeout(15000) })
        const type = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]
        const description = await describeImage(Buffer.from(await res.arrayBuffer()), type)
        notes.push(`[The guest sent a photo: ${description}]`)
      } catch {
        notes.push('[The guest sent a photo]')
      }
    } else if (a.type === 'audio') {
      notes.push('[The guest sent a voice message, which can\'t be played here — ask them to type their question]')
    } else if (a.type === 'share' || a.type === 'story_mention' || a.type === 'ig_reel' || a.type === 'reel') {
      notes.push('[The guest shared a post or story]')
    } else if (a.type) {
      notes.push(`[The guest sent an attachment (${a.type})]`)
    }
  }
  return notes
}

async function handleMessage(tenantId: string, conn: InstagramConnection, accountId: string, senderId: string, ev: IgEvent) {
  const supabase = createServiceClient()
  const text = [ev.message?.text?.trim(), ...(await describeAttachments(ev))].filter(Boolean).join('\n')
  if (!text) return

  // ---- Guest & conversation ------------------------------------------------
  const guestKey = `ig:${senderId}`
  const { data: existingGuest } = await supabase.from('guests').select('*').eq('tenant_id', tenantId).eq('phone', guestKey).maybeSingle()
  let guest = existingGuest
  if (!guest) {
    const profile = await instagramProfile(conn, senderId)
    const { data } = await supabase
      .from('guests')
      .upsert({ tenant_id: tenantId, phone: guestKey, name: profile.name || (profile.username ? `@${profile.username}` : null) }, { onConflict: 'tenant_id,phone' })
      .select()
      .single()
    guest = data
  }
  if (!guest) return

  const { data: openConvo } = await supabase
    .from('conversations')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('guest_id', guest.id)
    .eq('channel', 'instagram')
    .neq('status', 'closed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  let conversationId = openConvo?.id as string | undefined
  if (!conversationId) {
    const { data } = await supabase
      .from('conversations')
      .insert({ tenant_id: tenantId, guest_id: guest.id, channel: 'instagram', status: 'active' })
      .select('id')
      .single()
    conversationId = data?.id as string | undefined
  }
  if (!conversationId) return

  const { data: guestMessage, error: messageError } = await supabase
    .from('messages')
    .insert({ tenant_id: tenantId, conversation_id: conversationId, sender_type: 'guest', content: text, external_id: ev.message?.mid ?? null })
    .select('id')
    .single()
  if (messageError) {
    if (messageError.code === '23505') return // Meta re-delivered a message we already have
    throw messageError
  }
  await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)

  // ---- Wait briefly so several quick messages get one reply ----------------
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS))
  const { data: latest } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'guest')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latest && latest.id !== guestMessage.id) return

  const [{ data: convoNow }, { data: tenant }] = await Promise.all([
    supabase.from('conversations').select('status').eq('id', conversationId).single(),
    supabase
      .from('tenants')
      .select('ai_persona_prompt, knowledge_base, escalation_contacts, booking_config, message_templates, channel_settings')
      .eq('id', tenantId)
      .single(),
  ])
  if (convoNow?.status === 'human_takeover' || convoNow?.status === 'closed') return
  if ((tenant?.channel_settings as { instagram?: boolean } | null)?.instagram === false) return

  // ---- Tools ------------------------------------------------------------------
  const { data: integrations } = await supabase
    .from('tenant_integrations')
    .select('integration_type, status, credentials, config')
    .eq('tenant_id', tenantId)
    .in('integration_type', ['pms_cloudbeds', 'whatsapp'])
  const cloudbeds = integrations?.find((i) => i.integration_type === 'pms_cloudbeds' && i.status === 'connected')
  const whatsapp = integrations?.find((i) => i.integration_type === 'whatsapp' && i.status === 'connected')
  const propertyId = (cloudbeds?.config as { property_id?: string } | null)?.property_id
  const cbKey = cloudbeds?.credentials ? decryptCredentials<{ api_key: string }>(cloudbeds.credentials as EncryptedPayload).api_key : null

  const reservationTool =
    cbKey && propertyId
      ? {
          lookupReservation: async (confirmationNumber?: string) =>
            confirmationNumber
              ? lookupReservation(cbKey, propertyId, confirmationNumber)
              : { found: false, note: 'On Instagram there is no phone number to match — ask the guest for their confirmation number.' },
        }
      : undefined
  const roomPhotosTool = cbKey && propertyId ? buildRoomPhotosTool(cbKey, propertyId) : undefined

  const contacts = parseEscalationContacts(tenant?.escalation_contacts)
  const waPhoneId = (whatsapp?.config as { phone_number_id?: string } | null)?.phone_number_id
  const guestName = (guest.name as string | null) ?? null
  const escalationTool =
    contacts.length && whatsapp?.credentials && waPhoneId
      ? {
          categories: contacts.map((c) => ({ key: c.key, description: c.description })),
          escalateToStaff: async (input: { category: string; roomNumber?: string; summary: string; urgency?: string }) => {
            const contact = findEscalationContact(contacts, input.category)
            if (!contact) return { success: false, error: `No ${input.category} contact configured` }
            const result = await notifyStaff(
              waPhoneId,
              whatsapp.credentials as EncryptedPayload,
              contact.phone,
              `Instagram ${guestName ?? ''}`.trim(),
              input,
              tenant?.message_templates,
              guestName
            )
            await supabase.from('escalations').insert({
              tenant_id: tenantId,
              conversation_id: conversationId,
              guest_id: guest.id,
              category: input.category,
              urgency: input.urgency ?? 'normal',
              summary: input.summary,
              room: input.roomNumber ?? null,
              delivered: result.success,
            })
            return result
          },
        }
      : undefined

  // ---- Prompt & history ---------------------------------------------------------
  const channelInstruction = `\n\nCHANNEL: You are replying in Instagram Direct Messages. Keep replies short and conversational. Use plain text only — no asterisks, Markdown, headings or tables; paste links as plain URLs. If several guest messages arrive in a row, answer them together. Messages in square brackets describe a photo or attachment the guest sent.\n\nINSTAGRAM LIMITS: You can't add people to the New Year's waitlist or update arrival times directly here — collect what's needed (full name, email and phone for the waitlist; confirmation number and time for arrival) and pass it to the team with escalate_to_staff (category "reservations"). For reservation questions, ask for the confirmation number.\n\nNO REPLY: If the guest's latest message(s) only close the conversation — a thank-you, "ok", a farewell, or just an emoji/reaction — with no new question, reply with exactly ${NO_REPLY_TOKEN} and nothing else.`
  const nameContext = guestName ? `The guest's Instagram name is "${guestName}". It's only a display name — not proof of identity or a reservation.\n\n` : ''

  const { data: recent } = await supabase
    .from('messages')
    .select('sender_type, content')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['guest', 'lana'])
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)
  const history = (recent ?? []).reverse()
  while (history.length && history[0].sender_type !== 'guest') history.shift()

  const systemPrompt =
    nameContext +
    ((tenant?.ai_persona_prompt as string) ?? 'You are a helpful, warm hotel concierge assistant.') +
    buildKnowledgeBaseSection(tenant?.knowledge_base as string | null) +
    buildBookingLinkInstruction(tenant?.booking_config as Record<string, unknown>) +
    channelInstruction

  let reply: Awaited<ReturnType<typeof generateReply>>
  try {
    reply = await generateReply(
      systemPrompt,
      history.map((m) => ({ role: m.sender_type === 'guest' ? ('user' as const) : ('assistant' as const), content: m.content as string })),
      reservationTool,
      escalationTool,
      undefined,
      undefined,
      undefined,
      undefined,
      roomPhotosTool
    )
  } catch (err) {
    console.error('[instagram-inbound] AI reply failed', err)
    return
  }

  const photos = reply.photoUrls ?? []
  const replyText = reply.noReply ? '' : reply.text.replace(/\*\*?([^*]+)\*\*?/g, '$1')
  const note = photos.length ? `[Sent ${photos.length} room photo${photos.length === 1 ? '' : 's'}]` : ''
  if (replyText || note) {
    await supabase.from('messages').insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      sender_type: 'lana',
      content: [replyText, note].filter(Boolean).join('\n'),
    })
    await supabase.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversationId)
  }
  if (replyText) {
    const sent = await sendInstagramText(conn, senderId, replyText)
    if (!sent.success) console.error('[instagram-inbound] send failed', sent.error)
  }
  for (const url of photos) {
    const res = await sendInstagramImage(conn, senderId, url)
    if (!res.success) console.error('[instagram-inbound] photo send failed', res.error)
  }
  void accountId
}
