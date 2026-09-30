import './globals.css'
import { Inter, Playfair_Display } from 'next/font/google'
import AppFrame from '@/components/AppFrame'

const inter = Inter({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-inter' })
const playfair = Playfair_Display({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  variable: '--font-playfair',
})

export const metadata = {
  title: 'Lana Admin',
  description: "Conversation and reservation admin panel for Lana, the hotel concierge.",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${playfair.variable} font-body`}>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  )
}
