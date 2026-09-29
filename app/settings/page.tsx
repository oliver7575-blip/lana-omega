'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

const STARTER_TEMPLATE = [
  'You are the AI concierge for [HOTEL NAME], a [TYPE OF PROPERTY] in [CITY, COUNTRY].',
  '',
  'TONE',
  '- Warm, clear and concise, like a knowledgeable local host rather than a corporate hotel.',
  '- Short paragraphs; bullet points only when they genuinely help.',
  '',
  'LANGUAGE',
  "- Always reply in the language of the guest's most recent message, even if earlier messages were in another language.",
  '',
  'RULES',
  '- Use only the facts in this prompt. Never invent prices, availability, policies or exceptions.',
  '- Never promise early check-in, late check-out, discounts, refunds or special arrangements.',
  "- If you don't know something, say a member of the team will gladly help, and give the general contact below.",
  '',
  'KEY FACTS',
  '- Check-in: [TIME]. Check-out: [TIME].',
  '- Wi-Fi: network [NAME], password [PASSWORD].',
  '- Address and how to find us: [DIRECTIONS].',
  '- Food and breakfast: [DETAILS].',
  '- House rules: [DETAILS].',
  '',
  'CONTACTS',
  "- General questions and anything you can't answer: [EMAIL OR PHONE].",
  '- Taxis and transfers: [NAME AND CONTACT].',
  '- Tours and activities: [NAME AND CONTACT].',
].join('\n')

interface PlaygroundMessage {
  role: 'user' | 'assistant'
  content: string
}

export default function SettingsPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [knowledgeBase, setKnowledgeBase] = useState('')
  const [savingKb, setSavingKb] = useState(false)
  const [kbMessage, setKbMessage] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [role, setRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [showDeleteForm, setShowDeleteForm] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  const [activating, setActivating] = useState(false)
  const [activateError, setActivateError] = useState<string | null>(null)

  const [contacts, setContacts] = useState<{ key: string; phone: string; description: string }[]>([])
  const [postStayEnabled, setPostStayEnabled] = useState(false)
  const [savingPostStay, setSavingPostStay] = useState(false)
  const [postStayMessage, setPostStayMessage] = useState<string | null>(null)
  const [savingContacts, setSavingContacts] = useState(false)
  const [contactsMessage, setContactsMessage] = useState<string | null>(null)

  const [bookingEngineCode, setBookingEngineCode] = useState('')
  const [bookingCurrency, setBookingCurrency] = useState('')
  const [savingBooking, setSavingBooking] = useState(false)
  const [bookingMessage, setBookingMessage] = useState<string | null>(null)

  const [pgMessages, setPgMessages] = useState<PlaygroundMessage[]>([])
  const [pgInput, setPgInput] = useState('')
  const [pgLoading, setPgLoading] = useState(false)
  const [pgError, setPgError] = useState<string | null>(null)

  async function loadTenant() {
    const res = await fetch('/api/tenant')
    const json = await res.json()
    if (json.tenant) {
      setName(json.tenant.name)
      setPrompt(json.tenant.ai_persona_prompt)
      setKnowledgeBase(json.tenant.knowledge_base ?? '')
      setStatus(json.tenant.status)
      setRole(json.role)
      const raw = json.tenant.escalation_contacts
      setContacts(
        Array.isArray(raw)
          ? raw.map((c: { key?: string; phone?: string; description?: string }) => ({
              key: c.key ?? '',
              phone: c.phone ?? '',
              description: c.description ?? '',
            }))
          : Object.entries((raw ?? {}) as Record<string, string>).map(([key, phone]) => ({
              key,
              phone,
              description: '',
            }))
      )
      setPostStayEnabled(Boolean(json.tenant.post_stay_enabled))
      const booking = json.tenant.booking_config ?? {}
      setBookingEngineCode(booking.booking_engine_code ?? '')
      setBookingCurrency(booking.currency ?? '')
    }
    setLoading(false)
  }

  useEffect(() => {
    loadTenant()
  }, [])

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    const res = await fetch('/api/tenant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ai_persona_prompt: prompt }),
    })
    const json = await res.json()
    setSaving(false)
    if (!res.ok) {
      setMessage(`Error: ${json.error}`)
      return
    }
    setMessage('Saved.')
  }

  async function handleSaveKnowledgeBase() {
    setSavingKb(true)
    setKbMessage(null)
    const res = await fetch('/api/tenant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ knowledge_base: knowledgeBase }),
    })
    const json = await res.json()
    setSavingKb(false)
    if (!res.ok) {
      setKbMessage(`Error: ${json.error}`)
      return
    }
    setKbMessage('Saved.')
  }

  async function handleSaveContacts() {
    setSavingContacts(true)
    setContactsMessage(null)
    const res = await fetch('/api/tenant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        escalation_contacts: contacts.filter((c) => c.key.trim() && c.phone.trim()),
      }),
    })
    const json = await res.json()
    setSavingContacts(false)
    if (!res.ok) {
      setContactsMessage(`Error: ${json.error}`)
      return
    }
    setContactsMessage('Saved.')
    loadTenant()
  }

  async function handleTogglePostStay(next: boolean) {
    setSavingPostStay(true)
    setPostStayMessage(null)
    const res = await fetch('/api/tenant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ post_stay_enabled: next }),
    })
    const json = await res.json()
    setSavingPostStay(false)
    if (!res.ok) {
      setPostStayMessage(`Error: ${json.error}`)
      return
    }
    setPostStayEnabled(next)
    setPostStayMessage(next ? 'Post-stay messages are on.' : 'Post-stay messages are off.')
  }

  function updateContact(index: number, field: 'key' | 'phone' | 'description', value: string) {
    setContacts((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)))
  }

  async function handleSaveBooking() {
    setSavingBooking(true)
    setBookingMessage(null)
    const res = await fetch('/api/tenant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_config: {
          booking_engine_code: bookingEngineCode,
          currency: bookingCurrency,
        },
      }),
    })
    const json = await res.json()
    setSavingBooking(false)
    if (!res.ok) {
      setBookingMessage(`Error: ${json.error}`)
      return
    }
    setBookingMessage('Saved.')
  }

  function handleUseTemplate() {
    if (
      prompt.trim() &&
      prompt.trim() !== STARTER_TEMPLATE &&
      !confirm('Replace the current text with the starter template? Nothing is saved until you click Save changes.')
    ) {
      return
    }
    setPrompt(STARTER_TEMPLATE)
  }

  async function handlePlaygroundSend(e: React.FormEvent) {
    e.preventDefault()
    const text = pgInput.trim()
    if (!text || pgLoading) return

    const next: PlaygroundMessage[] = [...pgMessages, { role: 'user', content: text }]
    setPgMessages(next)
    setPgInput('')
    setPgLoading(true)
    setPgError(null)

    try {
      const res = await fetch('/api/tenant/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, knowledgeBase, messages: next }),
      })

      const raw = await res.text()
      let json: { reply?: string; error?: string } | null = null
      try {
        json = JSON.parse(raw)
      } catch {
        json = null
      }

      if (!json) {
        setPgError(`Unexpected response (HTTP ${res.status}). It may have timed out.`)
        return
      }
      if (!res.ok || !json.reply) {
        setPgError(json.error ?? `HTTP ${res.status}`)
        return
      }
      setPgMessages([...next, { role: 'assistant', content: json.reply }])
    } catch (err) {
      setPgError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setPgLoading(false)
    }
  }

  async function handleActivate() {
    setActivating(true)
    setActivateError(null)
    const res = await fetch('/api/tenant', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activate: true }),
    })
    const json = await res.json()
    setActivating(false)
    if (!res.ok) {
      setActivateError(json.error)
      return
    }
    setStatus(json.tenant.status)
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    setPasswordMessage(null)

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    setChangingPassword(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setChangingPassword(false)

    if (error) {
      setPasswordError(error.message)
      return
    }

    setPasswordMessage('Password updated.')
    setNewPassword('')
    setConfirmPassword('')
  }

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(null)
    const res = await fetch('/api/tenant', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmName }),
    })
    const json = await res.json()
    setDeleting(false)
    if (!res.ok) {
      setDeleteError(json.error)
      return
    }
    router.push('/login')
  }

  if (loading) {
    return <main style={{ maxWidth: 640, margin: '80px auto' }}>Loading...</main>
  }

  const canEdit = role === 'owner' || role === 'admin'
  const canDelete = role === 'owner'

  return (
    <main style={{ maxWidth: 640, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <p>
        <Link href="/">← Back home</Link>
      </p>
      <h1>Settings</h1>
      <p style={{ color: '#888' }}>Status: {status}</p>

      {status === 'onboarding' && canEdit && (
        <div
          style={{
            background: '#eff6ff',
            border: '1px solid #bfdbfe',
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <p style={{ margin: 0, marginBottom: 8 }}>
            This hotel is still in onboarding. Once you've connected a channel and set up your
            persona, activate it.
          </p>
          <button onClick={handleActivate} disabled={activating}>
            {activating ? 'Activating...' : 'Activate hotel'}
          </button>
          {activateError && <p style={{ color: 'red' }}>{activateError}</p>}
        </div>
      )}

      {!canEdit && (
        <p style={{ color: '#b45309' }}>
          Your role ({role}) can view these settings but only an owner or admin can edit them.
        </p>
      )}

      <div style={{ marginBottom: 16 }}>
        <label>
          <strong>Hotel name</strong>
        </label>
        <br />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit}
          style={{ width: '100%', padding: 8, marginTop: 4 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label>
          <strong>AI persona &amp; policies</strong>
        </label>
        <br />
        <span style={{ fontSize: 13, color: '#888' }}>
          This is the full system prompt guiding your AI concierge — persona, tone, policies, and
          key facts, all in one place.
        </span>
        <br />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={!canEdit}
          rows={20}
          style={{ width: '100%', padding: 8, marginTop: 4, fontFamily: 'monospace', fontSize: 13 }}
        />
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
          <button onClick={handleUseTemplate} type="button">
            Use starter template
          </button>
        </div>
      )}
      {message && <p>{message}</p>}

      <div style={{ marginTop: 32, marginBottom: 16 }}>
        <label>
          <strong>Knowledge base</strong>
        </label>
        <br />
        <span style={{ fontSize: 13, color: '#888' }}>
          Your hotel's reference manual: facts, policies, prices, contacts, local tips (parking,
          Wi-Fi, restaurants, taxis, tours, house rules...). The concierge treats this as the
          source of truth. Keep tone and behaviour rules in the persona box above. Plain text or
          Markdown, up to 60,000 characters.
        </span>
        <br />
        <textarea
          value={knowledgeBase}
          onChange={(e) => setKnowledgeBase(e.target.value)}
          disabled={!canEdit}
          rows={24}
          style={{ width: '100%', padding: 8, marginTop: 4, fontFamily: 'monospace', fontSize: 13 }}
        />
        <span style={{ fontSize: 12, color: knowledgeBase.length > 60000 ? 'red' : '#888' }}>
          {knowledgeBase.length.toLocaleString('en-US')} / 60,000 characters
        </span>
      </div>
      {canEdit && (
        <button onClick={handleSaveKnowledgeBase} disabled={savingKb || knowledgeBase.length > 60000}>
          {savingKb ? 'Saving...' : 'Save knowledge base'}
        </button>
      )}
      {kbMessage && <p>{kbMessage}</p>}

      {canEdit && (
        <div style={{ marginTop: 32, border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Staff escalation contacts</h2>
          <p style={{ fontSize: 13, color: '#888', marginTop: 0 }}>
            WhatsApp numbers your AI concierge will message directly when a guest needs staff
            attention. Each contact is a category the concierge can choose — the description tells
            it when. Include the country code, e.g. +52 958 128 5454. A contact called
            &quot;reservations&quot; also receives new waitlist entries. Staff alerts use the approved
            template chosen under <Link href="/automations">Automated messages</Link>.
          </p>
          {contacts.map((c, i) => (
            <div
              key={i}
              style={{ border: '1px solid #eee', borderRadius: 6, padding: 10, marginBottom: 8 }}
            >
              <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input
                  value={c.key}
                  onChange={(e) => updateContact(i, 'key', e.target.value)}
                  placeholder="Category, e.g. maintenance or oliver"
                  style={{ flex: 1, padding: 8 }}
                />
                <input
                  value={c.phone}
                  onChange={(e) => updateContact(i, 'phone', e.target.value)}
                  placeholder="+52 ..."
                  style={{ flex: 1, padding: 8 }}
                />
                <button
                  onClick={() => setContacts((prev) => prev.filter((_, j) => j !== i))}
                  title="Remove"
                >
                  Remove
                </button>
              </div>
              <input
                value={c.description}
                onChange={(e) => updateContact(i, 'description', e.target.value)}
                placeholder="When should the concierge use this? e.g. Only when the guest asks to speak with Oliver"
                style={{ width: '100%', padding: 8 }}
              />
            </div>
          ))}
          <button
            onClick={() => setContacts((prev) => [...prev, { key: '', phone: '', description: '' }])}
            style={{ marginRight: 8, marginBottom: 8 }}
          >
            + Add contact
          </button>
          <br />
          <button onClick={handleSaveContacts} disabled={savingContacts}>
            {savingContacts ? 'Saving...' : 'Save contacts'}
          </button>
          {contactsMessage && <p>{contactsMessage}</p>}
        </div>
      )}

      {canEdit && (
        <div style={{ marginTop: 32, border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Post-stay messages</h2>
          <p style={{ fontSize: 13, color: '#888', marginTop: 0 }}>
            When on, guests get a feedback message (WhatsApp and/or email) the day after
            check-out. Set up the message under <Link href="/automations">Automated messages</Link>.
          </p>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={postStayEnabled}
              disabled={savingPostStay}
              onChange={(e) => handleTogglePostStay(e.target.checked)}
            />
            Send post-stay messages
          </label>
          {postStayMessage && <p>{postStayMessage}</p>}
        </div>
      )}

      {canEdit && (
        <div style={{ marginTop: 32, border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Booking link</h2>
          <p style={{ fontSize: 13, color: '#888', marginTop: 0 }}>
            Lets your AI concierge send guests a real link to check availability and book, using
            your Cloudbeds booking engine. Find your booking engine code in Cloudbeds under
            Booking Engine settings — it's the short code in your booking engine's own URL.
          </p>
          <div style={{ marginBottom: 8 }}>
            <label>Booking engine code</label>
            <br />
            <input
              value={bookingEngineCode}
              onChange={(e) => setBookingEngineCode(e.target.value)}
              placeholder="e.g. NadQ8y"
              style={{ width: '100%', padding: 8 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>Currency code</label>
            <br />
            <input
              value={bookingCurrency}
              onChange={(e) => setBookingCurrency(e.target.value)}
              placeholder="e.g. mxn, usd"
              style={{ width: '100%', padding: 8 }}
            />
          </div>
          <button onClick={handleSaveBooking} disabled={savingBooking}>
            {savingBooking ? 'Saving...' : 'Save booking link'}
          </button>
          {bookingMessage && <p>{bookingMessage}</p>}
        </div>
      )}

      {canEdit && (
        <div style={{ marginTop: 32, border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Test your concierge</h2>
          <p style={{ fontSize: 13, color: '#888', marginTop: 0 }}>
            Chats using the persona and knowledge base boxes above, even if you haven't saved them. Nothing here is
            stored, and reservation lookups aren't simulated. Each message is a real AI call. Note:
            escalation, the waitlist, and the booking link are NOT simulated here either — testing
            those needs a real conversation (WhatsApp or the widget), not this box.
          </p>

          <div
            style={{
              border: '1px solid #eee',
              borderRadius: 8,
              minHeight: 120,
              maxHeight: 320,
              overflowY: 'auto',
              padding: 12,
              marginBottom: 12,
            }}
          >
            {pgMessages.length === 0 && (
              <p style={{ color: '#aaa', margin: 0 }}>
                Ask something a guest would, e.g. "What's the Wi-Fi password?"
              </p>
            )}
            {pgMessages.map((m, i) => (
              <div key={i} style={{ marginBottom: 10, textAlign: m.role === 'user' ? 'right' : 'left' }}>
                <div
                  style={{
                    display: 'inline-block',
                    padding: '8px 12px',
                    borderRadius: 8,
                    maxWidth: '85%',
                    background: m.role === 'user' ? '#dbeafe' : '#f0f0f0',
                    whiteSpace: 'pre-wrap',
                    textAlign: 'left',
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {pgLoading && <p style={{ color: '#888', margin: 0 }}>Thinking...</p>}
          </div>

          {pgError && <p style={{ color: 'red', marginTop: 0 }}>{pgError}</p>}

          <form onSubmit={handlePlaygroundSend} style={{ display: 'flex', gap: 8 }}>
            <input
              value={pgInput}
              onChange={(e) => setPgInput(e.target.value)}
              placeholder="Type as a guest..."
              style={{ flex: 1, padding: 8 }}
            />
            <button type="submit" disabled={pgLoading || !pgInput.trim()}>
              Send
            </button>
            <button
              type="button"
              onClick={() => {
                setPgMessages([])
                setPgError(null)
              }}
            >
              Reset
            </button>
          </form>
        </div>
      )}

      <div style={{ marginTop: 48, borderTop: '1px solid #eee', paddingTop: 16 }}>
        <h2>Your account</h2>
        <form onSubmit={handleChangePassword}>
          <div style={{ marginBottom: 8 }}>
            <label>New password (min 8 characters)</label>
            <br />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={{ width: '100%', padding: 8 }}
            />
          </div>
          <div style={{ marginBottom: 8 }}>
            <label>Confirm new password</label>
            <br />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={{ width: '100%', padding: 8 }}
            />
          </div>
          {passwordError && <p style={{ color: 'red' }}>{passwordError}</p>}
          {passwordMessage && <p style={{ color: 'green' }}>{passwordMessage}</p>}
          <button type="submit" disabled={changingPassword}>
            {changingPassword ? 'Updating...' : 'Change password'}
          </button>
        </form>
      </div>

      {canDelete && (
        <div style={{ marginTop: 48, borderTop: '1px solid #f0c0c0', paddingTop: 16 }}>
          <h2 style={{ color: '#b91c1c' }}>Danger zone</h2>
          {!showDeleteForm ? (
            <button onClick={() => setShowDeleteForm(true)} style={{ color: '#b91c1c' }}>
              Delete this hotel account
            </button>
          ) : (
            <div>
              <p>
                This permanently deletes <strong>{name}</strong>, every staff account, every
                integration, and every guest conversation. This cannot be undone.
              </p>
              <p>
                Type <strong>{name}</strong> to confirm:
              </p>
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                style={{ width: '100%', padding: 8, marginBottom: 8 }}
              />
              {deleteError && <p style={{ color: 'red' }}>{deleteError}</p>}
              <button
                onClick={handleDelete}
                disabled={deleting || confirmName !== name}
                style={{ color: '#b91c1c' }}
              >
                {deleting ? 'Deleting...' : 'Permanently delete'}
              </button>
              <button onClick={() => setShowDeleteForm(false)} style={{ marginLeft: 8 }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  )
}
