import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Bypasses RLS entirely — never import into client components, never expose
// to the browser. Used only where a trusted server-side operation must cross
// tenant boundaries, e.g. tenant onboarding (creating the first tenant + owner
// row, before any tenant context exists to scope an RLS-bound query to).
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
