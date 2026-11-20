import type { ParsedMail } from 'mailparser'
import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'email-attachments'
const MAX_FILES = 12
const MAX_FILE_BYTES = 15 * 1024 * 1024
const MAX_TOTAL_BYTES = 30 * 1024 * 1024

const safeName = (n: string) => n.replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || 'file'

/** Saves the attachments of one email in private storage and lists them in inbound_email_attachments. */
export async function storeAttachments(db: SupabaseClient, tenantId: string, emailId: string, parsed: ParsedMail): Promise<number> {
  let saved = 0
  try {
    let total = 0
    const files = (parsed.attachments ?? []).slice(0, MAX_FILES)
    for (let i = 0; i < files.length; i++) {
      const a = files[i]
      const size = a.size ?? a.content?.length ?? 0
      if (!a.content || size === 0 || size > MAX_FILE_BYTES || total + size > MAX_TOTAL_BYTES) continue
      total += size
      const filename = a.filename || `attachment-${i + 1}`
      const path = `${tenantId}/${emailId}/${i + 1}-${safeName(filename)}`
      const { error: upErr } = await db.storage.from(BUCKET).upload(path, a.content, { contentType: a.contentType || 'application/octet-stream', upsert: true })
      if (upErr) {
        console.error('[email-attachments] upload failed', upErr.message)
        continue
      }
      const inline = a.related === true || (a.contentDisposition === 'inline' && !!a.cid)
      const { error } = await db.from('inbound_email_attachments').insert({
        tenant_id: tenantId, email_id: emailId, filename, content_type: a.contentType || null, size_bytes: size, storage_path: path, inline,
      })
      if (!error) saved++
    }
  } catch (err) {
    console.error('[email-attachments] failed', err)
  }
  await db.from('inbound_emails').update({ attachments_checked: true }).eq('id', emailId)
  return saved
}

export const attachmentBucket = BUCKET
