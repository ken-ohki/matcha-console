'use client'

import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { SETTINGS_GROUPS, type SettingsKey } from '@/components/settings/SettingsNav'
import { Settings } from 'lucide-react'

const DESCRIPTIONS: Record<SettingsKey, string> = {
  issuer: '請求書・帳票に印字する会社情報',
  terms: '英文請求書の取引条件（T&C）',
  'bank-accounts': '振込先口座（請求書・案内メール）',
  emails: '自動送付メールの件名・本文',
  wholesale: '卸売の各種設定・スタッフ通知',
  masters: '産地・品種などの選択肢マスター',
  users: 'スタッフアカウントと権限',
}

export default function SettingsHomePage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const groups = SETTINGS_GROUPS.map(g => ({
    title: g.title,
    items: g.items.filter(i => isAdmin || !i.adminOnly),
  })).filter(g => g.items.length > 0)

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-3 py-1 text-sm font-medium text-graphite">
            <Settings size={15} />
            設定
          </div>
          <h1 className="mt-3 text-3xl font-bold text-ink">設定</h1>
          <p className="mt-2 text-sm text-mist">各種設定をカテゴリ別に管理します。</p>
        </div>

        {groups.map(group => (
          <div key={group.title}>
            <p className="mb-2 text-[11px] font-mono uppercase tracking-brand text-mist">{group.title}</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map(item => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="rounded-2xl border border-line bg-white p-4 shadow-sm transition hover:bg-[#f5f2e8]"
                >
                  <p className="text-sm font-semibold text-ink">{item.label}</p>
                  <p className="mt-1 text-xs text-mist">{DESCRIPTIONS[item.key]}</p>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AppLayout>
  )
}
