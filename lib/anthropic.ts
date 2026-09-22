interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: unknown
}

interface ReservationTool {
  lookupReservation: (confirmationNumber: string) => Promise<unknown>
}

export async function generateReply(
  systemPrompt: string,
  conversationHistory: ClaudeMessage[],
  reservationTool?: ReservationTool
): Promise<string> {
  const tools = reservationTool
    ? [
        {
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
        },
      ]
    : undefined

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
        ...(tools ? { tools } : {}),
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Anthropic API error: ${response.status} ${errText}`)
    }

    const data = await response.json()

    if (data.stop_reason === 'tool_use' && reservationTool) {
      const toolUseBlock = data.content.find(
        (b: { type: string }) => b.type === 'tool_use'
      ) as { type: string; id: string; name: string; input: { confirmationNumber: string } }

      messages.push({ role: 'assistant', content: data.content })

      if (toolUseBlock && toolUseBlock.name === 'lookup_reservation') {
        const result = await reservationTool.lookupReservation(
          toolUseBlock.input.confirmationNumber
        )
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: toolUseBlock.id,
              content: JSON.stringify(result),
            },
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

  return "I'm having trouble looking that up right now — a staff member will follow up shortly."
}
