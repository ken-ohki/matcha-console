'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { SaleModal } from '@/components/sales/SaleModal'
import { AppLayout } from '@/components/layout/AppLayout'
import { PageTabs, SALES_TABS } from '@/components/layout/PageTabs'
import { KPICard } from '@/components/ui/KPICard'
import { SalesStatusBadge } from '@/components/ui/StatusBadge'
import { getServices } from '@/lib/services'
import type { Buyer, MasterEntry, PaymentStatus, ProductWithInventory, SaleRecord, SaleRecordInput, SaleStatus, ShippingStatus } from '@/types'
import { computeSaleTaxIncluded } from '@/lib/cashflow'
import { sumSaleFees } from '@/lib/tax'
import { formatCurrency, formatKg } from '@/lib/format'
import {
  CircleDollarSign,
  ClipboardPenLine,
  Copy,
  Package2,
  Percent,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'

type ViewMode = 'by-month' | 'by-fiscal' | 'by-country' | 'by-product'
type SortKey = 'createdAt' | 'orderDate' | 'buyerName' | 'amount' | 'grossProfit' | 'dueDate' | 'paymentDate' | 'status'

interface AggregateRow {
  key: string
  label: string
  count: number
  quantityKg: number
  revenue: number
  costAmount: number
  grossProfit: number
}

function fiscalYearOf(date: Date): number {
  const year = date.getFullYear()
  const month = date.getMonth() // 0-11
  return month >= 3 ? year : year - 1 // Apr (3) - Mar
}

function aggregateSales(records: SaleRecord[], keyFn: (r: SaleRecord) => { key: string; label: string }): AggregateRow[] {
  const groups = new Map<string, AggregateRow>()
  for (const r of records) {
    const { key, label } = keyFn(r)
    const existing = groups.get(key) ?? { key, label, count: 0, quantityKg: 0, revenue: 0, costAmount: 0, grossProfit: 0 }
    existing.count += 1
    existing.quantityKg += r.quantityKg
    existing.revenue += r.revenue
    existing.costAmount += r.costAmount
    existing.grossProfit += r.grossProfit
    groups.set(key, existing)
  }
  return [...groups.values()]
}

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  uninvoiced: '未請求',
  invoiced: '請求済',
  paid: '支払済',
}
const PAYMENT_COLORS: Record<PaymentStatus, string> = {
  uninvoiced: 'bg-gray-100 text-gray-700',
  invoiced: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-800',
}
const SHIPPING_LABELS: Record<ShippingStatus, string> = {
  ordering: '発注中',
  producing: '製造中',
  ready_to_ship: '発送準備中',
  shipped: '発送完了',
}
const SHIPPING_COLORS: Record<ShippingStatus, string> = {
  ordering: 'bg-slate-100 text-slate-700',
  producing: 'bg-blue-100 text-blue-800',
  ready_to_ship: 'bg-amber-100 text-amber-800',
  shipped: 'bg-emerald-100 text-emerald-800',
}

function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${PAYMENT_COLORS[status]}`}>
      {PAYMENT_LABELS[status]}
    </span>
  )
}
function ShippingBadge({ status }: { status: ShippingStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${SHIPPING_COLORS[status]}`}>
      {SHIPPING_LABELS[status]}
    </span>
  )
}

function getStatusLabel(status: SaleStatus): string {
  if (status === 'confirmed') return '確定'
  if (status === 'cancelled') return '取消'
  return '商談中'
}

function formatDateOnly(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function SortTh({ label, col, sortKey, sortDir, onSort }: {
  label: string
  col: SortKey
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
}) {
  const active = sortKey === col
  return (
    <th className="whitespace-nowrap px-3 py-3 font-medium">
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 ${active ? 'text-[#173c2a]' : 'hover:text-[#173c2a]'}`}
      >
        {label}
        <span className="text-[10px]">{active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  )
}

function statusColor(status: SaleStatus): string {
  if (status === 'confirmed') return '#2f5d26'
  if (status === 'cancelled') return '#c6c6c6'
  return '#7dbb57'
}

export default function SalesPage() {
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [masters, setMasters] = useState<MasterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilters, setStatusFilters] = useState<Set<SaleStatus>>(new Set())
  const [buyerFilters, setBuyerFilters] = useState<Set<string>>(new Set())
  const [countryFilters, setCountryFilters] = useState<Set<string>>(new Set())
  const [productFilters, setProductFilters] = useState<Set<string>>(new Set())
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('by-month')
  const [mainTab, setMainTab] = useState<'dashboard' | 'records'>('records')
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [modalOpen, setModalOpen] = useState(false)
  const [prefillSale, setPrefillSale] = useState<SaleRecord | null>(null)
  const router = useRouter()
  const openDetail = (id: string) => router.push(`/sales/${id}`)

  const handleDuplicate = (record: SaleRecord) => {
    setPrefillSale({
      ...record,
      id: '',
      status: 'negotiating',
      paymentStatus: 'uninvoiced',
      shippingStatus: 'ordering',
      dueDate: undefined,
      paymentDate: undefined,
      shippingDate: undefined,
      trackingNumber: undefined,
      notes: record.notes ? `${record.notes}（複製）` : '複製',
    })
    setModalOpen(true)
  }
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const [nextSales, nextBuyers, nextProducts, nextMasters] = await Promise.all([
      services.sales.getSaleRecords(),
      services.sales.getBuyers(),
      services.inventory.getProductsWithInventory(),
      services.masters.listMasters(),
    ])
    setSales(nextSales)
    setBuyers(nextBuyers)
    setProducts(nextProducts)
    setMasters(nextMasters)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const handler = () => {
      if (modalOpen) return
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', handler)
    window.addEventListener('focus', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen])

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : null
    const toTime = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null
    return sales.filter(record => {
      if (statusFilters.size > 0 && !statusFilters.has(record.status)) return false
      if (buyerFilters.size > 0 && !buyerFilters.has(record.buyerName)) return false
      if (countryFilters.size > 0 && !countryFilters.has(record.country || '(未設定)')) return false
      if (productFilters.size > 0) {
        const matched = record.items.some(item => productFilters.has(item.productSku || item.productId))
        if (!matched) return false
      }
      const t = record.createdAt.getTime()
      if (fromTime != null && t < fromTime) return false
      if (toTime != null && t > toTime) return false
      if (!q) return true
      return (
        record.buyerName.toLowerCase().includes(q) ||
        record.country.toLowerCase().includes(q) ||
        record.items.some(item =>
          item.productName.toLowerCase().includes(q) ||
          item.productSku.toLowerCase().includes(q)
        )
      )
    })
  }, [sales, search, statusFilters, buyerFilters, countryFilters, productFilters, dateFrom, dateTo])

  // Statistics exclude cancelled deals (取消)
  const analyticsSales = useMemo(() => filteredSales.filter(s => s.status !== 'cancelled'), [filteredSales])

  const STATUS_ORDER: Record<SaleStatus, number> = { negotiating: 0, confirmed: 1, cancelled: 2 }
  const sortedSales = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    const val = (r: SaleRecord): string | number => {
      switch (sortKey) {
        case 'buyerName': return r.buyerName ?? ''
        case 'amount': return computeSaleTaxIncluded(r)
        case 'grossProfit': return r.grossProfit ?? 0
        case 'orderDate': return r.orderDate ?? ''
        case 'dueDate': return r.dueDate ?? ''
        case 'paymentDate': return r.paymentDate ?? ''
        case 'status': return STATUS_ORDER[r.status] ?? 9
        case 'createdAt':
        default: return r.createdAt.getTime()
      }
    }
    return [...filteredSales].sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSales, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'buyerName' ? 'asc' : 'desc') }
  }

  const aggregations = useMemo(() => ({
    monthly: aggregateSales(analyticsSales, r => {
      const d = r.createdAt
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      return { key, label: key }
    }).sort((a, b) => b.key.localeCompare(a.key)),
    fiscal: aggregateSales(analyticsSales, r => {
      const fy = fiscalYearOf(r.createdAt)
      return { key: String(fy), label: `FY${fy}（${fy}/4 - ${fy + 1}/3）` }
    }).sort((a, b) => b.key.localeCompare(a.key)),
    country: aggregateSales(analyticsSales, r => ({ key: r.country || '(未設定)', label: r.country || '(未設定)' }))
      .sort((a, b) => b.revenue - a.revenue),
    product: (() => {
      const groups = new Map<string, AggregateRow>()
      for (const sale of analyticsSales) {
        const seenInSale = new Set<string>()
        for (const item of sale.items) {
          const key = `${item.productSku || item.productId}::${item.productName}`
          const label = item.productName
          const existing = groups.get(key) ?? { key, label, count: 0, quantityKg: 0, revenue: 0, costAmount: 0, grossProfit: 0 }
          // Count each sale once per product
          if (!seenInSale.has(key)) {
            existing.count += 1
            seenInSale.add(key)
          }
          existing.quantityKg += item.quantityKg
          existing.revenue += item.revenue
          existing.costAmount += item.costAmount
          existing.grossProfit += item.grossProfit
          groups.set(key, existing)
        }
      }
      return [...groups.values()].sort((a, b) => b.revenue - a.revenue)
    })(),
  }), [analyticsSales])

  const filterOptions = useMemo(() => {
    const buyers = new Set<string>()
    const countries = new Set<string>()
    const products = new Map<string, string>() // key → label
    for (const r of sales) {
      if (r.buyerName) buyers.add(r.buyerName)
      countries.add(r.country || '(未設定)')
      for (const item of r.items) {
        const key = item.productSku || item.productId
        products.set(key, `${item.productName}${item.productSku ? ` (${item.productSku})` : ''}`)
      }
    }
    return {
      buyers: [...buyers].sort(),
      countries: [...countries].sort(),
      products: [...products.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
    }
  }, [sales])

  const activeFilterCount =
    statusFilters.size + buyerFilters.size + countryFilters.size + productFilters.size +
    (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)

  const toggleSetItem = <T,>(setter: (next: Set<T>) => void, current: Set<T>, item: T) => {
    const next = new Set(current)
    if (next.has(item)) next.delete(item)
    else next.add(item)
    setter(next)
  }

  const resetFilters = () => {
    setStatusFilters(new Set())
    setBuyerFilters(new Set())
    setCountryFilters(new Set())
    setProductFilters(new Set())
    setDateFrom('')
    setDateTo('')
    setSearch('')
  }

  const scopeRevenue = analyticsSales.reduce((sum, record) => sum + record.revenue, 0)
  const scopeQuantity = analyticsSales.reduce((sum, record) => sum + record.quantityKg, 0)
  const scopeProfit = analyticsSales.reduce((sum, record) => sum + record.grossProfit, 0)
  const scopeMargin = scopeRevenue === 0 ? 0 : (scopeProfit / scopeRevenue) * 100
  const scopeAvgUnitPrice = scopeQuantity === 0 ? 0 : scopeRevenue / scopeQuantity

  const scopeLabel = statusFilters.size === 0
    ? '全案件'
    : [...statusFilters].map(getStatusLabel).join(' + ')

  const buyerSummary = Object.values(analyticsSales.reduce<Record<string, {
    buyerName: string
    revenue: number
    profit: number
  }>>((acc, record) => {
    const current = acc[record.buyerName] ?? { buyerName: record.buyerName, revenue: 0, profit: 0 }
    current.revenue += record.revenue
    current.profit += record.grossProfit
    acc[record.buyerName] = current
    return acc
  }, {})).sort((a, b) => b.revenue - a.revenue)

  const maxBuyerRevenue = buyerSummary[0]?.revenue ?? 1
  const statusCounts = {
    negotiating: filteredSales.filter(record => record.status === 'negotiating').length,
    confirmed: filteredSales.filter(record => record.status === 'confirmed').length,
    cancelled: filteredSales.filter(record => record.status === 'cancelled').length,
  }
  const totalStatusCount = statusCounts.negotiating + statusCounts.confirmed + statusCounts.cancelled
  const donut = `conic-gradient(
    ${statusColor('confirmed')} 0deg ${(statusCounts.confirmed / Math.max(totalStatusCount, 1)) * 360}deg,
    ${statusColor('negotiating')} ${(statusCounts.confirmed / Math.max(totalStatusCount, 1)) * 360}deg ${((statusCounts.confirmed + statusCounts.negotiating) / Math.max(totalStatusCount, 1)) * 360}deg,
    ${statusColor('cancelled')} ${((statusCounts.confirmed + statusCounts.negotiating) / Math.max(totalStatusCount, 1)) * 360}deg 360deg
  )`

  // The modal is now create/duplicate only; editing happens on /sales/[id].
  const handleSave = async (input: SaleRecordInput) => {
    const services = await getServices()
    await services.sales.createSaleRecord(input)
    setMessage('販売案件を登録しました')
    setPrefillSale(null)
    setModalOpen(false)
    await load()
  }

  const handleDelete = async (record: SaleRecord) => {
    if (!confirm(`${record.buyerName} 向けの案件を削除しますか？`)) return
    const services = await getServices()
    await services.sales.deleteSaleRecord(record.id)
    setMessage('販売案件を削除しました')
    await load()
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageTabs tabs={SALES_TABS} />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="mt-3 text-3xl font-bold text-[#173c2a]">販売管理</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-[#174c33] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#123723]"
            >
              <Plus size={16} />
              新規作成
            </button>
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}

        <div className="flex gap-1 border-b border-[#e6dfcf]">
          {([
            ['records', '案件一覧'],
            ['dashboard', 'ダッシュボード'],
          ] as ['records' | 'dashboard', string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMainTab(k)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                mainTab === k
                  ? 'border-[#174c33] text-[#173c2a]'
                  : 'border-transparent text-[#68756c] hover:text-[#173c2a]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mainTab === 'dashboard' && (<>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KPICard title={`売上高（${scopeLabel}）`} value={formatCurrency(scopeRevenue)} color="green" icon={<CircleDollarSign size={18} />} />
          <KPICard title="数量" value={formatKg(scopeQuantity)} color="default" icon={<Package2 size={18} />} />
          <KPICard title="粗利" value={formatCurrency(scopeProfit)} color="amber" icon={<ClipboardPenLine size={18} />} />
          <KPICard title="粗利率" value={`${scopeMargin.toFixed(1)}%`} color="violet" icon={<Percent size={18} />} />
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KPICard title="案件数" value={`${analyticsSales.length} 件`} color="default" icon={<ClipboardPenLine size={18} />} />
          <KPICard title="平均単価 / kg" value={scopeAvgUnitPrice > 0 ? formatCurrency(scopeAvgUnitPrice) : '-'} color="default" icon={<CircleDollarSign size={18} />} />
          <KPICard
            title="未入金金額(税込)"
            value={formatCurrency(analyticsSales.filter(r => r.paymentStatus !== 'paid').reduce((s, r) => s + computeSaleTaxIncluded(r), 0))}
            color="amber"
            icon={<CircleDollarSign size={18} />}
          />
          <KPICard
            title="未発送件数"
            value={`${analyticsSales.filter(r => r.shippingStatus !== 'shipped').length} 件`}
            color="default"
            icon={<Package2 size={18} />}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
          <section className="rounded-3xl border border-[#d9d1be] bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-[#173c2a]">購入者別売上高・粗利（{scopeLabel}）</h2>
            <div className="mt-6 space-y-4">
              {buyerSummary.length === 0 && (
                <p className="text-sm text-[#68756c]">対象の案件がありません。</p>
              )}
              {buyerSummary.map(item => (
                <div key={item.buyerName} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-[#173c2a]">{item.buyerName}</span>
                    <span className="text-[#68756c]">{formatCurrency(item.revenue)}</span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="rounded-full bg-[#eef3eb]">
                      <div className="h-4 rounded-full bg-[#2f5d26]" style={{ width: `${(item.revenue / maxBuyerRevenue) * 100}%` }} />
                    </div>
                    <div className="rounded-full bg-[#eef3eb]">
                      <div className="h-4 rounded-full bg-[#7dbb57]" style={{ width: `${Math.max((item.profit / maxBuyerRevenue) * 100, 3)}%` }} />
                    </div>
                  </div>
                  <div className="flex gap-5 text-xs text-[#68756c]">
                    <span>売上高 {formatCurrency(item.revenue)}</span>
                    <span>粗利 {formatCurrency(item.profit)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-[#d9d1be] bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-[#173c2a]">ステータス分布</h2>
            <div className="mt-8 flex flex-col items-center gap-6 lg:flex-row lg:justify-center">
              <div className="relative h-48 w-48 rounded-full" style={{ background: donut }}>
                <div className="absolute inset-[32px] rounded-full bg-white" />
              </div>
              <div className="space-y-4 text-sm text-[#4d5b52]">
                {(['negotiating', 'confirmed', 'cancelled'] as SaleStatus[]).map(status => (
                  <div key={status} className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: statusColor(status) }} />
                    <span>{getStatusLabel(status)}</span>
                    <span className="font-semibold text-[#173c2a]">
                      {status === 'negotiating' ? statusCounts.negotiating : status === 'confirmed' ? statusCounts.confirmed : statusCounts.cancelled}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
        </>)}

        <div className="rounded-3xl border border-[#d9d1be] bg-white p-5 shadow-sm">
          {mainTab === 'dashboard' && (
          <div className="mb-4 flex flex-wrap gap-2">
            {([
              { mode: 'by-month', label: '月別' },
              { mode: 'by-fiscal', label: '年度別' },
              { mode: 'by-country', label: '国別' },
              { mode: 'by-product', label: '商品別' },
            ] as { mode: ViewMode; label: string }[]).map(tab => (
              <button
                key={tab.mode}
                type="button"
                onClick={() => setViewMode(tab.mode)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  viewMode === tab.mode
                    ? 'bg-[#174c33] text-white'
                    : 'border border-[#d9d1be] bg-white text-[#173c2a] hover:bg-[#ece8db]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          )}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-lg font-semibold text-[#173c2a]">
              {mainTab === 'records' ? '販売案件一覧'
                : viewMode === 'by-month' ? '月別集計'
                : viewMode === 'by-fiscal' ? '年度別集計（4月〜3月）'
                : viewMode === 'by-country' ? '国別集計'
                : '商品別集計'}
              <span className="ml-2 text-sm font-normal text-[#68756c]">({filteredSales.length}件)</span>
            </h2>
            <div className="flex flex-wrap gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="商品名・購入者・国で検索"
                  className="w-full rounded-xl border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 sm:w-56"
                />
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen(prev => !prev)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                詳細フィルタ
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-[#174c33] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-xl px-3 py-2 text-sm text-[#68756c] underline-offset-2 hover:underline"
                >
                  リセット
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(['negotiating', 'confirmed', 'cancelled'] as SaleStatus[]).map(status => {
              const active = statusFilters.has(status)
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleSetItem(setStatusFilters, statusFilters, status)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    active
                      ? 'bg-[#174c33] text-white'
                      : 'border border-[#d9d1be] bg-white text-[#173c2a] hover:bg-[#ece8db]'
                  }`}
                >
                  {getStatusLabel(status)}
                </button>
              )
            })}
            <span className="self-center text-[11px] text-[#68756c]">
              {statusFilters.size === 0 ? '全ステータス表示中' : `${statusFilters.size} ステータス選択中`}
            </span>
          </div>

          {filtersOpen && (
            <div className="mt-3 grid gap-4 rounded-2xl border border-[#e6dfcf] bg-[#faf8f1] p-4 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[#68756c]">期間（作成日）</p>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <span className="text-xs text-[#68756c]">〜</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>
              <FilterMultiSelect
                label="購入者"
                options={filterOptions.buyers.map(name => ({ value: name, label: name }))}
                selected={buyerFilters}
                onToggle={value => toggleSetItem(setBuyerFilters, buyerFilters, value)}
                onClear={() => setBuyerFilters(new Set())}
              />
              <FilterMultiSelect
                label="国"
                options={filterOptions.countries.map(name => ({ value: name, label: name }))}
                selected={countryFilters}
                onToggle={value => toggleSetItem(setCountryFilters, countryFilters, value)}
                onClear={() => setCountryFilters(new Set())}
              />
              <FilterMultiSelect
                label="商品"
                options={filterOptions.products.map(p => ({ value: p.key, label: p.label }))}
                selected={productFilters}
                onToggle={value => toggleSetItem(setProductFilters, productFilters, value)}
                onClear={() => setProductFilters(new Set())}
              />
            </div>
          )}

          {mainTab === 'dashboard' && (
            <div className="mt-5 overflow-x-auto">
              <AggregateTable
                rows={
                  viewMode === 'by-month' ? aggregations.monthly
                    : viewMode === 'by-fiscal' ? aggregations.fiscal
                    : viewMode === 'by-country' ? aggregations.country
                    : aggregations.product
                }
                groupLabel={
                  viewMode === 'by-month' ? '月'
                    : viewMode === 'by-fiscal' ? '年度'
                    : viewMode === 'by-country' ? '国'
                    : '商品'
                }
              />
            </div>
          )}

          <div className={`mt-5 space-y-3 ${mainTab === 'records' ? 'md:hidden' : 'hidden'}`}>
            {!loading && sortedSales.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#d9d1be] px-4 py-10 text-center text-sm text-[#68756c]">
                条件に合う販売案件はありません。
              </div>
            )}
            {sortedSales.map(record => (
              <div
                key={record.id}
                onClick={() => openDetail(record.id)}
                className="cursor-pointer rounded-2xl border border-[#ece5d7] bg-[#faf8f2] p-4 transition hover:border-[#bcb39a]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-[#173c2a]">{record.buyerName}</div>
                    <div className="mt-1 text-xs text-[#68756c]">{record.country} / 納期 {record.dueDate || '-'}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SalesStatusBadge status={record.status} />
                    <PaymentBadge status={record.paymentStatus} />
                    <ShippingBadge status={record.shippingStatus} />
                  </div>
                </div>
                <div className="mt-3 rounded-xl bg-white p-3">
                  <div className="text-sm text-[#173c2a]">
                    {record.items[0]?.productName ?? record.productName}
                    {record.items.length > 1 && (
                      <span className="text-xs text-[#68756c]"> +他{record.items.length - 1}件</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-[#68756c]">{record.items[0]?.productSku ?? record.productSku}</div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-white p-3 text-xs text-[#68756c]">
                    <div>数量 {formatKg(record.quantityKg)}</div>
                    <div className="mt-1 font-semibold text-[#173c2a]">請求額(税込) {formatCurrency(computeSaleTaxIncluded(record))}</div>
                    <div className="mt-1">
                      （税抜 {formatCurrency(record.invoiceAmount || record.revenue)}
                      {((record.shippingFee || 0) > 0 || (record.fees ?? []).length > 0) && <> ＝商品 {formatCurrency(record.revenue)}{(record.shippingFee || 0) > 0 && <> ＋送料 {formatCurrency(record.shippingFee)}</>}{(record.fees ?? []).length > 0 && <> ＋諸費用 {formatCurrency(sumSaleFees(record.fees))}</>}</>}）
                    </div>
                    <div className="mt-1">原価 {formatCurrency(record.costAmount)}</div>
                    <div className="mt-1 font-semibold text-emerald-700">粗利 {formatCurrency(record.grossProfit)}</div>
                  </div>
                  <div className="rounded-xl bg-white p-3 text-xs text-[#68756c]">
                    <div>メモ {record.notes || '-'}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => handleDuplicate(record)}
                    aria-label="複製"
                    className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(record)}
                    className="rounded-lg p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className={`mt-5 -mx-5 overflow-x-auto ${mainTab === 'records' ? 'hidden md:block' : 'hidden'}`}>
            <table className="min-w-[1280px] text-sm">
              <thead>
                <tr className="border-b border-[#e6dfcf] text-left text-[#68756c]">
                  <SortTh label="ステータス" col="status" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="購入者" col="buyerName" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="発注日" col="orderDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="作成日" col="createdAt" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="whitespace-nowrap px-3 py-3 font-medium">商品</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">数量</th>
                  <SortTh label="請求額(税込)" col="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="whitespace-nowrap px-3 py-3 font-medium">原価</th>
                  <SortTh label="粗利" col="grossProfit" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="whitespace-nowrap px-3 py-3 font-medium">国</th>
                  <SortTh label="納期" col="dueDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="whitespace-nowrap px-3 py-3 font-medium">支払方法</th>
                  <SortTh label="入金日" col="paymentDate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="whitespace-nowrap px-3 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {!loading && sortedSales.length === 0 && (
                  <tr>
                    <td colSpan={14} className="px-3 py-10 text-center text-sm text-[#68756c]">
                      条件に合う販売案件はありません。
                    </td>
                  </tr>
                )}
                {sortedSales.map(record => (
                  <tr
                    key={record.id}
                    onClick={() => openDetail(record.id)}
                    className="cursor-pointer border-b border-[#f0ebdf] text-[#173c2a] transition hover:bg-[#faf8f2]"
                  >
                    <td className="whitespace-nowrap px-3 py-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SalesStatusBadge status={record.status} />
                        <PaymentBadge status={record.paymentStatus} />
                        <ShippingBadge status={record.shippingStatus} />
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 font-medium">{record.buyerName}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-[#68756c]">{record.orderDate || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-[#68756c]">{formatDateOnly(record.createdAt)}</td>
                    <td className="px-3 py-4 align-top">
                      <div className="line-clamp-2 max-w-[260px]">
                        {record.items[0]?.productName ?? record.productName}
                        {record.items.length > 1 && (
                          <span className="text-xs text-[#68756c]"> +他{record.items.length - 1}件</span>
                        )}
                      </div>
                      <div className="truncate max-w-[260px] text-xs text-[#68756c]">{record.items[0]?.productSku ?? record.productSku}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4">{formatKg(record.quantityKg)}</td>
                    <td className="whitespace-nowrap px-3 py-4 align-top">
                      <div className="font-semibold text-[#173c2a]">{formatCurrency(computeSaleTaxIncluded(record))}</div>
                      <div className="text-[10px] text-[#68756c]">税抜 {formatCurrency(record.invoiceAmount || record.revenue)}</div>
                      {((record.shippingFee || 0) > 0 || (record.fees ?? []).length > 0) && (
                        <div className="truncate max-w-[220px] text-[10px] text-[#68756c]">
                          商品 {formatCurrency(record.revenue)}
                          {(record.shippingFee || 0) > 0 && <> ＋送料 {formatCurrency(record.shippingFee)}</>}
                          {(record.fees ?? []).length > 0 && <> ＋諸費用 {formatCurrency(sumSaleFees(record.fees))}</>}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4">{formatCurrency(record.costAmount)}</td>
                    <td className="whitespace-nowrap px-3 py-4 font-medium text-emerald-700">{formatCurrency(record.grossProfit)}</td>
                    <td className="whitespace-nowrap px-3 py-4">{record.country}</td>
                    <td className="whitespace-nowrap px-3 py-4">{record.dueDate || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-4">{record.paymentMethod || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-4">{record.paymentDate || '-'}</td>
                    <td className="whitespace-nowrap px-3 py-4">
                      <div className="flex flex-wrap justify-end gap-1" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleDuplicate(record)}
                          aria-label="複製"
                          className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(record)}
                          className="rounded-lg p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <SaleModal
          open={modalOpen}
          buyers={buyers}
          masters={masters}
          products={products}
          initial={prefillSale}
          onClose={() => {
            setModalOpen(false)
            setPrefillSale(null)
          }}
          onSave={handleSave}
        />
      </div>
    </AppLayout>
  )
}

function FilterMultiSelect({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string
  options: { value: string; label: string }[]
  selected: Set<string>
  onToggle: (value: string) => void
  onClear: () => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[#68756c]">
          {label} <span className="ml-1 text-[10px] text-[#a59f8c]">({selected.size === 0 ? '全' : selected.size}/{options.length})</span>
        </p>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-[#174c33] underline-offset-2 hover:underline"
          >
            クリア
          </button>
        )}
      </div>
      <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
        {options.length === 0 ? (
          <p className="px-1 py-2 text-xs text-[#a59f8c]">選択肢がありません</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {options.map(opt => {
              const active = selected.has(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onToggle(opt.value)}
                  className={`rounded-full px-2.5 py-0.5 text-xs transition ${
                    active
                      ? 'bg-[#174c33] text-white'
                      : 'border border-[#d9d1be] bg-white text-[#173c2a] hover:bg-[#ece8db]'
                  }`}
                  title={opt.label}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function AggregateTable({ rows, groupLabel }: { rows: AggregateRow[]; groupLabel: string }) {
  const totals = rows.reduce<AggregateRow>((acc, r) => ({
    key: '',
    label: '合計',
    count: acc.count + r.count,
    quantityKg: acc.quantityKg + r.quantityKg,
    revenue: acc.revenue + r.revenue,
    costAmount: acc.costAmount + r.costAmount,
    grossProfit: acc.grossProfit + r.grossProfit,
  }), { key: '', label: '合計', count: 0, quantityKg: 0, revenue: 0, costAmount: 0, grossProfit: 0 })
  const totalMargin = totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : 0

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#d9d1be] px-4 py-10 text-center text-sm text-[#68756c]">
        集計対象の販売案件がありません。
      </div>
    )
  }

  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr className="border-b border-[#e6dfcf] text-left text-[#68756c]">
          <th className="px-3 py-3 font-medium">{groupLabel}</th>
          <th className="px-3 py-3 text-right font-medium">件数</th>
          <th className="px-3 py-3 text-right font-medium">数量</th>
          <th className="px-3 py-3 text-right font-medium">売上</th>
          <th className="px-3 py-3 text-right font-medium">原価</th>
          <th className="px-3 py-3 text-right font-medium">粗利</th>
          <th className="px-3 py-3 text-right font-medium">粗利率</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => {
          const margin = row.revenue > 0 ? (row.grossProfit / row.revenue) * 100 : 0
          return (
            <tr key={row.key} className="border-b border-[#f0ebdf] text-[#173c2a]">
              <td className="px-3 py-3 font-medium">{row.label}</td>
              <td className="px-3 py-3 text-right">{row.count}</td>
              <td className="px-3 py-3 text-right">{formatKg(row.quantityKg)}</td>
              <td className="px-3 py-3 text-right">{formatCurrency(row.revenue)}</td>
              <td className="px-3 py-3 text-right text-[#68756c]">{formatCurrency(row.costAmount)}</td>
              <td className="px-3 py-3 text-right font-semibold text-emerald-700">{formatCurrency(row.grossProfit)}</td>
              <td className="px-3 py-3 text-right">{margin.toFixed(1)}%</td>
            </tr>
          )
        })}
        <tr className="bg-[#faf8f1] text-[#173c2a]">
          <td className="px-3 py-3 font-semibold">合計</td>
          <td className="px-3 py-3 text-right font-semibold">{totals.count}</td>
          <td className="px-3 py-3 text-right font-semibold">{formatKg(totals.quantityKg)}</td>
          <td className="px-3 py-3 text-right font-semibold">{formatCurrency(totals.revenue)}</td>
          <td className="px-3 py-3 text-right font-semibold">{formatCurrency(totals.costAmount)}</td>
          <td className="px-3 py-3 text-right font-semibold text-emerald-700">{formatCurrency(totals.grossProfit)}</td>
          <td className="px-3 py-3 text-right font-semibold">{totalMargin.toFixed(1)}%</td>
        </tr>
      </tbody>
    </table>
  )
}
