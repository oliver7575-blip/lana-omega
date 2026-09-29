import { NextResponse, after } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateReply, NO_REPLY_TOKEN } from '@/lib/anthropic'
import { sendWhatsAppMessage, sendWhatsAppInteractiveButton, sendWhatsAppImage } from '@/lib/whatsapp-send'
import { downloadWhatsAppMedia, describeImage, transcribeAudio } from '@/lib/whatsapp-media'
import { verifyMetaSignature } from '@/lib/verify-webhook'
import { decryptCredentials, type EncryptedPayload } from '@/lib/crypto'
import { lookupReservation, updateArrivalTime } from '@/lib/cloudbeds'
import { notifyStaff } from '@/lib/escalation'
import { parseEscalationContacts, findEscalationContact } from '@/lib/escalation-contacts'
import { buildRoomPhotosTool } from '@/lib/room-photos'
import { buildBookingLinkInstruction } from '@/lib/booking-link'
import { buildKnowledgeBaseSection } from '@/lib/knowledge-base'
import { processMaintenanceButtonReply } from '@/lib/maintenance-reply'

// Meta must get a fast 200. All real work runs in after(), which keeps the
// function alive (up to maxDuration) after the response has been sent.
export const maxDuration = 60

// How long to wait for more messages before replying, so a guest who sends
// several quick messages gets one combined answer (same idea as Beta's
// 10-second debounce).
const DEBOUNCE_MS = 8000

// How many past messages to give the AI. Keeps long-running conversations
// from growing without limit.
const HISTORY_LIMIT = 40

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'sticker'

interface ExtractedMessage {
  phoneNumberId: string
  from: string
  messageId: string | null
  type: string
  text: string
  mediaId?: string
  mediaKind?: MediaKind
  profileName?: string
}

const MEDIA_KINDS: MediaKind[] = ['image', 'audio', 'video', 'document', 'sticker']

function extractMessage(body: Record<string, unknown>): ExtractedMessage | null {
  if (body.entry) {
    const entry = (body.entry as unknown[])?.[0] as Record<string, unknown> | undefined
    const changes = entry?.changes as unknown[] | undefined
    const value = (changes?.[0] as Record<string, unknown> | undefined)?.value as
      | Record<string, unknown>
      | undefined
    const metadata = value?.metadata as Record<string, unknown> | undefined
    const messages = value?.messages as Record<string, unknown>[] | undefined
    const contacts = value?.contacts as { profile?: { name?: string } }[] | undefined
    const message = messages?.[0]
    const phoneNumberId = metadata?.phone_number_id as string | undefined

    // Status updates (sent/delivered/read) have no `messages` — ignore them.
    if (!message || !phoneNumberId) return null

    const type = message.type as string
    const base = {
      phoneNumberId,
      from: message.from as string,
      messageId: (message.id as string) ?? null,
      type,
      profileName: contacts?.[0]?.profile?.name,
    }

    if (type === 'text') {
      const textObj = message.text as { body?: string } | undefined
      return { ...base, text: textObj?.body ?? '' }
    }
    if (type === 'button') {
      const buttonObj = message.button as { payload?: string; text?: string } | undefined
      return { ...base, text: buttonObj?.payload ?? buttonObj?.text ?? '' }
    }
    if (type === 'interactive') {
      const inter = message.interactive as
        | { button_reply?: { title?: string }; list_reply?: { title?: string } }
        | undefined
      return { ...base, text: inter?.button_reply?.title ?? inter?.list_reply?.title ?? '' }
    }
    if (type === 'reaction') {
      const reaction = message.reaction as { emoji?: string } | undefined
      // An empty emoji means the guest removed a reaction — nothing to answer.
      if (!reaction?.emoji) return null
      return { ...base, text: `[The guest reacted with ${reaction.emoji}]` }
    }
    if (type === 'location') {
      const loc = message.location as
        | { latitude?: number; longitude?: number; name?: string; address?: string }
        | undefined
      const place = [loc?.name, loc?.address].filter(Boolean).join(', ')
      return {
        ...base,
        text: `[The guest shared a location${place ? `: ${place}` : ''} (${loc?.latitude}, ${loc?.longitude})]`,
      }
    }
    if ((MEDIA_KINDS as string[]).includes(type)) {
      const media = message[type] as { id?: string; caption?: string } | undefined
      return {
        ...base,
        text: media?.caption ?? '',
        mediaId: media?.id,
        mediaKind: type as MediaKind,
      }
    }
    // Anything else (contacts cards, unsupported types): acknowledge generically.
    return { ...base, text: `[The guest sent a ${type} message, which can't be displayed here]` }
  }

  // Internal/manual test shape: { phoneNumberId, from, text }
  if (body.phoneNumberId && body.from && body.text) {
    return {
      phoneNumberId: body.phoneNumberId as string,
      from: body.from as string,
      messageId: (body.messageId as string) ?? null,
      type: 'text',
      text: body.text as string,
    }
  }

  return null
}

/**
 * Turns a photo / voice note / other media into text the AI can read and the
 * database can store. Never throws: if anything fails, returns a placeholder
 * so the guest still gets a sensible reply.
 */
async function resolveMediaToText(
  msg: ExtractedMessage,
  credentials: EncryptedPayload,
  deepgramApiKey: string | undefined
): Promise<string> {
  const caption = msg.text ? ` Their caption: "${msg.text}"` : ''
  const kind = msg.mediaKind

  if (!msg.mediaId || !kind) return msg.text

  if (kind === 'image' || kind === 'sticker') {
    try {
      const { buffer, mimeType } = await downloadWhatsAppMedia(msg.mediaId, credentials)
      const description = await describeImage(buffer, mimeType)
      return `[The guest sent a ${kind === 'sticker' ? 'sticker' : 'photo'}. It shows: ${description}]${caption}`
    } catch (err) {
      console.error('[whatsapp-inbound] image resolve failed', err)
      return `[The guest sent a photo that couldn't be viewed.]${caption}`
    }
  }

  if (kind === 'audio') {
    try {
      const { buffer, mimeType } = await downloadWhatsAppMedia(msg.mediaId, credentials)
      const transcript = await transcribeAudio(buffer, mimeType, deepgramApiKey)
      return `[Voice message, transcribed]: ${transcript}`
    } catch (err) {
      console.error('[whatsapp-inbound] audio resolve failed', err)
      return "[The guest sent a voice message that couldn't be transcribed. Politely ask them to type their message instead.]"
    }
  }

  if (kind === 'video') return `[The guest sent a video.]${caption}`
  return `[The guest sent a document.]${caption}`
}

interface ContactDirectoryEntry {
  name: string
  phone: string
  url: string
  button_text: string
  category?: string
}

/**
 * Meta accepts a message first and reports delivery later, in a separate
 * "status" webhook. Failures there (24-hour window closed, recipient not
 * allowed, media unreachable…) are otherwise invisible, so log them.
 */
function logFailedDeliveries(body: Record<string, unknown>) {
  const entries = (body.entry as { changes?: { value?: { statuses?: unknown[] } }[] }[]) ?? []
  for (const entry of entries) {
    for (const change of entry.changes ?? []) {
      for (const raw of change.value?.statuses ?? []) {
        const st = raw as {
          status?: string
          recipient_id?: string
          errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[]
        }
        if (st.status !== 'failed') continue
        const err = st.errors?.[0]
        console.error(
          `[whatsapp-delivery] failed to ${st.recipient_id}: ${err?.code ?? ''} ${err?.title ?? err?.message ?? 'unknown error'}${err?.error_data?.details ? ` — ${err.error_data.details}` : ''}`
        )
      }
    }
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')
  const appSecret = process.env.META_APP_SECRET

  if (!appSecret) {
    return NextResponse.json({ error: 'META_APP_SECRET not configured' }, { status: 500 })
  }
  if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let parsedBody: Record<string, unknown>
  try {
    parsedBody = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ignored: true, reason: 'invalid json' })
  }

  logFailedDeliveries(parsedBody)

  const extracted = extractMessage(parsedBody)
  if (!extracted) {
    return NextResponse.json({ ignored: true })
  }

  // Acknowledge immediately. Any non-200 (or a slow response) makes Meta
  // retry the same message, which would produce duplicate replies.
  after(async () => {
    try {
      await processInbound(extracted)
    } catch (err) {
      console.error('[whatsapp-inbound] processing failed', err)
    }
  })

  return NextResponse.json({ received: true })
}

async function processInbound(msg: ExtractedMessage) {
  const { phoneNumberId, from } = msg
  const supabase = createServiceClient()

  const { data: integration, error: integrationError } = await supabase
    .from('tenant_integrations')
    .select('tenant_id, status, credentials')
    .eq('integration_type', 'whatsapp')
    .eq('config->>phone_number_id', phoneNumberId)
    .maybeSingle()

  if (integrationError) {
    console.error('[whatsapp-inbound] integration lookup failed', integrationError.message)
    return
  }
  if (!integration) {
    console.warn('[whatsapp-inbound] no tenant for phone_number_id', phoneNumberId)
    return
  }
  if (integration.status !== 'connected') {
    console.warn('[whatsapp-inbound] tenant WhatsApp not connected', integration.tenant_id)
    return
  }

  const tenantId = integration.tenant_id as string
  const credentials = integration.credentials as EncryptedPayload

  // Maintenance staff replies (button taps / text) are routed away from the
  // guest pipeline entirely.
  if (!msg.mediaId && msg.text) {
    const maintenanceResult = await processMaintenanceButtonReply(tenantId, from, msg.text)
    if (maintenanceResult.handled) return
  }

  // ---- Guest + conversation -------------------------------------------------

  const { data: guest, error: guestError } = await supabase
    .from('guests')
    .upsert({ tenant_id: tenantId, phone: from }, { onConflict: 'tenant_id,phone' })
    .select()
    .single()

  if (guestError || !guest) {
    console.error('[whatsapp-inbound] guest upsert failed', guestError?.message)
    return
  }

  if (!guest.name && msg.profileName) {
    await supabase.from('guests').update({ name: msg.profileName }).eq('id', guest.id)
  }

  const { data: existingConversation } = await supabase
    .from('conversations')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('guest_id', guest.id)
    .eq('channel', 'whatsapp')
    .neq('status', 'closed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let conversationId = existingConversation?.id as string | undefined

  if (!conversationId) {
    const { data: newConversation, error: conversationError } = await supabase
      .from('conversations')
      .insert({
        tenant_id: tenantId,
        guest_id: guest.id,
        channel: 'whatsapp',
        status: 'active',
        last_message_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (conversationError || !newConversation) {
      console.error('[whatsapp-inbound] conversation create failed', conversationError?.message)
      return
    }
    conversationId = newConversation.id as string
  } else {
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId)
  }

  // ---- Log the guest message (idempotent on Meta's message id) --------------

  let deepgramApiKey: string | undefined
  if (msg.mediaKind === 'audio') {
    const { data: deepgramIntegration } = await supabase
      .from('tenant_integrations')
      .select('status, credentials')
      .eq('tenant_id', tenantId)
      .eq('integration_type', 'transcription_deepgram')
      .maybeSingle()
    if (deepgramIntegration?.status === 'connected' && deepgramIntegration.credentials) {
      try {
        deepgramApiKey = decryptCredentials<{ api_key: string }>(
          deepgramIntegration.credentials as EncryptedPayload
        ).api_key
      } catch (err) {
        console.error('[whatsapp-inbound] could not decrypt Deepgram key', err)
      }
    }
  }

  const content = msg.mediaId
    ? await resolveMediaToText(msg, credentials, deepgramApiKey)
    : msg.text
  if (!content) return

  const { data: guestMessage, error: messageError } = await supabase
    .from('messages')
    .insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      sender_type: 'guest',
      content,
      external_id: msg.messageId,
      media_type: msg.mediaKind ?? null,
    })
    .select('id')
    .single()

  if (messageError) {
    // 23505 = unique violation: Meta re-delivered a message we already have.
    if (messageError.code === '23505') return
    console.error('[whatsapp-inbound] message insert failed', messageError.message)
    return
  }
  if (!guestMessage) return

  // ---- Debounce: only the newest message in a burst triggers a reply --------

  await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS))

  const { data: latestGuestMessage } = await supabase
    .from('messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'guest')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (latestGuestMessage && latestGuestMessage.id !== guestMessage.id) {
    // A newer message arrived during the wait — its own run will reply to all.
    return
  }

  // Re-check takeover after the wait, in case staff took over meanwhile.
  const { data: convoNow } = await supabase
    .from('conversations')
    .select('status')
    .eq('id', conversationId)
    .single()
  if (convoNow?.status === 'human_takeover' || convoNow?.status === 'closed') return

  // ---- Tools & context ------------------------------------------------------

  const { data: tenant } = await supabase
    .from('tenants')
    .select('ai_persona_prompt, knowledge_base, escalation_contacts, booking_config, contact_directory, message_templates')
    .eq('id', tenantId)
    .single()

  const { data: cloudbedsIntegration } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'pms_cloudbeds')
    .maybeSingle()

  const cloudbedsReady = cloudbedsIntegration?.status === 'connected'
  const getCloudbeds = () => {
    const { api_key } = decryptCredentials<{ api_key: string }>(cloudbedsIntegration!.credentials)
    const propertyId = (cloudbedsIntegration!.config as { property_id?: string })?.property_id
    return { api_key, propertyId }
  }

  const reservationTool = cloudbedsReady
    ? {
        lookupReservation: async (confirmationNumber: string) => {
          const { api_key, propertyId } = getCloudbeds()
          if (!propertyId) {
            return { found: false, error: 'No property_id configured for this tenant' }
          }
          return lookupReservation(api_key, propertyId, confirmationNumber)
        },
      }
    : undefined

  const arrivalUpdateTool = cloudbedsReady
    ? {
        updateArrivalTime: async (input: { confirmationNumber: string; arrivalTime: string }) => {
          const { api_key, propertyId } = getCloudbeds()
          if (!propertyId) {
            return { success: false, error: 'No property_id configured for this tenant' }
          }
          return updateArrivalTime(api_key, propertyId, input.confirmationNumber, input.arrivalTime)
        },
      }
    : undefined

  const escalationContacts = parseEscalationContacts(tenant?.escalation_contacts)
  const messageTemplates = tenant?.message_templates
  const escalationTool =
    escalationContacts.length > 0
      ? {
          categories: escalationContacts.map((c) => ({ key: c.key, description: c.description })),
          escalateToStaff: async (input: {
            category: string
            roomNumber?: string
            summary: string
            urgency?: string
          }) => {
            const contact = findEscalationContact(escalationContacts, input.category)
            if (!contact) {
              return { success: false, error: `No ${input.category} contact configured` }
            }
            return notifyStaff(
              phoneNumberId,
              credentials,
              contact.phone,
              from,
              input,
              messageTemplates,
              guestName
            )
          },
        }
      : undefined

  const waitlistTool = {
    joinWaitlist: async (input: {
      fullName: string
      email: string
      phone: string
      dateRequested: string
      notes?: string
    }) => {
      const { error: insertError } = await supabase.from('waitlist_entries').insert({
        tenant_id: tenantId,
        guest_id: guest.id,
        full_name: input.fullName,
        email: input.email,
        phone: input.phone,
        date_requested: input.dateRequested,
        notes: input.notes ?? null,
      })

      if (insertError) {
        return { success: false, error: insertError.message }
      }

      const reservationsContact = findEscalationContact(escalationContacts, 'reservations')
      if (reservationsContact) {
        await notifyStaff(
          phoneNumberId,
          credentials,
          reservationsContact.phone,
          from,
          {
            category: 'reservations',
            summary: `Waitlist request: ${input.fullName}, wants ${input.dateRequested}. Contact: ${input.email} / ${input.phone}${input.notes ? `. Notes: ${input.notes}` : ''}`,
          },
          messageTemplates,
          input.fullName
        )
      }

      return { success: true }
    },
  }

  const registerReservationTool = {
    registerReservation: async (confirmationNumber: string) => {
      const { error: upsertError } = await supabase
        .from('guest_reservations')
        .upsert(
          { tenant_id: tenantId, guest_id: guest.id, confirmation_number: confirmationNumber },
          { onConflict: 'tenant_id,guest_id' }
        )
      if (upsertError) {
        return { success: false, error: upsertError.message }
      }
      return { success: true }
    },
  }

  const roomPhotosTool = cloudbedsReady
    ? (() => {
        const { api_key, propertyId } = getCloudbeds()
        return propertyId ? buildRoomPhotosTool(api_key, propertyId) : undefined
      })()
    : undefined

  const contactDirectory = (tenant?.contact_directory as ContactDirectoryEntry[]) ?? []
  const contactButtonTool = contactDirectory.length > 0 ? { enabled: true as const } : undefined

  const contactDirectoryContext =
    contactDirectory.length > 0
      ? `AVAILABLE CONTACTS\n\nThese are real, pre-approved contacts you can recommend and share via the send_contact_button tool. Use their exact name, phone, url, and buttonText values when calling that tool — do not alter them.\n\n${contactDirectory
          .map(
            (c) =>
              `- ${c.name}${c.category ? ` (${c.category})` : ''}: phone="${c.phone}", url="${c.url}", buttonText="${c.button_text}"`
          )
          .join('\n')}\n\n`
      : ''

  let knownGuestContext = ''
  if (cloudbedsReady) {
    const { data: savedReservation } = await supabase
      .from('guest_reservations')
      .select('confirmation_number')
      .eq('tenant_id', tenantId)
      .eq('guest_id', guest.id)
      .maybeSingle()

    if (savedReservation) {
      try {
        const { api_key, propertyId } = getCloudbeds()
        if (propertyId) {
          const liveLookup = (await lookupReservation(
            api_key,
            propertyId,
            savedReservation.confirmation_number
          )) as { found?: boolean; [key: string]: unknown }
          if (liveLookup?.found) {
            knownGuestContext = `KNOWN GUEST CONTEXT\n\nThis guest's identity and active reservation have already been confirmed. Their reservation details:\n${JSON.stringify(liveLookup)}\n\nDo not ask them for their name or confirmation number again unless they explicitly want to look up or update a different reservation. Use these details directly.\n\n`
          }
        }
      } catch {
        // Best-effort only — if the live check fails, treat the guest as
        // unidentified rather than trust stale data.
      }
    }
  }

  const guestName = (guest.name as string | null) ?? msg.profileName
  const guestNameContext = guestName
    ? `The guest's WhatsApp display name is "${guestName}". This is only a display name — don't treat it as confirming their identity or reservation.\n\n`
    : ''

  const channelInstruction = `\n\nCHANNEL: You are replying on WhatsApp. Keep replies short and conversational. For emphasis use single asterisks (*like this*), never double asterisks, headings, tables or Markdown links — paste URLs as plain text. If several guest messages arrive in a row, answer them together in one reply. Messages in square brackets describe a photo, voice note or other attachment the guest sent.\n\nNO REPLY: If the guest's latest message(s) only close the conversation — a thank-you, "ok", "perfecto", "listo", a farewell, or just an emoji/reaction — with no new question or request, reply with exactly ${NO_REPLY_TOKEN} and nothing else. The guest will then receive no message, which is what we want. Never answer a thank-you with "you're welcome" or another farewell.`

  // ---- History (most recent HISTORY_LIMIT messages) --------------------------

  const { data: recent } = await supabase
    .from('messages')
    .select('sender_type, content')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['guest', 'lana'])
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  const chronological = (recent ?? []).reverse()
  // The AI API requires the conversation to start with a guest turn.
  while (chronological.length > 0 && chronological[0].sender_type !== 'guest') {
    chronological.shift()
  }

  const claudeMessages = chronological.map((m) => ({
    role: m.sender_type === 'guest' ? ('user' as const) : ('assistant' as const),
    content: m.content as string,
  }))

  const systemPrompt =
    knownGuestContext +
    contactDirectoryContext +
    guestNameContext +
    (tenant?.ai_persona_prompt ??
      'You are a helpful, warm hotel concierge assistant. Answer guest questions clearly and concisely.') +
    buildKnowledgeBaseSection(tenant?.knowledge_base as string | null) +
    buildBookingLinkInstruction(tenant?.booking_config as Record<string, unknown>) +
    channelInstruction

  // ---- Generate + send --------------------------------------------------------

  let replyText: string
  let noReply = false
  let photoUrls: string[] = []
  let contactButton:
    | { contactName: string; contactPhone: string; contactUrl: string; buttonText: string }
    | null
    | undefined
  try {
    const result = await generateReply(
      systemPrompt,
      claudeMessages,
      reservationTool,
      escalationTool,
      arrivalUpdateTool,
      waitlistTool,
      registerReservationTool,
      contactButtonTool,
      roomPhotosTool
    )
    replyText = result.text
    noReply = Boolean(result.noReply)
    photoUrls = result.photoUrls ?? []
    contactButton = result.contactButton
  } catch (err) {
    console.error('[whatsapp-inbound] AI generation failed', err)
    const fallbackText =
      "Sorry, I'm having trouble responding right now — a member of our team will follow up with you shortly."

    await supabase.from('messages').insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      sender_type: 'lana',
      content: fallbackText,
    })
    await sendWhatsAppMessage(phoneNumberId, credentials, from, fallbackText)
    return
  }

  const photoNote = photoUrls.length
    ? `[Sent ${photoUrls.length} room photo${photoUrls.length === 1 ? '' : 's'}]`
    : ''
  if (!noReply || photoNote) {
    await supabase.from('messages').insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      sender_type: 'lana',
      content: [noReply ? '' : replyText, photoNote].filter(Boolean).join('\n'),
    })
  }

  if (!noReply) {

    const sendResult = contactButton
      ? await sendWhatsAppInteractiveButton(
          phoneNumberId,
          credentials,
          from,
          replyText,
          contactButton.contactUrl,
          contactButton.buttonText
        )
      : await sendWhatsAppMessage(phoneNumberId, credentials, from, replyText)

    if (!sendResult.success) {
      console.error('[whatsapp-inbound] send failed', sendResult.error)
    }
  }

  // Room photos go out one by one, after the text.
  for (const url of photoUrls) {
    const res = await sendWhatsAppImage(phoneNumberId, credentials, from, url)
    if (!res.success) console.error('[whatsapp-inbound] photo send failed', res.error)
  }
}
