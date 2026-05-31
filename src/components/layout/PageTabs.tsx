'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface PageTab {
  href: string
  label: string
}

export function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const pathname = usePathname()
  return (
    <div className="flex flex-wrap gap-1 rounded-2xl border border-[#d9d1be] bg-white p-1">
      {tabs.map(tab => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? 'bg-[#174c33] text-white shadow-sm'
                : 'text-[#68756c] hover:bg-[#f1ede0] hover:text-[#173c2a]'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}

export const SALES_TABS: PageTab[] = [
  { href: '/sales', label: '直販' },
  { href: '/ec-sales', label: 'EC販売' },
  { href: '/buyers', label: '販売先一覧' },
]

export const PURCHASING_TABS: PageTab[] = [
  { href: '/purchase-orders', label: '発注' },
  { href: '/suppliers', label: '仕入先一覧' },
]
