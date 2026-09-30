import { redirect } from 'next/navigation'

// The panel always opens on the Dashboard; the Inbox lives at /inbox.
export default function Home() {
  redirect('/cloudbeds')
}
