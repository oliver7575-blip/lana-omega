import type { ReactNode } from 'react'

/**
 * Shows message text the way WhatsApp does: *bold*, _italic_, ~strike~ and
 * ```monospace```. Like WhatsApp, a marker only counts at a word edge, so
 * underscores or stars inside links and words are left alone.
 */
const PATTERN = /(^|[\s(\[{"'“‘¡¿])(```|[*_~])(?!\s)([^\n]*?[^\s])\2(?=$|[\s.,;:!?)\]}"'”’])/g

export default function WhatsAppText({ text }: { text: string }) {
  return <>{format(text, 0)}</>
}

function format(text: string, depth: number): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  PATTERN.lastIndex = 0
  for (const m of text.matchAll(PATTERN)) {
    const [whole, lead, marker, inner] = m
    const start = (m.index ?? 0) + lead.length
    if (start > last) out.push(text.slice(last, start))
    // Inner text can carry its own formatting (*bold _italic_*), one level deep.
    const content = depth < 2 && marker !== '```' ? format(inner, depth + 1) : [inner]
    const k = `${depth}-${key++}`
    if (marker === '*') out.push(<strong key={k} className="font-semibold">{content}</strong>)
    else if (marker === '_') out.push(<em key={k}>{content}</em>)
    else if (marker === '~') out.push(<s key={k}>{content}</s>)
    else out.push(<code key={k} className="rounded bg-black/20 px-1 font-mono text-[0.92em]">{content}</code>)
    last = (m.index ?? 0) + whole.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
