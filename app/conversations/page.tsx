import { redirect } from 'next/navigation'

// The inbox now lives on the home page.
export default function ConversationsPage() {
  redirect('/')
}
