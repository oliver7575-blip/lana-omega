import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const keyB64 = process.env.CREDENTIAL_ENCRYPTION_KEY
  if (!keyB64) {
    throw new Error('CREDENTIAL_ENCRYPTION_KEY is not set')
  }
  const key = Buffer.from(keyB64, 'base64')
  if (key.length !== 32) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`
    )
  }
  return key
}

export interface EncryptedPayload {
  iv: string
  authTag: string
  ciphertext: string
}

/**
 * Encrypts an arbitrary JSON-serializable value (e.g. a set of integration
 * credentials) for storage in tenant_integrations.credentials. This is the
 * only path plaintext secrets should ever go through before hitting the DB.
 */
export function encryptCredentials(plaintext: unknown): EncryptedPayload {
  const key = getKey()
  const iv = crypto.randomBytes(12) // 96-bit IV, standard for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

  const json = JSON.stringify(plaintext)
  const ciphertext = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

/**
 * Decrypts a payload previously produced by encryptCredentials. Throws if
 * the auth tag doesn't match (tampered ciphertext or wrong key) instead of
 * silently returning garbage.
 */
export function decryptCredentials<T = unknown>(payload: EncryptedPayload): T {
  const key = getKey()
  const iv = Buffer.from(payload.iv, 'base64')
  const authTag = Buffer.from(payload.authTag, 'base64')
  const ciphertext = Buffer.from(payload.ciphertext, 'base64')

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return JSON.parse(plaintext.toString('utf8')) as T
}
