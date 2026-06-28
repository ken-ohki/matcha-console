'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
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
  signerName: '',
  signerPosition: '',
  traderType: 'BUSINESS',
  vatNo: '',
  eori: '',
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
  // 輸出書類（Commercial Invoice）用
  { key: 'signerName', label: '署名者氏名（輸出書類）', placeholder: '例: 北川 唯生' },
  { key: 'signerPosition', label: '署名者 役職（輸出書類）', placeholder: '例: 代表取締役' },
  { key: 'traderType', label: 'Trader Type（輸出書類）', placeholder: 'BUSINESS' },
  { key: 'vatNo', label: 'VAT番号（輸出書類・任意）' },
  { key: 'eori', label: 'EORI番号（輸出書類・任意）' },
]

export default function SettingsIssuerPage() {
  const [form, setForm] = useState<IssuerInfo>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const { user } = useAuth()
  const { confirm } = useConfirm()
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
        signerName: form.signerName.trim(),
        signerPosition: form.signerPosition.trim(),
        traderType: form.traderType.trim(),
        vatNo: form.vatNo.trim(),
        eori: form.eori.trim(),
      }
      await services.settings.updateIssuer(cleaned)
      setFeedback({ tone: 'success', message: '自社情報を保存しました' })
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  const handleResetDefaults = async () => {
    if (!(await confirm({ message: 'デフォルト値で上書きします（保存はしません）。よろしいですか？', danger: true, confirmLabel: 'OK' }))) return
    setForm({
      company: ISSUER.company,
      companyEn: ISSUER.companyEn,
      postalCode: ISSUER.postalCode,
      address: ISSUER.address,
      addressEn: ISSUER.addressEn,
      tel: ISSUER.tel,
      email: ISSUER.email,
      registrationNumber: ISSUER.registrationNumber,
      signerName: ISSUER.signerName,
      signerPosition: ISSUER.signerPosition,
      traderType: ISSUER.traderType,
      vatNo: ISSUER.vatNo,
      eori: ISSUER.eori,
    })
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
          <h1 className="mt-3 text-3xl font-bold text-ink">請求書 自社情報</h1>
          <p className="mt-2 text-sm text-mist">
            請求書・納品書・見積書に印字される自社の住所・連絡先・登録番号を設定します。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/settings/masters" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">マスター管理</Link>
          <Link href="/settings/users" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">ユーザー管理</Link>
          <Link href="/settings/terms" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">請求書 T&amp;C</Link>
          <Link href="/settings/bank-accounts" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">入金口座</Link>
          <Link href="/settings/issuer" className="rounded-full bg-ink px-3 py-1.5 text-paper">自社情報</Link>
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

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-graphite hover:bg-bone"
          >
            デフォルトに戻す
          </button>
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
