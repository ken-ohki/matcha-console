'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import { ISSUER } from '@/lib/invoice'
import { Save, Settings } from 'lucide-react'

export default function SettingsBankAccountsPage() {
  const [ja, setJa] = useState('')
  const [en, setEn] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const stored = await services.settings.getBankAccounts()
    setJa(stored.ja || ISSUER.bankInfo)
    setEn(stored.en || ISSUER.bankInfoEn)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setFeedback(null)
    try {
      const services = await getServices()
      await services.settings.updateBankAccounts({ ja: ja.trim(), en: en.trim() })
      setFeedback({ tone: 'success', message: '入金口座情報を保存しました' })
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  const handleResetDefaults = () => {
    if (!confirm('デフォルトの口座情報で上書きします（保存はしません）。よろしいですか？')) return
    setJa(ISSUER.bankInfo)
    setEn(ISSUER.bankInfoEn)
  }

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="rounded-2xl border border-dashed border-[#d9d1be] bg-white p-10 text-center text-sm text-[#68756c]">
          このページは管理者のみアクセスできます。
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-3 py-1 text-sm font-medium text-[#5e44a8]">
            <Settings size={15} />
            設定
          </div>
          <h1 className="mt-3 text-3xl font-bold text-[#173c2a]">請求書 入金口座</h1>
          <p className="mt-2 text-sm text-[#68756c]">
            請求書に記載される入金口座を、国内用（日本語）と海外用（英語）で個別に設定できます。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/settings/masters" className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]">マスター管理</Link>
          <Link href="/settings/users" className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]">ユーザー管理</Link>
          <Link href="/settings/terms" className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]">請求書 T&amp;C</Link>
          <Link href="/settings/bank-accounts" className="rounded-full bg-[#174c33] px-3 py-1.5 text-white">入金口座</Link>
          <Link href="/settings/issuer" className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]">自社情報</Link>
          <Link href="/settings/wholesale" className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]">卸売設定</Link>
        </div>

        {feedback && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${
            feedback.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}>
            {feedback.message}
          </div>
        )}

        {loading ? (
          <p className="py-10 text-center text-sm text-[#68756c]">読み込み中…</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-3xl border border-[#d9d1be] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-[#173c2a]">国内用（日本語請求書）</h2>
              <p className="mt-1 text-xs text-[#68756c]">日本語の請求書「振込先」欄に表示されます。</p>
              <textarea
                rows={6}
                value={ja}
                onChange={e => setJa(e.target.value)}
                className="mt-3 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 font-mono"
                placeholder="銀行名 支店名 種別 口座番号&#10;口座名義"
              />
            </section>

            <section className="rounded-3xl border border-[#d9d1be] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-[#173c2a]">海外用（英語請求書）</h2>
              <p className="mt-1 text-xs text-[#68756c]">英語請求書の "Bank Information" 欄に表示されます。SWIFT コードも記載してください。</p>
              <textarea
                rows={6}
                value={en}
                onChange={e => setEn(e.target.value)}
                className="mt-3 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 font-mono"
                placeholder="Account Name: ...&#10;Bank Name: ...&#10;Account Number: ...&#10;SWIFT Code: ..."
              />
            </section>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            デフォルトに戻す
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 rounded-xl bg-[#174c33] px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-[#205f43] disabled:opacity-60"
          >
            <Save size={14} />
            {saving ? '保存中…' : '変更を保存'}
          </button>
        </div>
      </div>
    </AppLayout>
  )
}
