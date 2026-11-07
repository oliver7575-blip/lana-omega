import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from './supabase/service'
import { KNOWLEDGE_BASE_MAX_CHARS } from './knowledge-base'

export interface LiveNote {
  id: string
  subject: string | null
  note: string
  created_at: string
  expires_at: string
}

export async function loadActiveNotes(tenantId: string, db = createServiceClient()): Promise<LiveNote[]> {
  const { data } = await db
    .from('lana_live_notes')
    .select('id, subject, note, created_at, expires_at')
    .eq('tenant_id', tenantId)
    .is('resolved_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(30)
  return (data ?? []) as LiveNote[]
}

/**
 * What the team has told Lana about the hotel right now (a room without hot
 * water, a closed pool...). Newer than the knowledge base, so it wins.
 */
export async function buildLiveNotesSection(tenantId: string): Promise<string> {
  try {
    const notes = await loadActiveNotes(tenantId)
    if (!notes.length) return ''
    const lines = notes.map((n) => `- ${n.subject ? `${n.subject}: ` : ''}${n.note} (reported ${n.created_at.slice(0, 10)})`).join('\n')
    return `\n\nCURRENT SITUATION AT THE HOTEL\nOur team has just reported the following. It is more recent than the knowledge base, so it takes priority. Treat it as true until it is cleared. When it affects the guest you are talking to (their room or something they ask about), be upfront, apologise briefly, and say the team is aware and working on it. Do not promise a fix time. Never mention who reported it, and do not bring it up with guests it does not affect.\n\n<current_situation>\n${lines}\n</current_situation>`
  } catch (err) {
    console.error('[live-notes] failed to load', err)
    return ''
  }
}

const FACTS_HEADING = '# Team-confirmed facts'

/** A lasting fact told by staff goes into the knowledge base itself, so it never expires. */
export async function addPermanentFact(db: SupabaseClient, tenantId: string, subject: string | null, fact: string, reportedBy: string) {
  const { data } = await db.from('tenants').select('knowledge_base').eq('id', tenantId).single()
  const kb = ((data?.knowledge_base as string | null) ?? '').trimEnd()
  const line = `- ${subject ? `**${subject}**: ` : ''}${fact}`
  if (kb.includes(line)) return
  const next = kb.includes(FACTS_HEADING)
    ? kb.replace(FACTS_HEADING, `${FACTS_HEADING}\n${line}`)
    : `${kb}${kb ? '\n\n' : ''}${FACTS_HEADING}\n${line}`
  if (next.length > KNOWLEDGE_BASE_MAX_CHARS) {
    console.error('[maintenance-freetext] knowledge base is full, fact not saved')
    return
  }
  await db.from('tenants').update({ knowledge_base: next }).eq('id', tenantId)
  await db.from('lana_live_notes').insert({
    tenant_id: tenantId, subject, note: fact, reported_by: reportedBy, resolved_at: new Date().toISOString(), resolved_by: 'saved to the knowledge base',
  })
}
