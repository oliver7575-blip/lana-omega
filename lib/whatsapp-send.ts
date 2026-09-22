import { decryptCredentials, type EncryptedPayload } from './crypto'

interface WhatsAppCredentials {
  access_token: string
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
        text: { body: text },
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
