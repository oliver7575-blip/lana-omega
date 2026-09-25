'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const code = searchParams.get('code')
    const supabase = createClient()

    if (code) {
      // Supabase's PKCE-style recovery link — exchange the code for a real session.
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) {
          setError(error.message)
        } else {
          setReady(true)
        }
      })
    } else {
      // Fallback for the older hash-token style, in case that's ever used instead.
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) setReady(true)
      })
    }
  }, [searchParams])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }
    setSuccess(true)
    setTimeout(() => router.push('/login'), 2000)
  }

  if (success) {
    return (
      <main style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'sans-serif' }}>
        <h1>Password updated</h1>
        <p>Redirecting you to sign in...</p>
      </main>
    )
  }

  if (!ready) {
    return (
      <main style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'sans-serif' }}>
        <h1>Reset your password</h1>
        {error ? <p style={{ color: 'red' }}>{error}</p> : <p>Verifying your reset link...</p>}
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 360, margin: '80px auto', fontFamily: 'sans-serif' }}>
      <h1>Set a new password</h1>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 12 }}>
          <label>New password (min 8 characters)</label>
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
          {loading ? 'Updating...' : 'Update password'}
        </button>
      </form>
    </main>
  )
}
