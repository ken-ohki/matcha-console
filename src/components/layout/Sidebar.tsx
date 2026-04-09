'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Leaf, Package, Settings, LogOut } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'

const navItems = [
  { href: '/inventory', label: '在庫マスター', icon: Package },
  { href: '/sales', label: '販売管理', icon: Leaf },
  { href: '/settings', label: '設定', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const { user, logout } = useAuth()

  return (
    <aside className="fixed left-0 top-0 h-full w-60 bg-[#173c2a] flex flex-col z-30">
      <div className="px-6 py-5 border-b border-white/10">
        <p className="text-xs uppercase tracking-[0.2em] text-emerald-100/70 mb-1">Tea Ops</p>
        <h1 className="text-white font-bold text-lg leading-tight">ChaFlow</h1>
      </div>

      <nav className="flex-1 py-4 px-3">
        {navItems.map(item => {
          const Icon = item.icon
          const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 text-sm font-medium transition-colors ${
                active
                  ? 'bg-[#285e3f] text-white'
                  : 'text-emerald-50/80 hover:bg-white/10 hover:text-white'
              }`}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="px-3 py-4 border-t border-white/10">
        {user && (
          <div className="px-3 py-2 mb-2">
            <p className="text-emerald-50/60 text-xs truncate">{user.email}</p>
            <span className={`text-xs font-medium ${user.role === 'admin' ? 'text-emerald-300' : 'text-emerald-50/50'}`}>
              {user.role === 'admin' ? 'Admin' : 'Viewer'}
            </span>
          </div>
        )}
        <button
          onClick={() => logout()}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-emerald-50/80 hover:bg-white/10 hover:text-white transition-colors"
        >
          <LogOut size={18} />
          ログアウト
        </button>
      </div>
    </aside>
  )
}
