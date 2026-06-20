'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppLayout } from '@/components/layout/AppLayout'
import { PageTabs, PURCHASING_TABS } from '@/components/layout/PageTabs'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type {
  InventoryGroup,
  ProductWithInventory,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderStatus,
  Supplier,
} from '@/types'
import { ChevronRight, ClipboardList, FileText, Plus, Search, X } from 'lucide-react'
import { computePoTaxIncluded } from '@/lib/cashflow'
import { formatCurrency, formatDate, formatKg, todayIso } from '@/lib/format'
import {
  PaymentStatusBadge,
  StatusBadge,
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

// Create modal. Editing an existing order now happens on /purchase-orders/[id];
// this modal is kept lean for quickly registering a new 発注. It reuses the same
// shared form sections as the detail page so the two never drift apart.
function PurchaseOrderModal({
  open,
  suppliers,
  products,
  inventoryGroups,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  suppliers: Supplier[]
  products: ProductWithInventory[]
  inventoryGroups: InventoryGroup[]
  initial: PurchaseOrder | null
  onClose: () => void
  onSave: (input: PurchaseOrderInput) => Promise<void>
}) {
  const [form, setForm] = useState<PurchaseOrderInput>(() => buildPoFormState(null, products, todayIso()))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setForm(buildPoFormState(initial, products, todayIso()))
    setError('')
    // Only re-init when the modal opens or the edited record changes — NOT when
    // products refresh in the background (would wipe input).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      validatePoForm(form)
      await onSave(form)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4">
      <div className="max-h-[100vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:max-h-[92vh] sm:rounded-3xl sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink">{initial ? '発注を編集' : '発注を登録'}</h2>
            <p className="mt-1 text-sm text-mist">入荷の反映は「入荷管理」で行います。在庫未登録の商品も発注できます。</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 transition hover:bg-bone hover:text-mist">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-alert/40 bg-alert/5 px-4 py-3 text-sm text-alert">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <PoBasicSection form={form} setForm={setForm} suppliers={suppliers} />
          <PoItemsSection form={form} setForm={setForm} products={products} inventoryGroups={inventoryGroups} />
          <PoDatesSection form={form} setForm={setForm} />
          <PoBillingSection form={form} setForm={setForm} poId={initial?.id ?? 'new'} />
          <PoNotesSection form={form} setForm={setForm} />
          <PoFeesSection form={form} setForm={setForm} />
          <PoSummarySection form={form} />

          <div className="flex flex-col gap-3 pt-1 sm:flex-row">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm text-graphite transition hover:bg-bone"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:bg-matchaDeep disabled:bg-[#4f7c65]"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function PurchaseOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [inventoryGroups, setInventoryGroups] = useState<InventoryGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | ''>('')
  const [modalOpen, setModalOpen] = useState(false)
  const [message, setMessage] = useState('')
  const { user } = useAuth()
  const canEdit = user?.role === 'admin'

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const [nextOrders, nextSuppliers, nextProducts, nextGroups] = await Promise.all([
      services.purchaseOrders.getPurchaseOrders(),
      services.suppliers.getSuppliers(),
      services.inventory.getProductsWithInventory(),
      services.inventory.getInventoryGroups(),
    ])
    setOrders(nextOrders)
    setSuppliers(nextSuppliers)
    setProducts(nextProducts)
    setInventoryGroups(nextGroups)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const handler = () => {
      // Don't refetch while the create modal is open — it would wipe input.
      if (modalOpen) return
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', handler)
    window.addEventListener('focus', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
  }, [modalOpen])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter(o => {
      if (statusFilter && o.status !== statusFilter) return false
      if (!q) return true
      return (
        o.supplierName.toLowerCase().includes(q) ||
        o.items.some(i => i.productName.toLowerCase().includes(q) || i.productSku.toLowerCase().includes(q))
      )
    })
  }, [orders, search, statusFilter])

  const handleSave = async (input: PurchaseOrderInput) => {
    const services = await getServices()
    await services.purchaseOrders.createPurchaseOrder(input)
    setMessage('発注を登録しました')
    await load()
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageTabs tabs={PURCHASING_TABS} />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-3 py-1 text-sm font-medium text-graphite">
              <ClipboardList size={15} />
              発注管理
            </div>
            <h1 className="mt-3 text-3xl font-bold text-ink">仕入れ発注の一覧</h1>
            <p className="mt-2 text-sm text-mist">行をクリックすると詳細ページで編集・支払い・入荷を管理できます。</p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-2 self-start rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:bg-matchaDeep"
            >
              <Plus size={16} />
              新規発注
            </button>
          )}
        </div>

        {message && (
          <div className="rounded-xl border border-matcha/40 bg-bone px-4 py-3 text-sm text-matcha">
            {message}
          </div>
        )}

        <div className="rounded-3xl border border-line bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-lg font-semibold text-ink">発注一覧</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as PurchaseOrderStatus | '')}
                className="rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              >
                <option value="">すべてのステータス</option>
                <option value="placed">発注済</option>
                <option value="shipped">発送中</option>
                <option value="received">入荷済</option>
                <option value="cancelled">取消</option>
              </select>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="発注先・商品で検索"
                  className="w-full rounded-xl border border-line py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-matcha sm:w-64"
                />
              </div>
            </div>
          </div>

          <div className="mt-5 -mx-4 overflow-x-auto md:-mx-6">
            <table className="min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-[#e6dfcf] text-left text-mist">
                  <th className="whitespace-nowrap px-3 py-3 font-medium">状態</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">発注先</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">商品</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium text-right">数量</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium text-right">金額(税込)</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">発注日</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">入荷予定</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">支払</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">支払期日</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">請求書</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-10 text-center text-sm text-mist">
                      発注はまだ登録されていません。
                    </td>
                  </tr>
                )}
                {filtered.map(order => (
                  <PoListRow
                    key={order.id}
                    order={order}
                    onOpen={() => router.push(`/purchase-orders/${order.id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <PurchaseOrderModal
        open={modalOpen}
        suppliers={suppliers}
        products={products}
        inventoryGroups={inventoryGroups}
        initial={null}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
      />
    </AppLayout>
  )
}

function PoListRow({ order, onOpen }: { order: PurchaseOrder; onOpen: () => void }) {
  const first = order.items[0]
  const rest = order.items.length > 1 ? ` 他${order.items.length - 1}件` : ''

  return (
    <tr
      onClick={onOpen}
      className="cursor-pointer border-b border-[#f0ebdf] text-ink transition hover:bg-bone"
    >
      <td className="whitespace-nowrap px-3 py-3"><StatusBadge status={order.status} /></td>
      <td className={`whitespace-nowrap px-3 py-3 font-medium ${order.status === 'cancelled' ? 'text-gray-400 line-through' : ''}`}>
        {order.supplierName}
      </td>
      <td className="whitespace-nowrap px-3 py-3">
        <div className="font-medium">{first?.productName ?? '-'}</div>
        <div className="text-[11px] text-mist">{first?.productSku}{rest}</div>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right">{formatKg(order.totalQuantityKg)}</td>
      <td className="whitespace-nowrap px-3 py-3 text-right">
        <div className="font-semibold">{formatCurrency(computePoTaxIncluded(order))}</div>
        <div className="text-[10px] text-mist">税抜 {formatCurrency(order.totalAmount + (order.shippingFee ?? 0) + (order.otherFees ?? 0))}</div>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-mist">{formatDate(order.orderDate)}</td>
      <td className="whitespace-nowrap px-3 py-3 text-mist">{formatDate(order.expectedDeliveryDate)}</td>
      <td className="whitespace-nowrap px-3 py-3">
        <PaymentStatusBadge status={order.paymentStatus} hasInvoice={!!order.invoice} />
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-mist">{formatDate(order.paymentDueDate)}</td>
      <td className="whitespace-nowrap px-3 py-3">
        {order.invoice ? (
          <a
            href={order.invoice.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-lg bg-bone px-2 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb]"
            title={order.invoice.name}
          >
            <FileText size={12} /> PDF
          </a>
        ) : (
          <span className="text-[11px] text-mist">未添付</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right text-gray-400">
        <ChevronRight size={16} className="inline" />
      </td>
    </tr>
  )
}
