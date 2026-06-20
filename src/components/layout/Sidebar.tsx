'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Building2, Calculator, ClipboardList, ExternalLink, Globe, LayoutDashboard, Leaf, Package, LogOut, PackageMinus, PackageOpen, Send, Settings, ShoppingBag, Truck, UserCheck, X } from 'lucide-react'
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
    label: 'ホーム',
    items: [
      { href: '/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
    ],
  },
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
      { href: '/wholesale/members', label: '会員管理', icon: UserCheck },
      { href: '/wholesale/orders', label: '卸売注文', icon: Globe },
      { href: '/purchase-orders', label: '仕入管理', icon: ClipboardList, match: ['/purchase-orders', '/suppliers'] },
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
      <aside className={`fixed left-0 top-0 z-40 flex h-full w-72 max-w-[85vw] flex-col border-r border-line bg-[#e7e7e7] shadow-[1px_0_4px_rgba(17,17,17,0.04)] transition-transform md:w-60 md:max-w-none md:translate-x-0 md:pointer-events-auto ${
        open ? 'translate-x-0 pointer-events-auto' : '-translate-x-full pointer-events-none md:pointer-events-auto'
      }`}>
        <div className="flex items-center justify-between border-b border-ink px-6 py-5">
          <div>
            <p className="kicker-mute mb-1">Tea Ops</p>
            <h1 className="display-2 text-lg leading-tight text-ink">Matcha Console</h1>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-mist transition hover:text-ink md:hidden"
            aria-label="メニューを閉じる"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {navGroups.map(group => (
            <div key={group.label} className="mb-3.5 last:mb-0">
              <p className="folio mb-1 px-3">{group.label}</p>
              {group.items.map(item => {
                const Icon = item.icon
                const matchPaths = item.match ?? [item.href]
                const active = matchPaths.some(p => pathname === p || pathname.startsWith(p + '/'))
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`mb-px flex items-center gap-3 rounded-md border-l-2 py-1.5 pl-2.5 pr-3 text-[13px] font-bold transition-colors ${
                      active
                        ? 'border-matcha bg-paper text-ink'
                        : 'border-transparent text-graphite hover:bg-paper/60 hover:text-ink'
                    }`}
                  >
                    <Icon size={17} strokeWidth={active ? 2 : 1.6} />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-line px-3 py-4">
          <a
            href="/catalog"
            target="_blank"
            rel="noopener noreferrer"
            className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[13px] font-bold text-graphite transition-colors hover:border-ink hover:text-ink"
          >
            <span className="flex items-center gap-3">
              <Leaf size={17} strokeWidth={1.6} />
              カタログを開く
            </span>
            <ExternalLink size={14} className="text-mist" />
          </a>
          {user && (
            <div className="mb-2 px-3 py-2">
              <p className="truncate text-xs text-mist">{user.email}</p>
              <span className={`font-mono text-[10px] uppercase tracking-brand ${user.role === 'admin' ? 'text-matcha' : 'text-mist'}`}>
                {user.role === 'admin' ? 'Admin' : 'Viewer'}
              </span>
            </div>
          )}
          <button
            onClick={() => {
              onClose()
              void logout()
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-[13px] font-bold text-graphite transition-colors hover:bg-paper/60 hover:text-ink"
          >
            <LogOut size={17} strokeWidth={1.6} />
            ログアウト
          </button>
        </div>
      </aside>
    </>
  )
}
