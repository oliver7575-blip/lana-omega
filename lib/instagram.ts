/**
 * Instagram Direct messaging (Meta). Works with either connection style:
 *  - Instagram API with Instagram Login → graph.instagram.com (no Page needed)
 *  - Messenger Platform via a linked Facebook Page → graph.facebook.com/{page}
 * If a Page ID is configured we use the Page route, otherwise Instagram Login.
 */
import { decryptCredentials, type EncryptedPayload } from './crypto'

const V = 'v21.0'

export interface InstagramConfig {
  account_id?: string // Instagram professional account ID (the webhook's entry.id)
  page_id?: string // only for the Facebook Page connection style
}

export interface InstagramConnection {
  token: string
  appSecret?: string
  config: InstagramConfig
}

export function instagramConnection(credentials: EncryptedPayload, config: unknown): InstagramConnection {
  const c = decryptCredentials<{ access_token: string; app_secret?: string }>(credentials)
  return { token: c.access_token, appSecret: c.app_secret || undefined, config: (config ?? {}) as InstagramConfig }
}

function sendUrl(conn: InstagramConnection): { url: string; headers: Record<string, string> } {
  if (conn.config.page_id) {
    return {
      url: `https://graph.facebook.com/${V}/${conn.config.page_id}/messages?access_token=${encodeURIComponent(conn.token)}`,
      headers: { 'Content-Type': 'application/json' },
    }
  }
  return {
    url: `https://graph.instagram.com/${V}/${conn.config.account_id ?? 'me'}/messages`,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.token}` },
  }
}

async function post(conn: InstagramConnection, body: object): Promise<{ success: boolean; error?: string }> {
  try {
    const { url, headers } = sendUrl(conn)
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
    if (!res.ok) return { success: false, error: `Instagram send failed: ${res.status} ${(await res.text()).slice(0, 300)}` }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Instagram send failed' }
  }
}

/** Instagram allows 1,000 characters per message: split on paragraphs, then sentences. */
export function splitForInstagram(text: string, max = 1000): string[] {
  const out: string[] = []
  let current = ''
  for (const part of text.split(/\n{2,}/)) {
    const piece = current ? `${current}\n\n${part}` : part
    if (piece.length <= max) {
      current = piece
      continue
    }
    if (current) out.push(current)
    if (part.length <= max) {
      current = part
    } else {
      let rest = part
      while (rest.length > max) {
        const cut = Math.max(rest.lastIndexOf('. ', max), rest.lastIndexOf(' ', max), max - 1)
        out.push(rest.slice(0, cut + 1).trim())
        rest = rest.slice(cut + 1).trim()
      }
      current = rest
    }
  }
  if (current) out.push(current)
  return out
}

export async function sendInstagramText(conn: InstagramConnection, recipientId: string, text: string) {
  for (const chunk of splitForInstagram(text)) {
    const res = await post(conn, {
      recipient: { id: recipientId },
      message: { text: chunk },
      ...(conn.config.page_id ? { messaging_type: 'RESPONSE' } : {}),
    })
    if (!res.success) return res
  }
  return { success: true }
}

export async function sendInstagramImage(conn: InstagramConnection, recipientId: string, imageUrl: string) {
  return post(conn, {
    recipient: { id: recipientId },
    message: { attachment: { type: 'image', payload: { url: imageUrl } } },
    ...(conn.config.page_id ? { messaging_type: 'RESPONSE' } : {}),
  })
}

/** The sender's name/username, if Meta shares it (best effort). */
export async function instagramProfile(conn: InstagramConnection, igsid: string): Promise<{ name?: string; username?: string }> {
  try {
    const base = conn.config.page_id ? `https://graph.facebook.com/${V}/${igsid}` : `https://graph.instagram.com/${V}/${igsid}`
    const res = await fetch(`${base}?fields=name,username&access_token=${encodeURIComponent(conn.token)}`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return {}
    return (await res.json()) as { name?: string; username?: string }
  } catch {
    return {}
  }
}

/** Checks the connection details work (used by Integrations → Test). */
export async function checkInstagram(conn: InstagramConnection): Promise<{ ok: boolean; detail?: string; error?: string }> {
  try {
    const url = conn.config.page_id
      ? `https://graph.facebook.com/${V}/${conn.config.page_id}?fields=name,instagram_business_account&access_token=${encodeURIComponent(conn.token)}`
      : `https://graph.instagram.com/${V}/me?fields=user_id,username&access_token=${encodeURIComponent(conn.token)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) return { ok: false, error: `Instagram ${res.status}: ${JSON.stringify(json).slice(0, 300)}` }
    if (conn.config.page_id) {
      const ig = (json.instagram_business_account as { id?: string } | undefined)?.id
      if (!ig) return { ok: false, error: `Facebook Page "${json.name}" has no Instagram professional account linked` }
      if (conn.config.account_id && ig !== conn.config.account_id) {
        return { ok: false, error: `This Page is linked to Instagram account ${ig}, not ${conn.config.account_id}` }
      }
      return { ok: true, detail: `Connected via Facebook Page "${json.name}" (Instagram account ${ig})` }
    }
    const id = String(json.user_id ?? '')
    if (conn.config.account_id && id && id !== conn.config.account_id) {
      return { ok: false, error: `Token belongs to Instagram account ${id} (@${json.username}), not ${conn.config.account_id}` }
    }
    return { ok: true, detail: `Connected as @${json.username} (account ${id})` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Instagram check failed' }
  }
}
