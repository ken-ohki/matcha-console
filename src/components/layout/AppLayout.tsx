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
      <div className="min-h-screen flex items-center justify-center bg-[#f4f2ea]">
        <div className="text-gray-500">読み込み中...</div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-[#f4f2ea]">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="min-h-screen bg-[#f4f2ea] md:ml-60">
        <div className="sticky top-0 z-20 border-b border-[#d9d1be] bg-[#f4f2ea]/95 backdrop-blur md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-[#68756c]">Tea Ops</p>
              <h1 className="text-base font-semibold text-[#173c2a]">ChaFlow</h1>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-xl border border-[#d9d1be] bg-white p-2 text-[#173c2a] shadow-sm"
              aria-label="メニューを開く"
            >
              <Menu size={18} />
            </button>
          </div>
        </div>
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8">
          {children}
        </div>
      </main>
    </div>
  )
}
