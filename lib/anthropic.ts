import type { ReviewTool, ReviewToolInput } from './reviews'
/** The model behind every guest-facing reply. */
export const CONCIERGE_MODEL = 'claude-sonnet-5'

/** Returned by the model when a guest message needs no answer (e.g. "gracias"). */
export const NO_REPLY_TOKEN = '[NO_REPLY]'

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: unknown
}

interface ReservationTool {
  /** No confirmation number = find the guest's reservation from their phone (WhatsApp only). */
  lookupReservation: (confirmationNumber?: string) => Promise<unknown>
}

interface EscalationToolInput {
  category: string
  roomNumber?: string
  summary: string
  urgency?: 'low' | 'normal' | 'urgent'
}

interface EscalationTool {
  /** Which staff categories exist for this hotel and when to use each. */
  categories: { key: string; description?: string }[]
  escalateToStaff: (input: EscalationToolInput) => Promise<unknown>
}

export interface RoomPhotosResult {
  found: boolean
  roomTypeName?: string
  photoCount?: number
  availableRoomTypes?: string[]
  error?: string
  /** Photo URLs — handed back to the caller to send, never shown to the model. */
  photoUrls?: string[]
}

interface RoomPhotosTool {
  getRoomPhotos: (roomType: string) => Promise<RoomPhotosResult>
}

interface ArrivalUpdateToolInput {
  confirmationNumber: string
  arrivalTime: string
}

interface ArrivalUpdateTool {
  updateArrivalTime: (input: ArrivalUpdateToolInput) => Promise<unknown>
}

interface WaitlistToolInput {
  fullName: string
  email: string
  phone: string
  dateRequested: string
  notes?: string
}

interface WaitlistTool {
  joinWaitlist: (input: WaitlistToolInput) => Promise<unknown>
}

interface RegisterReservationTool {
  registerReservation: (confirmationNumber: string) => Promise<unknown>
}

interface ContactButtonToolInput {
  contactName: string
  contactPhone: string
  contactUrl: string
  buttonText: string
}

interface ContactButtonTool {
  // Present only so callers can opt this capability in/out the same way as
  // the other tools. It performs no side effect itself — sending the real
  // WhatsApp interactive button requires the channel credentials, which
  // only the calling route has, so generateReply just captures Claude's
  // intent and hands it back to the caller to actually send.
  enabled: true
}

export interface GenerateReplyResult {
  text: string
  /** True when the model decided the guest's message needs no answer. */
  noReply?: boolean
  /** Room photos the caller should send after the text. */
  photoUrls?: string[]
  contactButton?: {
    contactName: string
    contactPhone: string
    contactUrl: string
    buttonText: string
  } | null
}

export async function generateReply(
  systemPrompt: string,
  conversationHistory: ClaudeMessage[],
  reservationTool?: ReservationTool,
  escalationTool?: EscalationTool,
  arrivalUpdateTool?: ArrivalUpdateTool,
  waitlistTool?: WaitlistTool,
  registerReservationTool?: RegisterReservationTool,
  contactButtonTool?: ContactButtonTool,
  roomPhotosTool?: RoomPhotosTool,
  reviewTool?: ReviewTool
): Promise<GenerateReplyResult> {
  const tools: Record<string, unknown>[] = []

  if (reviewTool) {
    tools.push({
      name: 'record_review',
      description:
        "Save a guest's feedback about their stay to the hotel's Reviews list. Call it when the guest gives real feedback or a rating about Soirée — praise, a complaint about the room or service, suggestions, or how they rated their stay (e.g. 'loved the pool, staff were great', 'the AC was noisy all night', '10/10'). Do NOT call it for questions, small talk, plain thanks ('gracias'), or problems that need fixing right now (escalate those). Call it once per piece of feedback, in addition to replying normally. Never mention to the guest that you saved it.",
      input_schema: {
        type: 'object',
        properties: {
          reviewText: { type: 'string', description: "The guest's feedback in their own words (quote it)" },
          sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
          rating: { type: 'number', description: 'Only if the guest gave a number rating' },
          ratingScale: { type: 'number', description: 'The maximum of that rating, e.g. 5 or 10' },
          summary: { type: 'string', description: 'One short sentence in English summarising the feedback' },
        },
        required: ['reviewText', 'sentiment'],
      },
    })
  }

  if (reservationTool) {
    tools.push({
      name: 'lookup_reservation',
      description:
        "Look up a guest's reservation in the property management system: dates, room, balance, payment status. Pass the confirmation number if the guest gave one (exactly as given — never question its format). If the guest asks about \"my reservation\" without a number, call this WITHOUT confirmationNumber: on WhatsApp the system finds their reservation from their phone number. Only ask for the confirmation number if that returns found: false.",
      input_schema: {
        type: 'object',
        properties: {
          confirmationNumber: {
            type: 'string',
            description: "The guest's reservation confirmation number",
          },
        },
        required: [],
      },
    })
  }

  if (escalationTool && escalationTool.categories.length > 0) {
    const categoryGuide = escalationTool.categories
      .map((c) => `- ${c.key}${c.description ? `: ${c.description}` : ''}`)
      .join('\n')
    tools.push({
      name: 'escalate_to_staff',
      description:
        'Send a real, immediate notification directly to hotel staff about something that needs a person. This actually sends a message, so only call it once you have a clear picture of the issue — ask for the room number first if the problem is room-specific and you do not already have it. Call it once per issue, then tell the guest the team has been notified. NEVER tell a guest that staff, Oliver, Lucia or anyone else has been notified or will contact them unless you called this tool in your current reply and it returned success: true. If the guest repeats a request that was escalated earlier in the conversation, call it again. If it returns an error, apologise and tell the guest to write to the hotel instead.\n\nCategories:\n' +
        categoryGuide,
      input_schema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: escalationTool.categories.map((c) => c.key),
            description: 'Which staff contact this should go to (see the category list)',
          },
          urgency: {
            type: 'string',
            enum: ['low', 'normal', 'urgent'],
            description: 'How urgent this is. Use urgent only for safety issues, flooding, no power in the room, lockouts and similar.',
          },
          roomNumber: {
            type: 'string',
            description: "The guest's room number, if relevant and known",
          },
          summary: {
            type: 'string',
            description: 'A short, clear summary of the issue for staff to act on',
          },
        },
        required: ['category', 'summary'],
      },
    })
  }

  if (arrivalUpdateTool) {
    tools.push({
      name: 'update_arrival_time',
      description:
        "Update a guest's estimated arrival time on their EXISTING reservation via the property management system. Use this when a guest with a confirmation number tells you what time they expect to arrive. This is a real write to their reservation, not just a note — only call it once you have both a confirmation number and a specific time. If the tool result's error mentions the reservation system itself (unreachable, an API problem, etc.), that is NOT the guest's fault — apologize and say the system is temporarily unavailable, do not ask them to double-check their confirmation number. Only ask the guest to double-check the number if the error says no matching reservation was found.",
      input_schema: {
        type: 'object',
        properties: {
          confirmationNumber: {
            type: 'string',
            description: "The guest's reservation confirmation number",
          },
          arrivalTime: {
            type: 'string',
            description: 'The estimated arrival time in 24-hour HH:MM format, e.g. 15:30',
          },
        },
        required: ['confirmationNumber', 'arrivalTime'],
      },
    })
  }

  if (waitlistTool) {
    tools.push({
      name: 'join_waitlist',
      description:
        "Add a guest to the waitlist — for dates that are fully booked, or any case where the guest wants to be contacted if something opens up. This is a real, permanent record staff will follow up on, so do NOT call it until you have collected ALL of: the guest's full name, their email, AND their phone number, in addition to the dates they want. If any of those three are still missing, ask for them first — do not guess or leave them blank.",
      input_schema: {
        type: 'object',
        properties: {
          fullName: { type: 'string', description: "The guest's full name" },
          email: { type: 'string', description: "The guest's email address" },
          phone: { type: 'string', description: "The guest's phone number" },
          dateRequested: {
            type: 'string',
            description: 'The dates or date range the guest wants, as they described it',
          },
          notes: {
            type: 'string',
            description: 'Any other relevant detail the guest mentioned, optional',
          },
        },
        required: ['fullName', 'email', 'phone', 'dateRequested'],
      },
    })
  }

  if (registerReservationTool) {
    tools.push({
      name: 'register_reservation',
      description:
        "Save a confirmed reservation to this guest's profile so they're automatically recognized next time they message, without needing to give their confirmation number again. Only call this after the guest has EXPLICITLY confirmed a specific reservation belongs to them (e.g. they said \"yes\" after you asked whether a reservation you found belongs to them). Never call this speculatively or before that explicit confirmation.",
      input_schema: {
        type: 'object',
        properties: {
          confirmationNumber: {
            type: 'string',
            description: 'The confirmation number of the reservation the guest just confirmed is theirs',
          },
        },
        required: ['confirmationNumber'],
      },
    })
  }

  if (contactButtonTool) {
    tools.push({
      name: 'send_contact_button',
      description:
        "Signal that the guest should be shown a native WhatsApp button linking directly to a specific contact's WhatsApp chat, instead of writing out a raw link. Use this when recommending or sharing contact details for a tour guide, taxi driver, or delivery service that has a real WhatsApp contact available. After calling this, still write a short, warm conversational reply mentioning who the contact is and their phone number — the button itself is added separately by the system, so do not include the raw WhatsApp URL in your reply text.",
      input_schema: {
        type: 'object',
        properties: {
          contactName: { type: 'string', description: "The contact's name" },
          contactPhone: {
            type: 'string',
            description: "The contact's phone number in display format, e.g. +52 958 128 5454",
          },
          contactUrl: {
            type: 'string',
            description: "The contact's wa.me WhatsApp link",
          },
          buttonText: {
            type: 'string',
            description: 'Short button label, e.g. "WhatsApp Kevin"',
          },
        },
        required: ['contactName', 'contactPhone', 'contactUrl', 'buttonText'],
      },
    })
  }

  if (roomPhotosTool) {
    tools.push({
      name: 'send_room_photos',
      description:
        "Send the guest real photos of one room type. Use this when a guest asks to see photos or pictures of a room or unit. The photos are sent automatically after your reply — just write a short, warm line introducing them and do not paste any image links. If the result says the room type wasn't found, tell the guest which room types exist (from availableRoomTypes) and ask which one they'd like to see.",
      input_schema: {
        type: 'object',
        properties: {
          roomType: {
            type: 'string',
            description: 'The room type the guest wants to see, as they described it (e.g. "rooftop", "king bedroom")',
          },
        },
        required: ['roomType'],
      },
    })
  }

  // Anthropic-hosted web search, for genuinely current info (weather, closures).
  // Turned off automatically for the rest of this reply if the API rejects it.
  let useWebSearch = process.env.DISABLE_WEB_SEARCH !== 'true'

  const messages: ClaudeMessage[] = [...conversationHistory]
  let contactButtonResult: GenerateReplyResult['contactButton'] = null
  let photoUrls: string[] = []

  for (let i = 0; i < 6; i++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CONCIERGE_MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        messages,
        ...(tools.length > 0 || useWebSearch
          ? {
              tools: [
                ...tools,
                ...(useWebSearch ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }] : []),
              ],
            }
          : {}),
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      if (useWebSearch && response.status === 400 && /web_search/i.test(errText)) {
        console.error('[concierge] web search unavailable, continuing without it', errText.slice(0, 200))
        useWebSearch = false
        i--
        continue
      }
      throw new Error(`Anthropic API error: ${response.status} ${errText}`)
    }

    const data = await response.json()

    // A long server-side web search can pause the turn; hand it back to continue.
    if (data.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: data.content })
      continue
    }

    if (data.stop_reason === 'tool_use') {
      const toolUseBlocks = (data.content as { type: string }[]).filter(
        (b) => b.type === 'tool_use'
      ) as { type: string; id: string; name: string; input: Record<string, unknown> }[]

      messages.push({ role: 'assistant', content: data.content })

      // Sonnet may call several tools in one turn — every call needs a result.
      const results: { type: 'tool_result'; tool_use_id: string; content: string }[] = []
      for (const block of toolUseBlocks) {
        let result: unknown = { success: false, error: `Tool ${block.name} is not available` }

        if (block.name === 'lookup_reservation' && reservationTool) {
          const num = String(block.input.confirmationNumber ?? '').trim()
          result = await reservationTool.lookupReservation(num || undefined)
        } else if (block.name === 'escalate_to_staff' && escalationTool) {
          result = await escalationTool.escalateToStaff(block.input as unknown as EscalationToolInput)
        } else if (block.name === 'update_arrival_time' && arrivalUpdateTool) {
          result = await arrivalUpdateTool.updateArrivalTime(
            block.input as unknown as ArrivalUpdateToolInput
          )
        } else if (block.name === 'join_waitlist' && waitlistTool) {
          result = await waitlistTool.joinWaitlist(block.input as unknown as WaitlistToolInput)
        } else if (block.name === 'register_reservation' && registerReservationTool) {
          result = await registerReservationTool.registerReservation(
            block.input.confirmationNumber as string
          )
        } else if (block.name === 'send_room_photos' && roomPhotosTool) {
          const photos = await roomPhotosTool.getRoomPhotos(block.input.roomType as string)
          if (photos.found && photos.photoUrls?.length) photoUrls = photos.photoUrls
          // The model only needs to know how many photos go out, not the URLs.
          const { photoUrls: _omit, ...forModel } = photos
          void _omit
          result = forModel
        } else if (block.name === 'record_review' && reviewTool) {
          result = await reviewTool.recordReview(block.input as unknown as ReviewToolInput)
        } else if (block.name === 'send_contact_button' && contactButtonTool) {
          contactButtonResult = block.input as unknown as ContactButtonToolInput
          result = { success: true }
        }

        const ok = (result as { success?: boolean; found?: boolean } | null) ?? {}
        console.log(
          `[concierge-tool] ${block.name} ${JSON.stringify(block.input).slice(0, 300)} → ${
            ok.success === false || ok.found === false ? 'FAILED ' : 'ok '
          }${JSON.stringify(result).slice(0, 300)}`
        )
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) })
      }

      messages.push({ role: 'user', content: results })
      continue
    }

    const text = ((data.content ?? []) as { type: string; text?: string }[])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim()
    if (!text || text.includes(NO_REPLY_TOKEN)) {
      // Nothing to say (e.g. the guest just wrote "gracias"). Photos still go out.
      return { text: '', noReply: true, contactButton: null, photoUrls }
    }
    return { text, contactButton: contactButtonResult, photoUrls }
  }

  return {
    text: "I'm having trouble handling that right now — a staff member will follow up shortly.",
    contactButton: contactButtonResult,
    photoUrls,
  }
}
