import { decryptCredentials, type EncryptedPayload } from './crypto'

interface WhatsAppCredentials {
  access_token: string
}

interface DownloadedMedia {
  buffer: Buffer
  mimeType: string
}

/**
 * Downloads a WhatsApp media file in Meta's two-step flow:
 *   1. GET /{media-id}  -> JSON with a short-lived download URL + mime_type
 *   2. GET that URL with the same Bearer token -> the raw bytes
 */
export async function downloadWhatsAppMedia(
  mediaId: string,
  encryptedCredentials: EncryptedPayload
): Promise<DownloadedMedia> {
  const { access_token } = decryptCredentials<WhatsAppCredentials>(encryptedCredentials)

  const metaRes = await fetch(`https://graph.facebook.com/v21.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  if (!metaRes.ok) {
    throw new Error(`Media lookup failed: ${metaRes.status} ${await metaRes.text()}`)
  }
  const meta = (await metaRes.json()) as { url?: string; mime_type?: string }
  if (!meta.url) throw new Error('Media lookup returned no url')

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${access_token}` },
  })
  if (!fileRes.ok) {
    throw new Error(`Media download failed: ${fileRes.status}`)
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer())
  const mimeType = (meta.mime_type ?? fileRes.headers.get('content-type') ?? '').split(';')[0].trim()
  return { buffer, mimeType }
}

const CLAUDE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/**
 * Asks Claude to describe a guest's photo in plain words, so the rest of the
 * pipeline (which is text-only, and replays history from the database) can
 * treat it like any other message.
 */
export async function describeImage(buffer: Buffer, mimeType: string): Promise<string> {
  if (!CLAUDE_IMAGE_TYPES.has(mimeType)) {
    throw new Error(`Unsupported image type: ${mimeType}`)
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mimeType, data: buffer.toString('base64') },
            },
            {
              type: 'text',
              text: 'A hotel guest sent this photo to the hotel concierge. Describe what it shows in 1-3 short, factual sentences, focusing on anything a hotel would care about (a problem or damage, a place, a document, a screenshot). Transcribe any clearly visible text that seems important (e.g. a confirmation number, an error message, an address). Output ONLY the description, nothing else.',
            },
          ],
        },
      ],
    }),
  })
  if (!response.ok) {
    throw new Error(`Image description failed: ${response.status} ${await response.text()}`)
  }
  const data = (await response.json()) as { content?: { type: string; text?: string }[] }
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join(' ')
    .trim()
  if (!text) throw new Error('Image description was empty')
  return text
}

/**
 * Transcribes a voice note with Deepgram (pre-recorded API, automatic
 * language detection), using the tenant's own Deepgram key from the
 * Integrations page. If the tenant hasn't connected one, this throws and the
 * caller falls back to a placeholder so Lana asks the guest to type.
 */
export async function transcribeAudio(
  buffer: Buffer,
  mimeType: string,
  apiKey: string | undefined
): Promise<string> {
  if (!apiKey) throw new Error('Voice notes (Deepgram) integration not connected')

  const response = await fetch(
    'https://api.deepgram.com/v1/listen?model=nova-3-general&detect_language=true&smart_format=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': mimeType || 'audio/ogg',
      },
      body: new Uint8Array(buffer),
    }
  )
  if (!response.ok) {
    throw new Error(`Transcription failed: ${response.status} ${await response.text()}`)
  }
  const data = (await response.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] }
  }
  const transcript = data.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim()
  if (!transcript) throw new Error('Transcript was empty')
  return transcript
}
