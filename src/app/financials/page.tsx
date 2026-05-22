'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  Calculator,
  ChevronDown,
  ChevronRight,
  FileText,
  Filter,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { getServices } from '@/lib/services'
import type {
  PaymentStatus,
  PurchaseOrder,
  PurchaseOrderPaymentStatus,
  SaleRecord,
} from '@/types'

type TabKey = 'overview' | 'monthly' | 'fiscal' | 'partner'
type SaleFilterChip = 'all' | 'pending' | 'paid' | 'overdue'
type PoFilterChip = 'all' | 'pending' | 'paid' | 'overdue'

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(amount)
}

function fiscalYearOf(date: Date): number {
  const year = date.getFullYear()
  const month = date.getMonth()
  return month >= 3 ? year : year - 1
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function startOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function endOfMonth(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
}

function startOfFiscalYear(fy: number): string {
  return `${fy}-04-01`
}

function endOfFiscalYear(fy: number): string {
  return `${fy + 1}-03-31`
}

function saleIncome(sale: SaleRecord): number {
  const inv = sale.invoiceAmount || 0
  return inv > 0 ? inv : sale.revenue || 0
}

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  uninvoiced: '未請求',
  invoiced: '請求済',
  paid: '入金済',
}
const PAYMENT_COLORS: Record<PaymentStatus, string> = {
  uninvoiced: 'bg-gray-100 text-gray-700',
  invoiced: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-800',
}

const PO_PAYMENT_LABELS: Record<PurchaseOrderPaymentStatus, string> = {
  uninvoiced: '未請求',
  unpaid: '未払',
  paid: '支払済',
}
const PO_PAYMENT_COLORS: Record<PurchaseOrderPaymentStatus, string> = {
  uninvoiced: 'bg-slate-100 text-slate-700',
  unpaid: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-800',
}

function SaleBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${PAYMENT_COLORS[status]}`}>
      {PAYMENT_LABELS[status]}
    </span>
  )
}
function PoBadge({ status }: { status: PurchaseOrderPaymentStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${PO_PAYMENT_COLORS[status]}`}>
      {PO_PAYMENT_LABELS[status]}
    </span>
  )
}

interface MonthlyRow {
  key: string
  label: string
  revenue: number
  collected: number
  expense: number
  paid: number
  net: number
}

interface PartnerRow {
  name: string
  total: number
  settled: number
  outstanding: number
  count: number
}

const editInputCls =
  'w-full rounded-lg border border-[#d9d1be] bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600'

export default function FinancialsPage() {
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [saleChip, setSaleChip] = useState<SaleFilterChip>('all')
  const [poChip, setPoChip] = useState<PoFilterChip>('all')
  const [salesOpen, setSalesOpen] = useState(true)
  const [posOpen, setPosOpen] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const svc = await getServices()
      const [s, o] = await Promise.all([svc.sales.getSaleRecords(), svc.purchaseOrders.getPurchaseOrders()])
      setSales(s)
      setOrders(o)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', handler)
    window.addEventListener('focus', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
  }, [])

  const fromTime = dateFrom ? new Date(dateFrom).getTime() : null
  const toTime = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null

  const filteredSales = useMemo(() => {
    return sales.filter(s => {
      const t = s.createdAt.getTime()
      if (fromTime != null && t < fromTime) return false
      if (toTime != null && t > toTime) return false
      return true
    })
  }, [sales, fromTime, toTime])

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (!o.orderDate) return true
      const t = new Date(o.orderDate).getTime()
      if (fromTime != null && t < fromTime) return false
      if (toTime != null && t > toTime) return false
      return true
    })
  }, [orders, fromTime, toTime])

  const kpis = useMemo(() => {
    const totalRevenue = filteredSales.reduce((s, r) => s + saleIncome(r), 0)
    const collected = filteredSales
      .filter(r => r.paymentStatus === 'paid')
      .reduce((s, r) => s + saleIncome(r), 0)
    const outstanding = filteredSales
      .filter(r => r.status === 'confirmed' && r.paymentStatus !== 'paid')
      .reduce((s, r) => s + saleIncome(r), 0)
    const totalExpense = filteredOrders.reduce((s, o) => s + (o.totalAmount || 0), 0)
    const paid = filteredOrders
      .filter(o => o.paymentStatus === 'paid')
      .reduce((s, o) => s + (o.totalAmount || 0), 0)
    const unpaid = filteredOrders
      .filter(o => o.paymentStatus !== 'paid')
      .reduce((s, o) => s + (o.totalAmount || 0), 0)
    return {
      totalRevenue,
      collected,
      outstanding,
      totalExpense,
      paid,
      unpaid,
      realizedNet: collected - paid,
      expectedNet: totalRevenue - totalExpense,
    }
  }, [filteredSales, filteredOrders])

  const monthly = useMemo<MonthlyRow[]>(() => {
    const map = new Map<string, MonthlyRow>()
    for (const r of filteredSales) {
      const k = monthKey(r.createdAt)
      const row = map.get(k) ?? { key: k, label: k, revenue: 0, collected: 0, expense: 0, paid: 0, net: 0 }
      row.revenue += saleIncome(r)
      if (r.paymentStatus === 'paid') row.collected += saleIncome(r)
      map.set(k, row)
    }
    for (const o of filteredOrders) {
      const d = o.orderDate ? new Date(o.orderDate) : null
      if (!d) continue
      const k = monthKey(d)
      const row = map.get(k) ?? { key: k, label: k, revenue: 0, collected: 0, expense: 0, paid: 0, net: 0 }
      row.expense += o.totalAmount || 0
      if (o.paymentStatus === 'paid') row.paid += o.totalAmount || 0
      map.set(k, row)
    }
    return [...map.values()]
      .map(r => ({ ...r, net: r.collected - r.paid }))
      .sort((a, b) => b.key.localeCompare(a.key))
  }, [filteredSales, filteredOrders])

  const fiscal = useMemo<MonthlyRow[]>(() => {
    const map = new Map<string, MonthlyRow>()
    for (const r of filteredSales) {
      const fy = fiscalYearOf(r.createdAt)
      const k = String(fy)
      const row = map.get(k) ?? { key: k, label: `FY${fy} (${fy}/04 - ${fy + 1}/03)`, revenue: 0, collected: 0, expense: 0, paid: 0, net: 0 }
      row.revenue += saleIncome(r)
      if (r.paymentStatus === 'paid') row.collected += saleIncome(r)
      map.set(k, row)
    }
    for (const o of filteredOrders) {
      const d = o.orderDate ? new Date(o.orderDate) : null
      if (!d) continue
      const fy = fiscalYearOf(d)
      const k = String(fy)
      const row = map.get(k) ?? { key: k, label: `FY${fy} (${fy}/04 - ${fy + 1}/03)`, revenue: 0, collected: 0, expense: 0, paid: 0, net: 0 }
      row.expense += o.totalAmount || 0
      if (o.paymentStatus === 'paid') row.paid += o.totalAmount || 0
      map.set(k, row)
    }
    return [...map.values()]
      .map(r => ({ ...r, net: r.collected - r.paid }))
      .sort((a, b) => b.key.localeCompare(a.key))
  }, [filteredSales, filteredOrders])

  const partnerBuyers = useMemo<PartnerRow[]>(() => {
    const map = new Map<string, PartnerRow>()
    for (const r of filteredSales) {
      const key = r.buyerName || '(未設定)'
      const row = map.get(key) ?? { name: key, total: 0, settled: 0, outstanding: 0, count: 0 }
      const amt = saleIncome(r)
      row.total += amt
      if (r.paymentStatus === 'paid') row.settled += amt
      else if (r.status === 'confirmed') row.outstanding += amt
      row.count += 1
      map.set(key, row)
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [filteredSales])

  const partnerSuppliers = useMemo<PartnerRow[]>(() => {
    const map = new Map<string, PartnerRow>()
    for (const o of filteredOrders) {
      const key = o.supplierName || '(未設定)'
      const row = map.get(key) ?? { name: key, total: 0, settled: 0, outstanding: 0, count: 0 }
      const amt = o.totalAmount || 0
      row.total += amt
      if (o.paymentStatus === 'paid') row.settled += amt
      else row.outstanding += amt
      row.count += 1
      map.set(key, row)
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [filteredOrders])

  const today = todayIso()
  const isOverdueSale = (r: SaleRecord): boolean => {
    if (r.paymentStatus === 'paid') return false
    if (!r.dueDate) return false
    return r.dueDate < today
  }
  const isOverduePo = (o: PurchaseOrder): boolean => {
    if (o.paymentStatus === 'paid') return false
    if (!o.paymentDueDate) return false
    return o.paymentDueDate < today
  }

  const overdueSales = filteredSales.filter(isOverdueSale)
  const overdueOrders = filteredOrders.filter(isOverduePo)

  const visibleSales = useMemo(() => {
    const list = [...filteredSales].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    if (saleChip === 'all') return list
    if (saleChip === 'paid') return list.filter(r => r.paymentStatus === 'paid')
    if (saleChip === 'pending') return list.filter(r => r.paymentStatus !== 'paid')
    return list.filter(isOverdueSale)
  }, [filteredSales, saleChip])

  const visibleOrders = useMemo(() => {
    const list = [...filteredOrders].sort((a, b) => (b.orderDate || '').localeCompare(a.orderDate || ''))
    if (poChip === 'all') return list
    if (poChip === 'paid') return list.filter(o => o.paymentStatus === 'paid')
    if (poChip === 'pending') return list.filter(o => o.paymentStatus !== 'paid')
    return list.filter(isOverduePo)
  }, [filteredOrders, poChip])

  const applyPreset = (preset: 'thisMonth' | 'lastMonth' | 'thisFY' | 'all') => {
    const now = new Date()
    if (preset === 'all') {
      setDateFrom('')
      setDateTo('')
      return
    }
    if (preset === 'thisMonth') {
      setDateFrom(startOfMonth(now))
      setDateTo(endOfMonth(now))
      return
    }
    if (preset === 'lastMonth') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      setDateFrom(startOfMonth(d))
      setDateTo(endOfMonth(d))
      return
    }
    if (preset === 'thisFY') {
      const fy = fiscalYearOf(now)
      setDateFrom(startOfFiscalYear(fy))
      setDateTo(endOfFiscalYear(fy))
    }
  }

  const updateSale = async (id: string, patch: { paymentStatus?: PaymentStatus; paymentMethod?: string; paymentDate?: string; paymentFee?: number }) => {
    setSavingId(id)
    setFeedback(null)
    try {
      const svc = await getServices()
      const updated = await svc.sales.updateSaleRecord(id, {
        ...(patch.paymentStatus !== undefined && { paymentStatus: patch.paymentStatus }),
        ...(patch.paymentMethod !== undefined && { paymentMethod: patch.paymentMethod || undefined }),
        ...(patch.paymentDate !== undefined && { paymentDate: patch.paymentDate || undefined }),
        ...(patch.paymentFee !== undefined && { paymentFee: patch.paymentFee }),
      })
      setSales(prev => prev.map(r => (r.id === id ? updated : r)))
      setFeedback('更新しました')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '更新に失敗しました')
    } finally {
      setSavingId(null)
    }
  }

  const updateOrder = async (id: string, patch: { paymentStatus?: PurchaseOrderPaymentStatus; paymentDueDate?: string; paidDate?: string }) => {
    setSavingId(id)
    setFeedback(null)
    try {
      const svc = await getServices()
      const updated = await svc.purchaseOrders.updatePurchaseOrder(id, {
        ...(patch.paymentStatus !== undefined && { paymentStatus: patch.paymentStatus }),
        ...(patch.paymentDueDate !== undefined && { paymentDueDate: patch.paymentDueDate || undefined }),
        ...(patch.paidDate !== undefined && { paidDate: patch.paidDate || undefined }),
      })
      setOrders(prev => prev.map(o => (o.id === id ? updated : o)))
      setFeedback('更新しました')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '更新に失敗しました')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Calculator size={20} className="text-[#174c33]" />
              <h1 className="text-2xl font-bold text-[#173c2a]">収支管理</h1>
            </div>
            <p className="mt-1 text-sm text-[#68756c]">売上の入金状況と仕入の支払い状況を一元管理します。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="rounded-lg border border-[#d9d1be] bg-white px-2 py-1.5 text-xs"
              />
              <span className="text-xs text-[#68756c]">〜</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="rounded-lg border border-[#d9d1be] bg-white px-2 py-1.5 text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => applyPreset('thisMonth')} className="rounded-full border border-[#d9d1be] bg-white px-2.5 py-1 text-[11px] text-[#174c33] hover:bg-[#eef3eb]">今月</button>
              <button onClick={() => applyPreset('lastMonth')} className="rounded-full border border-[#d9d1be] bg-white px-2.5 py-1 text-[11px] text-[#174c33] hover:bg-[#eef3eb]">先月</button>
              <button onClick={() => applyPreset('thisFY')} className="rounded-full border border-[#d9d1be] bg-white px-2.5 py-1 text-[11px] text-[#174c33] hover:bg-[#eef3eb]">今年度</button>
              <button onClick={() => applyPreset('all')} className="rounded-full border border-[#d9d1be] bg-white px-2.5 py-1 text-[11px] text-[#174c33] hover:bg-[#eef3eb]">全期間</button>
            </div>
          </div>
        </div>

        {feedback && (
          <div className="rounded-xl border border-[#d9d1be] bg-[#faf8f1] px-3 py-2 text-xs text-[#173c2a]">{feedback}</div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KPICard title="売上計" value={formatCurrency(kpis.totalRevenue)} color="default" icon={<TrendingUp size={16} />} />
          <KPICard title="入金済" value={formatCurrency(kpis.collected)} color="green" icon={<ArrowDownCircle size={16} />} />
          <KPICard title="未収" value={formatCurrency(kpis.outstanding)} color="amber" icon={<AlertTriangle size={16} />} />
          <KPICard title="仕入計" value={formatCurrency(kpis.totalExpense)} color="default" icon={<ArrowUpCircle size={16} />} />
          <KPICard title="支払済 PO" value={formatCurrency(kpis.paid)} color="green" icon={<Wallet size={16} />} />
          <KPICard title="未払 PO" value={formatCurrency(kpis.unpaid)} color="amber" icon={<AlertTriangle size={16} />} />
          <KPICard title="純収支（入金−支払）" value={formatCurrency(kpis.realizedNet)} color={kpis.realizedNet >= 0 ? 'green' : 'red'} />
          <KPICard title="見込み収支" value={formatCurrency(kpis.expectedNet)} color={kpis.expectedNet >= 0 ? 'green' : 'red'} />
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-[#d9d1be]">
          {([
            ['overview', '概要'],
            ['monthly', '月別'],
            ['fiscal', '年度別'],
            ['partner', '取引先別'],
          ] as [TabKey, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setActiveTab(k)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                activeTab === k ? 'border-[#174c33] text-[#173c2a]' : 'border-transparent text-[#68756c] hover:text-[#173c2a]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#d9d1be] bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle size={16} className="text-[#9d3d28]" />
                <h2 className="text-sm font-semibold text-[#173c2a]">アラート（期限超過）</h2>
              </div>
              {overdueSales.length === 0 && overdueOrders.length === 0 ? (
                <p className="text-xs text-[#68756c]">期限超過の請求・支払いはありません。</p>
              ) : (
                <div className="space-y-3">
                  {overdueSales.length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] uppercase tracking-wider text-[#9d3d28]">売上（未収・期限超過）</p>
                      <ul className="space-y-1 text-xs text-[#173c2a]">
                        {overdueSales.map(r => (
                          <li key={r.id} className="flex items-center justify-between rounded-lg bg-[#fff0ec] px-2 py-1.5">
                            <span>{r.buyerName} - {r.items[0]?.productName ?? ''}</span>
                            <span className="text-[#9d3d28]">{formatCurrency(saleIncome(r))} / 期日 {r.dueDate}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {overdueOrders.length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] uppercase tracking-wider text-[#9d3d28]">仕入（未払・期限超過）</p>
                      <ul className="space-y-1 text-xs text-[#173c2a]">
                        {overdueOrders.map(o => (
                          <li key={o.id} className="flex items-center justify-between rounded-lg bg-[#fff0ec] px-2 py-1.5">
                            <span>{o.supplierName} - {o.items[0]?.productName ?? ''}</span>
                            <span className="text-[#9d3d28]">{formatCurrency(o.totalAmount || 0)} / 期日 {o.paymentDueDate}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'monthly' && (
          <PeriodTable rows={monthly} title="月別 収支" />
        )}
        {activeTab === 'fiscal' && (
          <PeriodTable rows={fiscal} title="年度別 収支" />
        )}

        {activeTab === 'partner' && (
          <div className="space-y-4">
            <PartnerTable title="販売先" rows={partnerBuyers} headers={['請求総額', '入金済', '未収']} />
            <PartnerTable title="仕入先" rows={partnerSuppliers} headers={['仕入総額', '支払済', '未払']} />
          </div>
        )}

        {/* Receivables (sales) */}
        <div className="rounded-2xl border border-[#d9d1be] bg-white">
          <button
            type="button"
            onClick={() => setSalesOpen(v => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <div className="flex items-center gap-2">
              {salesOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <h2 className="text-sm font-semibold text-[#173c2a]">売上（販売側）</h2>
              <span className="rounded-full bg-[#f4f2ea] px-2 py-0.5 text-[11px] text-[#68756c]">{visibleSales.length}件</span>
            </div>
            <div className="flex items-center gap-1">
              <Filter size={12} className="text-[#68756c]" />
              {([
                ['all', '全件'],
                ['pending', '未入金'],
                ['paid', '入金済'],
                ['overdue', '期限超過'],
              ] as [SaleFilterChip, string][]).map(([k, label]) => (
                <span
                  key={k}
                  role="button"
                  tabIndex={0}
                  onClick={e => { e.stopPropagation(); setSaleChip(k) }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setSaleChip(k) } }}
                  className={`cursor-pointer rounded-full px-2 py-0.5 text-[11px] ${saleChip === k ? 'bg-[#174c33] text-white' : 'bg-[#f4f2ea] text-[#68756c] hover:bg-[#eef3eb]'}`}
                >
                  {label}
                </span>
              ))}
            </div>
          </button>
          {salesOpen && (
            <div className="overflow-x-auto border-t border-[#ece8db]">
              <table className="min-w-full text-xs">
                <thead className="bg-[#faf8f1] text-left uppercase tracking-wider text-[#68756c]">
                  <tr>
                    <th className="px-3 py-2 font-medium">案件</th>
                    <th className="px-3 py-2 font-medium">販売先</th>
                    <th className="px-3 py-2 font-medium">商品</th>
                    <th className="px-3 py-2 font-medium text-right">請求額</th>
                    <th className="px-3 py-2 font-medium">ステータス</th>
                    <th className="px-3 py-2 font-medium">支払方法</th>
                    <th className="px-3 py-2 font-medium">入金日</th>
                    <th className="px-3 py-2 font-medium">期日</th>
                    <th className="px-3 py-2 font-medium text-right">手数料</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSales.map(r => (
                    <SaleRow
                      key={r.id}
                      record={r}
                      saving={savingId === r.id}
                      overdue={isOverdueSale(r)}
                      onSave={patch => updateSale(r.id, patch)}
                    />
                  ))}
                  {visibleSales.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-6 text-center text-[#68756c]">該当する売上はありません。</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Payables (POs) */}
        <div className="rounded-2xl border border-[#d9d1be] bg-white">
          <button
            type="button"
            onClick={() => setPosOpen(v => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <div className="flex items-center gap-2">
              {posOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              <h2 className="text-sm font-semibold text-[#173c2a]">仕入（発注側）</h2>
              <span className="rounded-full bg-[#f4f2ea] px-2 py-0.5 text-[11px] text-[#68756c]">{visibleOrders.length}件</span>
            </div>
            <div className="flex items-center gap-1">
              <Filter size={12} className="text-[#68756c]" />
              {([
                ['all', '全件'],
                ['pending', '未払'],
                ['paid', '支払済'],
                ['overdue', '期限超過'],
              ] as [PoFilterChip, string][]).map(([k, label]) => (
                <span
                  key={k}
                  role="button"
                  tabIndex={0}
                  onClick={e => { e.stopPropagation(); setPoChip(k) }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setPoChip(k) } }}
                  className={`cursor-pointer rounded-full px-2 py-0.5 text-[11px] ${poChip === k ? 'bg-[#174c33] text-white' : 'bg-[#f4f2ea] text-[#68756c] hover:bg-[#eef3eb]'}`}
                >
                  {label}
                </span>
              ))}
            </div>
          </button>
          {posOpen && (
            <div className="overflow-x-auto border-t border-[#ece8db]">
              <table className="min-w-full text-xs">
                <thead className="bg-[#faf8f1] text-left uppercase tracking-wider text-[#68756c]">
                  <tr>
                    <th className="px-3 py-2 font-medium">PO</th>
                    <th className="px-3 py-2 font-medium">仕入先</th>
                    <th className="px-3 py-2 font-medium">商品</th>
                    <th className="px-3 py-2 font-medium text-right">合計</th>
                    <th className="px-3 py-2 font-medium">ステータス</th>
                    <th className="px-3 py-2 font-medium">支払期日</th>
                    <th className="px-3 py-2 font-medium">支払日</th>
                    <th className="px-3 py-2 font-medium">請求書</th>
                    <th className="px-3 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleOrders.map(o => (
                    <PoRow
                      key={o.id}
                      order={o}
                      saving={savingId === o.id}
                      overdue={isOverduePo(o)}
                      onSave={patch => updateOrder(o.id, patch)}
                    />
                  ))}
                  {visibleOrders.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-6 text-center text-[#68756c]">該当する発注はありません。</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {loading && <p className="text-xs text-[#68756c]">読み込み中…</p>}
      </div>
    </AppLayout>
  )
}

function PeriodTable({ rows, title }: { rows: MonthlyRow[]; title: string }) {
  return (
    <div className="rounded-2xl border border-[#d9d1be] bg-white">
      <div className="border-b border-[#ece8db] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#173c2a]">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-[#faf8f1] text-left uppercase tracking-wider text-[#68756c]">
            <tr>
              <th className="px-3 py-2 font-medium">期間</th>
              <th className="px-3 py-2 font-medium text-right">売上計</th>
              <th className="px-3 py-2 font-medium text-right">入金済</th>
              <th className="px-3 py-2 font-medium text-right">仕入計</th>
              <th className="px-3 py-2 font-medium text-right">支払済</th>
              <th className="px-3 py-2 font-medium text-right">純収支</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} className="border-t border-[#ece8db] text-[#173c2a]">
                <td className="px-3 py-2 font-medium">{r.label}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(r.revenue)}</td>
                <td className="px-3 py-2 text-right text-[#174c33]">{formatCurrency(r.collected)}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(r.expense)}</td>
                <td className="px-3 py-2 text-right text-[#9d3d28]">{formatCurrency(r.paid)}</td>
                <td className={`px-3 py-2 text-right font-semibold ${r.net >= 0 ? 'text-[#174c33]' : 'text-[#9d3d28]'}`}>{formatCurrency(r.net)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-[#68756c]">データがありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PartnerTable({ title, rows, headers }: { title: string; rows: PartnerRow[]; headers: [string, string, string] }) {
  return (
    <div className="rounded-2xl border border-[#d9d1be] bg-white">
      <div className="border-b border-[#ece8db] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#173c2a]">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-[#faf8f1] text-left uppercase tracking-wider text-[#68756c]">
            <tr>
              <th className="px-3 py-2 font-medium">取引先</th>
              <th className="px-3 py-2 font-medium text-right">{headers[0]}</th>
              <th className="px-3 py-2 font-medium text-right">{headers[1]}</th>
              <th className="px-3 py-2 font-medium text-right">{headers[2]}</th>
              <th className="px-3 py-2 font-medium text-right">件数</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name} className="border-t border-[#ece8db] text-[#173c2a]">
                <td className="px-3 py-2 font-medium">{r.name}</td>
                <td className="px-3 py-2 text-right">{formatCurrency(r.total)}</td>
                <td className="px-3 py-2 text-right text-[#174c33]">{formatCurrency(r.settled)}</td>
                <td className="px-3 py-2 text-right text-[#9d3d28]">{formatCurrency(r.outstanding)}</td>
                <td className="px-3 py-2 text-right">{r.count}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-[#68756c]">データがありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SaleRow({
  record,
  saving,
  overdue,
  onSave,
}: {
  record: SaleRecord
  saving: boolean
  overdue: boolean
  onSave: (patch: { paymentStatus?: PaymentStatus; paymentMethod?: string; paymentDate?: string; paymentFee?: number }) => Promise<void>
}) {
  const [status, setStatus] = useState<PaymentStatus>(record.paymentStatus)
  const [method, setMethod] = useState<string>(record.paymentMethod ?? '')
  const [date, setDate] = useState<string>(record.paymentDate ?? '')
  const [fee, setFee] = useState<string>(String(record.paymentFee ?? 0))

  useEffect(() => {
    setStatus(record.paymentStatus)
    setMethod(record.paymentMethod ?? '')
    setDate(record.paymentDate ?? '')
    setFee(String(record.paymentFee ?? 0))
  }, [record])

  const dirty =
    status !== record.paymentStatus ||
    (method || '') !== (record.paymentMethod ?? '') ||
    (date || '') !== (record.paymentDate ?? '') ||
    Number(fee || 0) !== Number(record.paymentFee ?? 0)

  const extraItems = record.items.length > 1 ? `他${record.items.length - 1}件` : ''
  const productLabel = `${record.items[0]?.productName ?? '-'}${extraItems ? ` (${extraItems})` : ''}`

  return (
    <tr className={`border-t border-[#ece8db] ${overdue ? 'bg-[#fff7f4]' : ''}`}>
      <td className="px-3 py-2">
        <Link href={`/sales`} className="text-[#174c33] hover:underline">{record.id.slice(0, 8)}</Link>
      </td>
      <td className="px-3 py-2 text-[#173c2a]">{record.buyerName}</td>
      <td className="px-3 py-2 text-[#68756c]">{productLabel}</td>
      <td className="px-3 py-2 text-right font-medium text-[#173c2a]">{formatCurrency(saleIncome(record))}</td>
      <td className="px-3 py-2">
        <select
          value={status}
          onChange={e => setStatus(e.target.value as PaymentStatus)}
          className={editInputCls}
        >
          <option value="uninvoiced">未請求</option>
          <option value="invoiced">請求済</option>
          <option value="paid">入金済</option>
        </select>
        <div className="mt-1"><SaleBadge status={record.paymentStatus} /></div>
      </td>
      <td className="px-3 py-2">
        <select
          value={method}
          onChange={e => setMethod(e.target.value)}
          className={editInputCls}
        >
          <option value="">未設定</option>
          <option value="銀行振込">銀行振込</option>
          <option value="Stripe">Stripe</option>
          <option value="PayPal">PayPal</option>
          <option value="Square">Square</option>
          <option value="現金">現金</option>
          <option value="その他">その他</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className={editInputCls}
        />
      </td>
      <td className={`px-3 py-2 ${overdue ? 'font-medium text-[#9d3d28]' : 'text-[#68756c]'}`}>{record.dueDate || '-'}</td>
      <td className="px-3 py-2 text-right">
        <input
          type="number"
          value={fee}
          onChange={e => setFee(e.target.value)}
          className={`${editInputCls} text-right`}
        />
      </td>
      <td className="px-3 py-2">
        {dirty && (
          <button
            type="button"
            onClick={() => onSave({ paymentStatus: status, paymentMethod: method, paymentDate: date, paymentFee: Number(fee) || 0 })}
            disabled={saving}
            className="rounded-lg bg-[#174c33] px-2 py-1 text-[11px] font-medium text-white shadow hover:bg-[#205f43] disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        )}
      </td>
    </tr>
  )
}

function PoRow({
  order,
  saving,
  overdue,
  onSave,
}: {
  order: PurchaseOrder
  saving: boolean
  overdue: boolean
  onSave: (patch: { paymentStatus?: PurchaseOrderPaymentStatus; paymentDueDate?: string; paidDate?: string }) => Promise<void>
}) {
  const [status, setStatus] = useState<PurchaseOrderPaymentStatus>(order.paymentStatus)
  const [dueDate, setDueDate] = useState<string>(order.paymentDueDate ?? '')
  const [paidDate, setPaidDate] = useState<string>(order.paidDate ?? '')

  useEffect(() => {
    setStatus(order.paymentStatus)
    setDueDate(order.paymentDueDate ?? '')
    setPaidDate(order.paidDate ?? '')
  }, [order])

  const dirty =
    status !== order.paymentStatus ||
    (dueDate || '') !== (order.paymentDueDate ?? '') ||
    (paidDate || '') !== (order.paidDate ?? '')

  const extraItems = order.items.length > 1 ? `他${order.items.length - 1}件` : ''
  const productLabel = `${order.items[0]?.productName ?? '-'}${extraItems ? ` (${extraItems})` : ''}`

  return (
    <tr className={`border-t border-[#ece8db] ${overdue ? 'bg-[#fff7f4]' : ''}`}>
      <td className="px-3 py-2">
        <Link href={`/purchase-orders`} className="text-[#174c33] hover:underline">{order.id.slice(0, 8)}</Link>
      </td>
      <td className="px-3 py-2 text-[#173c2a]">{order.supplierName}</td>
      <td className="px-3 py-2 text-[#68756c]">{productLabel}</td>
      <td className="px-3 py-2 text-right font-medium text-[#173c2a]">{formatCurrency(order.totalAmount || 0)}</td>
      <td className="px-3 py-2">
        <select
          value={status}
          onChange={e => setStatus(e.target.value as PurchaseOrderPaymentStatus)}
          className={editInputCls}
        >
          <option value="uninvoiced">未請求</option>
          <option value="unpaid">未払</option>
          <option value="paid">支払済</option>
        </select>
        <div className="mt-1"><PoBadge status={order.paymentStatus} /></div>
      </td>
      <td className="px-3 py-2">
        <input
          type="date"
          value={dueDate}
          onChange={e => setDueDate(e.target.value)}
          className={`${editInputCls} ${overdue ? 'border-[#9d3d28]' : ''}`}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="date"
          value={paidDate}
          onChange={e => setPaidDate(e.target.value)}
          className={editInputCls}
        />
      </td>
      <td className="px-3 py-2">
        {order.invoice ? (
          <a
            href={order.invoice.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[#174c33] hover:underline"
          >
            <FileText size={12} /> PDF
          </a>
        ) : (
          <span className="text-[#a59f8c]">-</span>
        )}
      </td>
      <td className="px-3 py-2">
        {dirty && (
          <button
            type="button"
            onClick={() => onSave({ paymentStatus: status, paymentDueDate: dueDate, paidDate })}
            disabled={saving}
            className="rounded-lg bg-[#174c33] px-2 py-1 text-[11px] font-medium text-white shadow hover:bg-[#205f43] disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        )}
      </td>
    </tr>
  )
}
