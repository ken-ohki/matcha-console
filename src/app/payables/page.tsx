'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Filter,
  Wallet,
  X,
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { getServices } from '@/lib/services'
import type { PurchaseOrder, PurchaseOrderPaymentStatus, PurchaseOrderStatus } from '@/types'
import { computePoTaxIncluded } from '@/lib/cashflow'
import { computeTaxBuckets } from '@/lib/tax'
import { formatCurrency, formatKg, todayIso } from '@/lib/format'
import { bucketOf, makeBucketLabels, BUCKET_COLORS, BUCKET_ORDER_OPEN, BUCKET_ORDER_ALL, type Bucket } from '@/lib/payment-buckets'

const PAY_LABELS: Record<PurchaseOrderPaymentStatus, string> = {
  uninvoiced: '未請求',
  unpaid: '未払',
  paid: '支払済',
}

const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  placed: '発注済',
  shipped: '発送中',
  received: '入荷済',
  cancelled: '取消',
}

const BUCKET_LABELS = makeBucketLabels('支払済')

export default function PayablesPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [bankInfoBySupplier, setBankInfoBySupplier] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hidePaid, setHidePaid] = useState(true)
  const [detailOrder, setDetailOrder] = useState<PurchaseOrder | null>(null)
  const [openBuckets, setOpenBuckets] = useState<Record<Bucket, boolean>>({
    overdue: true, thisMonth: true, nextMonth: true, later: false, noDate: false, paid: false,
  })

  const load = async () => {
    setLoading(true)
    try {
      const svc = await getServices()
      const [all, suppliers] = await Promise.all([
        svc.purchaseOrders.getPurchaseOrders(),
        svc.suppliers.getSuppliers(),
      ])
      setOrders(all.filter(o => o.status !== 'cancelled'))
      const map: Record<string, string> = {}
      for (const s of suppliers) {
        if (s.bankInfo) map[s.name] = s.bankInfo
      }
      setBankInfoBySupplier(map)
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter(o => !q || o.supplierName.toLowerCase().includes(q) || o.items.some(i => i.productName.toLowerCase().includes(q)))
  }, [orders, query])

  const grouped = useMemo(() => {
    const groups: Record<Bucket, PurchaseOrder[]> = { overdue: [], thisMonth: [], nextMonth: [], later: [], noDate: [], paid: [] }
    for (const o of filtered) groups[bucketOf(o.paymentDueDate, o.paymentStatus === 'paid')].push(o)
    for (const k of Object.keys(groups) as Bucket[]) {
      groups[k].sort((a, b) => (a.paymentDueDate || '9999').localeCompare(b.paymentDueDate || '9999'))
    }
    return groups
  }, [filtered])

  const kpis = useMemo(() => {
    const outstanding = orders.filter(o => o.paymentStatus !== 'paid').reduce((s, o) => s + computePoTaxIncluded(o), 0)
    const overdue = grouped.overdue.reduce((s, o) => s + computePoTaxIncluded(o), 0)
    const thisMonth = grouped.thisMonth.reduce((s, o) => s + computePoTaxIncluded(o), 0)
    const paidThisMonth = orders
      .filter(o => o.paymentStatus === 'paid' && (o.paidDate ?? '').startsWith(todayIso().slice(0, 7)))
      .reduce((s, o) => s + computePoTaxIncluded(o), 0)
    return { outstanding, overdue, thisMonth, paidThisMonth }
  }, [orders, grouped])

  const markPaid = async (id: string) => {
    setSavingId(id)
    setFeedback(null)
    try {
      const svc = await getServices()
      const updated = await svc.purchaseOrders.updatePurchaseOrder(id, { paymentStatus: 'paid', paidDate: todayIso() })
      setOrders(prev => prev.map(o => o.id === id ? updated : o))
      setFeedback('支払確認しました')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '更新に失敗しました')
    } finally { setSavingId(null) }
  }

  const updateInline = async (id: string, patch: { paymentStatus?: PurchaseOrderPaymentStatus; paymentDueDate?: string; paidDate?: string }) => {
    setSavingId(id)
    setFeedback(null)
    try {
      const svc = await getServices()
      // Keep status and paidDate consistent: entering a paid date marks the PO
      // paid; clearing it on a paid PO reverts to 未払.
      const coupledStatus: Partial<Record<'paymentStatus', PurchaseOrderPaymentStatus>> = {}
      if (patch.paidDate !== undefined && patch.paymentStatus === undefined) {
        coupledStatus.paymentStatus = patch.paidDate ? 'paid' : 'unpaid'
      }
      const updated = await svc.purchaseOrders.updatePurchaseOrder(id, {
        ...(patch.paymentStatus !== undefined && { paymentStatus: patch.paymentStatus }),
        ...coupledStatus,
        ...(patch.paymentDueDate !== undefined && { paymentDueDate: patch.paymentDueDate || undefined }),
        ...(patch.paidDate !== undefined && { paidDate: patch.paidDate || undefined }),
      })
      setOrders(prev => prev.map(o => o.id === id ? updated : o))
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
            <h1 className="text-2xl font-semibold text-[#173c2a]">支払管理</h1>
            <p className="text-sm text-[#68756c]">期日が近い／超過した買掛を一目で確認し、支払を記録できます。</p>
          </div>
          <Link href="/financials" className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-xs text-[#174c33] hover:bg-[#eef3eb]">
            収支ダッシュボード →
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard title="未払 残高" value={formatCurrency(kpis.outstanding)} color={kpis.outstanding > 0 ? 'amber' : 'default'} icon={<Wallet size={18} />} />
          <KPICard title="期限超過" value={formatCurrency(kpis.overdue)} color={kpis.overdue > 0 ? 'red' : 'default'} icon={<AlertTriangle size={18} />} />
          <KPICard title="今月期限" value={formatCurrency(kpis.thisMonth)} color={kpis.thisMonth > 0 ? 'amber' : 'default'} icon={<CircleDollarSign size={18} />} />
          <KPICard title="今月支払 (確認済)" value={formatCurrency(kpis.paidThisMonth)} color="green" icon={<CheckCircle2 size={18} />} />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#d9d1be] bg-white p-3">
          <Filter size={14} className="text-[#68756c]" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="仕入先または商品名で検索"
            className="flex-1 min-w-[200px] rounded-lg border border-[#d9d1be] bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
          />
          <label className="inline-flex items-center gap-1.5 text-xs text-[#68756c]">
            <input type="checkbox" checked={hidePaid} onChange={e => setHidePaid(e.target.checked)} />
            支払済を隠す
          </label>
          {feedback && <span className="text-xs text-[#174c33]">{feedback}</span>}
        </div>

        {loading && <p className="text-sm text-[#68756c]">読み込み中…</p>}

        {!loading && bucketsToRender.map(bucket => {
          const rows = grouped[bucket]
          if (rows.length === 0) return null
          const open = openBuckets[bucket]
          const total = rows.reduce((s, o) => s + computePoTaxIncluded(o), 0)
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
                        <th className="px-3 py-2 text-left font-medium">仕入先</th>
                        <th className="px-3 py-2 text-left font-medium">商品</th>
                        <th className="px-3 py-2 text-right font-medium">支払額(税込)</th>
                        <th className="px-3 py-2 text-left font-medium">状態</th>
                        <th className="px-3 py-2 text-left font-medium">支払日</th>
                        <th className="px-3 py-2 text-left font-medium">請求書</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(o => {
                        const productLabel = (o.items[0]?.productName ?? '') + (o.items.length > 1 ? ` 他${o.items.length - 1}件` : '')
                        const isOverdue = bucket === 'overdue'
                        return (
                          <tr key={o.id} className="border-t border-white/60">
                            <td className="px-3 py-2">
                              <input
                                type="date"
                                value={o.paymentDueDate ?? ''}
                                onChange={e => updateInline(o.id, { paymentDueDate: e.target.value })}
                                className={`rounded-lg border bg-white px-2 py-1 text-xs ${isOverdue ? 'border-red-400 text-red-700' : 'border-[#d9d1be]'}`}
                              />
                            </td>
                            <td className="px-3 py-2 text-[#173c2a]">
                              <button type="button" onClick={() => setDetailOrder(o)} className="text-left hover:underline">{o.supplierName}</button>
                            </td>
                            <td className="px-3 py-2 text-[#68756c]">{productLabel}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="font-medium">{formatCurrency(computePoTaxIncluded(o))}</div>
                              <div className="text-[10px] text-[#68756c]">税抜 {formatCurrency(o.totalAmount || 0)}</div>
                            </td>
                            <td className="px-3 py-2">
                              <select
                                value={o.paymentStatus}
                                onChange={e => updateInline(o.id, { paymentStatus: e.target.value as PurchaseOrderPaymentStatus })}
                                className="rounded-lg border border-[#d9d1be] bg-white px-2 py-1 text-xs"
                              >
                                <option value="uninvoiced">{PAY_LABELS.uninvoiced}</option>
                                <option value="unpaid">{PAY_LABELS.unpaid}</option>
                                <option value="paid">{PAY_LABELS.paid}</option>
                              </select>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                type="date"
                                value={o.paidDate ?? ''}
                                onChange={e => updateInline(o.id, { paidDate: e.target.value })}
                                className="rounded-lg border border-[#d9d1be] bg-white px-2 py-1 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              {o.invoice ? (
                                <a
                                  href={o.invoice.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-[#174c33] hover:underline"
                                >
                                  <FileText size={12} /> PDF
                                </a>
                              ) : (
                                <span className="text-[#a59f8c] text-xs">未添付</span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {o.paymentStatus !== 'paid' && (
                                <button
                                  type="button"
                                  onClick={() => markPaid(o.id)}
                                  disabled={savingId === o.id}
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#174c33] px-2.5 py-1 text-[11px] font-medium text-white shadow hover:bg-[#205f43] disabled:opacity-60"
                                >
                                  <CheckCircle2 size={12} /> 支払確認
                                </button>
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
          <p className="rounded-2xl border border-[#d9d1be] bg-white p-6 text-center text-sm text-[#68756c]">該当の買掛はありません。</p>
        )}
      </main>

      <PoDetailModal
        order={detailOrder}
        bankInfo={detailOrder ? bankInfoBySupplier[detailOrder.supplierName] : undefined}
        onClose={() => setDetailOrder(null)}
      />
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

function PoDetailModal({ order, bankInfo, onClose }: { order: PurchaseOrder | null; bankInfo?: string; onClose: () => void }) {
  if (!order) return null
  const fees = (order.shippingFee ?? 0) + (order.otherFees ?? 0)
  const tax = computeTaxBuckets(order.items ?? [], fees)
  const inclTotal = computePoTaxIncluded(order)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[100vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:max-h-[92vh] sm:rounded-3xl sm:p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#173c2a]">{order.supplierName}</h2>
            <p className="mt-1 text-xs text-[#68756c]">発注の詳細（読み取り専用）</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/purchase-orders/${order.id}/document`} className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-xs text-[#174c33] hover:bg-[#eef3eb]">発注書 →</Link>
            <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"><X size={18} /></button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[#e6dfcf] bg-[#faf8f2] p-3">
            <DetailRow label="発注ステータス" value={PO_STATUS_LABELS[order.status]} />
            <DetailRow label="支払ステータス" value={PAY_LABELS[order.paymentStatus]} />
            <DetailRow label="発注日" value={order.orderDate || '-'} />
            <DetailRow label="入荷予定日" value={order.expectedDeliveryDate || '-'} />
            <DetailRow label="入荷日" value={order.actualDeliveryDate || '-'} />
            <DetailRow label="支払期日" value={order.paymentDueDate || '-'} />
            <DetailRow label="支払日" value={order.paidDate || '-'} />
          </div>
          <div className="rounded-2xl border border-[#e6dfcf] bg-[#faf8f2] p-3">
            <DetailRow label="商品代金（税抜）" value={formatCurrency(order.totalAmount - (order.shippingFee ?? 0) - (order.otherFees ?? 0))} />
            <DetailRow label="送料" value={formatCurrency(order.shippingFee ?? 0)} />
            <DetailRow label="諸経費" value={formatCurrency(order.otherFees ?? 0)} />
            <DetailRow label="10%対象 / 消費税" value={`${formatCurrency(tax.standardSubtotal)} / ${formatCurrency(tax.standardTax)}`} />
            <DetailRow label="8%対象 / 消費税" value={`${formatCurrency(tax.reducedSubtotal)} / ${formatCurrency(tax.reducedTax)}`} />
            <DetailRow label="合計（税抜）" value={formatCurrency(order.totalAmount)} />
            <DetailRow label="合計（税込）" value={<span className="text-base">{formatCurrency(inclTotal)}</span>} />
            <DetailRow label="請求書" value={order.invoice ? <a href={order.invoice.url} target="_blank" rel="noopener noreferrer" className="text-[#174c33] hover:underline">PDF</a> : '未添付'} />
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-[#e6dfcf] bg-[#faf8f2] p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-[#68756c]">振込先（支払口座）</p>
          {bankInfo
            ? <p className="whitespace-pre-wrap text-[#173c2a]">{bankInfo}</p>
            : <p className="text-[#a59f8c]">仕入先マスタに未登録です。<Link href="/suppliers" className="text-[#174c33] hover:underline">仕入先管理</Link>で登録してください。</p>}
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
              {(order.items ?? []).map((item, i) => (
                <tr key={i} className="border-t border-[#f0ebdf] text-[#173c2a]">
                  <td className="px-3 py-2">{item.productName}{item.productSku && <span className="ml-1 text-[10px] text-[#68756c]">({item.productSku})</span>}</td>
                  <td className="px-3 py-2 text-right">{formatKg(item.quantityKg)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                  <td className="px-3 py-2 text-center">{(item.taxRate ?? 8)}%</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(order.otherFeesNote || order.notes) && (
          <div className="mt-4 rounded-2xl border border-[#e6dfcf] bg-[#faf8f2] p-3 text-sm">
            {order.otherFeesNote && <p className="text-[#173c2a]"><span className="text-[#68756c]">諸経費メモ：</span>{order.otherFeesNote}</p>}
            {order.notes && <p className="mt-1 whitespace-pre-wrap text-[#173c2a]"><span className="text-[#68756c]">メモ：</span>{order.notes}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
