interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function generateReply(
  systemPrompt: string,
  conversationHistory: ClaudeMessage[]
): Promise<string> {
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
      messages: conversationHistory,
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Anthropic API error: ${response.status} ${errText}`)
  }

  const data = await response.json()
  const textBlock = data.content?.find((block: { type: string }) => block.type === 'text')
  return textBlock?.text ?? ''
}
