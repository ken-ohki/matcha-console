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
  ShoppingBag,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { getServices } from '@/lib/services'
import type {
  EcSaleRecord,
  PaymentStatus,
  PurchaseOrder,
  PurchaseOrderPaymentStatus,
  SaleRecord,
} from '@/types'
import {
  buildCashFlowSeries,
  todayMonthKey,
  type CashFlowMode,
  type MonthlyCashFlow,
} from '@/lib/cashflow'
import { endOfMonth, formatCurrency, monthKey, startOfMonth, todayIso } from '@/lib/format'
import { fetchWholesaleOrders, orderToSale } from '@/lib/wholesaleAdapter'

type TabKey = 'overview' | 'monthly' | 'fiscal' | 'partner' | 'products' | 'cashflow'

function fiscalYearOf(date: Date): number {
  const year = date.getFullYear()
  const month = date.getMonth()
  return month >= 3 ? year : year - 1
}

function startOfFiscalYear(fy: number): string {
  return `${fy}-04-01`
}

function endOfFiscalYear(fy: number): string {
  return `${fy + 1}-03-31`
}

// PO expense (税抜): stored totalAmount is items-only, fees live in separate fields.
function poExpense(o: PurchaseOrder): number {
  return (o.totalAmount || 0) + (o.shippingFee ?? 0) + (o.otherFees ?? 0)
}

function saleIncome(sale: SaleRecord): number {
  const inv = sale.invoiceAmount || 0
  return inv > 0 ? inv : sale.revenue || 0
}

function ecRevenue(ec: EcSaleRecord): number {
  return ec.revenue != null ? ec.revenue : (ec.unitPrice ?? 0) * ec.quantityKg
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

interface ProductRow {
  productId: string
  name: string
  sku: string
  revenue: number
  quantity: number
  profit: number
  count: number
}

interface PartnerRow {
  name: string
  total: number
  settled: number
  outstanding: number
  count: number
}

const editInputCls =
  'w-full rounded-lg border border-line bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-matcha'

export default function FinancialsPage() {
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [ecSales, setEcSales] = useState<EcSaleRecord[]>([])
  const [costByProduct, setCostByProduct] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('overview')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  // 集計の基準日: 発注日（無ければ作成日）/ 納品日（納期、無ければ発注日/作成日）
  const [saleBasis, setSaleBasis] = useState<'order' | 'delivery'>('order')
  const saleDate = (r: SaleRecord): Date => {
    if (saleBasis === 'delivery' && r.dueDate) return new Date(r.dueDate)
    if (r.orderDate) return new Date(r.orderDate)
    return r.createdAt
  }

  const load = async () => {
    setLoading(true)
    try {
      const svc = await getServices()
      const [o, ec, products, wholesaleOrders] = await Promise.all([
        svc.purchaseOrders.getPurchaseOrders(),
        svc.ecSales.getEcSaleRecords(),
        svc.inventory.getProductsWithInventory(),
        fetchWholesaleOrders(),
      ])
      const costMap: Record<string, number> = {}
      for (const p of products) costMap[p.id] = p.purchaseUnitPrice ?? 0
      setCostByProduct(costMap)
      // Direct sales are now wholesale_orders; map them into the SaleRecord shape.
      setSales(wholesaleOrders.map(wo => orderToSale(wo, costMap)))
      setOrders(o)
      // Exclude wholesale stock-ledger entries — those revenues are counted via the
      // wholesale orders above; only Shopify ec_sales are EC revenue.
      setEcSales(ec.filter(e => e.channel !== 'Wholesale' && e.channel !== 'WholesaleSample'))
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
      // 収支管理は確定済み案件のみ
      if (s.status !== 'confirmed') return false
      const t = saleDate(s).getTime()
      if (fromTime != null && t < fromTime) return false
      if (toTime != null && t > toTime) return false
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, fromTime, toTime, saleBasis])

  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (!o.orderDate) return true
      const t = new Date(o.orderDate).getTime()
      if (fromTime != null && t < fromTime) return false
      if (toTime != null && t > toTime) return false
      return true
    })
  }, [orders, fromTime, toTime])

  const filteredEc = useMemo(() => {
    return ecSales.filter(ec => {
      if (ec.status === 'cancelled') return false
      if (!ec.soldOn) return false
      const t = new Date(ec.soldOn).getTime()
      if (fromTime != null && t < fromTime) return false
      if (toTime != null && t > toTime) return false
      return true
    })
  }, [ecSales, fromTime, toTime])

  const kpis = useMemo(() => {
    const ecTotal = filteredEc.reduce((s, ec) => s + ecRevenue(ec), 0)
    const directRevenue = filteredSales.reduce((s, r) => s + saleIncome(r), 0)
    const sampleRevenue = filteredSales.reduce((s, r) => s + (r.sampleRevenue ?? 0), 0)
    const totalRevenue = directRevenue + ecTotal
    // EC sales are collected on the sale date.
    const collected = filteredSales
      .filter(r => r.paymentStatus === 'paid')
      .reduce((s, r) => s + saleIncome(r), 0) + ecTotal
    const outstanding = filteredSales
      .filter(r => r.status === 'confirmed' && r.paymentStatus !== 'paid')
      .reduce((s, r) => s + saleIncome(r), 0)
    const totalExpense = filteredOrders.reduce((s, o) => s + poExpense(o), 0)
    const paid = filteredOrders
      .filter(o => o.paymentStatus === 'paid')
      .reduce((s, o) => s + poExpense(o), 0)
    const unpaid = filteredOrders
      .filter(o => o.paymentStatus !== 'paid')
      .reduce((s, o) => s + poExpense(o), 0)
    // Stripe processing fees on collected card orders, and the net actually deposited.
    const stripeFees = filteredSales
      .filter(r => r.paymentStatus === 'paid')
      .reduce((s, r) => s + (r.stripeFeeJpy ?? 0), 0)
    return {
      totalRevenue,
      ecRevenue: ecTotal,
      sampleRevenue,
      collected,
      stripeFees,
      netDeposited: collected - stripeFees,
      outstanding,
      totalExpense,
      paid,
      unpaid,
      realizedNet: collected - stripeFees - paid,
      expectedNet: totalRevenue - totalExpense,
    }
  }, [filteredSales, filteredOrders, filteredEc])

  const monthly = useMemo<MonthlyRow[]>(() => {
    const map = new Map<string, MonthlyRow>()
    for (const r of filteredSales) {
      const k = monthKey(saleDate(r))
      const row = map.get(k) ?? { key: k, label: k, revenue: 0, collected: 0, expense: 0, paid: 0, net: 0 }
      row.revenue += saleIncome(r)
      if (r.paymentStatus === 'paid') row.collected += saleIncome(r)
      map.set(k, row)
    }
    for (const ec of filteredEc) {
      const k = monthKey(new Date(ec.soldOn))
      const row = map.get(k) ?? { key: k, label: k, revenue: 0, collected: 0, expense: 0, paid: 0, net: 0 }
      const amt = ecRevenue(ec)
      row.revenue += amt
      row.collected += amt
      map.set(k, row)
    }
    for (const o of filteredOrders) {
      const d = o.orderDate ? new Date(o.orderDate) : null
      if (!d) continue
      const k = monthKey(d)
      const row = map.get(k) ?? { key: k, label: k, revenue: 0, collected: 0, expense: 0, paid: 0, net: 0 }
      row.expense += poExpense(o)
      if (o.paymentStatus === 'paid') row.paid += poExpense(o)
      map.set(k, row)
    }
    return [...map.values()]
      .map(r => ({ ...r, net: r.collected - r.paid }))
      .sort((a, b) => b.key.localeCompare(a.key))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSales, filteredOrders, filteredEc, saleBasis])

  const fiscal = useMemo<MonthlyRow[]>(() => {
    const map = new Map<string, MonthlyRow>()
    for (const r of filteredSales) {
      const fy = fiscalYearOf(saleDate(r))
      const k = String(fy)
      const row = map.get(k) ?? { key: k, label: `FY${fy} (${fy}/04 - ${fy + 1}/03)`, revenue: 0, collected: 0, expense: 0, paid: 0, net: 0 }
      row.revenue += saleIncome(r)
      if (r.paymentStatus === 'paid') row.collected += saleIncome(r)
      map.set(k, row)
    }
    for (const ec of filteredEc) {
      const fy = fiscalYearOf(new Date(ec.soldOn))
      const k = String(fy)
      const row = map.get(k) ?? { key: k, label: `FY${fy} (${fy}/04 - ${fy + 1}/03)`, revenue: 0, collected: 0, expense: 0, paid: 0, net: 0 }
      const amt = ecRevenue(ec)
      row.revenue += amt
      row.collected += amt
      map.set(k, row)
    }
    for (const o of filteredOrders) {
      const d = o.orderDate ? new Date(o.orderDate) : null
      if (!d) continue
      const fy = fiscalYearOf(d)
      const k = String(fy)
      const row = map.get(k) ?? { key: k, label: `FY${fy} (${fy}/04 - ${fy + 1}/03)`, revenue: 0, collected: 0, expense: 0, paid: 0, net: 0 }
      row.expense += poExpense(o)
      if (o.paymentStatus === 'paid') row.paid += poExpense(o)
      map.set(k, row)
    }
    return [...map.values()]
      .map(r => ({ ...r, net: r.collected - r.paid }))
      .sort((a, b) => b.key.localeCompare(a.key))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredSales, filteredOrders, filteredEc, saleBasis])

  // All-time monthly map for YoY lookups (ignores date filter).
  const monthlyAll = useMemo(() => {
    const map = new Map<string, { revenue: number; expense: number; profit: number }>()
    for (const r of sales) {
      if (r.status === 'cancelled') continue
      const k = monthKey(saleDate(r))
      const row = map.get(k) ?? { revenue: 0, expense: 0, profit: 0 }
      const inc = saleIncome(r)
      row.revenue += inc
      row.profit += r.grossProfit ?? (inc - (r.costAmount ?? 0))
      map.set(k, row)
    }
    for (const ec of ecSales) {
      if (ec.status === 'cancelled' || !ec.soldOn) continue
      const k = monthKey(new Date(ec.soldOn))
      const row = map.get(k) ?? { revenue: 0, expense: 0, profit: 0 }
      const amt = ecRevenue(ec)
      const cost = (costByProduct[ec.productId] ?? 0) * ec.quantityKg
      row.revenue += amt
      row.profit += amt - cost
      map.set(k, row)
    }
    for (const o of orders) {
      const d = o.orderDate ? new Date(o.orderDate) : null
      if (!d) continue
      const k = monthKey(d)
      const row = map.get(k) ?? { revenue: 0, expense: 0, profit: 0 }
      row.expense += poExpense(o)
      map.set(k, row)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, orders, ecSales, costByProduct, saleBasis])

  const productRanking = useMemo<ProductRow[]>(() => {
    const map = new Map<string, ProductRow>()
    for (const r of filteredSales) {
      for (const item of r.items ?? []) {
        if (item.isSample) continue // sample sales are tallied separately, not per product
        const key = item.productId || item.productName
        const row = map.get(key) ?? {
          productId: item.productId,
          name: item.productName || '(未設定)',
          sku: item.productSku || '',
          revenue: 0, quantity: 0, profit: 0, count: 0,
        }
        row.revenue += item.revenue || 0
        row.quantity += item.quantityKg || 0
        row.profit += (item.revenue || 0) - (item.costAmount || 0)
        row.count += 1
        map.set(key, row)
      }
    }
    for (const ec of filteredEc) {
      const key = ec.productId || ec.productName
      const row = map.get(key) ?? {
        productId: ec.productId,
        name: ec.productName || '(未設定)',
        sku: ec.productSku || '',
        revenue: 0, quantity: 0, profit: 0, count: 0,
      }
      const amt = ecRevenue(ec)
      const cost = (costByProduct[ec.productId] ?? 0) * ec.quantityKg
      row.revenue += amt
      row.quantity += ec.quantityKg || 0
      row.profit += amt - cost
      row.count += 1
      map.set(key, row)
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue)
  }, [filteredSales, filteredEc, costByProduct])

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
      const amt = poExpense(o)
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

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Calculator size={20} className="text-matchaDeep" />
              <h1 className="text-2xl font-bold text-ink">収支管理</h1>
            </div>
            <p className="mt-1 text-sm text-mist">売上の入金状況と仕入の支払い状況を一元管理します。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs"
              />
              <span className="text-xs text-mist">〜</span>
              <input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => applyPreset('thisMonth')} className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb]">今月</button>
              <button onClick={() => applyPreset('lastMonth')} className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb]">先月</button>
              <button onClick={() => applyPreset('thisFY')} className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb]">今年度</button>
              <button onClick={() => applyPreset('all')} className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb]">全期間</button>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-mist">集計基準</span>
              <div className="flex overflow-hidden rounded-full border border-line">
                {([['order', '発注日'], ['delivery', '納品日']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSaleBasis(key)}
                    className={`px-2.5 py-1 text-[11px] transition ${saleBasis === key ? 'bg-ink text-paper' : 'bg-white text-matchaDeep hover:bg-[#eef3eb]'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KPICard title="売上計" value={formatCurrency(kpis.totalRevenue)} color="default" icon={<TrendingUp size={16} />} />
          <KPICard title="うち EC売上" value={formatCurrency(kpis.ecRevenue)} color="default" icon={<ShoppingBag size={16} />} />
          <KPICard title="うち サンプル売上" value={formatCurrency(kpis.sampleRevenue)} color="default" icon={<ShoppingBag size={16} />} />
          <KPICard title="入金済" value={formatCurrency(kpis.collected)} color="green" icon={<ArrowDownCircle size={16} />} />
          <KPICard title="Stripe手数料" value={formatCurrency(kpis.stripeFees)} color="amber" icon={<Wallet size={16} />} />
          <KPICard title="入金額（手数料差引後）" value={formatCurrency(kpis.netDeposited)} color="green" icon={<ArrowDownCircle size={16} />} />
          <KPICard title="未収" value={formatCurrency(kpis.outstanding)} color="amber" icon={<AlertTriangle size={16} />} />
          <KPICard title="仕入計" value={formatCurrency(kpis.totalExpense)} color="default" icon={<ArrowUpCircle size={16} />} />
          <KPICard title="支払済 PO" value={formatCurrency(kpis.paid)} color="green" icon={<Wallet size={16} />} />
          <KPICard title="未払 PO" value={formatCurrency(kpis.unpaid)} color="amber" icon={<AlertTriangle size={16} />} />
          <KPICard title="純収支（入金−支払）" value={formatCurrency(kpis.realizedNet)} color={kpis.realizedNet >= 0 ? 'green' : 'red'} />
          <KPICard title="見込み収支" value={formatCurrency(kpis.expectedNet)} color={kpis.expectedNet >= 0 ? 'green' : 'red'} />
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 border-b border-line">
          {([
            ['overview', '概要'],
            ['monthly', '月別'],
            ['fiscal', '年度別'],
            ['products', '商品別'],
            ['partner', '取引先別'],
            ['cashflow', 'キャッシュフロー'],
          ] as [TabKey, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setActiveTab(k)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                activeTab === k ? 'border-[#174c33] text-ink' : 'border-transparent text-mist hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="mb-3 flex items-center gap-2">
                <AlertTriangle size={16} className="text-alert" />
                <h2 className="text-sm font-semibold text-ink">アラート（期限超過）</h2>
              </div>
              {overdueSales.length === 0 && overdueOrders.length === 0 ? (
                <p className="text-xs text-mist">期限超過の請求・支払いはありません。</p>
              ) : (
                <div className="space-y-3">
                  {overdueSales.length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] uppercase tracking-wider text-alert">売上（未収・期限超過）</p>
                      <ul className="space-y-1 text-xs text-ink">
                        {overdueSales.map(r => (
                          <li key={r.id} className="flex items-center justify-between rounded-lg bg-bone px-2 py-1.5">
                            <span>{r.buyerName} - {r.items[0]?.productName ?? ''}</span>
                            <span className="text-alert">{formatCurrency(saleIncome(r))} / 期日 {r.dueDate}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {overdueOrders.length > 0 && (
                    <div>
                      <p className="mb-1 text-[11px] uppercase tracking-wider text-alert">仕入（未払・期限超過）</p>
                      <ul className="space-y-1 text-xs text-ink">
                        {overdueOrders.map(o => (
                          <li key={o.id} className="flex items-center justify-between rounded-lg bg-bone px-2 py-1.5">
                            <span>{o.supplierName} - {o.items[0]?.productName ?? ''}</span>
                            <span className="text-alert">{formatCurrency(poExpense(o))} / 期日 {o.paymentDueDate}</span>
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
          <div className="space-y-4">
            <MonthlyTrendChart rows={monthly} yoy={monthlyAll} />
            <PeriodTable rows={monthly} title="月別 収支" yoy={monthlyAll} />
          </div>
        )}
        {activeTab === 'fiscal' && (
          <PeriodTable rows={fiscal} title="年度別 収支" />
        )}

        {activeTab === 'products' && (
          <ProductsTab rows={productRanking} />
        )}

        {activeTab === 'partner' && (
          <div className="space-y-4">
            <PartnerTable title="販売先" rows={partnerBuyers} headers={['請求総額', '入金済', '未収']} />
            <PartnerTable title="仕入先" rows={partnerSuppliers} headers={['仕入総額', '支払済', '未払']} />
          </div>
        )}

        {activeTab === 'cashflow' && (
          <CashFlowTab sales={sales} ecSales={ecSales} purchaseOrders={orders} />
        )}

        {loading && <p className="text-xs text-mist">読み込み中…</p>}
      </div>
    </AppLayout>
  )
}

function prevYearKey(k: string): string {
  // Accepts YYYY-MM or YYYY; returns the same shape shifted back 12 months / 1 year.
  if (/^\d{4}-\d{2}$/.test(k)) {
    const [y, m] = k.split('-').map(Number)
    return `${y - 1}-${String(m).padStart(2, '0')}`
  }
  if (/^\d{4}$/.test(k)) return String(Number(k) - 1)
  return k
}

function formatPct(v: number, prev: number): string {
  if (!prev) return v > 0 ? '+∞' : '—'
  const r = ((v - prev) / Math.abs(prev)) * 100
  const sign = r >= 0 ? '+' : ''
  return `${sign}${r.toFixed(1)}%`
}

function PeriodTable({ rows, title, yoy }: {
  rows: MonthlyRow[]
  title: string
  yoy?: Map<string, { revenue: number; expense: number; profit: number }>
}) {
  return (
    <div className="rounded-2xl border border-line bg-white">
      <div className="border-b border-[#ece8db] px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-bone text-left uppercase tracking-wider text-mist">
            <tr>
              <th className="px-3 py-2 font-medium">期間</th>
              <th className="px-3 py-2 font-medium text-right">売上計</th>
              {yoy && <th className="px-3 py-2 font-medium text-right">前年同月比</th>}
              <th className="px-3 py-2 font-medium text-right">入金済</th>
              <th className="px-3 py-2 font-medium text-right">仕入計</th>
              <th className="px-3 py-2 font-medium text-right">支払済</th>
              <th className="px-3 py-2 font-medium text-right">純収支</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const prev = yoy?.get(prevYearKey(r.key))
              const yoyText = prev ? formatPct(r.revenue, prev.revenue) : '—'
              const yoyColor = !prev ? 'text-mist' : r.revenue >= prev.revenue ? 'text-matchaDeep' : 'text-alert'
              return (
                <tr key={r.key} className="border-t border-[#ece8db] text-ink">
                  <td className="px-3 py-2 font-medium">{r.label}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(r.revenue)}</td>
                  {yoy && <td className={`px-3 py-2 text-right text-[11px] ${yoyColor}`}>{yoyText}</td>}
                  <td className="px-3 py-2 text-right text-matchaDeep">{formatCurrency(r.collected)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(r.expense)}</td>
                  <td className="px-3 py-2 text-right text-alert">{formatCurrency(r.paid)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${r.net >= 0 ? 'text-matchaDeep' : 'text-alert'}`}>{formatCurrency(r.net)}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={yoy ? 7 : 6} className="px-3 py-6 text-center text-mist">データがありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MonthlyTrendChart({ rows, yoy }: {
  rows: MonthlyRow[]
  yoy: Map<string, { revenue: number; expense: number; profit: number }>
}) {
  const series = [...rows].sort((a, b) => a.key.localeCompare(b.key))
  if (series.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-white p-4 text-center text-xs text-mist">表示できる月次データがありません。</div>
    )
  }
  const W = 720, H = 220
  const PAD = { top: 12, right: 8, bottom: 22, left: 8 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const valsRev = series.map(r => r.revenue)
  const valsExp = series.map(r => r.expense)
  const valsNet = series.map(r => r.revenue - r.expense)
  const maxAbs = Math.max(1, ...valsRev, ...valsExp, ...valsNet.map(Math.abs))
  const colW = innerW / series.length
  const barW = Math.max(4, Math.min(22, colW * 0.28))
  const xCenter = (i: number) => PAD.left + colW * (i + 0.5)
  const yZero = PAD.top + innerH / 2
  const yVal = (v: number) => yZero - (v / maxAbs) * (innerH / 2 - 4)

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-mist">
        <span>月次トレンド（売上＝緑棒 / 仕入＝赤棒 / 収支ライン＝紺）</span>
        <div className="flex gap-3">
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-matcha" />売上</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-alert/50" />仕入</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-ink" />純収支</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-[#9b9382]" style={{ borderTop: '1.5px dashed #9b9382' }} />前年売上</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
          <line x1={PAD.left} y1={yZero} x2={W - PAD.right} y2={yZero} stroke="#e5e2d6" />
          {series.map((r, i) => {
            const cx = xCenter(i)
            return (
              <g key={r.key}>
                <rect x={cx - barW - 1} y={yVal(r.revenue)} width={barW} height={yZero - yVal(r.revenue)} fill="#059669" />
                <rect x={cx + 1} y={yZero} width={barW} height={yVal(-r.expense) - yZero} fill="#ef4444" />
              </g>
            )
          })}
          {series.length > 1 && (
            <polyline
              fill="none"
              stroke="#173c2a"
              strokeWidth={2}
              points={series.map((r, i) => `${xCenter(i)},${yVal(r.revenue - r.expense)}`).join(' ')}
            />
          )}
          {series.length > 1 && (
            <polyline
              fill="none"
              stroke="#9b9382"
              strokeDasharray="3 3"
              strokeWidth={1.5}
              points={series.map((r, i) => {
                const prev = yoy.get(prevYearKey(r.key))
                return prev ? `${xCenter(i)},${yVal(prev.revenue)}` : ''
              }).filter(Boolean).join(' ')}
            />
          )}
          {series.map((r, i) => (
            <text key={`lbl-${r.key}`} x={xCenter(i)} y={H - 6} fontSize={9} textAnchor="middle" fill="#68756c">{r.key.slice(2)}</text>
          ))}
        </svg>
      </div>
    </div>
  )
}

function ProductsTab({ rows }: { rows: ProductRow[] }) {
  if (rows.length === 0) {
    return <div className="rounded-2xl border border-line bg-white p-6 text-center text-sm text-mist">商品データがありません。</div>
  }
  const total = rows.reduce((s, r) => s + r.revenue, 0) || 1
  const maxRev = rows[0]?.revenue || 1
  const top = rows.slice(0, 20)
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">商品別 売上ランキング（期間内）</h2>
        <div className="space-y-1.5">
          {top.map((r, i) => {
            const sharePct = (r.revenue / total) * 100
            const width = (r.revenue / maxRev) * 100
            return (
              <div key={`${r.productId}-${i}`} className="grid grid-cols-[24px_minmax(180px,1fr)_2fr_120px_60px] items-center gap-2 text-xs">
                <span className="text-right font-mono text-mist">{i + 1}</span>
                <div className="truncate">
                  <span className="font-medium text-ink">{r.name}</span>
                  {r.sku && <span className="ml-1 text-[10px] text-mist">({r.sku})</span>}
                </div>
                <div className="relative h-4 rounded bg-bone">
                  <div className="absolute inset-y-0 left-0 rounded bg-matcha/70" style={{ width: `${width}%` }} />
                </div>
                <span className="text-right font-medium text-ink">{formatCurrency(r.revenue)}</span>
                <span className="text-right text-mist">{sharePct.toFixed(1)}%</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-bone text-left uppercase tracking-wider text-mist">
            <tr>
              <th className="px-3 py-2 font-medium">商品</th>
              <th className="px-3 py-2 font-medium text-right">数量(kg)</th>
              <th className="px-3 py-2 font-medium text-right">売上</th>
              <th className="px-3 py-2 font-medium text-right">粗利</th>
              <th className="px-3 py-2 font-medium text-right">粗利率</th>
              <th className="px-3 py-2 font-medium text-right">案件</th>
              <th className="px-3 py-2 font-medium text-right">構成比</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const margin = r.revenue ? (r.profit / r.revenue) * 100 : 0
              const share = (r.revenue / total) * 100
              return (
                <tr key={r.productId || r.name} className="border-t border-[#ece8db] text-ink">
                  <td className="px-3 py-2">
                    <span className="font-medium">{r.name}</span>
                    {r.sku && <span className="ml-1 text-[10px] text-mist">({r.sku})</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{r.quantity.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(r.revenue)}</td>
                  <td className={`px-3 py-2 text-right ${r.profit >= 0 ? 'text-matchaDeep' : 'text-alert'}`}>{formatCurrency(r.profit)}</td>
                  <td className="px-3 py-2 text-right">{margin.toFixed(1)}%</td>
                  <td className="px-3 py-2 text-right">{r.count}</td>
                  <td className="px-3 py-2 text-right">{share.toFixed(1)}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PartnerTable({ title, rows, headers }: { title: string; rows: PartnerRow[]; headers: [string, string, string] }) {
  const total = rows.reduce((s, r) => s + r.total, 0) || 1
  const maxTotal = rows[0]?.total || 1
  return (
    <div className="rounded-2xl border border-line bg-white">
      <div className="border-b border-[#ece8db] px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-bone text-left uppercase tracking-wider text-mist">
            <tr>
              <th className="px-3 py-2 font-medium">取引先</th>
              <th className="px-3 py-2 font-medium text-right">{headers[0]}</th>
              <th className="px-3 py-2 font-medium" style={{ width: 140 }}>シェア</th>
              <th className="px-3 py-2 font-medium text-right">{headers[1]}</th>
              <th className="px-3 py-2 font-medium text-right">{headers[2]}</th>
              <th className="px-3 py-2 font-medium text-right">件数</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const share = (r.total / total) * 100
              const width = (r.total / maxTotal) * 100
              return (
                <tr key={r.name} className="border-t border-[#ece8db] text-ink">
                  <td className="px-3 py-2 font-medium">{r.name}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(r.total)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="relative h-3 flex-1 rounded bg-bone">
                        <div className="absolute inset-y-0 left-0 rounded bg-matcha/70" style={{ width: `${width}%` }} />
                      </div>
                      <span className="w-10 text-right text-[10px] text-mist">{share.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right text-matchaDeep">{formatCurrency(r.settled)}</td>
                  <td className="px-3 py-2 text-right text-alert">{formatCurrency(r.outstanding)}</td>
                  <td className="px-3 py-2 text-right">{r.count}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-mist">データがありません。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function CashFlowTab({
  sales,
  ecSales,
  purchaseOrders,
}: {
  sales: SaleRecord[]
  ecSales: EcSaleRecord[]
  purchaseOrders: PurchaseOrder[]
}) {
  const todayKey = todayMonthKey()
  const [openingBalance, setOpeningBalance] = useState<number>(0)
  const [startMonth, setStartMonth] = useState<string>(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 5)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [endMonth, setEndMonth] = useState<string>(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 6)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [mode, setMode] = useState<CashFlowMode>('plan')

  useEffect(() => {
    try {
      const stored = localStorage.getItem('cashflow.opening')
      if (stored != null) setOpeningBalance(Number(stored) || 0)
    } catch {}
  }, [])

  const handleOpeningChange = (v: number) => {
    setOpeningBalance(v)
    try { localStorage.setItem('cashflow.opening', String(v)) } catch {}
  }

  const applyPreset = (preset: 'last12' | 'thisFY' | 'next12') => {
    const now = new Date()
    if (preset === 'last12') {
      const s = new Date(now); s.setMonth(s.getMonth() - 11)
      setStartMonth(`${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}`)
      setEndMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
    } else if (preset === 'thisFY') {
      const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
      setStartMonth(`${fy}-04`)
      setEndMonth(`${fy + 1}-03`)
    } else {
      const s = new Date(now); s.setMonth(s.getMonth() - 2)
      const e = new Date(now); e.setMonth(e.getMonth() + 11)
      setStartMonth(`${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}`)
      setEndMonth(`${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}`)
    }
  }

  const series = useMemo<MonthlyCashFlow[]>(() => buildCashFlowSeries({
    sales,
    ecSales,
    purchaseOrders,
    startMonth,
    endMonth,
    openingBalance,
    mode,
  }), [sales, ecSales, purchaseOrders, startMonth, endMonth, openingBalance, mode])

  const currentRow = series.find(r => r.key === todayKey)
  const currentBalance = currentRow?.endBalance ?? (series[0]?.endBalance ?? openingBalance)
  const nextRow = series[series.findIndex(r => r.key === todayKey) + 1]
  const nextBalance = nextRow?.endBalance ?? null
  const shortMonths = series.filter(r => r.endBalance < 0).length

  const W = 720
  const H = 200
  const PAD = { top: 12, right: 8, bottom: 22, left: 8 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const maxBar = Math.max(1, ...series.map(r => Math.max(r.inActual + r.inExpected, r.outActual + r.outExpected)))
  const balances = series.map(r => r.endBalance)
  const minBal = Math.min(0, ...balances)
  const maxBal = Math.max(0, ...balances)
  const balRange = maxBal - minBal || 1
  const colW = series.length > 0 ? innerW / series.length : 0
  const barW = Math.max(4, Math.min(28, colW * 0.32))
  const xCenter = (i: number) => PAD.left + colW * (i + 0.5)
  const yBar = (v: number) => PAD.top + innerH / 2 - (v / maxBar) * (innerH / 2 - 4)
  const yBal = (v: number) => PAD.top + innerH - ((v - minBal) / balRange) * innerH
  const yZero = PAD.top + innerH / 2

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-mist">
            <span className="mb-1 block">期首残高 (¥)</span>
            <input
              type="number"
              value={openingBalance}
              onChange={e => handleOpeningChange(Number(e.target.value) || 0)}
              className="w-36 rounded-lg border border-line bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
            />
          </label>
          <label className="text-xs text-mist">
            <span className="mb-1 block">開始月</span>
            <input
              type="month"
              value={startMonth}
              onChange={e => setStartMonth(e.target.value)}
              className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
            />
          </label>
          <label className="text-xs text-mist">
            <span className="mb-1 block">終了月</span>
            <input
              type="month"
              value={endMonth}
              onChange={e => setEndMonth(e.target.value)}
              className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
            />
          </label>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => applyPreset('last12')} className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb]">過去12ヶ月</button>
            <button onClick={() => applyPreset('thisFY')} className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb]">今年度</button>
            <button onClick={() => applyPreset('next12')} className="rounded-full border border-line bg-white px-2.5 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb]">前後12ヶ月</button>
          </div>
          <div className="ml-auto flex gap-1">
            <button
              onClick={() => setMode('actual')}
              className={`rounded-full border px-3 py-1 text-[11px] ${mode === 'actual' ? 'border-[#174c33] bg-ink text-paper' : 'border-line bg-white text-matchaDeep hover:bg-[#eef3eb]'}`}
            >実績のみ</button>
            <button
              onClick={() => setMode('plan')}
              className={`rounded-full border px-3 py-1 text-[11px] ${mode === 'plan' ? 'border-[#174c33] bg-ink text-paper' : 'border-line bg-white text-matchaDeep hover:bg-[#eef3eb]'}`}
            >実績＋予定</button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <KPICard title="現在の残高（今月末）" value={formatCurrency(currentBalance)} color={currentBalance < 0 ? 'red' : 'default'} icon={<Wallet size={18} />} />
        <KPICard title="翌月末の予測残高" value={nextBalance != null ? formatCurrency(nextBalance) : '-'} color={nextBalance != null && nextBalance < 0 ? 'red' : 'default'} icon={<TrendingUp size={18} />} />
        <KPICard title="期間内のショート月数" value={`${shortMonths} ヶ月`} color={shortMonths > 0 ? 'red' : 'default'} icon={<AlertTriangle size={18} />} />
      </div>

      <div className="rounded-2xl border border-line bg-white p-4">
        <div className="mb-2 flex items-center justify-between text-xs text-mist">
          <span>月別 入金/支払（縦棒）と現金残高（ライン）</span>
          <div className="flex gap-3">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-matcha" />入金</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-alert/50" />支払</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-3 bg-ink" />残高</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
            <line x1={PAD.left} y1={yZero} x2={W - PAD.right} y2={yZero} stroke="#e5e2d6" strokeWidth={1} />
            {series.map((r, i) => {
              const cx = xCenter(i)
              const inflow = r.inActual + (mode === 'plan' ? r.inExpected : 0)
              const outflow = r.outActual + (mode === 'plan' ? r.outExpected : 0)
              const inTop = yBar(inflow)
              const outBottom = yBar(-outflow)
              return (
                <g key={r.key}>
                  {inflow > 0 && (
                    <rect x={cx - barW / 2} y={inTop} width={barW} height={yZero - inTop} fill="#059669" opacity={r.inExpected > 0 && mode === 'plan' ? 0.7 : 1} />
                  )}
                  {outflow > 0 && (
                    <rect x={cx - barW / 2} y={yZero} width={barW} height={outBottom - yZero} fill="#ef4444" opacity={r.outExpected > 0 && mode === 'plan' ? 0.7 : 1} />
                  )}
                </g>
              )
            })}
            {series.length > 1 && (
              <polyline
                fill="none"
                stroke="#173c2a"
                strokeWidth={2}
                points={series.map((r, i) => `${xCenter(i)},${yBal(r.endBalance)}`).join(' ')}
              />
            )}
            {series.map((r, i) => (
              <circle key={`pt-${r.key}`} cx={xCenter(i)} cy={yBal(r.endBalance)} r={2.5} fill={r.endBalance < 0 ? '#dc2626' : '#173c2a'} />
            ))}
            {series.map((r, i) => (
              <text key={`lbl-${r.key}`} x={xCenter(i)} y={H - 6} fontSize={9} textAnchor="middle" fill="#68756c">{r.key.slice(2)}</text>
            ))}
          </svg>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-bone text-ink">
            <tr>
              <th className="px-3 py-2 text-left font-medium">月</th>
              <th className="px-3 py-2 text-right font-medium">入金 (実績)</th>
              <th className="px-3 py-2 text-right font-medium">入金 (予定)</th>
              <th className="px-3 py-2 text-right font-medium">支払 (実績)</th>
              <th className="px-3 py-2 text-right font-medium">支払 (予定)</th>
              <th className="px-3 py-2 text-right font-medium">月間ネット</th>
              <th className="px-3 py-2 text-right font-medium">月末残高</th>
            </tr>
          </thead>
          <tbody>
            {series.map(r => {
              const isCurrent = r.key === todayKey
              const negative = r.endBalance < 0
              return (
                <tr key={r.key} className={`${negative ? 'bg-alert/5' : ''} ${isCurrent ? 'border-l-4 border-[#174c33]' : ''}`}>
                  <td className="border-b border-gray-100 px-3 py-2 font-medium text-ink">{r.key}</td>
                  <td className="border-b border-gray-100 px-3 py-2 text-right text-matcha">{r.inActual > 0 ? formatCurrency(r.inActual) : '-'}</td>
                  <td className="border-b border-gray-100 px-3 py-2 text-right text-mist">{r.inExpected > 0 ? formatCurrency(r.inExpected) : '-'}</td>
                  <td className="border-b border-gray-100 px-3 py-2 text-right text-alert">{r.outActual > 0 ? formatCurrency(r.outActual) : '-'}</td>
                  <td className="border-b border-gray-100 px-3 py-2 text-right text-mist">{r.outExpected > 0 ? formatCurrency(r.outExpected) : '-'}</td>
                  <td className={`border-b border-gray-100 px-3 py-2 text-right font-medium ${r.net >= 0 ? 'text-ink' : 'text-alert'}`}>{formatCurrency(r.net)}</td>
                  <td className={`border-b border-gray-100 px-3 py-2 text-right font-semibold ${negative ? 'text-alert' : 'text-ink'}`}>{formatCurrency(r.endBalance)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-mist">
        ※ 金額は税込換算（海外向け販売は税抜のまま）。EC 販売は売上日に入金とみなしています。期首残高はブラウザに保存されます。
      </p>
    </div>
  )
}
