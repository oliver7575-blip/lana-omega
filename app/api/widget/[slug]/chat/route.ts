import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { generateReply } from '@/lib/anthropic'
import { decryptCredentials } from '@/lib/crypto'
import { lookupReservation, updateArrivalTime } from '@/lib/cloudbeds'
import { notifyStaff } from '@/lib/escalation'
import { parseEscalationContacts, findEscalationContact } from '@/lib/escalation-contacts'
import { buildRoomPhotosTool } from '@/lib/room-photos'
import { buildBookingLinkInstruction } from '@/lib/booking-link'
import { buildKnowledgeBaseSection } from '@/lib/knowledge-base'

const RATE_LIMIT_WINDOW_MINUTES = 10
const RATE_LIMIT_MAX_MESSAGES = 15

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { searchParams } = new URL(request.url)
  const visitorId = searchParams.get('visitorId')

  if (!visitorId) {
    return NextResponse.json(
      { error: 'visitorId is required' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const supabase = createServiceClient()

  const { data: tenant } = await supabase.from('tenants').select('id').eq('slug', slug).maybeSingle()
  if (!tenant) {
    return NextResponse.json({ error: 'Hotel not found' }, { status: 404, headers: CORS_HEADERS })
  }

  const syntheticPhone = `web:${visitorId}`

  const { data: guest } = await supabase
    .from('guests')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('phone', syntheticPhone)
    .maybeSingle()

  if (!guest) {
    return NextResponse.json({ conversationId: null, messages: [] }, { headers: CORS_HEADERS })
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('guest_id', guest.id)
    .eq('channel', 'widget')
    .neq('status', 'closed')
    .maybeSingle()

  if (!conversation) {
    return NextResponse.json({ conversationId: null, messages: [] }, { headers: CORS_HEADERS })
  }

  const { data: messages } = await supabase
    .from('messages')
    .select('sender_type, content, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true })

  return NextResponse.json(
    { conversationId: conversation.id, messages: messages ?? [] },
    { headers: CORS_HEADERS }
  )
}

interface WidgetChatRequest {
  visitorId: string
  message: string
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const body = (await request.json()) as Partial<WidgetChatRequest>
  const { visitorId, message } = body

  if (!visitorId || !message) {
    return NextResponse.json(
      { error: 'visitorId and message are required' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  if (message.length > 2000) {
    return NextResponse.json(
      { error: 'Message is too long' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  const supabase = createServiceClient()

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, ai_persona_prompt, knowledge_base, status, escalation_contacts, booking_config, message_templates')
    .eq('slug', slug)
    .maybeSingle()

  if (tenantError || !tenant) {
    return NextResponse.json({ error: 'Hotel not found' }, { status: 404, headers: CORS_HEADERS })
  }

  const tenantId = tenant.id
  const syntheticPhone = `web:${visitorId}`

  const { data: existingGuestForLimit } = await supabase
    .from('guests')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone', syntheticPhone)
    .maybeSingle()

  if (existingGuestForLimit) {
    const windowStart = new Date(
      Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000
    ).toISOString()

    const { data: recentConversations } = await supabase
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('guest_id', existingGuestForLimit.id)
      .eq('channel', 'widget')

    const conversationIds = (recentConversations ?? []).map((c) => c.id)

    if (conversationIds.length > 0) {
      const { count } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', conversationIds)
        .eq('sender_type', 'guest')
        .gte('created_at', windowStart)

      if ((count ?? 0) >= RATE_LIMIT_MAX_MESSAGES) {
        return NextResponse.json(
          { error: "You're sending messages too quickly — please wait a few minutes and try again." },
          { status: 429, headers: CORS_HEADERS }
        )
      }
    }
  }

  const { data: guest, error: guestError } = await supabase
    .from('guests')
    .upsert({ tenant_id: tenantId, phone: syntheticPhone }, { onConflict: 'tenant_id,phone' })
    .select()
    .single()

  if (guestError || !guest) {
    return NextResponse.json(
      { error: `Failed to upsert guest: ${guestError?.message}` },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  const { data: cloudbedsIntegration } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'pms_cloudbeds')
    .maybeSingle()

  const reservationTool =
    cloudbedsIntegration?.status === 'connected'
      ? {
          lookupReservation: async (confirmationNumber: string) => {
            const { api_key } = decryptCredentials<{ api_key: string }>(
              cloudbedsIntegration.credentials
            )
            const propertyId = (cloudbedsIntegration.config as { property_id?: string })
              ?.property_id
            if (!propertyId) {
              return { found: false, error: 'No property_id configured for this tenant' }
            }
            return lookupReservation(api_key, propertyId, confirmationNumber)
          },
        }
      : undefined

  const arrivalUpdateTool =
    cloudbedsIntegration?.status === 'connected'
      ? {
          updateArrivalTime: async (input: { confirmationNumber: string; arrivalTime: string }) => {
            const { api_key } = decryptCredentials<{ api_key: string }>(
              cloudbedsIntegration.credentials
            )
            const propertyId = (cloudbedsIntegration.config as { property_id?: string })
              ?.property_id
            if (!propertyId) {
              return { success: false, error: 'No property_id configured for this tenant' }
            }
            return updateArrivalTime(api_key, propertyId, input.confirmationNumber, input.arrivalTime)
          },
        }
      : undefined

  // A widget guest has no WhatsApp of their own — staff escalation and
  // waitlist notifications still need to reach staff over WhatsApp, so the
  // tenant's own connection is fetched here purely for that purpose.
  const { data: whatsappForEscalation } = await supabase
    .from('tenant_integrations')
    .select('status, credentials, config')
    .eq('tenant_id', tenantId)
    .eq('integration_type', 'whatsapp')
    .maybeSingle()

  const escalationContacts = parseEscalationContacts(tenant.escalation_contacts)
  const escalationTool =
    escalationContacts.length > 0 && whatsappForEscalation?.status === 'connected'
      ? {
          categories: escalationContacts.map((c) => ({ key: c.key, description: c.description })),
          escalateToStaff: async (input: {
            category: string
            roomNumber?: string
            summary: string
            urgency?: string
          }) => {
            const staffNumber = findEscalationContact(escalationContacts, input.category)?.phone
            if (!staffNumber) {
              return { success: false, error: `No ${input.category} contact configured` }
            }
            const phoneNumberId = (whatsappForEscalation.config as { phone_number_id?: string })
              ?.phone_number_id
            if (!phoneNumberId) {
              return { success: false, error: 'No phone_number_id configured for WhatsApp' }
            }
            return notifyStaff(
              phoneNumberId,
              whatsappForEscalation.credentials,
              staffNumber,
              'website chat',
              input,
              tenant.message_templates
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

      // Notification is best-effort — the entry above is saved regardless.
      const reservationsContact = findEscalationContact(escalationContacts, 'reservations')?.phone
      if (reservationsContact && whatsappForEscalation?.status === 'connected') {
        const phoneNumberId = (whatsappForEscalation.config as { phone_number_id?: string })
          ?.phone_number_id
        if (phoneNumberId) {
          await notifyStaff(
            phoneNumberId,
            whatsappForEscalation.credentials,
            reservationsContact,
            input.phone,
            {
              category: 'reservations',
              summary: `Waitlist request (website chat): ${input.fullName}, wants ${input.dateRequested}. Contact: ${input.email} / ${input.phone}${input.notes ? `. Notes: ${input.notes}` : ''}`,
            },
            tenant.message_templates,
            input.fullName
          )
        }
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

  let knownGuestContext = ''
  if (cloudbedsIntegration?.status === 'connected') {
    const { data: savedReservation } = await supabase
      .from('guest_reservations')
      .select('confirmation_number')
      .eq('tenant_id', tenantId)
      .eq('guest_id', guest.id)
      .maybeSingle()

    if (savedReservation) {
      try {
        const { api_key } = decryptCredentials<{ api_key: string }>(
          cloudbedsIntegration.credentials
        )
        const propertyId = (cloudbedsIntegration.config as { property_id?: string })?.property_id
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
        // Best-effort only — treat as unidentified if the live check fails.
      }
    }
  }

  const { data: existingConversation } = await supabase
    .from('conversations')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('guest_id', guest.id)
    .eq('channel', 'widget')
    .neq('status', 'closed')
    .maybeSingle()

  let conversationId = existingConversation?.id
  let conversationStatus = existingConversation?.status

  if (!conversationId) {
    const { data: newConversation, error: conversationError } = await supabase
      .from('conversations')
      .insert({
        tenant_id: tenantId,
        guest_id: guest.id,
        channel: 'widget',
        status: 'active',
        last_message_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (conversationError || !newConversation) {
      return NextResponse.json(
        { error: `Failed to create conversation: ${conversationError?.message}` },
        { status: 500, headers: CORS_HEADERS }
      )
    }
    conversationId = newConversation.id
    conversationStatus = newConversation.status
  } else {
    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId)
  }

  const { data: guestMessage, error: messageError } = await supabase
    .from('messages')
    .insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      sender_type: 'guest',
      content: message,
    })
    .select()
    .single()

  if (messageError || !guestMessage) {
    return NextResponse.json(
      { error: `Failed to log message: ${messageError?.message}` },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  if (conversationStatus === 'human_takeover') {
    return NextResponse.json(
      {
        conversationId,
        reply: "A member of our team is handling your conversation directly and will reply shortly.",
        humanTakeover: true,
      },
      { headers: CORS_HEADERS }
    )
  }

  const { data: history } = await supabase
    .from('messages')
    .select('sender_type, content')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['guest', 'lana'])
    .order('created_at', { ascending: true })

  const claudeMessages = (history ?? []).map((m) => ({
    role: m.sender_type === 'guest' ? ('user' as const) : ('assistant' as const),
    content: m.content,
  }))

  const systemPrompt =
    knownGuestContext +
    (tenant.ai_persona_prompt ??
      'You are a helpful, warm hotel concierge assistant. Answer guest questions clearly and concisely.') +
    buildKnowledgeBaseSection(tenant.knowledge_base as string | null) +
    buildBookingLinkInstruction(tenant.booking_config as Record<string, unknown>)

  let roomPhotosTool: ReturnType<typeof buildRoomPhotosTool> | undefined
  if (cloudbedsIntegration?.status === 'connected') {
    const { api_key } = decryptCredentials<{ api_key: string }>(cloudbedsIntegration.credentials)
    const propertyId = (cloudbedsIntegration.config as { property_id?: string })?.property_id
    if (propertyId) roomPhotosTool = buildRoomPhotosTool(api_key, propertyId)
  }

  let replyText: string
  try {
    const result = await generateReply(
      systemPrompt,
      claudeMessages,
      reservationTool,
      escalationTool,
      arrivalUpdateTool,
      waitlistTool,
      registerReservationTool,
      undefined,
      roomPhotosTool
    )
    // The widget shows plain text, so room photos go out as links.
    const photoLinks = (result.photoUrls ?? []).join('\n')
    replyText = [result.text || (photoLinks ? '' : '😊'), photoLinks].filter(Boolean).join('\n\n')
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'AI generation failed' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  await supabase.from('messages').insert({
    tenant_id: tenantId,
    conversation_id: conversationId,
    sender_type: 'lana',
    content: replyText,
  })

  return NextResponse.json({ conversationId, reply: replyText }, { headers: CORS_HEADERS })
}
