import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Google sign-in lands here: finish the session and check this person is hotel staff. */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const back = (reason: string) => NextResponse.redirect(new URL(`/login?error=${reason}`, url.origin))
  if (!code) return back('google_failed')

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) return back('google_failed')

  const { data: staff } = await supabase.from('staff_users').select('id').eq('auth_uid', data.user.id).maybeSingle()
  if (!staff) {
    await supabase.auth.signOut()
    return back('no_access')
  }
  return NextResponse.redirect(new URL('/cloudbeds', url.origin))
}
