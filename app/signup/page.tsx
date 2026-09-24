'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function SignupPage() {
  const [hotelName, setHotelName] = useState('')
  const [slug, setSlug] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function slugify(value: string) {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hotelName,
        slug: slug || slugify(hotelName),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ownerEmail: email,
        ownerPassword: password,
      }),
    })
    const json = await res.json()
    setLoading(false)

    if (!res.ok) {
      setError(json.error)
      return
    }
    setSuccess(json.message)
  }

  if (success) {
    return (
      <main style={{ maxWidth: 400, margin: '80px auto', fontFamily: 'sans-serif' }}>
        <h1>Check your email</h1>
        <p>{success}</p>
        <p>
          <Link href="/login">Back to sign in</Link>
        </p>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 400, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1>Create your account</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label>Hotel name</label>
          <br />
          <input
            value={hotelName}
            onChange={(e) => setHotelName(e.target.value)}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>URL slug (optional — auto-generated if left blank)</label>
          <br />
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>Email</label>
          <br />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>Password (min 8 characters)</label>
          <br />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ width: '100%', padding: 10 }}>
          {loading ? 'Creating account...' : 'Sign up'}
        </button>
      </form>
      <p style={{ marginTop: 12 }}>
        <Link href="/login">Already have an account? Sign in</Link>
      </p>
    </main>
  )
}
