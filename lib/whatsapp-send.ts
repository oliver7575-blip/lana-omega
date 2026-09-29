import { decryptCredentials, type EncryptedPayload } from './crypto'

interface WhatsAppCredentials {
  access_token: string
}

/**
 * Converts the Markdown the AI naturally writes into WhatsApp's own
 * formatting, so guests don't see stray symbols.
 *   **bold** / __bold__  -> *bold*
 *   ## Heading           -> *Heading*
 *   [text](https://url)  -> text: https://url
 *   horizontal rules     -> removed
 * Single *x* and _x_ are already valid WhatsApp syntax and are left alone.
 */
export function toWhatsAppFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) =>
      label.trim() === url.trim() ? url : `${label}: ${url}`
    )
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function sendWhatsAppMessage(
  phoneNumberId: string,
  encryptedCredentials: EncryptedPayload,
  to: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { access_token } = decryptCredentials<WhatsAppCredentials>(encryptedCredentials)

    const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: toWhatsAppFormat(text) },
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return { success: false, error: `WhatsApp send failed: ${response.status} ${errText}` }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// Native WhatsApp CTA button — used for send_contact_button. Uses Meta's
// "cta_url" interactive message type from general API knowledge, not
// verified against a real send yet — confirm with a real send now that
// WhatsApp inbound/outbound works end to end.
export async function sendWhatsAppInteractiveButton(
  phoneNumberId: string,
  encryptedCredentials: EncryptedPayload,
  to: string,
  bodyText: string,
  buttonUrl: string,
  buttonText: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { access_token } = decryptCredentials<WhatsAppCredentials>(encryptedCredentials)

    const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: toWhatsAppFormat(bodyText) },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: buttonText,
              url: buttonUrl,
            },
          },
        },
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      return { success: false, error: `WhatsApp send failed: ${response.status} ${errText}` }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

/**
 * Sends an image found at a URL. We download it ourselves and upload it to
 * WhatsApp first (like Beta does): sending a bare link makes Meta fetch it,
 * which many hosts (Cloudbeds included) block, and those failures are silent.
 */
export async function sendWhatsAppImage(
  phoneNumberId: string,
  encryptedCredentials: EncryptedPayload,
  to: string,
  imageUrl: string,
  caption?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { access_token } = decryptCredentials<WhatsAppCredentials>(encryptedCredentials)

    const download = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) })
    if (!download.ok) {
      return { success: false, error: `Photo download failed: ${download.status} ${imageUrl}` }
    }
    const bytes = await download.arrayBuffer()
    if (bytes.byteLength > 5 * 1024 * 1024) {
      return { success: false, error: `Photo is over WhatsApp's 5 MB limit: ${imageUrl}` }
    }
    let mime = (download.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (mime !== 'image/jpeg' && mime !== 'image/png') {
      mime = /\.png(\?|$)/i.test(imageUrl) ? 'image/png' : 'image/jpeg'
    }

    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', mime)
    form.append('file', new Blob([bytes], { type: mime }), mime === 'image/png' ? 'photo.png' : 'photo.jpg')

    const upload = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}` },
      body: form,
      signal: AbortSignal.timeout(20000),
    })
    if (!upload.ok) {
      return { success: false, error: `WhatsApp media upload failed: ${upload.status} ${await upload.text()}` }
    }
    const { id: mediaId } = (await upload.json()) as { id?: string }
    if (!mediaId) return { success: false, error: 'WhatsApp media upload returned no id' }

    const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: { id: mediaId, ...(caption ? { caption } : {}) },
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) {
      return { success: false, error: `WhatsApp image send failed: ${response.status} ${await response.text()}` }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
