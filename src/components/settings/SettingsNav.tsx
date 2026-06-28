import Link from 'next/link'

export type SettingsKey =
  | 'issuer'
  | 'terms'
  | 'bank-accounts'
  | 'emails'
  | 'wholesale'
  | 'masters'
  | 'users'

interface NavItem { key: SettingsKey; href: string; label: string; adminOnly?: boolean }
interface NavGroup { title: string; items: NavItem[] }

export const SETTINGS_GROUPS: NavGroup[] = [
  {
    title: '会社・書類',
    items: [
      { key: 'issuer', href: '/settings/issuer', label: '自社情報', adminOnly: true },
      { key: 'terms', href: '/settings/terms', label: '請求書 T&C', adminOnly: true },
      { key: 'bank-accounts', href: '/settings/bank-accounts', label: '入金口座', adminOnly: true },
      { key: 'emails', href: '/settings/emails', label: 'メール文面', adminOnly: true },
    ],
  },
  {
    title: '取引・商品',
    items: [
      { key: 'wholesale', href: '/settings/wholesale', label: '卸売設定', adminOnly: true },
      { key: 'masters', href: '/settings/masters', label: 'マスター管理' },
    ],
  },
  {
    title: 'システム',
    items: [{ key: 'users', href: '/settings/users', label: 'ユーザー管理', adminOnly: true }],
  },
]

/** Shared, grouped settings navigation. Pass the current page's `active` key to
 *  highlight it. Non-admins only see non-admin items (currently マスター管理). */
export function SettingsNav({ active, isAdmin = true }: { active: SettingsKey; isAdmin?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {SETTINGS_GROUPS.map(group => ({ title: group.title, items: group.items.filter(i => isAdmin || !i.adminOnly) }))
        .filter(group => group.items.length > 0)
        .map((group, gi) => (
        <div key={group.title} className="flex flex-wrap items-center gap-2">
          {gi > 0 && <span className="hidden text-line sm:inline">|</span>}
          <span className="text-[11px] font-mono uppercase tracking-brand text-mist">{group.title}</span>
          {group.items.map(item => (
            <Link
              key={item.key}
              href={item.href}
              className={
                item.key === active
                  ? 'rounded-full bg-ink px-3 py-1.5 text-paper'
                  : 'rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]'
              }
            >
              {item.label}
            </Link>
          ))}
        </div>
      ))}
    </div>
  )
}
