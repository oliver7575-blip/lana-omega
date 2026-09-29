interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: unknown
}

interface ReservationTool {
  lookupReservation: (confirmationNumber: string) => Promise<unknown>
}

interface EscalationToolInput {
  category: string
  roomNumber?: string
  summary: string
}

interface EscalationTool {
  escalateToStaff: (input: EscalationToolInput) => Promise<unknown>
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
  contactButtonTool?: ContactButtonTool
): Promise<GenerateReplyResult> {
  const tools: Record<string, unknown>[] = []

  if (reservationTool) {
    tools.push({
      name: 'lookup_reservation',
      description:
        "Look up a guest's hotel reservation by their confirmation number via the property management system. Use this whenever a guest provides a confirmation number and asks about their reservation, dates, or room.",
      input_schema: {
        type: 'object',
        properties: {
          confirmationNumber: {
            type: 'string',
            description: "The guest's reservation confirmation number",
          },
        },
        required: ['confirmationNumber'],
      },
    })
  }

  if (escalationTool) {
    tools.push({
      name: 'escalate_to_staff',
      description:
        'Send a real, immediate notification directly to hotel staff about a guest issue that needs their attention (a maintenance problem, a cleaning request, or a billing question). This actually sends a message, so only call it once you have a clear picture of the issue — ask for the room number first if the problem is room-specific and you do not already have it.',
      input_schema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['maintenance', 'cleaning', 'billing'],
            description: 'Which staff team this should go to',
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

  const messages: ClaudeMessage[] = [...conversationHistory]
  let contactButtonResult: GenerateReplyResult['contactButton'] = null

  for (let i = 0; i < 4; i++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: systemPrompt,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Anthropic API error: ${response.status} ${errText}`)
    }

    const data = await response.json()

    if (data.stop_reason === 'tool_use') {
      const toolUseBlock = data.content.find((b: { type: string }) => b.type === 'tool_use') as
        | { type: string; id: string; name: string; input: Record<string, unknown> }
        | undefined

      messages.push({ role: 'assistant', content: data.content })

      if (toolUseBlock?.name === 'lookup_reservation' && reservationTool) {
        const result = await reservationTool.lookupReservation(
          toolUseBlock.input.confirmationNumber as string
        )
        messages.push({
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: toolUseBlock.id, content: JSON.stringify(result) },
          ],
        })
        continue
      }

      if (toolUseBlock?.name === 'escalate_to_staff' && escalationTool) {
        const result = await escalationTool.escalateToStaff(
          toolUseBlock.input as unknown as EscalationToolInput
        )
        messages.push({
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: toolUseBlock.id, content: JSON.stringify(result) },
          ],
        })
        continue
      }

      if (toolUseBlock?.name === 'update_arrival_time' && arrivalUpdateTool) {
        const result = await arrivalUpdateTool.updateArrivalTime(
          toolUseBlock.input as unknown as ArrivalUpdateToolInput
        )
        messages.push({
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: toolUseBlock.id, content: JSON.stringify(result) },
          ],
        })
        continue
      }

      if (toolUseBlock?.name === 'join_waitlist' && waitlistTool) {
        const result = await waitlistTool.joinWaitlist(
          toolUseBlock.input as unknown as WaitlistToolInput
        )
        messages.push({
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: toolUseBlock.id, content: JSON.stringify(result) },
          ],
        })
        continue
      }

      if (toolUseBlock?.name === 'register_reservation' && registerReservationTool) {
        const result = await registerReservationTool.registerReservation(
          toolUseBlock.input.confirmationNumber as string
        )
        messages.push({
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: toolUseBlock.id, content: JSON.stringify(result) },
          ],
        })
        continue
      }

      if (toolUseBlock?.name === 'send_contact_button' && contactButtonTool) {
        const input = toolUseBlock.input as unknown as ContactButtonToolInput
        contactButtonResult = input
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUseBlock.id,
              content: JSON.stringify({ success: true }),
            },
          ],
        })
        continue
      }
    }

    const textBlock = data.content?.find((b: { type: string }) => b.type === 'text') as
      | { type: string; text: string }
      | undefined
    return { text: textBlock?.text ?? '', contactButton: contactButtonResult }
  }

  return {
    text: "I'm having trouble handling that right now — a staff member will follow up shortly.",
    contactButton: contactButtonResult,
  }
}
