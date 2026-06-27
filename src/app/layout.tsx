import type { Metadata } from 'next'
import { Inter, Noto_Sans_JP, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext'
import { ConfirmProvider } from '@/contexts/ConfirmContext'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const notoSansJp = Noto_Sans_JP({ subsets: ['latin'], variable: '--font-noto-sans-jp', display: 'swap' })
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'Matcha Console',
  description: 'お茶の在庫管理と販売管理を行うアプリケーション',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${inter.variable} ${notoSansJp.variable} ${plexMono.variable}`}>
      <body className="font-jp bg-canvas text-ink antialiased">
        <AuthProvider>
          <ConfirmProvider>
            {children}
          </ConfirmProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
