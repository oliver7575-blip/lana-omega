export interface EscalationContact {
  /** Short id the AI uses, e.g. "maintenance" or "oliver". */
  key: string
  phone: string
  /** Tells the AI when to use this contact. */
  description?: string
}

/** Turns a label into a safe category key: "Front desk" → "front_desk". */
export function toCategoryKey(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

/**
 * Reads escalation contacts in either the current list format or the older
 * { category: phone } object format.
 */
export function parseEscalationContacts(raw: unknown): EscalationContact[] {
  const out: EscalationContact[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const c = item as Partial<EscalationContact>
      const key = toCategoryKey(c?.key ?? '')
      const phone = (c?.phone ?? '').trim()
      if (key && phone) out.push({ key, phone, description: c.description?.trim() || undefined })
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const key = toCategoryKey(k)
      if (key && typeof v === 'string' && v.trim()) out.push({ key, phone: v.trim() })
    }
  }
  // One contact per category — the first one wins.
  return out.filter((c, i) => out.findIndex((o) => o.key === c.key) === i)
}

export function findEscalationContact(
  contacts: EscalationContact[],
  key: string
): EscalationContact | undefined {
  return contacts.find((c) => c.key === toCategoryKey(key))
}
