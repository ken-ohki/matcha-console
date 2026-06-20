'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { StockStatusBadge } from '@/components/ui/StatusBadge'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import { fetchWholesaleOrders, orderToSale } from '@/lib/wholesaleAdapter'
import type {
  EcSaleRecord,
  InventoryGroup,
  MasterEntry,
  ProductInput,
  ProductWithInventory,
  PurchaseOrder,
  SaleRecord,
  SelfConsumptionRecord,
} from '@/types'
import { ArrowLeft, ChevronRight, Trash2 } from 'lucide-react'
import {
  buildProductForm,
  finalizeProductInput,
  formatKg,
  EMPTY_PENDING_CHECK,
  ProductStockSection,
  ProductMasterSection,
  ProductPricingSection,
  type PendingInventoryCheck,
} from '@/components/inventory/ProductFormSections'
import { STATUS_LABELS } from '@/components/purchase-orders/PoFormSections'
import { formatCurrency, formatDate } from '@/lib/format'

type Tab = 'overview' | 'master' | 'stock' | 'pricing' | 'transactions'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '概要' },
  { key: 'master', label: '商品マスター' },
  { key: 'stock', label: '在庫・棚卸' },
  { key: 'pricing', label: '価格・販売設定' },
  { key: 'transactions', label: '取引履歴' },
]

type TxKind = 'purchase' | 'sale' | 'ec' | 'self'

type TxRow = {
  key: string
  date: string
  kind: TxKind
  counterparty: string
  quantityKg: number   // signed: + incoming, - outgoing
  unitPrice?: number
  amount?: number
  status?: string
  href?: string
}

const TX_META: Record<TxKind, { label: string; cls: string }> = {
  purchase: { label: '仕入', cls: 'bg-bone text-graphite' },
  sale: { label: '販売', cls: 'bg-bone text-matcha' },
  ec: { label: 'EC', cls: 'bg-bone text-graphite' },
  self: { label: '自社消費', cls: 'bg-bone text-graphite' },
}

const SALE_STATUS_LABELS: Record<string, string> = {
  negotiating: '商談中',
  confirmed: '確定',
  cancelled: '取消',
}

const SELF_USAGE_LABELS: Record<string, string> = {
  ingredient: '原料利用',
  retail: '店頭販売',
  sample: 'サンプル',
}

function yen(value?: number): string {
  if (value == null) return '-'
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(value)
}

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const canEdit = user?.role === 'admin'

  const [product, setProduct] = useState<ProductWithInventory | null>(null)
  const [groups, setGroups] = useState<InventoryGroup[]>([])
  const [masters, setMasters] = useState<MasterEntry[]>([])
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([])
  const [ecSales, setEcSales] = useState<EcSaleRecord[]>([])
  const [selfRecords, setSelfRecords] = useState<SelfConsumptionRecord[]>([])
  const [form, setForm] = useState<ProductInput | null>(null)
  const [pending, setPending] = useState<PendingInventoryCheck>(EMPTY_PENDING_CHECK)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      const services = await getServices()
      const [products, nextGroups, nextMasters, nextOrders, nextPos, nextEc, nextSelf] = await Promise.all([
        services.inventory.getProductsWithInventory(),
        services.inventory.getInventoryGroups(),
        services.masters.listMasters(),
        fetchWholesaleOrders(),
        services.purchaseOrders.getPurchaseOrders(),
        services.ecSales.getEcSaleRecords(),
        services.selfConsumption.getSelfConsumptionRecords(),
      ])
      if (!active) return
      const found = products.find(p => p.id === params.id) ?? null
      setProduct(found)
      setGroups(nextGroups)
      setMasters(nextMasters)
      // Direct sales are now wholesale_orders; cost not needed for the tx history.
      setSales(nextOrders.map(o => orderToSale(o, {})))
      setPurchaseOrders(nextPos)
      setEcSales(nextEc)
      setSelfRecords(nextSelf)
      if (found) {
        setForm(buildProductForm(found, found.inventoryGroupId))
        setPending(EMPTY_PENDING_CHECK)
      }
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [params.id])

  const stock = product
    ? { currentStockKg: product.currentStockKg, salesAllocatedKg: product.salesAllocatedKg, selfConsumedKg: product.selfConsumedKg }
    : { currentStockKg: 0, salesAllocatedKg: 0, selfConsumedKg: 0 }

  const transactions = useMemo<TxRow[]>(() => {
    const pid = params.id
    const rows: TxRow[] = []

    for (const po of purchaseOrders) {
      po.items.forEach((item, i) => {
        if (item.productId !== pid) return
        rows.push({
          key: `po-${po.id}-${i}`,
          date: po.actualDeliveryDate || po.orderDate,
          kind: 'purchase',
          counterparty: po.supplierName,
          quantityKg: item.quantityKg,
          unitPrice: item.unitPrice,
          amount: item.lineTotal,
          status: STATUS_LABELS[po.status],
          href: `/purchase-orders/${po.id}`,
        })
      })
    }

    for (const sale of sales) {
      sale.items.forEach((item, i) => {
        if (item.productId !== pid) return
        rows.push({
          key: `sale-${sale.id}-${i}`,
          date: sale.dueDate || sale.createdAt.toISOString().slice(0, 10),
          kind: 'sale',
          counterparty: sale.buyerName,
          quantityKg: -item.quantityKg,
          unitPrice: item.unitPrice,
          amount: item.revenue,
          status: SALE_STATUS_LABELS[sale.status] ?? sale.status,
          href: `/wholesale/orders/${sale.id}`,
        })
      })
    }

    for (const ec of ecSales) {
      if (ec.productId !== pid) continue
      // Wholesale-channel ec_sales are the stock ledger for wholesale orders, which
      // are already shown as 'sale' rows above — skip to avoid duplicate rows.
      if (ec.channel === 'Wholesale' || ec.channel === 'WholesaleSample') continue
      rows.push({
        key: `ec-${ec.id}`,
        date: ec.soldOn,
        kind: 'ec',
        counterparty: ec.channel || ec.orderNumber || 'EC',
        quantityKg: -ec.quantityKg,
        unitPrice: ec.unitPrice,
        amount: ec.revenue ?? (ec.unitPrice != null ? ec.unitPrice * ec.quantityKg : undefined),
        status: ec.status === 'cancelled' ? '取消' : undefined,
      })
    }

    for (const sc of selfRecords) {
      if (sc.productId !== pid) continue
      rows.push({
        key: `self-${sc.id}`,
        date: sc.usedOn,
        kind: 'self',
        counterparty: SELF_USAGE_LABELS[sc.usageType] ?? sc.usageType,
        quantityKg: -sc.quantityKg,
      })
    }

    return rows.sort((a, b) => b.date.localeCompare(a.date))
  }, [params.id, purchaseOrders, sales, ecSales, selfRecords])

  const txTotals = useMemo(() => {
    let purchased = 0, sold = 0, ec = 0, self = 0
    for (const t of transactions) {
      if (t.kind === 'purchase') purchased += t.quantityKg
      else if (t.kind === 'sale') sold += -t.quantityKg
      else if (t.kind === 'ec') ec += -t.quantityKg
      else self += -t.quantityKg
    }
    return { purchased, sold, ec, self }
  }, [transactions])

  const reload = async () => {
    const services = await getServices()
    const products = await services.inventory.getProductsWithInventory()
    const found = products.find(p => p.id === params.id) ?? null
    setProduct(found)
    if (found) {
      setForm(buildProductForm(found, found.inventoryGroupId))
      setPending(EMPTY_PENDING_CHECK)
    }
  }

  const handleSave = async () => {
    if (!form || !product) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const input = finalizeProductInput(form, pending, stock)
      const services = await getServices()
      await services.inventory.updateProduct(product.id, input)
      await reload()
      setMessage('保存しました')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!product) return
    if (!confirm(`${product.name} を削除しますか？`)) return
    const services = await getServices()
    await services.inventory.deleteProduct(product.id)
    router.push('/inventory')
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="py-20 text-center text-sm text-mist">読み込み中…</div>
      </AppLayout>
    )
  }

  if (!product || !form) {
    return (
      <AppLayout>
        <div className="space-y-4 py-20 text-center">
          <p className="text-sm text-mist">商品が見つかりませんでした。</p>
          <Link href="/inventory" className="inline-flex items-center gap-2 text-sm font-medium text-matchaDeep hover:underline">
            <ArrowLeft size={14} /> 在庫管理へ戻る
          </Link>
        </div>
      </AppLayout>
    )
  }

  const groupName = groups.find(g => g.id === product.inventoryGroupId)?.name ?? '-'
  const wholesale = product.standardWholesalePrice
  const cost = product.purchaseUnitPrice
  const margin = wholesale != null && cost != null ? wholesale - cost : undefined
  const marginRate = wholesale != null && cost != null && wholesale > 0 ? ((wholesale - cost) / wholesale) * 100 : undefined

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <Link href="/inventory" className="inline-flex w-fit items-center gap-1.5 text-sm text-mist hover:text-ink">
            <ArrowLeft size={14} /> 在庫管理
          </Link>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <StockStatusBadge status={product.stockStatus} />
              <h1 className="text-2xl font-bold text-ink">{product.name}</h1>
              <span className="font-mono text-sm text-mist">{product.sku}</span>
              {product.inquireToOrder && (
                <span className="rounded-full bg-bone px-2 py-0.5 text-[10px] font-medium text-[#a87b1e]">ASK</span>
              )}
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-alert/40 bg-white px-3 py-2 text-sm font-medium text-alert transition hover:bg-alert/5"
                >
                  <Trash2 size={14} /> 削除
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-matchaDeep disabled:bg-[#4f7c65]"
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            )}
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-matcha/40 bg-bone px-4 py-3 text-sm text-matcha">{message}</div>
        )}
        {error && (
          <div className="rounded-xl border border-alert/40 bg-alert/5 px-4 py-3 text-sm text-alert">{error}</div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-[#e6dfcf]">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                tab === t.key
                  ? 'border-[#174c33] text-matchaDeep'
                  : 'border-transparent text-mist hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4 lg:col-span-1">
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.imageUrl} alt={product.name} className="aspect-square w-full rounded-xl object-cover" />
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-bone text-sm text-[#9aa39a]">画像なし</div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
              <OverviewCard label="残在庫" value={<span className={product.currentStockKg < 0 ? 'text-alert' : ''}>{formatKg(product.currentStockKg)}</span>} strong />
              <OverviewCard label="在庫グループ" value={groupName} />
              <OverviewCard label="入荷累計" value={formatKg(product.initialStockKg)} />
              <OverviewCard label="販売引当" value={formatKg(product.salesAllocatedKg)} />
              <OverviewCard label="自社消費" value={formatKg(product.selfConsumedKg)} />
              <OverviewCard label="Shopify販売" value={formatKg(product.ecSoldKg)} />
              <OverviewCard label="標準卸売単価" value={yen(wholesale)} />
              <OverviewCard label="仕入単価" value={yen(cost)} />
              <OverviewCard
                label="粗利 (kg)"
                value={
                  <span className={margin == null ? '' : margin < 0 ? 'text-alert' : 'text-matcha'}>
                    {margin == null ? '-' : yen(margin)}{marginRate != null && <span className="ml-1 text-xs">({marginRate.toFixed(1)}%)</span>}
                  </span>
                }
              />
            </div>
            {(product.salesNote || product.adminNote || product.flavorNotes) && (
              <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4 lg:col-span-3">
                {product.flavorNotes && <p className="text-sm text-ink"><span className="text-mist">フレーバー：</span>{product.flavorNotes}</p>}
                {product.salesNote && <p className="mt-2 whitespace-pre-wrap text-sm text-ink"><span className="text-mist">販売メモ：</span>{product.salesNote}</p>}
                {product.adminNote && <p className="mt-2 whitespace-pre-wrap text-sm text-ink"><span className="text-mist">管理メモ：</span>{product.adminNote}</p>}
              </div>
            )}
          </div>
        )}

        {tab === 'master' && (
          <fieldset disabled={!canEdit} className="space-y-5">
            <ProductMasterSection
              form={form}
              setForm={setForm as React.Dispatch<React.SetStateAction<ProductInput>>}
              masters={masters}
              productKey={product.id}
            />
          </fieldset>
        )}

        {tab === 'stock' && (
          <fieldset disabled={!canEdit} className="space-y-5">
            <ProductStockSection
              form={form}
              setForm={setForm as React.Dispatch<React.SetStateAction<ProductInput>>}
              groups={groups}
              pending={pending}
              setPending={setPending}
              stock={stock}
            />
            <p className="text-xs text-mist">※ 棚卸や在庫グループを変更したら上部の「保存」を押してください。</p>
          </fieldset>
        )}

        {tab === 'pricing' && (
          <fieldset disabled={!canEdit} className="space-y-5">
            <ProductPricingSection form={form} setForm={setForm as React.Dispatch<React.SetStateAction<ProductInput>>} />
          </fieldset>
        )}

        {tab === 'transactions' && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <OverviewCard label="仕入（入荷）計" value={formatKg(txTotals.purchased)} />
              <OverviewCard label="販売計" value={formatKg(txTotals.sold)} />
              <OverviewCard label="Shopify販売計" value={formatKg(txTotals.ec)} />
              <OverviewCard label="自社消費計" value={formatKg(txTotals.self)} />
            </div>

            {transactions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line px-4 py-12 text-center text-sm text-mist">
                この商品の取引はまだありません。
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-[#e6dfcf] bg-white">
                <div className="overflow-x-auto">
                  <table className="min-w-[760px] w-full text-sm">
                    <thead className="bg-bone text-left text-[11px] uppercase tracking-wider text-mist">
                      <tr>
                        <th className="px-4 py-2 font-medium">日付</th>
                        <th className="px-4 py-2 font-medium">区分</th>
                        <th className="px-4 py-2 font-medium">取引先</th>
                        <th className="px-4 py-2 font-medium text-right">数量</th>
                        <th className="px-4 py-2 font-medium text-right">単価</th>
                        <th className="px-4 py-2 font-medium text-right">金額</th>
                        <th className="px-4 py-2 font-medium">状態</th>
                        <th className="px-4 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map(t => {
                        const meta = TX_META[t.kind]
                        return (
                          <tr
                            key={t.key}
                            onClick={t.href ? () => router.push(t.href!) : undefined}
                            className={`border-t border-[#f0ebdf] text-ink ${t.href ? 'cursor-pointer hover:bg-bone' : ''}`}
                          >
                            <td className="whitespace-nowrap px-4 py-2.5 text-mist">{formatDate(t.date) || t.date || '-'}</td>
                            <td className="px-4 py-2.5">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
                            </td>
                            <td className="px-4 py-2.5">{t.counterparty || '-'}</td>
                            <td className={`whitespace-nowrap px-4 py-2.5 text-right font-medium ${t.quantityKg >= 0 ? 'text-matcha' : 'text-ink'}`}>
                              {t.quantityKg >= 0 ? '+' : ''}{formatKg(t.quantityKg)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right text-mist">{t.unitPrice != null ? formatCurrency(t.unitPrice) : '-'}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-right">{t.amount != null ? formatCurrency(t.amount) : '-'}</td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-mist">{t.status ?? '-'}</td>
                            <td className="px-4 py-2.5 text-right text-gray-400">{t.href && <ChevronRight size={15} className="inline" />}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="text-xs text-mist">数量は仕入を ＋（入荷）、販売・EC・自社消費を −（出庫）で表示しています。</p>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function OverviewCard({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-mist">{label}</p>
      <div className={`mt-1.5 ${strong ? 'text-lg font-semibold text-ink' : 'text-sm text-ink'}`}>{value}</div>
    </div>
  )
}
