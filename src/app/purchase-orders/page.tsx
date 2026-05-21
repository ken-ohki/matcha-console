'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type {
  ProductWithInventory,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderLineInput,
  PurchaseOrderStatus,
  Supplier,
} from '@/types'
import Link from 'next/link'
import { ClipboardList, FileText, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { uploadPurchaseOrderInvoice, deleteStorageObjectByUrl } from '@/lib/firebase/storage'

function formatDate(value?: string): string {
  if (!value) return '-'
  return value
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(amount)
}

function formatKg(value: number): string {
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(value)} kg`
}

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  placed: '発注済',
  shipped: '発送中',
  received: '入荷済',
  cancelled: '取消',
}

const STATUS_COLORS: Record<PurchaseOrderStatus, string> = {
  placed: 'bg-slate-100 text-slate-700',
  shipped: 'bg-blue-100 text-blue-800',
  received: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-500',
}

function PaymentStatusBadge({ status, hasInvoice }: { status: 'uninvoiced' | 'unpaid' | 'paid'; hasInvoice: boolean }) {
  const map = {
    uninvoiced: { label: '未請求', cls: 'bg-slate-100 text-slate-700' },
    unpaid: { label: '未払', cls: 'bg-amber-100 text-amber-800' },
    paid: { label: '支払済', cls: 'bg-emerald-100 text-emerald-800' },
  } as const
  const m = map[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>
      {m.label}
      {hasInvoice && <FileText size={9} />}
    </span>
  )
}

function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function PurchaseOrderModal({
  open,
  suppliers,
  products,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  suppliers: Supplier[]
  products: ProductWithInventory[]
  initial: PurchaseOrder | null
  onClose: () => void
  onSave: (input: PurchaseOrderInput) => Promise<void>
}) {
  const defaultProductId = products[0]?.id ?? ''
  const [supplierFocused, setSupplierFocused] = useState(false)
  const [form, setForm] = useState<PurchaseOrderInput>({
    supplierName: '',
    items: [{ productId: defaultProductId, quantityKg: 0, unitPrice: 0 }],
    orderDate: todayIso(),
    expectedDeliveryDate: '',
    actualDeliveryDate: '',
    status: 'placed',
    paymentStatus: 'uninvoiced',
    paymentDueDate: '',
    paidDate: '',
    invoice: undefined,
    notes: '',
  })
  const [uploadingInvoice, setUploadingInvoice] = useState(false)
  const [invoiceError, setInvoiceError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const initialItems: PurchaseOrderLineInput[] = initial && initial.items.length > 0
      ? initial.items.map(item => ({
          productId: item.productId,
          quantityKg: item.quantityKg,
          unitPrice: item.unitPrice,
        }))
      : [{
          productId: defaultProductId,
          quantityKg: 0,
          unitPrice: products.find(p => p.id === defaultProductId)?.purchaseUnitPrice ?? 0,
        }]
    setForm({
      supplierName: initial?.supplierName ?? '',
      items: initialItems,
      orderDate: initial?.orderDate ?? todayIso(),
      expectedDeliveryDate: initial?.expectedDeliveryDate ?? '',
      actualDeliveryDate: initial?.actualDeliveryDate ?? '',
      status: initial?.status ?? 'placed',
      paymentStatus: initial?.paymentStatus ?? 'uninvoiced',
      paymentDueDate: initial?.paymentDueDate ?? '',
      paidDate: initial?.paidDate ?? '',
      invoice: initial?.invoice,
      notes: initial?.notes ?? '',
    })
    setError('')
  }, [open, initial, defaultProductId, products])

  const supplierSuggestions = useMemo(() => {
    const query = form.supplierName.trim().toLowerCase()
    const filtered = query
      ? suppliers.filter(s => s.name.toLowerCase().includes(query))
      : suppliers
    return filtered.slice(0, 8)
  }, [suppliers, form.supplierName])

  const totalAmount = form.items.reduce(
    (s, i) => s + (Number(i.quantityKg) || 0) * (Number(i.unitPrice) || 0), 0,
  )
  const totalQuantity = form.items.reduce((s, i) => s + (Number(i.quantityKg) || 0), 0)

  const updateItem = (index: number, patch: Partial<PurchaseOrderLineInput>) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) => i === index ? { ...item, ...patch } : item),
    }))
  }
  const handleItemProductChange = (index: number, productId: string) => {
    const product = products.find(item => item.id === productId)
    setForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) => i === index ? {
        ...item,
        productId,
        unitPrice: product?.purchaseUnitPrice ?? item.unitPrice,
      } : item),
    }))
  }
  const addItem = () => {
    const defaultPid = products[0]?.id ?? ''
    const defaultPrice = products[0]?.purchaseUnitPrice ?? 0
    setForm(prev => ({
      ...prev,
      items: [...prev.items, { productId: defaultPid, quantityKg: 0, unitPrice: defaultPrice }],
    }))
  }
  const removeItem = (index: number) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.length <= 1 ? prev.items : prev.items.filter((_, i) => i !== index),
    }))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!form.supplierName.trim()) throw new Error('発注先を入力してください')
      if (form.items.length === 0 || form.items.some(i => !i.productId)) {
        throw new Error('商品を選択してください')
      }
      if (form.items.some(i => !(Number(i.quantityKg) > 0))) {
        throw new Error('各商品の数量を入力してください')
      }
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
            <h2 className="text-xl font-semibold text-[#173c2a]">{initial ? '発注を編集' : '発注を登録'}</h2>
            <p className="mt-1 text-sm text-[#68756c]">「入荷済」に変更すると入荷記録が自動追加されます。</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">ステータス</label>
              <select
                value={form.status}
                onChange={e => setForm(prev => ({ ...prev, status: e.target.value as PurchaseOrderStatus }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="placed">発注済</option>
                <option value="shipped">発送中</option>
                <option value="received">入荷済</option>
                <option value="cancelled">取消</option>
              </select>
            </div>
            <div className="relative">
              <label className="mb-1 block text-sm font-medium text-gray-700">発注先</label>
              <input
                required
                value={form.supplierName}
                onChange={e => setForm(prev => ({ ...prev, supplierName: e.target.value }))}
                onFocus={() => setSupplierFocused(true)}
                onBlur={() => window.setTimeout(() => setSupplierFocused(false), 120)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                placeholder="例: 山政小山園"
              />
              {supplierFocused && supplierSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-10 overflow-hidden rounded-xl border border-[#d9d1be] bg-white shadow-lg">
                  {supplierSuggestions.map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onMouseDown={e => {
                        e.preventDefault()
                        setForm(prev => ({ ...prev, supplierName: s.name }))
                        setSupplierFocused(false)
                      }}
                      className="flex w-full items-start justify-between gap-3 border-b border-[#f0ebdf] px-3 py-2.5 text-left last:border-b-0 hover:bg-[#f7f5ee]"
                    >
                      <span className="block text-sm font-medium text-[#173c2a]">{s.name}</span>
                      <span className="shrink-0 text-xs text-[#68756c]">{s.orderCount}件</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">商品</label>
              <span className="text-xs text-[#68756c]">合計 {formatCurrency(totalAmount)}</span>
            </div>
            <div className="space-y-2">
              {form.items.map((line, index) => {
                const lineTotal = (Number(line.quantityKg) || 0) * (Number(line.unitPrice) || 0)
                return (
                  <div key={index} className="grid gap-2 rounded-xl border border-[#e6dfcf] bg-[#faf8f2] p-3 md:grid-cols-[1.4fr,0.7fr,0.7fr,auto,auto]">
                    <select
                      value={line.productId}
                      onChange={e => handleItemProductChange(index, e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    >
                      <option value="">選択してください</option>
                      {[...products]
                        .sort((a, b) => (a.purchaseProductName || a.name).localeCompare(b.purchaseProductName || b.name, 'en'))
                        .map(p => {
                          const label = p.purchaseProductName || p.name
                          const suffix = p.purchaseProductName ? '' : ' ※販売名'
                          return (
                            <option key={p.id} value={p.id}>
                              {label} ({p.sku}){suffix}
                            </option>
                          )
                        })}
                    </select>
                    <input
                      required
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={line.quantityKg}
                      placeholder="数量 (kg)"
                      onChange={e => updateItem(index, { quantityKg: Number(e.target.value) || 0 })}
                      className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                    <input
                      required
                      type="number"
                      min="0"
                      step="1"
                      value={line.unitPrice}
                      placeholder="単価"
                      onChange={e => updateItem(index, { unitPrice: Number(e.target.value) || 0 })}
                      className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                    <div className="flex items-center justify-end text-xs text-[#68756c] md:px-2">
                      {formatCurrency(lineTotal)}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      disabled={form.items.length <= 1}
                      aria-label="削除"
                      className="self-center rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-red-600 disabled:opacity-30"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )
              })}
            </div>
            <button
              type="button"
              onClick={addItem}
              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-[#d9d1be] bg-white px-3 py-1.5 text-xs font-medium text-[#174c33] transition hover:bg-[#ece8db]"
            >
              <Plus size={14} />
              商品を追加
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">発注日</label>
              <input
                required
                type="date"
                value={form.orderDate}
                onChange={e => setForm(prev => ({ ...prev, orderDate: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">入荷予定日</label>
              <input
                type="date"
                value={form.expectedDeliveryDate ?? ''}
                onChange={e => setForm(prev => ({ ...prev, expectedDeliveryDate: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">実際の入荷日</label>
              <input
                type="date"
                value={form.actualDeliveryDate ?? ''}
                onChange={e => setForm(prev => ({ ...prev, actualDeliveryDate: e.target.value }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-[#d9d1be] bg-white p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#68756c]">請求・支払い</p>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">支払いステータス</label>
                <select
                  value={form.paymentStatus ?? 'uninvoiced'}
                  onChange={e => setForm(prev => ({ ...prev, paymentStatus: e.target.value as 'uninvoiced' | 'unpaid' | 'paid' }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  <option value="uninvoiced">未請求</option>
                  <option value="unpaid">未払</option>
                  <option value="paid">支払済</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">支払い期日</label>
                <input
                  type="date"
                  value={form.paymentDueDate ?? ''}
                  onChange={e => setForm(prev => ({ ...prev, paymentDueDate: e.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">支払日</label>
                <input
                  type="date"
                  value={form.paidDate ?? ''}
                  onChange={e => setForm(prev => ({ ...prev, paidDate: e.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div className="md:col-span-3">
                <label className="mb-1 block text-xs font-medium text-gray-700">請求書（PDF）</label>
                {form.invoice ? (
                  <div className="flex items-center gap-2 rounded-xl border border-[#e6dfcf] bg-[#faf8f1] px-3 py-2 text-sm">
                    <a href={form.invoice.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-[#173c2a] hover:underline">
                      {form.invoice.name}
                    </a>
                    {form.invoice.uploadedAt && <span className="text-[10px] text-[#a59f8c]">{form.invoice.uploadedAt}</span>}
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm('請求書を削除しますか？')) return
                        if (form.invoice?.url) await deleteStorageObjectByUrl(form.invoice.url)
                        setForm(prev => ({ ...prev, invoice: null }))
                      }}
                      className="rounded-lg p-1 text-red-500 hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ) : (
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[#d9d1be] bg-white px-3 py-2 text-xs font-medium text-[#174c33] transition hover:bg-[#eef3eb]">
                    <FileText size={12} />
                    {uploadingInvoice ? 'アップロード中…' : '請求書PDFを添付'}
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      disabled={uploadingInvoice}
                      onChange={async e => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (!file) return
                        setInvoiceError('')
                        if (file.size > 30 * 1024 * 1024) {
                          setInvoiceError('30MBを超えるファイルはアップロードできません')
                          return
                        }
                        setUploadingInvoice(true)
                        try {
                          const url = await uploadPurchaseOrderInvoice(file, initial?.id || 'new')
                          setForm(prev => ({
                            ...prev,
                            invoice: {
                              name: file.name,
                              url,
                              uploadedAt: new Date().toISOString().slice(0, 10),
                              size: file.size,
                            },
                            paymentStatus: prev.paymentStatus === 'uninvoiced' ? 'unpaid' : prev.paymentStatus,
                          }))
                        } catch (err) {
                          setInvoiceError(err instanceof Error ? err.message : 'アップロードに失敗しました')
                        } finally {
                          setUploadingInvoice(false)
                        }
                      }}
                    />
                  </label>
                )}
                {invoiceError && <p className="mt-1 text-xs text-red-600">{invoiceError}</p>}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">メモ</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
              rows={3}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              placeholder="発注内容のメモ"
            />
          </div>

          <div className="grid gap-3 rounded-2xl border border-[#d9d1be] bg-[#f7f5ee] p-4 md:grid-cols-2">
            <div>
              <p className="text-xs text-[#68756c]">合計数量</p>
              <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatKg(totalQuantity)}</p>
            </div>
            <div>
              <p className="text-xs text-[#68756c]">合計金額</p>
              <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(totalAmount)}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-1 sm:flex-row">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-700 transition hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-[#174c33] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#123723] disabled:bg-[#4f7c65]"
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
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<PurchaseOrderStatus | ''>('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<PurchaseOrder | null>(null)
  const [message, setMessage] = useState('')
  const { user } = useAuth()
  const canEdit = user?.role === 'admin'

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const [nextOrders, nextSuppliers, nextProducts] = await Promise.all([
      services.purchaseOrders.getPurchaseOrders(),
      services.suppliers.getSuppliers(),
      services.inventory.getProductsWithInventory(),
    ])
    setOrders(nextOrders)
    setSuppliers(nextSuppliers)
    setProducts(nextProducts)
    setLoading(false)
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
    if (editing) {
      await services.purchaseOrders.updatePurchaseOrder(editing.id, input)
      setMessage('発注を更新しました')
    } else {
      await services.purchaseOrders.createPurchaseOrder(input)
      setMessage('発注を登録しました')
    }
    await load()
    setEditing(null)
  }

  const handleDelete = async (order: PurchaseOrder) => {
    if (!confirm(`発注「${order.supplierName} / ${order.orderDate}」を削除しますか？\n「入荷済」の場合、関連する入荷記録も削除されます。`)) return
    const services = await getServices()
    await services.purchaseOrders.deletePurchaseOrder(order.id)
    setMessage('発注を削除しました')
    await load()
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-3 py-1 text-sm font-medium text-[#5e44a8]">
              <ClipboardList size={15} />
              発注管理
            </div>
            <h1 className="mt-3 text-3xl font-bold text-[#173c2a]">仕入れ発注の一覧</h1>
            <p className="mt-2 text-sm text-[#68756c]">「入荷済」に変更すると商品の入荷記録に自動反映されます。</p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => { setEditing(null); setModalOpen(true) }}
              className="inline-flex items-center gap-2 self-start rounded-xl bg-[#174c33] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#123723]"
            >
              <Plus size={16} />
              新規発注
            </button>
          )}
        </div>

        {message && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {message}
          </div>
        )}

        <div className="rounded-3xl border border-[#d9d1be] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-lg font-semibold text-[#173c2a]">発注一覧</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as PurchaseOrderStatus | '')}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
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
                  className="w-full rounded-xl border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 sm:w-64"
                />
              </div>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[#e6dfcf] text-left text-[#68756c]">
                  <th className="px-3 py-3 font-medium">状態</th>
                  <th className="px-3 py-3 font-medium">発注先</th>
                  <th className="px-3 py-3 font-medium">商品</th>
                  <th className="px-3 py-3 font-medium text-right">数量</th>
                  <th className="px-3 py-3 font-medium text-right">金額</th>
                  <th className="px-3 py-3 font-medium">発注日</th>
                  <th className="px-3 py-3 font-medium">入荷予定</th>
                  <th className="px-3 py-3 font-medium">支払い</th>
                  <th className="px-3 py-3 font-medium">支払期日</th>
                  <th className="px-3 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center text-sm text-[#68756c]">
                      発注はまだ登録されていません。
                    </td>
                  </tr>
                )}
                {filtered.map(order => {
                  const first = order.items[0]
                  const rest = order.items.length > 1 ? ` 他${order.items.length - 1}件` : ''
                  return (
                    <tr key={order.id} className="border-b border-[#f0ebdf] text-[#173c2a] hover:bg-[#faf8f2]">
                      <td className="px-3 py-3"><StatusBadge status={order.status} /></td>
                      <td className={`px-3 py-3 font-medium ${order.status === 'cancelled' ? 'text-gray-400 line-through' : ''}`}>
                        {order.supplierName}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium">{first?.productName ?? '-'}</div>
                        <div className="text-[11px] text-[#68756c]">{first?.productSku}{rest}</div>
                      </td>
                      <td className="px-3 py-3 text-right">{formatKg(order.totalQuantityKg)}</td>
                      <td className="px-3 py-3 text-right font-semibold">{formatCurrency(order.totalAmount)}</td>
                      <td className="px-3 py-3 text-[#68756c]">{formatDate(order.orderDate)}</td>
                      <td className="px-3 py-3 text-[#68756c]">{formatDate(order.expectedDeliveryDate)}</td>
                      <td className="px-3 py-3">
                        <PaymentStatusBadge status={order.paymentStatus} hasInvoice={!!order.invoice} />
                      </td>
                      <td className="px-3 py-3 text-[#68756c]">{formatDate(order.paymentDueDate)}</td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Link
                            href={`/purchase-orders/${order.id}/document`}
                            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-[#173c2a]"
                            aria-label="発注書"
                            title="発注書を表示"
                          >
                            <FileText size={14} />
                          </Link>
                          {canEdit && (
                            <>
                              <button
                                type="button"
                                onClick={() => { setEditing(order); setModalOpen(true) }}
                                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-[#173c2a]"
                                aria-label="編集"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(order)}
                                className="rounded-lg p-2 text-gray-500 hover:bg-red-50 hover:text-red-600"
                                aria-label="削除"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <PurchaseOrderModal
        open={modalOpen}
        suppliers={suppliers}
        products={products}
        initial={editing}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        onSave={handleSave}
      />
    </AppLayout>
  )
}
