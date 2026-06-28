'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getServices, type ExportSettingsInfo } from '@/lib/services'
import { Save, Settings } from 'lucide-react'

const EMPTY: ExportSettingsInfo = {
  incotermsDefault: 'FOB',
  incotermsPlace: '',
  reasonForExport: 'Commercial',
  typeOfExport: 'Commercial Purposes/Sale',
  dutyPayer: 'Receiver Will Pay',
  payerOfVat: '',
  defaultCarrier: 'DHL',
}

const FIELDS: { key: keyof ExportSettingsInfo; label: string; placeholder?: string; full?: boolean }[] = [
  { key: 'incotermsDefault', label: 'Incoterms（取引条件）の既定', placeholder: 'FOB / CIF / DAP 等' },
  { key: 'incotermsPlace', label: 'Place of Incoterm（地名）', placeholder: '例: Toyama, Japan' },
  { key: 'defaultCarrier', label: '既定の配送業者（Carrier）', placeholder: 'DHL' },
  { key: 'reasonForExport', label: 'Reason for Export', placeholder: 'Commercial' },
  { key: 'typeOfExport', label: 'Type of Export', placeholder: 'Commercial Purposes/Sale', full: true },
  { key: 'dutyPayer', label: 'Duty / taxes account（関税負担）', placeholder: 'Receiver Will Pay' },
  { key: 'payerOfVat', label: 'Payer of GST / VAT', placeholder: '（任意）' },
]

export default function SettingsExportPage() {
  const [form, setForm] = useState<ExportSettingsInfo>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    setForm(await services.settings.getExportSettings())
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
      const cleaned: ExportSettingsInfo = {
        incotermsDefault: form.incotermsDefault.trim(),
        incotermsPlace: form.incotermsPlace.trim(),
        reasonForExport: form.reasonForExport.trim(),
        typeOfExport: form.typeOfExport.trim(),
        dutyPayer: form.dutyPayer.trim(),
        payerOfVat: form.payerOfVat.trim(),
        defaultCarrier: form.defaultCarrier.trim(),
      }
      await services.settings.updateExportSettings(cleaned)
      setFeedback({ tone: 'success', message: '輸出設定を保存しました' })
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-mist">
          このページは管理者のみアクセスできます。
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-3 py-1 text-sm font-medium text-graphite">
            <Settings size={15} />
            設定
          </div>
          <h1 className="mt-3 text-3xl font-bold text-ink">輸出設定（Commercial Invoice）</h1>
          <p className="mt-2 text-sm text-mist">
            越境注文の Commercial Invoice（通関書類）に印字する既定値です。注文ごとに上書きされていない場合に使用します。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/settings/masters" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">マスター管理</Link>
          <Link href="/settings/users" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">ユーザー管理</Link>
          <Link href="/settings/terms" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">請求書 T&amp;C</Link>
          <Link href="/settings/bank-accounts" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">入金口座</Link>
          <Link href="/settings/issuer" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">自社情報</Link>
          <Link href="/settings/export" className="rounded-full bg-ink px-3 py-1.5 text-paper">輸出設定</Link>
          <Link href="/settings/wholesale" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">卸売設定</Link>
        </div>

        {feedback && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${
            feedback.tone === 'success'
              ? 'border-matcha/40 bg-bone text-matcha'
              : 'border-alert/40 bg-alert/5 text-alert'
          }`}>
            {feedback.message}
          </div>
        )}

        {loading ? (
          <p className="py-10 text-center text-sm text-mist">読み込み中…</p>
        ) : (
          <div className="rounded-3xl border border-line bg-white p-5 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
              {FIELDS.map(field => (
                <div key={field.key} className={field.full ? 'md:col-span-2' : ''}>
                  <label className="mb-1 block text-sm font-medium text-ink">{field.label}</label>
                  <input
                    type="text"
                    value={form[field.key]}
                    onChange={e => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={field.placeholder}
                    className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper shadow transition hover:bg-[#205f43] disabled:opacity-60"
          >
            <Save size={14} />
            {saving ? '保存中…' : '変更を保存'}
          </button>
        </div>
      </div>
    </AppLayout>
  )
}
