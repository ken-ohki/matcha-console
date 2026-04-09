'use client'

import { useEffect, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { getServices } from '@/lib/services'
import type { Settings } from '@/types'
import { Database, Info, ShieldCheck } from 'lucide-react'

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    getServices().then(async services => {
      setSettings(await services.settings.getSettings())
    })
  }, [])

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-[#173c2a]">設定</h1>
          <p className="text-sm text-[#5d6b61] mt-1">ChaFlow の Firebase 接続前提と運用ルールです。</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <Database className="text-[#174c33] mb-3" />
            <p className="text-sm text-[#5d6b61]">Firestore DB</p>
            <p className="text-xl font-semibold text-[#173c2a]">{process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'chaflow'}</p>
          </div>
          <div className="rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <Info className="text-[#8d5b08] mb-3" />
            <p className="text-sm text-[#5d6b61]">低在庫アラート</p>
            <p className="text-xl font-semibold text-[#173c2a]">
              {settings ? `${Math.round(settings.stockAlertRatio * 100)}%` : '--'}
            </p>
          </div>
          <div className="rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <ShieldCheck className="text-[#6b3db5] mb-3" />
            <p className="text-sm text-[#5d6b61]">認証方式</p>
            <p className="text-xl font-semibold text-[#173c2a]">Firebase Auth</p>
          </div>
        </div>

        <div className="rounded-2xl border border-[#d9d1be] bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-lg font-semibold text-[#173c2a]">運用ルール</h2>
          <ul className="space-y-3 text-sm text-[#4d5b52]">
            <li>販売案件のうち `商談中` と `確定` は在庫引当対象として扱います。</li>
            <li>`取消` に変更した案件は在庫引当から除外されます。</li>
            <li>初回ログインした Firebase ユーザーは `admin` として `users` コレクションに作成されます。</li>
          </ul>
        </div>
      </div>
    </AppLayout>
  )
}
