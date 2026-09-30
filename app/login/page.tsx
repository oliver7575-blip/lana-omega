'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

const ERRORS: Record<string, string> = {
  google_failed: 'Google sign-in did not complete. Please try again.',
  no_access: 'That Google account is not linked to any staff account. Ask your manager to add you.',
}

// Shown on the login page; set NEXT_PUBLIC_LOGIN_TITLE in Vercel to change it.
const TITLE = process.env.NEXT_PUBLIC_LOGIN_TITLE || 'Soirée'
const FOOTER = process.env.NEXT_PUBLIC_LOGIN_FOOTER || 'Access is limited to Soirée staff. Contact Oliver if you need an account.'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const router = useRouter()
  const params = useSearchParams()

  useEffect(() => {
    const e = params.get('error')
    if (e) setError(ERRORS[e] ?? 'Sign-in failed.')
  }, [params])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error } = await createClient().auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    router.push('/')
    router.refresh()
  }

  async function handleGoogle() {
    setError(null)
    setGoogleLoading(true)
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setGoogleLoading(false)
      setError(error.message)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <p className="mb-1 font-display italic text-clay">Lana · staff access</p>
          <h1 className="font-display text-4xl uppercase italic tracking-tight text-navy">{TITLE}</h1>
        </div>
        <form onSubmit={handleSubmit} className="rounded-2xl border border-line bg-white p-8 shadow-sm">
          <button
            type="button"
            onClick={handleGoogle}
            disabled={googleLoading}
            className="mb-5 flex w-full items-center justify-center gap-2 rounded-full border border-[#1b2340] bg-[#1b2340] py-2.5 font-semibold text-white transition hover:border-[#c0574a] hover:bg-[#c0574a] disabled:opacity-60"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.4 2.9-7.4Z" />
              <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2.1 1-3.4 1a5.9 5.9 0 0 1-5.5-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
              <path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9.1L6.5 14Z" />
              <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.7 9.7 0 0 0 3.1 7.5l3.4 2.6A5.9 5.9 0 0 1 12 5.9Z" />
            </svg>
            {googleLoading ? 'Redirecting…' : 'Continue with Google'}
          </button>
          <div className="mb-5 flex items-center gap-3 text-xs font-medium text-[#64748b]">
            <span className="h-px flex-1 bg-[#cbd5e1]" />
            <span>or use password</span>
            <span className="h-px flex-1 bg-[#cbd5e1]" />
          </div>
          <label className="mb-1 block text-sm font-semibold text-[#1b2340]" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@soiree.mx"
            className="mb-4 w-full rounded-lg border border-[#94a3b8] bg-white px-3 py-2 text-[#1b2340] outline-none placeholder:text-[#64748b] focus:border-[#c0574a]"
          />
          <label className="mb-1 block text-sm font-semibold text-[#1b2340]" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="mb-6 w-full rounded-lg border border-[#94a3b8] bg-white px-3 py-2 text-[#1b2340] outline-none placeholder:text-[#64748b] focus:border-[#c0574a]"
          />
          {error && <p className="-mt-3 mb-4 text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={loading} className="w-full rounded-full bg-ink py-2.5 font-medium text-white transition hover:bg-clay disabled:opacity-60">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="mt-4 text-center text-xs">
            <Link href="/forgot-password" className="text-[#64748b] hover:text-[#c0574a]">Forgot password?</Link>
          </p>
        </form>
        <p className="mt-6 text-center text-xs text-navy/60">{FOOTER}</p>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
