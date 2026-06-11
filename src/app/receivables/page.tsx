'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Filter,
  Mail,
  Wallet,
} from 'lucide-react'
import { X } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { getServices } from '@/lib/services'
import type { EcSaleRecord, PaymentStatus, SaleRecord, SaleStatus, ShippingStatus } from '@/types'
import { computeSaleTaxIncluded } from '@/lib/cashflow'
import { computeSaleTaxBuckets } from '@/lib/tax'
import { PAYMENT_METHODS } from '@/lib/payment-methods'
import { formatCurrency, formatKg, todayIso } from '@/lib/format'
import { bucketOf, makeBucketLabels, BUCKET_COLORS, BUCKET_ORDER_OPEN, BUCKET_ORDER_ALL, type Bucket } from '@/lib/payment-buckets'

// Tax-inclusive billed amount (matches the invoice document and 支払管理).
function saleIncome(sale: SaleRecord): number {
  return computeSaleTaxIncluded(sale)
}

// Tax-exclusive base, for the small secondary line.
function saleIncomeExcl(sale: SaleRecord): number {
  return sale.invoiceAmount > 0 ? sale.invoiceAmount : sale.revenue
}

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  uninvoiced: '未請求',
  invoiced: '請求済',
  paid: '入金済',
}

const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  negotiating: '商談中',
  confirmed: '確定',
  cancelled: '取消',
}

const SHIPPING_STATUS_LABELS: Record<ShippingStatus, string> = {
  ordering: '発注対応中',
  producing: '製造中',
  ready_to_ship: '出荷準備完了',
  shipped: '出荷済',
}

const BUCKET_LABELS = makeBucketLabels('入金済')

export default function ReceivablesPage() {
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [ecSales, setEcSales] = useState<EcSaleRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hidePaid, setHidePaid] = useState(true)
  const [detailSale, setDetailSale] = useState<SaleRecord | null>(null)
  const [ecOpen, setEcOpen] = useState(false)
  const [openBuckets, setOpenBuckets] = useState<Record<Bucket, boolean>>({
    overdue: true, thisMonth: true, nextMonth: true, later: false, noDate: false, paid: false,
  })

  const load = async () => {
    setLoading(true)
    try {
      const svc = await getServices()
      const [all, ec] = await Promise.all([
        svc.sales.getSaleRecords(),
        svc.ecSales.getEcSaleRecords(),
      ])
      setSales(all.filter(s => s.status === 'confirmed'))
      setEcSales(ec.filter(e => e.status !== 'cancelled'))
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sales.filter(s => !q || s.buyerName.toLowerCase().includes(q) || s.items.some(i => i.productName.toLowerCase().includes(q)))
  }, [sales, query])

  const ecRev = (ec: EcSaleRecord) => ec.revenue != null ? ec.revenue : (ec.unitPrice ?? 0) * ec.quantityKg

  const ecThisMonth = useMemo(() => {
    const ym = todayIso().slice(0, 7)
    return ecSales
      .filter(e => (e.soldOn ?? '').startsWith(ym))
      .reduce((s, e) => s + ecRev(e), 0)
  }, [ecSales])

  const ecFiltered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...ecSales]
      .filter(e => !q || (e.productName ?? '').toLowerCase().includes(q) || (e.orderNumber ?? '').toLowerCase().includes(q))
      .sort((a, b) => (b.soldOn ?? '').localeCompare(a.soldOn ?? ''))
      .slice(0, 50)
  }, [ecSales, query])

  const grouped = useMemo(() => {
    const groups: Record<Bucket, SaleRecord[]> = { overdue: [], thisMonth: [], nextMonth: [], later: [], noDate: [], paid: [] }
    for (const s of filtered) groups[bucketOf(s.dueDate, s.paymentStatus === 'paid')].push(s)
    for (const k of Object.keys(groups) as Bucket[]) {
      groups[k].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    }
    return groups
  }, [filtered])

  const kpis = useMemo(() => {
    const outstanding = sales.filter(s => s.paymentStatus !== 'paid').reduce((sum, s) => sum + saleIncome(s), 0)
    const overdue = grouped.overdue.reduce((s, r) => s + saleIncome(r), 0)
    const thisMonth = grouped.thisMonth.reduce((s, r) => s + saleIncome(r), 0)
    const collectedThisMonth = sales
      .filter(s => s.paymentStatus === 'paid' && (s.paymentDate ?? '').startsWith(todayIso().slice(0, 7)))
      .reduce((sum, s) => sum + saleIncome(s), 0) + ecThisMonth
    return { outstanding, overdue, thisMonth, collectedThisMonth }
  }, [sales, grouped, ecThisMonth])

  const markPaid = async (id: string) => {
    setSavingId(id)
    setFeedback(null)
    try {
      const svc = await getServices()
      const updated = await svc.sales.updateSaleRecord(id, { paymentStatus: 'paid', paymentDate: todayIso() })
      setSales(prev => prev.map(s => s.id === id ? updated : s))
      setFeedback('入金確認しました')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '更新に失敗しました')
    } finally { setSavingId(null) }
  }

  const updateInline = async (id: string, patch: { paymentStatus?: PaymentStatus; dueDate?: string; paymentDate?: string; paymentMethod?: string }) => {
    setSavingId(id)
    setFeedback(null)
    try {
      const svc = await getServices()
      // Keep status and paymentDate consistent: entering a payment date marks
      // the sale paid; clearing it on a paid sale reverts to 請求済.
      const coupledStatus: Partial<Record<'paymentStatus', PaymentStatus>> = {}
      if (patch.paymentDate !== undefined && patch.paymentStatus === undefined) {
        coupledStatus.paymentStatus = patch.paymentDate ? 'paid' : 'invoiced'
      }
      const updated = await svc.sales.updateSaleRecord(id, {
        ...(patch.paymentStatus !== undefined && { paymentStatus: patch.paymentStatus }),
        ...coupledStatus,
        ...(patch.dueDate !== undefined && { dueDate: patch.dueDate || undefined }),
        ...(patch.paymentDate !== undefined && { paymentDate: patch.paymentDate || undefined }),
        ...(patch.paymentMethod !== undefined && { paymentMethod: patch.paymentMethod || undefined }),
      })
      setSales(prev => prev.map(s => s.id === id ? updated : s))
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '更新に失敗しました')
    } finally { setSavingId(null) }
  }

  const bucketsToRender: Bucket[] = hidePaid ? BUCKET_ORDER_OPEN : BUCKET_ORDER_ALL

  return (
    <AppLayout>
      <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[#173c2a]">入金管理</h1>
            <p className="text-sm text-[#68756c]">期日が近い／超過した売掛を一目で確認し、入金を一括で記録できます。</p>
          </div>
          <Link href="/financials" className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-xs text-[#174c33] hover:bg-[#eef3eb]">
            収支ダッシュボード →
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard title="未入金 残高" value={formatCurrency(kpis.outstanding)} color={kpis.outstanding > 0 ? 'amber' : 'default'} icon={<Wallet size={18} />} />
          <KPICard title="期限超過" value={formatCurrency(kpis.overdue)} color={kpis.overdue > 0 ? 'red' : 'default'} icon={<AlertTriangle size={18} />} />
          <KPICard title="今月期限" value={formatCurrency(kpis.thisMonth)} color={kpis.thisMonth > 0 ? 'amber' : 'default'} icon={<CircleDollarSign size={18} />} />
          <KPICard title="今月入金 (確認済・EC込)" value={formatCurrency(kpis.collectedThisMonth)} color="green" icon={<CheckCircle2 size={18} />} />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#d9d1be] bg-white p-3">
          <Filter size={14} className="text-[#68756c]" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="販売先または商品名で検索"
            className="flex-1 min-w-[200px] rounded-lg border border-[#d9d1be] bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-[#68756c]">
            <input type="checkbox" checked={hidePaid} onChange={e => setHidePaid(e.target.checked)} />
            入金済を隠す
          </label>
          {feedback && (
            <span className="text-xs text-[#174c33]">{feedback}</span>
          )}
        </div>

        {loading && <p className="text-sm text-[#68756c]">読み込み中…</p>}

        {!loading && bucketsToRender.map(bucket => {
          const rows = grouped[bucket]
          if (rows.length === 0) return null
          const open = openBuckets[bucket]
          const total = rows.reduce((s, r) => s + saleIncome(r), 0)
          return (
            <div key={bucket} className={`rounded-2xl border-2 ${BUCKET_COLORS[bucket]}`}>
              <button
                type="button"
                onClick={() => setOpenBuckets(prev => ({ ...prev, [bucket]: !prev[bucket] }))}
                className="flex w-full items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-2">
                  {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  <h2 className="text-sm font-semibold text-[#173c2a]">{BUCKET_LABELS[bucket]}</h2>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-[#68756c]">{rows.length}件 / {formatCurrency(total)}</span>
                </div>
              </button>
              {open && (
                <div className="overflow-x-auto border-t border-white/60">
                  <table className="min-w-full text-sm">
                    <thead className="bg-white/60 text-[#173c2a]">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">期日</th>
                        <th className="px-3 py-2 text-left font-medium">販売先</th>
                        <th className="px-3 py-2 text-left font-medium">商品</th>
                        <th className="px-3 py-2 text-right font-medium">請求額(税込)</th>
                        <th className="px-3 py-2 text-left font-medium">状態</th>
                        <th className="px-3 py-2 text-left font-medium">入金日</th>
                        <th className="px-3 py-2 text-left font-medium">支払方法</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(s => {
                        const productLabel = s.items[0]?.productName + (s.items.length > 1 ? ` 他${s.items.length - 1}件` : '')
                        const isOverdue = bucket === 'overdue'
                        return (
                          <tr key={s.id} className="border-t border-white/60">
                            <td className="px-3 py-2">
                              <input
                                type="date"
                                value={s.dueDate ?? ''}
                                onChange={e => updateInline(s.id, { dueDate: e.target.value })}
                                className={`rounded-lg border bg-white px-2 py-1 text-xs ${isOverdue ? 'border-red-400 text-red-700' : 'border-[#d9d1be]'}`}
                              />
                            </td>
                            <td className="px-3 py-2 text-[#173c2a]">
                              <button type="button" onClick={() => setDetailSale(s)} className="text-left hover:underline">{s.buyerName}</button>
                            </td>
                            <td className="px-3 py-2 text-[#68756c]">{productLabel}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="font-semibold text-[#173c2a]">{formatCurrency(saleIncome(s))}</div>
                              <div className="text-[10px] text-[#68756c]">税抜 {formatCurrency(saleIncomeExcl(s))}</div>
                              {((s.shippingFee || 0) > 0 || (s.otherFees || 0) > 0) && (
                                <div className="text-[10px] text-[#68756c]">
                                  商品 {formatCurrency(s.revenue)}
                                  {(s.shippingFee || 0) > 0 && <> ＋送料 {formatCurrency(s.shippingFee)}</>}
                                  {(s.otherFees || 0) > 0 && <> ＋諸費用 {formatCurrency(s.otherFees)}</>}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={s.paymentStatus}
                                onChange={e => updateInline(s.id, { paymentStatus: e.target.value as PaymentStatus })}
                                className="rounded-lg border border-[#d9d1be] bg-white px-2 py-1 text-xs"
                              >
                                <option value="uninvoiced">{PAYMENT_LABELS.uninvoiced}</option>
                                <option value="invoiced">{PAYMENT_LABELS.invoiced}</option>
                                <option value="paid">{PAYMENT_LABELS.paid}</option>
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="date"
                                value={s.paymentDate ?? ''}
                                onChange={e => updateInline(s.id, { paymentDate: e.target.value })}
                                className="rounded-lg border border-[#d9d1be] bg-white px-2 py-1 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={s.paymentMethod ?? ''}
                                onChange={e => updateInline(s.id, { paymentMethod: e.target.value })}
                                className="rounded-lg border border-[#d9d1be] bg-white px-2 py-1 text-xs"
                              >
                                <option value="">未設定</option>
                                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                                {s.paymentMethod && !PAYMENT_METHODS.includes(s.paymentMethod as never) && (
                                  <option value={s.paymentMethod}>{s.paymentMethod}</option>
                                )}
                              </select>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {s.paymentStatus !== 'paid' && (
                                <button
                                  type="button"
                                  onClick={() => markPaid(s.id)}
                                  disabled={savingId === s.id}
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#174c33] px-2.5 py-1 text-[11px] font-medium text-white shadow hover:bg-[#205f43] disabled:opacity-60"
                                >
                                  <CheckCircle2 size={12} /> 入金確認
                                </button>
                              )}
                              {s.paymentStatus !== 'paid' && bucket === 'overdue' && (
                                <a
                                  href={`mailto:?subject=${encodeURIComponent('お支払いのお願い')}&body=${encodeURIComponent(`${s.buyerName} 様\n\n下記の請求につきまして、ご入金状況をご確認ください。\n金額: ${formatCurrency(saleIncome(s))}\n期日: ${s.dueDate ?? ''}`)}`}
                                  className="ml-1 inline-flex items-center gap-1 rounded-lg border border-[#d9d1be] bg-white px-2 py-1 text-[11px] text-[#174c33] hover:bg-[#eef3eb]"
                                  title="督促メール下書き"
                                >
                                  <Mail size={12} />
                                </a>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}

        {!loading && bucketsToRender.every(b => grouped[b].length === 0) && (
          <p className="rounded-2xl border border-[#d9d1be] bg-white p-6 text-center text-sm text-[#68756c]">該当の売掛はありません。</p>
        )}

        {!loading && ecSales.length > 0 && (
          <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/30">
            <button
              type="button"
              onClick={() => setEcOpen(v => !v)}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                {ecOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <h2 className="text-sm font-semibold text-[#173c2a]">EC売上（入金済・参考）</h2>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-[#68756c]">
                  {ecFiltered.length}件 / 今月 {formatCurrency(ecThisMonth)}
                </span>
              </div>
            </button>
            {ecOpen && (
              <div className="overflow-x-auto border-t border-white/60">
                <table className="min-w-full text-sm">
                  <thead className="bg-white/60 text-[#173c2a]">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">売上日</th>
                      <th className="px-3 py-2 text-left font-medium">商品</th>
                      <th className="px-3 py-2 text-left font-medium">注文番号</th>
                      <th className="px-3 py-2 text-right font-medium">数量</th>
                      <th className="px-3 py-2 text-right font-medium">売上</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ecFiltered.map(e => (
                      <tr key={e.id} className="border-t border-white/60">
                        <td className="px-3 py-2 text-[#173c2a]">{e.soldOn || '-'}</td>
                        <td className="px-3 py-2 text-[#68756c]">{e.productName}</td>
                        <td className="px-3 py-2 text-[#68756c]">{e.orderNumber || '-'}</td>
                        <td className="px-3 py-2 text-right">{formatKg(e.quantityKg)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatCurrency(ecRev(e))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ecSales.length > ecFiltered.length && (
                  <p className="px-4 py-2 text-[11px] text-[#68756c]">最新 {ecFiltered.length} 件のみ表示しています。</p>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <SaleDetailModal sale={detailSale} onClose={() => setDetailSale(null)} />
    </AppLayout>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-[#68756c]">{label}</span>
      <span className="text-right font-medium text-[#173c2a]">{value}</span>
    </div>
  )
}

function SaleDetailModal({ sale, onClose }: { sale: SaleRecord | null; onClose: () => void }) {
  if (!sale) return null
  const fees = (sale.shippingFee ?? 0) + (sale.otherFees ?? 0)
  const tax = computeSaleTaxBuckets(sale.items ?? [], fees)
  const exclTotal = saleIncomeExcl(sale)
  const inclTotal = saleIncome(sale)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[100vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:max-h-[92vh] sm:rounded-3xl sm:p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#173c2a]">{sale.buyerName}</h2>
            <p className="mt-1 text-xs text-[#68756c]">販売案件の詳細（読み取り専用）</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/sales/${sale.id}/document?type=invoice`} className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-xs text-[#174c33] hover:bg-[#eef3eb]">請求書 →</Link>
            <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"><X size={18} /></button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[#e6dfcf] bg-[#faf8f2] p-3">
            <DetailRow label="販売ステータス" value={SALE_STATUS_LABELS[sale.status]} />
            <DetailRow label="入金ステータス" value={PAYMENT_LABELS[sale.paymentStatus]} />
            <DetailRow label="出荷ステータス" value={SHIPPING_STATUS_LABELS[sale.shippingStatus]} />
            <DetailRow label="国" value={sale.country || '-'} />
            <DetailRow label="支払期日" value={sale.dueDate || '-'} />
            <DetailRow label="入金日" value={sale.paymentDate || '-'} />
            <DetailRow label="支払方法" value={sale.paymentMethod || '-'} />
          </div>
          <div className="rounded-2xl border border-[#e6dfcf] bg-[#faf8f2] p-3">
            <DetailRow label="商品代金（税抜）" value={formatCurrency(sale.revenue)} />
            <DetailRow label="送料" value={formatCurrency(sale.shippingFee ?? 0)} />
            <DetailRow label="諸費用" value={formatCurrency(sale.otherFees ?? 0)} />
            <DetailRow label="決済手数料" value={formatCurrency(sale.paymentFee ?? 0)} />
            <DetailRow label="10%対象 / 消費税" value={`${formatCurrency(tax.standardSubtotal)} / ${formatCurrency(tax.standardTax)}`} />
            <DetailRow label="8%対象 / 消費税" value={`${formatCurrency(tax.reducedSubtotal)} / ${formatCurrency(tax.reducedTax)}`} />
            <DetailRow label="請求額（税抜）" value={formatCurrency(exclTotal)} />
            <DetailRow label="請求額（税込）" value={<span className="text-base">{formatCurrency(inclTotal)}</span>} />
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-[#e6dfcf]">
          <table className="min-w-full text-sm">
            <thead className="bg-[#f7f5ee] text-left text-[#173c2a]">
              <tr>
                <th className="px-3 py-2 font-medium">商品</th>
                <th className="px-3 py-2 font-medium text-right">数量</th>
                <th className="px-3 py-2 font-medium text-right">単価(税抜)</th>
                <th className="px-3 py-2 font-medium text-center">税率</th>
                <th className="px-3 py-2 font-medium text-right">金額</th>
              </tr>
            </thead>
            <tbody>
              {(sale.items ?? []).map((item, i) => (
                <tr key={i} className="border-t border-[#f0ebdf] text-[#173c2a]">
                  <td className="px-3 py-2">{item.productName}{item.productSku && <span className="ml-1 text-[10px] text-[#68756c]">({item.productSku})</span>}</td>
                  <td className="px-3 py-2 text-right">{formatKg(item.quantityKg)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                  <td className="px-3 py-2 text-center">{(item.taxRate ?? 8) === 0 ? '免税' : `${item.taxRate ?? 8}%`}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(sale.shippingAddress || sale.shippingPostalCode || sale.notes) && (
          <div className="mt-4 rounded-2xl border border-[#e6dfcf] bg-[#faf8f2] p-3 text-sm">
            {(sale.shippingPostalCode || sale.shippingAddress) && (
              <p className="text-[#173c2a]"><span className="text-[#68756c]">配送先：</span>{[sale.shippingPostalCode, sale.shippingAddress].filter(Boolean).join(' ')}</p>
            )}
            {sale.notes && <p className="mt-1 whitespace-pre-wrap text-[#173c2a]"><span className="text-[#68756c]">メモ：</span>{sale.notes}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
