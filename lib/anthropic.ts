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

export async function generateReply(
  systemPrompt: string,
  conversationHistory: ClaudeMessage[],
  reservationTool?: ReservationTool,
  escalationTool?: EscalationTool
): Promise<string> {
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

  const messages: ClaudeMessage[] = [...conversationHistory]

  for (let i = 0; i < 3; i++) {
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
    }

    const textBlock = data.content?.find((b: { type: string }) => b.type === 'text') as
      | { type: string; text: string }
      | undefined
    return textBlock?.text ?? ''
  }

  return "I'm having trouble handling that right now — a staff member will follow up shortly."
}
