import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { attachmentBucket } from '@/lib/email-attachments'

/** Opens or downloads one email attachment (only for staff of the tenant that received the email). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Unknown attachment' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // RLS: only returns the row when it belongs to the signed-in user's tenant.
  const { data: att } = await supabase.from('inbound_email_attachments').select('filename, content_type, storage_path').eq('id', id).maybeSingle()
  if (!att) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { data: file, error } = await createServiceClient().storage.from(attachmentBucket).download(att.storage_path as string)
  if (error || !file) return NextResponse.json({ error: 'The file could not be read' }, { status: 404 })

  const type = String(att.content_type ?? 'application/octet-stream').toLowerCase().split(';')[0].trim()
  // Pictures and PDFs open in the browser; anything else (html, svg, office files…) is always downloaded.
  const viewable = (/^image\/(png|jpe?g|gif|webp|heic|avif)$/.test(type) || type === 'application/pdf') && new URL(request.url).searchParams.get('download') !== '1'
  const name = String(att.filename).replace(/[\r\n"]/g, '_')
  return new Response(file.stream(), {
    headers: {
      'content-type': viewable ? type : 'application/octet-stream',
      'content-disposition': `${viewable ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(att.filename as string)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=300',
    },
  })
}
