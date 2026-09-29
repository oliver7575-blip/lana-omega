/**
 * Wraps a tenant's knowledge base (facts: policies, prices, contacts,
 * directions, recommendations) so it can be appended to the system prompt.
 * The persona prompt holds tone and rules; this holds the facts.
 */
export const KNOWLEDGE_BASE_MAX_CHARS = 100000

export function buildKnowledgeBaseSection(knowledgeBase: string | null | undefined): string {
  const kb = (knowledgeBase ?? '').trim()
  if (!kb) return ''
  return `\n\nHOTEL KNOWLEDGE BASE\nThe text below is the hotel's own reference information and the single source of truth for facts: policies, times, prices, contacts, directions, amenities and local recommendations. Use it to answer guest questions accurately. When it lists a contact for a service (taxis, tours, car rental, etc.), give that contact. If the answer is genuinely not in here, say so honestly and follow your escalation guidance — never invent details. Never mention that you are reading from a knowledge base, manual or document.\n\n<knowledge_base>\n${kb}\n</knowledge_base>`
}
