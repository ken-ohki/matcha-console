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
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { getServices } from '@/lib/services'
import type { PaymentStatus, SaleRecord } from '@/types'
import { computeSaleTaxIncluded } from '@/lib/cashflow'
import { formatCurrency, todayIso } from '@/lib/format'
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

const BUCKET_LABELS = makeBucketLabels('入金済')

export default function ReceivablesPage() {
  const [sales, setSales] = useState<SaleRecord[]>([])
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
      const all = await svc.sales.getSaleRecords()
      setSales(all.filter(s => s.status === 'confirmed'))
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sales.filter(s => !q || s.buyerName.toLowerCase().includes(q) || s.items.some(i => i.productName.toLowerCase().includes(q)))
  }, [sales, query])

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
      .reduce((sum, s) => sum + saleIncome(s), 0)
    return { outstanding, overdue, thisMonth, collectedThisMonth }
  }, [sales, grouped])

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

  const updateInline = async (id: string, patch: { paymentStatus?: PaymentStatus; dueDate?: string; paymentDate?: string }) => {
    setSavingId(id)
    setFeedback(null)
    try {
      const svc = await getServices()
      const updated = await svc.sales.updateSaleRecord(id, {
        ...(patch.paymentStatus !== undefined && { paymentStatus: patch.paymentStatus }),
        ...(patch.dueDate !== undefined && { dueDate: patch.dueDate || undefined }),
        ...(patch.paymentDate !== undefined && { paymentDate: patch.paymentDate || undefined }),
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
          <KPICard title="今月入金 (確認済)" value={formatCurrency(kpis.collectedThisMonth)} color="green" icon={<CheckCircle2 size={18} />} />
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
                              <Link href={`/sales/${s.id}/document?type=invoice`} className="hover:underline">{s.buyerName}</Link>
                            </td>
                            <td className="px-3 py-2 text-[#68756c]">{productLabel}</td>
                            <td className="px-3 py-2 text-right">
                              <div className="font-medium">{formatCurrency(saleIncome(s))}</div>
                              <div className="text-[10px] text-[#68756c]">税抜 {formatCurrency(saleIncomeExcl(s))}</div>
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
      </main>
    </AppLayout>
  )
}
