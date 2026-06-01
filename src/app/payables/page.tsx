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
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { getServices } from '@/lib/services'
import type { PurchaseOrder, PurchaseOrderPaymentStatus } from '@/types'
import { computePoTaxIncluded } from '@/lib/cashflow'
import { formatCurrency, todayIso } from '@/lib/format'
import { bucketOf, makeBucketLabels, BUCKET_COLORS, BUCKET_ORDER_OPEN, BUCKET_ORDER_ALL, type Bucket } from '@/lib/payment-buckets'

const PAY_LABELS: Record<PurchaseOrderPaymentStatus, string> = {
  uninvoiced: '未請求',
  unpaid: '未払',
  paid: '支払済',
}

const BUCKET_LABELS = makeBucketLabels('支払済')

export default function PayablesPage() {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hidePaid, setHidePaid] = useState(true)
  const [openBuckets, setOpenBuckets] = useState<Record<Bucket, boolean>>({
    overdue: true, thisMonth: true, nextMonth: true, later: false, noDate: false, paid: false,
  })

  const load = async () => {
    setLoading(true)
    try {
      const svc = await getServices()
      const all = await svc.purchaseOrders.getPurchaseOrders()
      setOrders(all.filter(o => o.status !== 'cancelled'))
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
                              <Link href={`/purchase-orders/${o.id}/document`} className="hover:underline">{o.supplierName}</Link>
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
    </AppLayout>
  )
}
