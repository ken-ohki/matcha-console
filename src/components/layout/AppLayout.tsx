'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Menu } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Sidebar } from './Sidebar'

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (!user) {
      setSidebarOpen(false)
    }
  }, [user])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="kicker-mute">読み込み中…</div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-canvas">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="min-h-screen bg-canvas md:ml-60">
        <div className="sticky top-0 z-20 border-b border-line bg-canvas/95 backdrop-blur md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="kicker-mute">Tea Ops</p>
              <h1 className="display-2 text-base text-ink">Matcha Console</h1>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="relative z-30 inline-flex h-11 w-11 items-center justify-center rounded-lg border border-ink bg-paper text-ink active:bg-bone"
              aria-label="メニューを開く"
            >
              <Menu size={20} />
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-content px-4 py-bl-4 sm:px-6 sm:py-bl-8">
          {children}
        </div>
      </main>
    </div>
  )
}
