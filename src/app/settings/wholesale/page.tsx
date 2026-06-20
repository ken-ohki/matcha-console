'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type { Settings, ShippingTierJp, WholesaleOption, WholesaleRankDiscounts } from '@/types'
import { Save, Settings as SettingsIcon, Plus, Trash2 } from 'lucide-react'

const DEFAULT_THRESHOLD = 10
const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)

export default function SettingsWholesalePage() {
  const [threshold, setThreshold] = useState<number | ''>('')
  const [sampleFee, setSampleFee] = useState<number | ''>('')
  const [rankDiscounts, setRankDiscounts] = useState<WholesaleRankDiscounts>({ standard: 0, premium: 0, exclusive: 0 })
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
    setSampleFee(stored.wholesaleSampleFeeJpy ?? 100)
    setRankDiscounts(stored.wholesaleRankDiscounts ?? { standard: 0, premium: 0, exclusive: 0 })
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
        wholesaleSampleFeeJpy: sampleFee === '' ? 0 : Math.max(0, Number(sampleFee)),
        wholesaleRankDiscounts: {
          standard: Math.min(100, Math.max(0, Number(rankDiscounts.standard) || 0)),
          premium: Math.min(100, Math.max(0, Number(rankDiscounts.premium) || 0)),
          exclusive: Math.min(100, Math.max(0, Number(rankDiscounts.exclusive) || 0)),
        },
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
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-mist">
          このページは管理者のみアクセスできます。
        </div>
      </AppLayout>
    )
  }

  const tabCls = 'rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]'

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-3 py-1 text-sm font-medium text-graphite">
            <SettingsIcon size={15} />
            設定
          </div>
          <h1 className="mt-3 text-3xl font-bold text-ink">卸売設定</h1>
          <p className="mt-2 text-sm text-mist">
            卸売サイト(wholesale.sabo-matcha.jp)のセルフ決済しきい値を全商品共通で設定します。この数量以上の注文はセルフ決済せず、問い合わせに誘導されます。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/settings/masters" className={tabCls}>マスター管理</Link>
          <Link href="/settings/users" className={tabCls}>ユーザー管理</Link>
          <Link href="/settings/terms" className={tabCls}>請求書 T&amp;C</Link>
          <Link href="/settings/bank-accounts" className={tabCls}>入金口座</Link>
          <Link href="/settings/issuer" className={tabCls}>自社情報</Link>
          <Link href="/settings/wholesale" className="rounded-full bg-ink px-3 py-1.5 text-paper">卸売設定</Link>
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
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="max-w-xs">
                <label className="mb-1 block text-sm font-medium text-ink">セルフ決済しきい値 (kg)</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={threshold}
                  onChange={e => setThreshold(e.target.value ? Number(e.target.value) : '')}
                  className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                  placeholder={String(DEFAULT_THRESHOLD)}
                />
                <p className="mt-1 text-[11px] text-mist">全商品共通。1注文あたりの数量がこの値以上のとき問い合わせに誘導します（初期値 {DEFAULT_THRESHOLD}kg）。</p>
              </div>
              <div className="max-w-xs">
                <label className="mb-1 block text-sm font-medium text-ink">サンプル手数料 (円・税抜)</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={sampleFee}
                  onChange={e => setSampleFee(e.target.value ? Number(e.target.value) : '')}
                  className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                  placeholder="100"
                />
                <p className="mt-1 text-[11px] text-mist">サンプル価格 ＝ 卸売単価 × 0.01（10g相当）＋ この手数料。全商品共通（初期値 100円）。</p>
              </div>
            </div>
          </div>
        )}

        {!loading && (
          <div className="rounded-3xl border border-line bg-white p-5 shadow-sm">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-ink">顧客ランク別 割引率（%）</h2>
              <p className="mt-1 text-[11px] text-mist">会員の顧客ランクに応じて卸売商品価格に適用される割引率です（サンプル・小分け・送料は対象外）。ランクは各顧客ページで設定します。</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {(['standard', 'premium', 'exclusive'] as const).map(rk => (
                <div key={rk}>
                  <label className="mb-1 block text-sm font-medium capitalize text-ink">{rk}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="0" max="100" step="1"
                      value={rankDiscounts[rk] || ''}
                      onChange={e => setRankDiscounts(prev => ({ ...prev, [rk]: Math.min(100, Math.max(0, Number(e.target.value) || 0)) }))}
                      className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                      placeholder="0"
                    />
                    <span className="text-sm text-mist">%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && (
          <div className="rounded-3xl border border-line bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink">国内発送 重量別送料（税抜・全国一律）</h2>
                <p className="mt-1 text-[11px] text-mist">
                  注文重量（kg）が「上限kg」以下のとき、その送料を自動適用します。最大の上限を超える注文は最も上の段の送料を適用するため、十分大きな段を用意してください。海外発送は注文ごとに手動見積です。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTiers(prev => [...prev, { uptoKg: 0, feeJpy: 0 }])}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-line px-3 py-1.5 text-sm text-ink hover:bg-bone"
              >
                <Plus size={14} /> 段を追加
              </button>
            </div>

            {tiers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-mist">
                送料段がありません。「段を追加」で重量階段を作成してください。
              </p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_1fr_40px] gap-3 px-1 text-[11px] text-mist">
                  <span>上限重量 (kg 以下)</span>
                  <span>送料 (円・税抜)</span>
                  <span />
                </div>
                {tiers.map((t, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_40px] items-center gap-3">
                    <input
                      type="number" min="0" step="0.1" value={t.uptoKg || ''}
                      onChange={e => setTiers(prev => prev.map((x, j) => (j === i ? { ...x, uptoKg: Number(e.target.value) } : x)))}
                      className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                      placeholder="例: 5"
                    />
                    <input
                      type="number" min="0" step="1" value={t.feeJpy || ''}
                      onChange={e => setTiers(prev => prev.map((x, j) => (j === i ? { ...x, feeJpy: Number(e.target.value) } : x)))}
                      className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                      placeholder="例: 800"
                    />
                    <button
                      type="button"
                      onClick={() => setTiers(prev => prev.filter((_, j) => j !== i))}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-line text-alert hover:bg-bone"
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
          <div className="rounded-3xl border border-line bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink">注文オプション（小分けサービス等）</h2>
                <p className="mt-1 text-[11px] text-mist">
                  卸売サイトで選べる注文オプションを定義します。小分けは「袋数 × 1袋単価」で課金（注文重量 ÷ 内容量＝袋数）。商品ごとの有効化は各商品の編集画面で行います。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOptions(prev => [...prev, { id: uid(), type: 'repackage', name: '小分けサービス', unitLabel: '袋', active: true, tiers: [] }])}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-line px-3 py-1.5 text-sm text-ink hover:bg-bone"
              >
                <Plus size={14} /> オプションを追加
              </button>
            </div>

            {options.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-mist">
                オプションがありません。「オプションを追加」で小分けサービスを作成してください。
              </p>
            ) : (
              <div className="space-y-4">
                {options.map((o, oi) => (
                  <div key={o.id} className="rounded-2xl border border-line p-4">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex-1 min-w-[160px]">
                        <span className="mb-1 block text-[11px] text-mist">オプション名</span>
                        <input
                          value={o.name}
                          onChange={e => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, name: e.target.value } : x)))}
                          className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                          placeholder="小分けサービス"
                        />
                      </label>
                      <label className="w-24">
                        <span className="mb-1 block text-[11px] text-mist">数量単位</span>
                        <input
                          value={o.unitLabel ?? ''}
                          onChange={e => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, unitLabel: e.target.value } : x)))}
                          className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                          placeholder="袋"
                        />
                      </label>
                      <label className="flex items-center gap-2 pb-2 text-sm text-ink">
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
                        className="flex h-9 w-9 items-center justify-center rounded-xl border border-line text-alert hover:bg-bone"
                        aria-label="オプション削除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="mt-3 border-t border-line pt-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-mist">小分けサイズ</span>
                        <button
                          type="button"
                          onClick={() => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, tiers: [...x.tiers, { id: uid(), label: '', portionKg: 0, pricePerBagJpy: 0 }] } : x)))}
                          className="inline-flex items-center gap-1 text-xs text-matchaDeep hover:underline"
                        >
                          <Plus size={12} /> サイズを追加
                        </button>
                      </div>
                      {o.tiers.length === 0 ? (
                        <p className="text-[11px] text-mist">サイズが未設定です。「サイズを追加」で 1kg・100g 等を作成してください。</p>
                      ) : (
                        <div className="space-y-2">
                          <div className="grid grid-cols-[1fr_1fr_1fr_36px] gap-2 px-1 text-[10px] text-mist">
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
                                className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                                placeholder="100g"
                              />
                              <input
                                type="number" min="0" step="0.01" value={t.portionKg || ''}
                                onChange={e => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, tiers: x.tiers.map((y, k) => (k === ti ? { ...y, portionKg: Number(e.target.value) } : y)) } : x)))}
                                className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                                placeholder="0.1"
                              />
                              <input
                                type="number" min="0" step="1" value={t.pricePerBagJpy || ''}
                                onChange={e => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, tiers: x.tiers.map((y, k) => (k === ti ? { ...y, pricePerBagJpy: Number(e.target.value) } : y)) } : x)))}
                                className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                                placeholder="150"
                              />
                              <button
                                type="button"
                                onClick={() => setOptions(prev => prev.map((x, j) => (j === oi ? { ...x, tiers: x.tiers.filter((_, k) => k !== ti) } : x)))}
                                className="flex h-9 w-9 items-center justify-center rounded-xl border border-line text-alert hover:bg-bone"
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
