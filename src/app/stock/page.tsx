'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { EmptyTableRow } from '@/components/ui/EmptyState'
import { getServices } from '@/lib/services'
import { fetchWholesaleOrders, type WholesaleOrderRow } from '@/lib/wholesaleAdapter'
import type { ProductWithInventory } from '@/types'
import { Package, Search, Boxes, ClipboardList } from 'lucide-react'

// 受注生産として受注中 = 未出荷の確定系ステータス（承認待ち→入金待ち→支払済）。
const MTO_STATUSES = new Set(['pending_approval', 'pending_payment', 'paid'])

/** Color-code a stock quantity by tier: マイナス / 0 / 10kg未満 / 10kg以上. */
function stockColorClass(kg: number): string {
  if (kg < 0) return 'text-alert font-bold'
  if (kg === 0) return 'text-[#c2410c]'
  if (kg < 10) return 'text-[#a87b1e]'
  return 'text-matchaDeep'
}

type SortKey = 'stock' | 'name'

export default function StockPage() {
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [orders, setOrders] = useState<WholesaleOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [lowOnly, setLowOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('stock')

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    // 受注生産・見積待ちは ec_sales 台帳に載らないため、注文からも集計する。
    const [list, ords] = await Promise.all([
      services.inventory.getProductsWithInventory(),
      fetchWholesaleOrders().catch(() => [] as WholesaleOrderRow[]),
    ])
    setProducts(list.filter(p => p.isActive !== false && !p.archived))
    setOrders(ords)
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  // Refresh when returning to the tab (arrivals/orders may have changed stock).
  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', handler)
    window.addEventListener('focus', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
  }, [])

  /**
   * 注文から2つの数量を商品ごとに集計する（どちらも ec_sales 台帳に出ないぶん）。
   *  - madeToOrder: 受注生産として受注中（在庫を引き当てていない明細）。未出荷のみ。
   *  - extraNegotiating: 商談中に加える「海外の見積待ち」「銀行振込の入金待ち」。
   *    見積提示済・承諾待ち・カード入金待ちは reserved 台帳として既に商談中に入るため対象外。
   * 受注生産の明細は受注生産列に出すので、商談中には二重計上しない。
   */
  const { madeToOrderByProduct, extraNegotiatingByProduct } = useMemo(() => {
    const mto: Record<string, number> = {}
    const neg: Record<string, number> = {}
    for (const o of orders) {
      if (o.status === 'cancelled' || o.status === 'shipped') continue
      const countsAsMto = MTO_STATUSES.has(o.status ?? '')
      const isQuoteWaiting = o.status === 'pending_quote'
      const isBankAwaiting = o.status === 'pending_payment' && o.paymentMethod === 'bank_transfer'
      for (const it of o.items ?? []) {
        if (!it.productId || it.kind === 'sample') continue
        const kg = Number(it.quantityKg) || 0
        if (kg <= 0) continue
        if (it.madeToOrder) {
          if (countsAsMto) mto[it.productId] = (mto[it.productId] ?? 0) + kg
          continue
        }
        if (isQuoteWaiting || isBankAwaiting) neg[it.productId] = (neg[it.productId] ?? 0) + kg
      }
    }
    return { madeToOrderByProduct: mto, extraNegotiatingByProduct: neg }
  }, [orders])

  const negotiatingOf = (p: ProductWithInventory) => p.negotiatingKg + (extraNegotiatingByProduct[p.id] ?? 0)

  const kpis = useMemo(() => {
    const negative = products.filter(p => p.currentStockKg < 0).length
    const out = products.filter(p => p.currentStockKg === 0).length
    const low = products.filter(p => p.currentStockKg > 0 && p.currentStockKg < 10).length
    const totalKg = products.reduce((s, p) => s + p.currentStockKg, 0)
    return { negative, out, low, totalKg }
  }, [products])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = products
    if (lowOnly) list = list.filter(p => p.currentStockKg < 10)
    if (q) {
      list = list.filter(p =>
        [p.name, p.sku, p.purchaseProductName, p.supplier].filter(Boolean).join(' ').toLowerCase().includes(q),
      )
    }
    return [...list].sort((a, b) =>
      sortKey === 'stock' ? a.currentStockKg - b.currentStockKg : a.name.localeCompare(b.name, 'ja'),
    )
  }, [products, search, lowOnly, sortKey])

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#e6f0e8] px-3 py-1 text-sm font-medium text-matchaDeep">
              <Package size={15} /> 倉庫
            </div>
            <h1 className="mt-3 text-3xl font-bold text-ink">在庫管理</h1>
            <p className="mt-2 text-sm text-mist">
              商品ごとの在庫数量・入荷元の商品名・仕入先を確認できます。商品名をクリックすると商品詳細を開きます。
            </p>
          </div>
          <Link
            href="/inventory/stocktake"
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-graphite transition-colors hover:bg-bone"
          >
            <ClipboardList size={16} />
            在庫管理表（PDF）
          </Link>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <KPICard title="在庫割れ（マイナス）" value={`${kpis.negative} 件`} color={kpis.negative > 0 ? 'red' : 'default'} />
          <KPICard title="在庫切れ（0）" value={`${kpis.out} 件`} color={kpis.out > 0 ? 'amber' : 'default'} />
          <KPICard title="残少（10kg未満）" value={`${kpis.low} 件`} icon={<Boxes size={16} />} color={kpis.low > 0 ? 'amber' : 'default'} />
          <KPICard title="総在庫量" value={`${kpis.totalKg.toFixed(1)} kg`} icon={<Package size={16} />} color="green" />
        </div>

        <div className="rounded-3xl border border-line bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-ink">
              <input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} className="h-4 w-4 accent-[#174c33]" />
              残少のみ（10kg未満）
            </label>
            <div className="flex gap-1.5 text-xs">
              {([['stock', '在庫が少ない順'], ['name', '商品名順']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSortKey(key)}
                  className={`rounded-full border px-2.5 py-1 transition ${sortKey === key ? 'border-[#174c33] bg-ink text-paper' : 'border-line bg-white text-ink hover:bg-bone'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative ml-auto w-full sm:w-72">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="商品名・SKU・入荷元・仕入先"
                className="w-full rounded-xl border border-line py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              />
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[#e6dfcf] text-left text-mist">
                  <th className="px-3 py-3 font-medium">商品名</th>
                  <th className="px-3 py-3 font-medium">SKU</th>
                  <th className="px-3 py-3 text-right font-medium">在庫数量</th>
                  <th className="px-3 py-3 text-right font-medium">商談中</th>
                  <th className="px-3 py-3 text-right font-medium">受注生産</th>
                  <th className="px-3 py-3 font-medium">入荷元の商品名</th>
                  <th className="px-3 py-3 font-medium">仕入先</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filtered.length === 0 && (
                  <EmptyTableRow colSpan={7} message="該当する商品がありません。" />
                )}
                {filtered.map(p => (
                  <tr key={p.id} className="border-b border-[#f0ebdf] hover:bg-bone">
                    <td className="px-3 py-3">
                      <Link href={`/inventory/${p.id}`} className="font-medium text-ink hover:text-matchaDeep hover:underline">{p.name}</Link>
                    </td>
                    <td className="px-3 py-3 font-mono text-graphite">{p.sku || '—'}</td>
                    <td className={`px-3 py-3 text-right text-base font-semibold ${stockColorClass(p.currentStockKg)}`}>{p.currentStockKg.toFixed(1)} kg</td>
                    <td className="px-3 py-3 text-right text-graphite">{negotiatingOf(p) > 0 ? `${negotiatingOf(p).toFixed(1)} kg` : '—'}</td>
                    <td className="px-3 py-3 text-right text-graphite">
                      {(madeToOrderByProduct[p.id] ?? 0) > 0
                        ? <span className="font-medium text-[#6d5bd0]">{(madeToOrderByProduct[p.id] ?? 0).toFixed(1)} kg</span>
                        : '—'}
                    </td>
                    <td className="px-3 py-3 text-graphite">{p.purchaseProductName || '—'}</td>
                    <td className="px-3 py-3 text-graphite">{p.supplier || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-mist">
            在庫数量の色: <span className="text-alert font-bold">マイナス</span> ／ <span className="text-[#c2410c]">0（切れ）</span> ／ <span className="text-[#a87b1e]">10kg未満</span> ／ <span className="text-matchaDeep">10kg以上</span>
          </p>
          <p className="mt-1 text-[11px] text-mist">
            <span className="font-medium">商談中</span>: 見積提示中・承諾待ち・支払い待ち（カード／銀行振込）・海外の見積待ちの受注量。
            <span className="ml-2 font-medium text-[#6d5bd0]">受注生産</span>: 在庫を引き当てずに受注している未出荷の数量（在庫数量には含まれません）。
          </p>
        </div>
      </div>
    </AppLayout>
  )
}
