'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { getServices } from '@/lib/services'
import type {
  InventoryGroup,
  ProductWithInventory,
  PurchaseInvoice,
  PurchaseOrder,
  PurchaseOrderInput,
  Supplier,
} from '@/types'
import { ArrowLeft, FileText, Plus, Trash2 } from 'lucide-react'
import { computePoTaxIncluded, isLegacyPayablePo, poLineBillableRemaining, poLineSubtotal, poPaidTotal, poRemaining } from '@/lib/cashflow'
import { formatCurrency, formatDate, formatKg, todayIso } from '@/lib/format'
import { InstallmentScheduleEditor } from '@/components/InstallmentScheduleEditor'
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
  const { confirm } = useConfirm()
  const canEdit = user?.role === 'admin'

  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [linkedInvoices, setLinkedInvoices] = useState<PurchaseInvoice[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [inventoryGroups, setInventoryGroups] = useState<InventoryGroup[]>([])
  const [form, setForm] = useState<PurchaseOrderInput | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')
  // Invoice-flow PO only: toggled when the user opts into 分割払い(前払金＋残金) and
  // sets up the schedule. Saving it flips the PO to PO-direct (legacy) on next render.
  const [showInstallmentSetup, setShowInstallmentSetup] = useState(false)
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
      if (found) {
        setForm(buildPoFormState(found, nextProducts, todayIso()))
        if (!isLegacyPayablePo(found)) {
          services.purchaseInvoices.getPurchaseInvoicesByPo(found.id).then(inv => { if (active) setLinkedInvoices(inv) }).catch(() => {})
        }
      }
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

  const toggleBillingComplete = async (next: boolean) => {
    if (!order) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const services = await getServices()
      const updated = await services.purchaseOrders.setPurchaseOrderBillingComplete(order.id, next)
      setOrder(updated)
      setForm(buildPoFormState(updated, products, todayIso()))
      setMessage(next ? '請求完了にしました' : '請求完了を解除しました')
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!order) return
    if (!(await confirm({ message: `発注「${order.supplierName} / ${order.orderDate}」を削除しますか？\n入荷済みの場合、関連する入荷記録も削除されます。`, danger: true, confirmLabel: '削除する' }))) return
    const services = await getServices()
    await services.purchaseOrders.deletePurchaseOrder(order.id)
    router.push('/purchase-orders')
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="py-20 text-center text-sm text-mist">読み込み中…</div>
      </AppLayout>
    )
  }

  if (!order || !form) {
    return (
      <AppLayout>
        <div className="space-y-4 py-20 text-center">
          <p className="text-sm text-mist">発注が見つかりませんでした。</p>
          <Link href="/purchase-orders" className="inline-flex items-center gap-2 text-sm font-medium text-matchaDeep hover:underline">
            <ArrowLeft size={14} /> 発注一覧へ戻る
          </Link>
        </div>
      </AppLayout>
    )
  }

  const taxIncl = computePoTaxIncluded(order)
  const paid = poPaidTotal(order)
  const remaining = poRemaining(order)
  const isInvoiceFlow = !isLegacyPayablePo(order)

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <Link href="/purchase-orders" className="inline-flex w-fit items-center gap-1.5 text-sm text-mist hover:text-ink">
            <ArrowLeft size={14} /> 発注一覧
          </Link>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <StatusBadge status={order.status} />
              <h1 className="text-2xl font-bold text-ink">{order.supplierName}</h1>
              <span className="text-sm text-mist">{formatDate(order.orderDate)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/purchase-orders/${order.id}/document`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-sm font-medium text-ink transition hover:bg-bone"
              >
                <FileText size={14} /> 発注書
              </Link>
              {canEdit && (
                <>
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
                </>
              )}
            </div>
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-matcha/40 bg-bone px-4 py-3 text-sm text-matcha">{message}</div>
        )}
        {error && (
          <div className="rounded-xl border border-alert/40 bg-alert/5 px-4 py-3 text-sm text-alert">{error}</div>
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
                  ? 'border-[#174c33] text-matchaDeep'
                  : 'border-transparent text-mist hover:text-ink'
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
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-mist">商品</p>
              <div className="space-y-1.5">
                {order.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="text-ink">{item.productName}{item.productSku ? `（${item.productSku}）` : ''}</span>
                    <span className="text-mist">{formatKg(item.quantityKg)} × {formatCurrency(item.unitPrice)}</span>
                  </div>
                ))}
              </div>
              {order.notes && <p className="mt-3 whitespace-pre-wrap border-t border-[#f0ebdf] pt-3 text-sm text-mist">{order.notes}</p>}
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

        {tab === 'payment' && isInvoiceFlow && (
          <div className="space-y-5">
            {/* 支払い方法の選択。既定は請求書で精算。分割払いを選ぶと前払金＋残金を
                発注に直接記録し、保存するとこの発注はPO直接（分割払い）に切り替わる。
                ※発注は「請求書で精算」か「分割払い(直接)」のどちらか一方に属する。 */}
            <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4">
              <p className="mb-2 text-sm font-semibold text-ink">支払い方法</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setShowInstallmentSetup(false)}
                  disabled={!canEdit}
                  className={`flex-1 rounded-xl border px-3 py-2 text-left text-sm transition disabled:opacity-60 ${!showInstallmentSetup ? 'border-matcha bg-[#f1f7f1] text-ink' : 'border-line bg-white text-mist hover:bg-bone'}`}
                >
                  <span className="font-medium">請求書で精算（既定）</span>
                  <span className="mt-0.5 block text-[11px] text-mist">仕入先から届く受領請求書を登録して消し込みます。</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowInstallmentSetup(true)}
                  disabled={!canEdit}
                  className={`flex-1 rounded-xl border px-3 py-2 text-left text-sm transition disabled:opacity-60 ${showInstallmentSetup ? 'border-matcha bg-[#f1f7f1] text-ink' : 'border-line bg-white text-mist hover:bg-bone'}`}
                >
                  <span className="font-medium">分割払い（前払金＋残金）で直接支払う</span>
                  <span className="mt-0.5 block text-[11px] text-mist">受領請求書を使わず、発注に直接 前払金・残金を記録します。</span>
                </button>
              </div>
            </div>

            {showInstallmentSetup && (
              <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4">
                <p className="mb-1 text-sm font-semibold text-ink">前払金・分割払い（納品前後）</p>
                <p className="mb-3 text-xs text-mist">前払金額を入力して「分割払い(前払金+残金)を設定」を押し、上部の「保存」で確定すると、この発注は分割払い（直接支払い）に切り替わります。</p>
                <InstallmentScheduleEditor
                  payments={form.payments ?? []}
                  totalIncl={taxIncl}
                  onChange={next => setForm(prev => (prev ? { ...prev, payments: next } : prev))}
                  disabled={!canEdit}
                />
                <p className="mt-2 text-xs text-mist">※ 設定後、上部の「保存」を押してください。</p>
              </div>
            )}

            {!showInstallmentSetup && (
            <>
            <div className="rounded-2xl border border-sky-200 bg-sky-50/40 p-4 text-sm text-mist">
              この発注は<strong className="text-ink">請求書ベース</strong>で管理します。仕入先から請求書が届いたら登録し、下記の明細を消し込みます。支払いは請求書側で記録します。
            </div>

            <div className="overflow-hidden rounded-2xl border border-[#e6dfcf] bg-white">
              <div className="flex items-center justify-between px-4 py-3">
                <p className="text-sm font-semibold text-ink">請求状況（明細ごと）</p>
                {canEdit && (
                  <Link
                    href={`/purchase-invoices/new?supplier=${encodeURIComponent(order.supplierName)}`}
                    className="inline-flex items-center gap-1 rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-medium text-matchaDeep hover:bg-[#eef3eb]"
                  >
                    <Plus size={14} /> この発注から請求書を作成
                  </Link>
                )}
              </div>
              <table className="min-w-full border-t border-[#f0ebdf] text-sm">
                <thead className="bg-bone text-left text-[11px] uppercase tracking-wider text-mist">
                  <tr>
                    <th className="px-4 py-2 font-medium">商品</th>
                    <th className="px-4 py-2 font-medium text-right">金額(税抜)</th>
                    <th className="px-4 py-2 font-medium text-right">請求済</th>
                    <th className="px-4 py-2 font-medium text-right">請求残</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((item, i) => {
                    const rem = poLineBillableRemaining(item)
                    return (
                      <tr key={i} className="border-t border-[#f0ebdf] text-ink">
                        <td className="px-4 py-2">{item.productName}{item.productSku ? `（${item.productSku}）` : ''}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(poLineSubtotal(item))}</td>
                        <td className="px-4 py-2 text-right text-mist">{formatCurrency(item.billedAmount ?? 0)}</td>
                        <td className={`px-4 py-2 text-right ${rem > 0.5 ? 'text-[#a87b1e]' : 'text-matcha'}`}>{order.billingComplete ? '—' : formatCurrency(rem)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4">
              <p className="mb-2 text-sm font-semibold text-ink">紐付く請求書</p>
              {linkedInvoices.length === 0 ? (
                <p className="text-xs text-mist">まだ請求書が登録されていません。</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {linkedInvoices.map(inv => (
                    <li key={inv.id} className="flex items-center justify-between">
                      <Link href={`/purchase-invoices/${inv.id}`} className="text-matchaDeep hover:underline">
                        {inv.invoiceNumber || '請求書'}（{inv.invoiceDate || '日付未設定'}）
                      </Link>
                      <span className="text-mist">{formatCurrency(inv.totalAmount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {canEdit && (
              <div className="flex items-center justify-between rounded-2xl border border-[#e6dfcf] bg-bone p-4">
                <div>
                  <p className="text-sm font-medium text-ink">請求完了</p>
                  <p className="text-xs text-mist">これ以上この発注に対する請求が来ない場合、残りを締めて予測・請求待ちから除外します。</p>
                </div>
                <button
                  type="button"
                  onClick={() => toggleBillingComplete(!order.billingComplete)}
                  disabled={saving}
                  className={`rounded-xl px-3 py-2 text-sm font-medium transition disabled:opacity-60 ${order.billingComplete ? 'border border-line bg-white text-ink hover:bg-bone' : 'bg-ink text-paper hover:bg-matchaDeep'}`}
                >
                  {order.billingComplete ? '請求完了を解除' : '請求完了にする'}
                </button>
              </div>
            )}
            </>
            )}
          </div>
        )}

        {tab === 'payment' && !isInvoiceFlow && (
          <fieldset disabled={!canEdit} className="space-y-5">
            <PoBillingSection form={form} setForm={setForm as React.Dispatch<React.SetStateAction<PurchaseOrderInput>>} poId={order.id} />
            <div className="grid gap-3 rounded-2xl border border-line bg-bone p-4 sm:grid-cols-3">
              <div>
                <p className="text-xs text-mist">合計（税込）</p>
                <p className="mt-1 text-lg font-semibold text-ink">{formatCurrency(taxIncl)}</p>
              </div>
              <div>
                <p className="text-xs text-mist">支払済</p>
                <p className="mt-1 text-lg font-semibold text-ink">{formatCurrency(paid)}</p>
              </div>
              <div>
                <p className="text-xs text-mist">残額</p>
                <p className={`mt-1 text-lg font-semibold ${remaining > 0 ? 'text-[#a87b1e]' : 'text-matcha'}`}>{formatCurrency(remaining)}</p>
              </div>
            </div>
            <p className="text-xs text-mist">※ 支払い内容を変更したら上部の「保存」を押してください。</p>
          </fieldset>
        )}

        {tab === 'receiving' && (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-[#e6dfcf] bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-bone text-left text-[11px] uppercase tracking-wider text-mist">
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
                      <tr key={i} className="border-t border-[#f0ebdf] text-ink">
                        <td className="px-4 py-2">
                          <div className="font-medium">{item.productName}</div>
                          <div className="text-[11px] text-mist">{item.productSku}</div>
                        </td>
                        <td className="px-4 py-2 text-right">{formatKg(item.quantityKg)}</td>
                        <td className="px-4 py-2 text-right">{formatKg(item.receivedKg ?? 0)}</td>
                        <td className={`px-4 py-2 text-right ${remainingKg > 0 ? 'text-[#a87b1e]' : 'text-matcha'}`}>{formatKg(remainingKg)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-mist">
              入荷の登録・反映は
              <Link href="/receiving" className="mx-1 font-medium text-matchaDeep hover:underline">入荷管理</Link>
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
      <p className="text-xs font-medium uppercase tracking-wider text-mist">{label}</p>
      <div className={`mt-1.5 ${strong ? 'text-lg font-semibold text-ink' : 'text-sm text-ink'}`}>{value}</div>
    </div>
  )
}
