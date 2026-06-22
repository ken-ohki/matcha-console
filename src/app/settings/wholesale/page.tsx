'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type { Settings, ShippingTierJp, WholesaleCoupon, WholesaleOption, WholesaleRankDiscounts } from '@/types'
import { Save, Settings as SettingsIcon, Plus, Trash2 } from 'lucide-react'

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10)

// Toggleable staff-notification emails (key + label). 要返金 is always sent (not listed).
const STAFF_EMAIL_EVENTS: { key: string; label: string }[] = [
  { key: 'registration', label: '新規会員登録（承認待ち）' },
  { key: 'order_paid', label: 'カード入金済みの新規注文' },
  { key: 'order_bank', label: '銀行振込の新規注文（入金待ち）' },
  { key: 'order_approval', label: '受注生産の承認待ち' },
  { key: 'order_quote', label: '海外発送の見積依頼' },
  { key: 'quote_sent', label: '見積（送料確定）の送付控え' },
  { key: 'shipment', label: '発送通知の送信控え' },
  { key: 'member_cancel', label: 'お客様によるキャンセル/辞退' },
]
const ALL_STAFF_EMAIL_KEYS = STAFF_EMAIL_EVENTS.map(e => e.key)

export default function SettingsWholesalePage() {
  const [sampleFee, setSampleFee] = useState<number | ''>('')
  const [rankDiscounts, setRankDiscounts] = useState<WholesaleRankDiscounts>({ standard: 0, premium: 0, exclusive: 0 })
  const [tiers, setTiers] = useState<ShippingTierJp[]>([])
  const [options, setOptions] = useState<WholesaleOption[]>([])
  const [coupons, setCoupons] = useState<WholesaleCoupon[]>([])
  const [products, setProducts] = useState<{ id: string; name: string; sku?: string }[]>([])
  const [orderingPaused, setOrderingPaused] = useState(false)
  const [pausedMessage, setPausedMessage] = useState('')
  const [staffEmailEvents, setStaffEmailEvents] = useState<string[]>(ALL_STAFF_EMAIL_KEYS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const stored = await services.settings.getSettings()
    setSampleFee(stored.wholesaleSampleFeeJpy ?? 100)
    setRankDiscounts(stored.wholesaleRankDiscounts ?? { standard: 0, premium: 0, exclusive: 0 })
    setTiers(stored.shippingRatesJp ?? [])
    setOptions(stored.wholesaleOptions ?? [])
    setCoupons(stored.wholesaleCoupons ?? [])
    setOrderingPaused(stored.orderingPaused ?? false)
    setPausedMessage(stored.orderingPausedMessage ?? '')
    // Unset = all enabled (backward compatible).
    setStaffEmailEvents(stored.staffEmailEvents ?? ALL_STAFF_EMAIL_KEYS)
    try {
      const prods = await services.inventory.getProductsWithInventory()
      setProducts(prods.map(p => ({ id: p.id, name: p.name, sku: p.sku })))
    } catch {
      setProducts([])
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const handleSave = async () => {
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
      const cleanCoupons: WholesaleCoupon[] = coupons
        .map(c => ({
          id: c.id,
          code: c.code.trim().toUpperCase(),
          name: c.name.trim(),
          discountType: c.discountType === 'fixed' ? 'fixed' as const : 'percentage' as const,
          discountValue: Math.max(0, Number(c.discountValue) || 0),
          eligibleProductIds: Array.isArray(c.eligibleProductIds) ? c.eligibleProductIds : [],
          expiresAt: (c.expiresAt ?? '').trim() || undefined,
          active: c.active !== false,
        }))
        .filter(c => c.code && c.name)
      const input: Partial<Settings> = {
        wholesaleCoupons: cleanCoupons,
        wholesaleSampleFeeJpy: sampleFee === '' ? 0 : Math.max(0, Number(sampleFee)),
        wholesaleRankDiscounts: {
          standard: Math.min(100, Math.max(0, Number(rankDiscounts.standard) || 0)),
          premium: Math.min(100, Math.max(0, Number(rankDiscounts.premium) || 0)),
          exclusive: Math.min(100, Math.max(0, Number(rankDiscounts.exclusive) || 0)),
        },
        shippingRatesJp: cleanTiers,
        wholesaleOptions: cleanOptions,
        orderingPaused,
        orderingPausedMessage: pausedMessage.trim(),
        staffEmailEvents: STAFF_EMAIL_EVENTS.filter(e => staffEmailEvents.includes(e.key)).map(e => e.key),
      }
      await services.settings.updateSettings(input)
      setTiers(cleanTiers)
      setOptions(cleanOptions)
      setCoupons(cleanCoupons)
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
            卸売サイト(wholesale.sabo-matcha.jp)の各種設定（サンプル手数料・顧客ランク割引など）を行います。
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
          <>
          <div className="mb-5 rounded-3xl border border-line bg-white p-5 shadow-sm">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input type="checkbox" checked={orderingPaused} onChange={e => setOrderingPaused(e.target.checked)} />
              注文受付を一時停止する
            </label>
            <p className="mt-1 text-xs text-mist">トラブル時などに卸売サイトの新規注文受付を停止します（直接注文＝スタッフ入力は継続できます）。停止中はカタログ・お会計に下記メッセージが表示され、顧客は注文できません。</p>
            <label className="mt-3 block text-sm font-medium text-ink">停止中の表示メッセージ（任意）</label>
            <textarea
              value={pausedMessage}
              onChange={e => setPausedMessage(e.target.value)}
              rows={2}
              placeholder="現在、ご注文の受付を一時停止しています。再開までお待ちください。"
              className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink outline-none focus:border-ink"
            />
            {orderingPaused && <p className="mt-2 text-xs font-bold text-alert">⚠ 現在、新規注文の受付を停止しています（保存後に反映）。</p>}
          </div>

          {/* Staff notification emails */}
          <div className="mb-5 rounded-3xl border border-line bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-ink">スタッフ通知メール</h2>
            <p className="mt-1 text-[11px] text-mist">スタッフ宛（{`wholesale@sabo-matcha.jp`}）に送る通知メールを選びます。チェックを外すと送信しません（送信数の節約に）。多くの内容はダッシュボード・注文一覧でも確認できます。</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {STAFF_EMAIL_EVENTS.map(e => (
                <label key={e.key} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={staffEmailEvents.includes(e.key)}
                    onChange={ev => setStaffEmailEvents(prev => (ev.target.checked ? [...new Set([...prev, e.key])] : prev.filter(k => k !== e.key)))}
                    className="h-4 w-4 accent-[#174c33]"
                  />
                  {e.label}
                </label>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-mist">※「要返金アラート」（取消済み注文への入金）は事故防止のため常時送信されます（設定不可）。</p>
          </div>

          {/* Coupons */}
          <div className="mb-5 rounded-3xl border border-line bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink">クーポン</h2>
                <p className="mt-1 text-xs text-mist">チェックアウトでコードを入力すると、対象商品の小計に割引が適用されます（1注文1枚）。対象商品が未選択の場合は全商品が対象です。</p>
              </div>
              <button
                type="button"
                onClick={() => setCoupons(prev => [...prev, { id: uid(), code: '', name: '', discountType: 'percentage', discountValue: 0, eligibleProductIds: [], expiresAt: '', active: true }])}
                className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-line px-3 py-1.5 text-sm text-ink hover:bg-bone"
              >
                <Plus size={14} /> クーポンを追加
              </button>
            </div>
            {coupons.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-mist">クーポンがありません。</p>
            ) : (
              <div className="space-y-4">
                {coupons.map((c, ci) => {
                  const set = (patch: Partial<WholesaleCoupon>) => setCoupons(prev => prev.map((x, j) => (j === ci ? { ...x, ...patch } : x)))
                  const eligible = c.eligibleProductIds ?? []
                  const toggleProduct = (pid: string) =>
                    set({ eligibleProductIds: eligible.includes(pid) ? eligible.filter(x => x !== pid) : [...eligible, pid] })
                  return (
                    <div key={c.id} className="rounded-2xl border border-line p-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-[11px] text-mist">コード（大文字）
                          <input value={c.code} onChange={e => set({ code: e.target.value.toUpperCase() })} placeholder="SUMMER2025" className="field-input mt-1 w-full uppercase" />
                        </label>
                        <label className="text-[11px] text-mist">クーポン名
                          <input value={c.name} onChange={e => set({ name: e.target.value })} placeholder="夏季10%OFF" className="field-input mt-1 w-full" />
                        </label>
                        <label className="text-[11px] text-mist">割引タイプ
                          <select value={c.discountType} onChange={e => set({ discountType: e.target.value === 'fixed' ? 'fixed' : 'percentage' })} className="field-input mt-1 w-full">
                            <option value="percentage">割引率（%）</option>
                            <option value="fixed">割引額（¥）</option>
                          </select>
                        </label>
                        <label className="text-[11px] text-mist">{c.discountType === 'fixed' ? '割引額（¥）' : '割引率（%）'}
                          <input type="number" min="0" value={c.discountValue} onChange={e => set({ discountValue: Number(e.target.value) })} className="field-input mt-1 w-full" />
                        </label>
                        <label className="text-[11px] text-mist">有効期限（任意）
                          <input type="date" value={c.expiresAt ?? ''} onChange={e => set({ expiresAt: e.target.value })} className="field-input mt-1 w-full" />
                        </label>
                        <label className="flex items-end gap-2 pb-2 text-sm text-ink">
                          <input type="checkbox" checked={c.active !== false} onChange={e => set({ active: e.target.checked })} className="h-4 w-4" />
                          有効
                        </label>
                      </div>
                      <div className="mt-3">
                        <p className="text-[11px] text-mist">対象商品（未選択＝全商品）{eligible.length > 0 ? ` — ${eligible.length}件選択中` : ''}</p>
                        <div className="mt-1 max-h-40 overflow-y-auto rounded-xl border border-line p-2">
                          {products.length === 0 ? (
                            <p className="px-1 py-2 text-xs text-mist">商品がありません。</p>
                          ) : (
                            products.map(p => (
                              <label key={p.id} className="flex items-center gap-2 px-1 py-1 text-sm text-ink">
                                <input type="checkbox" checked={eligible.includes(p.id)} onChange={() => toggleProduct(p.id)} className="h-3.5 w-3.5" />
                                <span className="truncate">{p.name}{p.sku ? ` (${p.sku})` : ''}</span>
                              </label>
                            ))
                          )}
                        </div>
                      </div>
                      <button type="button" onClick={() => setCoupons(prev => prev.filter((_, j) => j !== ci))} className="mt-3 inline-flex items-center gap-1 text-xs text-alert hover:underline">
                        <Trash2 size={12} /> このクーポンを削除
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-line bg-white p-5 shadow-sm">
            <div className="grid gap-5 sm:grid-cols-2">
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
          </>
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
