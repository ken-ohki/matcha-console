'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getServices, type IssuerInfo } from '@/lib/services'
import { ISSUER } from '@/lib/invoice'
import { Save, Settings } from 'lucide-react'

const EMPTY: IssuerInfo = {
  company: '',
  companyEn: '',
  postalCode: '',
  address: '',
  addressEn: '',
  tel: '',
  email: '',
  registrationNumber: '',
}

const FIELDS: { key: keyof IssuerInfo; label: string; placeholder?: string; full?: boolean }[] = [
  { key: 'company', label: '会社名（日本語）' },
  { key: 'companyEn', label: '会社名（英語）' },
  { key: 'postalCode', label: '郵便番号', placeholder: '〒000-0000' },
  { key: 'tel', label: '電話番号' },
  { key: 'address', label: '住所（日本語）', full: true },
  { key: 'addressEn', label: '住所（英語）', full: true },
  { key: 'email', label: 'Email' },
  { key: 'registrationNumber', label: '適格請求書発行事業者 登録番号', placeholder: 'T0000000000000' },
]

export default function SettingsIssuerPage() {
  const [form, setForm] = useState<IssuerInfo>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const stored = await services.settings.getIssuer()
    setForm(stored)
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
      const cleaned: IssuerInfo = {
        company: form.company.trim(),
        companyEn: form.companyEn.trim(),
        postalCode: form.postalCode.trim(),
        address: form.address.trim(),
        addressEn: form.addressEn.trim(),
        tel: form.tel.trim(),
        email: form.email.trim(),
        registrationNumber: form.registrationNumber.trim(),
      }
      await services.settings.updateIssuer(cleaned)
      setFeedback({ tone: 'success', message: '自社情報を保存しました' })
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  const handleResetDefaults = () => {
    if (!confirm('デフォルト値で上書きします（保存はしません）。よろしいですか？')) return
    setForm({
      company: ISSUER.company,
      companyEn: ISSUER.companyEn,
      postalCode: ISSUER.postalCode,
      address: ISSUER.address,
      addressEn: ISSUER.addressEn,
      tel: ISSUER.tel,
      email: ISSUER.email,
      registrationNumber: ISSUER.registrationNumber,
    })
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
          <h1 className="mt-3 text-3xl font-bold text-[#173c2a]">請求書 自社情報</h1>
          <p className="mt-2 text-sm text-[#68756c]">
            請求書・納品書・見積書に印字される自社の住所・連絡先・登録番号を設定します。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/settings/masters" className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]">マスター管理</Link>
          <Link href="/settings/users" className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]">ユーザー管理</Link>
          <Link href="/settings/terms" className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]">請求書 T&amp;C</Link>
          <Link href="/settings/bank-accounts" className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]">入金口座</Link>
          <Link href="/settings/issuer" className="rounded-full bg-[#174c33] px-3 py-1.5 text-white">自社情報</Link>
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
          <div className="rounded-3xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
              {FIELDS.map(field => (
                <div key={field.key} className={field.full ? 'md:col-span-2' : ''}>
                  <label className="mb-1 block text-sm font-medium text-[#173c2a]">{field.label}</label>
                  <input
                    type="text"
                    value={form[field.key]}
                    onChange={e => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              ))}
            </div>
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
