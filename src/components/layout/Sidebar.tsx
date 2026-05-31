'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Building2, Calculator, ClipboardList, ExternalLink, Leaf, Package, LogOut, PackageMinus, PackageOpen, Send, Settings, ShoppingBag, Truck, X } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import type { LucideIcon } from 'lucide-react'

interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  match?: string[]
}

const navGroups: { label: string; items: NavItem[] }[] = [
  {
    label: '倉庫',
    items: [
      { href: '/inventory', label: '在庫管理', icon: Package },
      { href: '/receiving', label: '入荷管理', icon: PackageOpen },
      { href: '/shipping', label: '発送管理', icon: Send },
    ],
  },
  {
    label: '営業',
    items: [
      { href: '/sales', label: '販売管理', icon: Leaf, match: ['/sales', '/ec-sales', '/buyers'] },
      { href: '/purchase-orders', label: '仕入れ管理', icon: ClipboardList, match: ['/purchase-orders', '/suppliers'] },
      { href: '/self-consumption', label: '自社消費', icon: PackageMinus },
    ],
  },
  {
    label: '経理',
    items: [
      { href: '/financials', label: '収支管理', icon: Calculator },
      { href: '/receivables', label: '入金管理', icon: ArrowDownCircle },
      { href: '/payables', label: '支払管理', icon: ArrowUpCircle },
    ],
  },
  {
    label: '管理',
    items: [
      { href: '/settings/masters', label: '設定', icon: Settings },
    ],
  },
]

export function Sidebar({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const pathname = usePathname()
  const { user, logout } = useAuth()

  useEffect(() => {
    onClose()
    // Only auto-close on route change, NOT on onClose identity change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-black/35 transition-opacity md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      <aside className={`fixed left-0 top-0 z-40 flex h-full w-72 max-w-[85vw] flex-col bg-[#173c2a] transition-transform md:w-60 md:max-w-none md:translate-x-0 md:pointer-events-auto ${
        open ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none md:pointer-events-auto'
      }`}>
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5">
          <div>
          <p className="mb-1 text-xs uppercase tracking-[0.2em] text-emerald-100/70">Tea Ops</p>
          <h1 className="text-lg font-bold leading-tight text-white">Matcha Console</h1>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-emerald-50/80 transition hover:bg-white/10 hover:text-white md:hidden"
            aria-label="メニューを閉じる"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {navGroups.map(group => (
            <div key={group.label} className="mb-4 last:mb-0">
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-100/45">
                {group.label}
              </p>
              {group.items.map(item => {
                const Icon = item.icon
                const matchPaths = item.match ?? [item.href]
                const active = matchPaths.some(p => pathname === p || pathname.startsWith(p + '/'))
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
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
            </div>
          ))}
        </nav>

        <div className="border-t border-white/10 px-3 py-4">
          <a
            href="/catalog"
            target="_blank"
            rel="noopener noreferrer"
            className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-white/10 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/15"
          >
            <span className="flex items-center gap-3">
              <Leaf size={18} />
              カタログを開く
            </span>
            <ExternalLink size={14} className="text-emerald-50/70" />
          </a>
          {user && (
            <div className="mb-2 px-3 py-2">
              <p className="truncate text-xs text-emerald-50/60">{user.email}</p>
              <span className={`text-xs font-medium ${user.role === 'admin' ? 'text-emerald-300' : 'text-emerald-50/50'}`}>
                {user.role === 'admin' ? 'Admin' : 'Viewer'}
              </span>
            </div>
          )}
          <button
            onClick={() => {
              onClose()
              void logout()
            }}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-emerald-50/80 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut size={18} />
            ログアウト
          </button>
        </div>
      </aside>
    </>
  )
}
