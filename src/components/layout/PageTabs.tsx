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
    <div className="flex flex-wrap gap-1 rounded-2xl border border-line bg-white p-1">
      {tabs.map(tab => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              active
                ? 'bg-ink text-paper shadow-sm'
                : 'text-mist hover:bg-bone hover:text-ink'
            }`}
          >
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}

// Direct sales (直販) and the 販売先一覧 were retired and merged into the wholesale
// system (卸売注文 / 会員管理). Shopify remains its own channel.
export const SALES_TABS: PageTab[] = [
  { href: '/wholesale/orders', label: '卸売注文' },
  { href: '/ec-sales', label: 'Shopify' },
]

export const PURCHASING_TABS: PageTab[] = [
  { href: '/purchase-orders', label: '発注' },
  { href: '/suppliers', label: '仕入先一覧' },
]
