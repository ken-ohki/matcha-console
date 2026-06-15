'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type {
  InventoryGroup,
  ProductWithInventory,
  PurchaseOrder,
  PurchaseOrderInput,
  Supplier,
} from '@/types'
import { ArrowLeft, FileText, Trash2 } from 'lucide-react'
import { computePoTaxIncluded, poPaidTotal, poRemaining } from '@/lib/cashflow'
import { formatCurrency, formatDate, formatKg, todayIso } from '@/lib/format'
import {
  StatusBadge,
  PaymentStatusBadge,
  PoBasicSection,
  PoItemsSection,
  PoDatesSection,
  PoBillingSection,
  PoFeesSection,
  PoNotesSection,
  PoSummarySection,
  buildPoFormState,
  validatePoForm,
} from '@/components/purchase-orders/PoFormSections'

type Tab = 'overview' | 'edit' | 'payment' | 'receiving'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '概要' },
  { key: 'edit', label: '商品・金額' },
  { key: 'payment', label: '支払' },
  { key: 'receiving', label: '入荷' },
]

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const canEdit = user?.role === 'admin'

  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [inventoryGroups, setInventoryGroups] = useState<InventoryGroup[]>([])
  const [form, setForm] = useState<PurchaseOrderInput | null>(null)
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
      const [orders, nextSuppliers, nextProducts, nextGroups] = await Promise.all([
        services.purchaseOrders.getPurchaseOrders(),
        services.suppliers.getSuppliers(),
        services.inventory.getProductsWithInventory(),
        services.inventory.getInventoryGroups(),
      ])
      if (!active) return
      const found = orders.find(o => o.id === params.id) ?? null
      setOrder(found)
      setSuppliers(nextSuppliers)
      setProducts(nextProducts)
      setInventoryGroups(nextGroups)
      if (found) setForm(buildPoFormState(found, nextProducts, todayIso()))
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [params.id])

  const handleSave = async () => {
    if (!form || !order) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      validatePoForm(form)
      const services = await getServices()
      const updated = await services.purchaseOrders.updatePurchaseOrder(order.id, form)
      setOrder(updated)
      setForm(buildPoFormState(updated, products, todayIso()))
      setMessage('保存しました')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!order) return
    if (!confirm(`発注「${order.supplierName} / ${order.orderDate}」を削除しますか？\n入荷済みの場合、関連する入荷記録も削除されます。`)) return
    const services = await getServices()
    await services.purchaseOrders.deletePurchaseOrder(order.id)
    router.push('/purchase-orders')
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="py-20 text-center text-sm text-[#68756c]">読み込み中…</div>
      </AppLayout>
    )
  }

  if (!order || !form) {
    return (
      <AppLayout>
        <div className="space-y-4 py-20 text-center">
          <p className="text-sm text-[#68756c]">発注が見つかりませんでした。</p>
          <Link href="/purchase-orders" className="inline-flex items-center gap-2 text-sm font-medium text-[#174c33] hover:underline">
            <ArrowLeft size={14} /> 発注一覧へ戻る
          </Link>
        </div>
      </AppLayout>
    )
  }

  const taxIncl = computePoTaxIncluded(order)
  const paid = poPaidTotal(order)
  const remaining = poRemaining(order)

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <Link href="/purchase-orders" className="inline-flex w-fit items-center gap-1.5 text-sm text-[#68756c] hover:text-[#173c2a]">
            <ArrowLeft size={14} /> 発注一覧
          </Link>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <StatusBadge status={order.status} />
              <h1 className="text-2xl font-bold text-[#173c2a]">{order.supplierName}</h1>
              <span className="text-sm text-[#68756c]">{formatDate(order.orderDate)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/purchase-orders/${order.id}/document`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-[#d9d1be] bg-white px-3 py-2 text-sm font-medium text-[#173c2a] transition hover:bg-[#f7f5ee]"
              >
                <FileText size={14} /> 発注書
              </Link>
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                  >
                    <Trash2 size={14} /> 削除
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[#174c33] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#123723] disabled:bg-[#4f7c65]"
                  >
                    {saving ? '保存中…' : '保存'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 border-b border-[#e6dfcf]">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                tab === t.key
                  ? 'border-[#174c33] text-[#174c33]'
                  : 'border-transparent text-[#68756c] hover:text-[#173c2a]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'overview' && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <OverviewCard label="発注先" value={order.supplierName} />
            <OverviewCard label="発注日" value={formatDate(order.orderDate) || '-'} />
            <OverviewCard label="入荷予定日" value={formatDate(order.expectedDeliveryDate) || '-'} />
            <OverviewCard label="実際の入荷日" value={formatDate(order.actualDeliveryDate) || '-'} />
            <OverviewCard label="合計数量" value={formatKg(order.totalQuantityKg)} />
            <OverviewCard label="合計金額（税込）" value={formatCurrency(taxIncl)} strong />
            <OverviewCard label="支払状況" value={<PaymentStatusBadge status={order.paymentStatus} hasInvoice={!!order.invoice} />} />
            <OverviewCard label="支払済" value={formatCurrency(paid)} />
            <OverviewCard label="残額（税込）" value={formatCurrency(remaining)} strong={remaining > 0} />
            <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4 sm:col-span-2 lg:col-span-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[#68756c]">商品</p>
              <div className="space-y-1.5">
                {order.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-[#173c2a]">{item.productName}{item.productSku ? `（${item.productSku}）` : ''}</span>
                    <span className="text-[#68756c]">{formatKg(item.quantityKg)} × {formatCurrency(item.unitPrice)}</span>
                  </div>
                ))}
              </div>
              {order.notes && <p className="mt-3 whitespace-pre-wrap border-t border-[#f0ebdf] pt-3 text-sm text-[#68756c]">{order.notes}</p>}
            </div>
          </div>
        )}

        {tab === 'edit' && (
          <fieldset disabled={!canEdit} className="space-y-5">
            <PoBasicSection form={form} setForm={setForm as React.Dispatch<React.SetStateAction<PurchaseOrderInput>>} suppliers={suppliers} />
            <PoDatesSection form={form} setForm={setForm as React.Dispatch<React.SetStateAction<PurchaseOrderInput>>} />
            <PoItemsSection form={form} setForm={setForm as React.Dispatch<React.SetStateAction<PurchaseOrderInput>>} products={products} inventoryGroups={inventoryGroups} />
            <PoFeesSection form={form} setForm={setForm as React.Dispatch<React.SetStateAction<PurchaseOrderInput>>} />
            <PoNotesSection form={form} setForm={setForm as React.Dispatch<React.SetStateAction<PurchaseOrderInput>>} />
            <PoSummarySection form={form} />
          </fieldset>
        )}

        {tab === 'payment' && (
          <fieldset disabled={!canEdit} className="space-y-5">
            <PoBillingSection form={form} setForm={setForm as React.Dispatch<React.SetStateAction<PurchaseOrderInput>>} poId={order.id} />
            <div className="grid gap-3 rounded-2xl border border-[#d9d1be] bg-[#f7f5ee] p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-[#68756c]">合計（税込）</p>
                <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(taxIncl)}</p>
              </div>
              <div>
                <p className="text-xs text-[#68756c]">支払済</p>
                <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(paid)}</p>
              </div>
              <div>
                <p className="text-xs text-[#68756c]">残額</p>
                <p className={`mt-1 text-lg font-semibold ${remaining > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{formatCurrency(remaining)}</p>
              </div>
            </div>
            <p className="text-xs text-[#68756c]">※ 支払い内容を変更したら上部の「保存」を押してください。</p>
          </fieldset>
        )}

        {tab === 'receiving' && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-[#e6dfcf] bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-[#faf8f1] text-left text-[11px] uppercase tracking-wider text-[#68756c]">
                  <tr>
                    <th className="px-4 py-2 font-medium">商品</th>
                    <th className="px-4 py-2 font-medium text-right">発注数量</th>
                    <th className="px-4 py-2 font-medium text-right">入荷済</th>
                    <th className="px-4 py-2 font-medium text-right">残</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item, i) => {
                    const remainingKg = Math.max(0, item.quantityKg - (item.receivedKg ?? 0))
                    return (
                      <tr key={i} className="border-t border-[#f0ebdf] text-[#173c2a]">
                        <td className="px-4 py-2">
                          <div className="font-medium">{item.productName}</div>
                          <div className="text-[11px] text-[#68756c]">{item.productSku}</div>
                        </td>
                        <td className="px-4 py-2 text-right">{formatKg(item.quantityKg)}</td>
                        <td className="px-4 py-2 text-right">{formatKg(item.receivedKg ?? 0)}</td>
                        <td className={`px-4 py-2 text-right ${remainingKg > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{formatKg(remainingKg)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-[#68756c]">
              入荷の登録・反映は
              <Link href="/receiving" className="mx-1 font-medium text-[#174c33] hover:underline">入荷管理</Link>
              で行います。実際の入荷日は「商品・金額」タブで編集できます。
            </p>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function OverviewCard({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-[#68756c]">{label}</p>
      <div className={`mt-1.5 ${strong ? 'text-lg font-semibold text-[#173c2a]' : 'text-sm text-[#173c2a]'}`}>{value}</div>
    </div>
  )
}
