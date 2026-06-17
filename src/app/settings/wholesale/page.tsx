'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type { Settings, ShippingTierJp, WholesaleOption } from '@/types'
import { Save, Settings as SettingsIcon, Plus, Trash2 } from 'lucide-react'

const DEFAULT_THRESHOLD = 10
const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)

export default function SettingsWholesalePage() {
  const [threshold, setThreshold] = useState<number | ''>('')
  const [tiers, setTiers] = useState<ShippingTierJp[]>([])
  const [options, setOptions] = useState<WholesaleOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const stored = await services.settings.getSettings()
    setThreshold(stored.wholesaleThresholdKgDefault ?? DEFAULT_THRESHOLD)
    setTiers(stored.shippingRatesJp ?? [])
    setOptions(stored.wholesaleOptions ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const handleSave = async () => {
    if (threshold === '' || Number(threshold) <= 0) {
      setFeedback({ tone: 'error', message: 'しきい値は 0 より大きい数値を入力してください' })
      return
    }
    const cleanTiers = tiers
      .map(t => ({ uptoKg: Number(t.uptoKg), feeJpy: Number(t.feeJpy) }))
      .filter(t => Number.isFinite(t.uptoKg) && Number.isFinite(t.feeJpy) && t.uptoKg > 0 && t.feeJpy >= 0)
      .sort((a, b) => a.uptoKg - b.uptoKg)
    setSaving(true)
    setFeedback(null)
    try {
      const services = await getServices()
      const cleanOptions: WholesaleOption[] = options
        .map(o => ({
          ...o,
          name: o.name.trim(),
          tiers: o.tiers
            .map(t => ({ ...t, label: t.label.trim(), portionKg: Number(t.portionKg), pricePerBagJpy: Number(t.pricePerBagJpy) }))
            .filter(t => t.label && Number.isFinite(t.portionKg) && t.portionKg > 0 && Number.isFinite(t.pricePerBagJpy) && t.pricePerBagJpy >= 0),
        }))
        .filter(o => o.name)
      const input: Partial<Settings> = {
        wholesaleThresholdKgDefault: Number(threshold),
        shippingRatesJp: cleanTiers,
        wholesaleOptions: cleanOptions,
      }
      await services.settings.updateSettings(input)
      setTiers(cleanTiers)
      setOptions(cleanOptions)
      setFeedback({ tone: 'success', message: '卸売設定を保存しました' })
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
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

  const tabCls = 'rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]'

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-3 py-1 text-sm font-medium text-[#5e44a8]">
            <SettingsIcon size={15} />
            設定
          </div>
          <h1 className="mt-3 text-3xl font-bold text-[#173c2a]">卸売設定</h1>
          <p className="mt-2 text-sm text-[#68756c]">
            卸売サイト(wholesale.sabo-matcha.jp)のセルフ決済しきい値を全商品共通で設定します。この数量以上の注文はセルフ決済せず、問い合わせに誘導されます。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/settings/masters" className={tabCls}>マスター管理</Link>
          <Link href="/settings/users" className={tabCls}>ユーザー管理</Link>
          <Link href="/settings/terms" className={tabCls}>請求書 T&amp;C</Link>
          <Link href="/settings/bank-accounts" className={tabCls}>入金口座</Link>
          <Link href="/settings/issuer" className={tabCls}>自社情報</Link>
          <Link href="/settings/wholesale" className="rounded-full bg-[#174c33] px-3 py-1.5 text-white">卸売設定</Link>
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
            <div className="max-w-xs">
              <label className="mb-1 block text-sm font-medium text-[#173c2a]">セルフ決済しきい値 (kg)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={threshold}
                onChange={e => setThreshold(e.target.value ? Number(e.target.value) : '')}
                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                placeholder={String(DEFAULT_THRESHOLD)}
              />
              <p className="mt-1 text-[11px] text-[#68756c]">全商品共通。1注文あたりの数量がこの値以上のとき問い合わせに誘導します（初期値 {DEFAULT_THRESHOLD}kg）。</p>
            </div>
          </div>
        )}

        {!loading && (
          <div className="rounded-3xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#173c2a]">国内発送 重量別送料（税抜・全国一律）</h2>
                <p className="mt-1 text-[11px] text-[#68756c]">
                  注文重量（kg）が「上限kg」以下のとき、その送料を自動適用します。最大の上限を超える注文は最も上の段の送料を適用するため、十分大きな段を用意してください。海外発送は注文ごとに手動見積です。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTiers(prev => [...prev, { uptoKg: 0, feeJpy: 0 }])}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-[#d9d1be] px-3 py-1.5 text-sm text-[#173c2a] hover:bg-[#f4f2ea]"
              >
                <Plus size={14} /> 段を追加
              </button>
            </div>

            {tiers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[#d9d1be] px-4 py-6 text-center text-sm text-[#a59f8c]">
                送料段がありません。「段を追加」で重量階段を作成してください。
              </p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_40px] gap-3 px-1 text-[11px] text-[#a59f8c]">
                  <span>上限重量 (kg 以下)</span>
                  <span>送料 (円・税抜)</span>
                  <span />
                </div>
                {tiers.map((t, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_40px] items-center gap-3">
                    <input
                      type="number" min="0" step="0.1" value={t.uptoKg || ''}
                      onChange={e => setTiers(prev => prev.map((x, j) => (j === i ? { ...x, uptoKg: Number(e.target.value) } : x)))}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      placeholder="例: 5"
                    />
                    <input
                      type="number" min="0" step="1" value={t.feeJpy || ''}
                      onChange={e => setTiers(prev => prev.map((x, j) => (j === i ? { ...x, feeJpy: Number(e.target.value) } : x)))}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      placeholder="例: 800"
                    />
                    <button
                      type="button"
                      onClick={() => setTiers(prev => prev.filter((_, j) => j !== i))}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#d9d1be] text-[#9d3d28] hover:bg-[#fff0ec]"
                      aria-label="削除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!loading && (
          <div className="rounded-3xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#173c2a]">注文オプション（小分けサービス等）</h2>
                <p className="mt-1 text-[11px] text-[#68756c]">
                  卸売サイトで選べる注文オプションを定義します。小分けは「袋数 × 1袋単価」で課金（注文重量 ÷ 内容量＝袋数）。商品ごとの有効化は各商品の編集画面で行います。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOptions(prev => [...prev, { id: uid(), type: 'repackage', name: '小分けサービス', unitLabel: '袋', active: true, tiers: [] }])}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-[#d9d1be] px-3 py-1.5 text-sm text-[#173c2a] hover:bg-[#f4f2ea]"
              >
                <Plus size={14} /> オプションを追加
              </button>
            </div>

            {options.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[#d9d1be] px-4 py-6 text-center text-sm text-[#a59f8c]">
                オプションがありません。「オプションを追加」で小分けサービスを作成してください。
              </p>
            ) : (
              <div className="space-y-4">
                {options.map((o, oi) => (
                  <div key={o.id} className="rounded-2xl border border-[#e7e1d2] p-4">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex-1 min-w-[160px]">
                        <span className="mb-1 block text-[11px] text-[#a59f8c]">オプション名</span>
                        <input
                          value={o.name}
                          onChange={e => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, name: e.target.value } : x)))}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                          placeholder="小分けサービス"
                        />
                      </label>
                      <label className="w-24">
                        <span className="mb-1 block text-[11px] text-[#a59f8c]">数量単位</span>
                        <input
                          value={o.unitLabel ?? ''}
                          onChange={e => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, unitLabel: e.target.value } : x)))}
                          className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                          placeholder="袋"
                        />
                      </label>
                      <label className="flex items-center gap-2 pb-2 text-sm text-[#173c2a]">
                        <input
                          type="checkbox"
                          checked={o.active}
                          onChange={e => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, active: e.target.checked } : x)))}
                          className="h-4 w-4 accent-[#174c33]"
                        />
                        有効
                      </label>
                      <button
                        type="button"
                        onClick={() => setOptions(prev => prev.filter((_, j) => j !== oi))}
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#d9d1be] text-[#9d3d28] hover:bg-[#fff0ec]"
                        aria-label="オプション削除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="mt-3 border-t border-[#f0ece0] pt-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-[#68756c]">小分けサイズ</span>
                        <button
                          type="button"
                          onClick={() => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, tiers: [...x.tiers, { id: uid(), label: '', portionKg: 0, pricePerBagJpy: 0 }] } : x)))}
                          className="inline-flex items-center gap-1 text-xs text-[#174c33] hover:underline"
                        >
                          <Plus size={12} /> サイズを追加
                        </button>
                      </div>
                      {o.tiers.length === 0 ? (
                        <p className="text-[11px] text-[#a59f8c]">サイズが未設定です。「サイズを追加」で 1kg・100g 等を作成してください。</p>
                      ) : (
                        <div className="space-y-2">
                          <div className="grid grid-cols-[1fr_1fr_1fr_36px] gap-2 px-1 text-[10px] text-[#a59f8c]">
                            <span>表示名（例: 100g）</span>
                            <span>内容量 (kg/袋)</span>
                            <span>単価 (円/袋・税抜)</span>
                            <span />
                          </div>
                          {o.tiers.map((t, ti) => (
                            <div key={t.id} className="grid grid-cols-[1fr_1fr_1fr_36px] items-center gap-2">
                              <input
                                value={t.label}
                                onChange={e => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, tiers: x.tiers.map((y, k) => (k === ti ? { ...y, label: e.target.value } : y)) } : x)))}
                                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                                placeholder="100g"
                              />
                              <input
                                type="number" min="0" step="0.01" value={t.portionKg || ''}
                                onChange={e => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, tiers: x.tiers.map((y, k) => (k === ti ? { ...y, portionKg: Number(e.target.value) } : y)) } : x)))}
                                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                                placeholder="0.1"
                              />
                              <input
                                type="number" min="0" step="1" value={t.pricePerBagJpy || ''}
                                onChange={e => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, tiers: x.tiers.map((y, k) => (k === ti ? { ...y, pricePerBagJpy: Number(e.target.value) } : y)) } : x)))}
                                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                                placeholder="150"
                              />
                              <button
                                type="button"
                                onClick={() => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, tiers: x.tiers.filter((_, k) => k !== ti) } : x)))}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#d9d1be] text-[#9d3d28] hover:bg-[#fff0ec]"
                                aria-label="サイズ削除"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end">
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
