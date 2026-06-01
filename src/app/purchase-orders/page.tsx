'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { PageTabs, PURCHASING_TABS } from '@/components/layout/PageTabs'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type {
  ProductWithInventory,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderLineInput,
  PurchaseOrderPaymentStatus,
  PurchaseOrderStatus,
  Supplier,
} from '@/types'
import Link from 'next/link'
import { ClipboardList, FileText, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { uploadPurchaseOrderInvoice, deleteStorageObjectByUrl } from '@/lib/firebase/storage'
import { computePoTaxIncluded } from '@/lib/cashflow'
import { formatCurrency, formatDate, formatKg, todayIso } from '@/lib/format'

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


function productSubLabel(p: ProductWithInventory): string {
  const parts = [p.teaType, p.grade].filter(Boolean)
  const origin = (p.origins ?? []).filter(Boolean).join('・')
  if (origin) parts.push(origin)
  return parts.join(' / ')
}

function ProductCombobox({
  products,
  value,
  freeText,
  onSelectProduct,
  onFreeText,
}: {
  products: ProductWithInventory[]
  value: string          // selected productId ('' = none)
  freeText: string       // free-text name for an unlisted product
  onSelectProduct: (product: ProductWithInventory) => void
  onFreeText: (name: string) => void
}) {
  const [focused, setFocused] = useState(false)
  const [query, setQuery] = useState('')

  const selected = value ? products.find(p => p.id === value) : undefined
  // The text shown in the input: query while typing, else selected name, else free text.
  const displayValue = focused
    ? query
    : selected
      ? `${selected.purchaseProductName || selected.name}（${selected.sku}）`
      : freeText

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? products.filter(p =>
          (p.purchaseProductName || '').toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q),
        )
      : products
    return [...list]
      .sort((a, b) => (a.purchaseProductName || a.name).localeCompare(b.purchaseProductName || b.name, 'ja'))
      .slice(0, 12)
  }, [products, query])

  const trimmed = query.trim()

  return (
    <div className="relative">
      <input
        type="text"
        value={displayValue}
        onChange={e => {
          setQuery(e.target.value)
          setFocused(true)
        }}
        onFocus={() => {
          setQuery(selected ? (selected.purchaseProductName || selected.name) : freeText)
          setFocused(true)
        }}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="商品名・SKUで検索、または新規商品名を入力"
        className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
      />
      {focused && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-[#d9d1be] bg-white shadow-lg">
          {suggestions.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={() => {
                onSelectProduct(p)
                setQuery('')
                setFocused(false)
              }}
              className="block w-full border-b border-[#f0ebe0] px-3 py-2 text-left last:border-b-0 hover:bg-[#f7f5ee]"
            >
              <div className="text-sm font-medium text-[#173c2a]">
                {p.purchaseProductName || p.name}
                <span className="ml-1 text-xs font-normal text-[#9a8f76]">{p.sku}</span>
              </div>
              {productSubLabel(p) && (
                <div className="text-[11px] text-[#68756c]">{productSubLabel(p)}</div>
              )}
            </button>
          ))}
          {trimmed && (
            <button
              type="button"
              onMouseDown={() => {
                onFreeText(trimmed)
                setQuery('')
                setFocused(false)
              }}
              className="block w-full px-3 py-2 text-left text-sm text-[#174c33] hover:bg-[#eef3eb]"
            >
              ＋ 新規商品として「{trimmed}」を登録
            </button>
          )}
          {suggestions.length === 0 && !trimmed && (
            <div className="px-3 py-2 text-sm text-[#9a8f76]">商品名やSKUを入力してください</div>
          )}
        </div>
      )}
    </div>
  )
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
    items: [{ productId: defaultProductId, quantityKg: 0, unitPrice: 0, taxRate: 8 }],
    shippingFee: 0,
    otherFees: 0,
    otherFeesNote: '',
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
          productId: item.productId || undefined,
          // For unlisted lines (no productId) keep the free-text name so the
          // editor reopens in "new product" mode with the name prefilled.
          productName: item.productId ? undefined : item.productName,
          quantityKg: item.quantityKg,
          unitPrice: item.unitPrice,
          receivedKg: item.receivedKg,
          taxRate: item.taxRate ?? 8,
        }))
      : [{
          productId: defaultProductId,
          quantityKg: 0,
          unitPrice: products.find(p => p.id === defaultProductId)?.purchaseUnitPrice ?? 0,
          taxRate: 8,
        }]
    setForm({
      supplierName: initial?.supplierName ?? '',
      items: initialItems,
      shippingFee: initial?.shippingFee ?? 0,
      otherFees: initial?.otherFees ?? 0,
      otherFeesNote: initial?.otherFeesNote ?? '',
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
    // Only re-init when the modal opens or the edited record changes — NOT when
    // products/defaultProductId refresh in the background (would wipe input).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const supplierSuggestions = useMemo(() => {
    const query = form.supplierName.trim().toLowerCase()
    const filtered = query
      ? suppliers.filter(s => s.name.toLowerCase().includes(query))
      : suppliers
    return filtered.slice(0, 8)
  }, [suppliers, form.supplierName])

  const itemsSubtotal = form.items.reduce(
    (s, i) => s + (Number(i.quantityKg) || 0) * (Number(i.unitPrice) || 0), 0,
  )
  const totalQuantity = form.items.reduce((s, i) => s + (Number(i.quantityKg) || 0), 0)
  const poShippingFee = Number(form.shippingFee) || 0
  const poOtherFees = Number(form.otherFees) || 0
  const totalAmount = itemsSubtotal + poShippingFee + poOtherFees
  const poSubtotal10 = form.items
    .filter(i => (i.taxRate ?? 8) === 10)
    .reduce((s, i) => s + (Number(i.quantityKg) || 0) * (Number(i.unitPrice) || 0), 0)
  const poSubtotal8 = form.items
    .filter(i => (i.taxRate ?? 8) === 8)
    .reduce((s, i) => s + (Number(i.quantityKg) || 0) * (Number(i.unitPrice) || 0), 0)
  // Treat shipping/other fees as 10% standard rate.
  const poTax10 = Math.floor((poSubtotal10 + poShippingFee + poOtherFees) * 0.10)
  const poTax8 = Math.floor(poSubtotal8 * 0.08)
  const poTaxTotal = poTax10 + poTax8

  const updateItem = (index: number, patch: Partial<PurchaseOrderLineInput>) => {
    setForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) => i === index ? { ...item, ...patch } : item),
    }))
  }
  const addItem = () => {
    const defaultPid = products[0]?.id ?? ''
    const defaultPrice = products[0]?.purchaseUnitPrice ?? 0
    setForm(prev => ({
      ...prev,
      items: [...prev.items, { productId: defaultPid, quantityKg: 0, unitPrice: defaultPrice, taxRate: 8 }],
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
      if (form.items.length === 0) {
        throw new Error('商品を選択してください')
      }
      if (form.items.some(i => !i.productId && !(i.productName ?? '').trim())) {
        throw new Error('商品を選択するか、新規商品名を入力してください')
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
            <p className="mt-1 text-sm text-[#68756c]">入荷の反映は「入荷管理」で行います。在庫未登録の商品も発注できます。</p>
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
                  <div key={index} className="grid gap-2 rounded-xl border border-[#e6dfcf] bg-[#faf8f2] p-3 md:grid-cols-[1.3fr,0.6fr,0.7fr,0.55fr,auto,auto]">
                    <div className="space-y-1.5">
                      <ProductCombobox
                        products={products}
                        value={line.productId ?? ''}
                        freeText={line.productName ?? ''}
                        onSelectProduct={p => updateItem(index, {
                          productId: p.id,
                          productName: undefined,
                          unitPrice: p.purchaseUnitPrice ?? line.unitPrice,
                        })}
                        onFreeText={name => updateItem(index, { productId: '', productName: name })}
                      />
                      {!line.productId && (line.productName ?? '').trim() && (
                        <p className="px-1 text-[11px] text-amber-700">新規商品（在庫未登録）：{line.productName}</p>
                      )}
                    </div>
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
                      placeholder="税抜単価"
                      onChange={e => updateItem(index, { unitPrice: Number(e.target.value) || 0 })}
                      className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    />
                    <select
                      value={line.taxRate ?? 8}
                      onChange={e => updateItem(index, { taxRate: Number(e.target.value) === 10 ? 10 : 8 })}
                      title="消費税区分"
                      className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    >
                      <option value={8}>8%軽減</option>
                      <option value={10}>10%</option>
                    </select>
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
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wider text-[#68756c]">請求・支払い</p>
              <Link href="/financials" className="text-[11px] font-medium text-[#174c33] hover:underline">
                収支管理で編集 →
              </Link>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wider text-[#68756c]">支払いステータス</p>
                <div className="py-1.5">
                  <PaymentStatusBadge status={form.paymentStatus ?? 'uninvoiced'} hasInvoice={!!form.invoice} />
                </div>
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wider text-[#68756c]">支払い期日</p>
                <p className="text-sm text-[#173c2a]">{form.paymentDueDate || '-'}</p>
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wider text-[#68756c]">支払日</p>
                <p className="text-sm text-[#173c2a]">{form.paidDate || '-'}</p>
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
                          if (!url) throw new Error('アップロードURLの取得に失敗しました')
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

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">送料（税抜）</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.shippingFee ?? 0}
                onChange={e => setForm(prev => ({ ...prev, shippingFee: Number(e.target.value) || 0 }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">諸経費（税抜）</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.otherFees ?? 0}
                onChange={e => setForm(prev => ({ ...prev, otherFees: Number(e.target.value) || 0 }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">諸経費メモ</label>
              <input
                type="text"
                value={form.otherFeesNote ?? ''}
                onChange={e => setForm(prev => ({ ...prev, otherFeesNote: e.target.value }))}
                placeholder="例: 通関手数料"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          <div className="grid gap-3 rounded-2xl border border-[#d9d1be] bg-[#f7f5ee] p-4 md:grid-cols-2">
            <div>
              <p className="text-xs text-[#68756c]">合計数量</p>
              <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatKg(totalQuantity)}</p>
            </div>
            <div>
              <p className="text-xs text-[#68756c]">合計金額（税抜）</p>
              <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(totalAmount)}</p>
              <p className="mt-1 text-[10px] text-[#68756c]">
                内訳: 商品 {formatCurrency(itemsSubtotal)} / 送料 {formatCurrency(poShippingFee)} / 諸経費 {formatCurrency(poOtherFees)}
              </p>
              <p className="mt-1 text-[10px] text-[#68756c]">
                消費税: 10%対象 {formatCurrency(poTax10)} / 8%対象 {formatCurrency(poTax8)} / 合計 {formatCurrency(poTaxTotal)}
              </p>
              <p className="mt-0.5 text-[10px] text-[#68756c]">
                税込目安 {formatCurrency(totalAmount + poTaxTotal)}
              </p>
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
      // Don't refetch while the editor is open — it would wipe in-progress input.
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
    if (!confirm(`発注「${order.supplierName} / ${order.orderDate}」を削除しますか？\n入荷済みの場合、関連する入荷記録も削除されます。`)) return
    const services = await getServices()
    await services.purchaseOrders.deletePurchaseOrder(order.id)
    setMessage('発注を削除しました')
    await load()
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageTabs tabs={PURCHASING_TABS} />
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

          <div className="mt-5 -mx-4 overflow-x-auto md:-mx-6">
            <table className="min-w-[1400px] text-sm">
              <thead>
                <tr className="border-b border-[#e6dfcf] text-left text-[#68756c]">
                  <th className="whitespace-nowrap px-3 py-3 font-medium">状態</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">発注先</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">商品</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium text-right">数量</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium text-right">金額(税込)</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">発注日</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">入荷予定</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">支払</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">支払期日</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">支払日</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium">請求書</th>
                  <th className="whitespace-nowrap px-3 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-3 py-10 text-center text-sm text-[#68756c]">
                      発注はまだ登録されていません。
                    </td>
                  </tr>
                )}
                {filtered.map(order => (
                  <PoListRow
                    key={order.id}
                    order={order}
                    canEdit={canEdit}
                    onEdit={() => { setEditing(order); setModalOpen(true) }}
                    onDelete={() => handleDelete(order)}
                    onUpdated={updated => setOrders(prev => prev.map(o => o.id === updated.id ? updated : o))}
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
        initial={editing}
        onClose={() => { setModalOpen(false); setEditing(null) }}
        onSave={handleSave}
      />
    </AppLayout>
  )
}

function PoListRow({
  order,
  canEdit,
  onEdit,
  onDelete,
  onUpdated,
}: {
  order: PurchaseOrder
  canEdit: boolean
  onEdit: () => void
  onDelete: () => void
  onUpdated: (order: PurchaseOrder) => void
}) {
  const first = order.items[0]
  const rest = order.items.length > 1 ? ` 他${order.items.length - 1}件` : ''

  const [status, setStatus] = useState<PurchaseOrderPaymentStatus>(order.paymentStatus)
  const [dueDate, setDueDate] = useState<string>(order.paymentDueDate ?? '')
  const [paidDate, setPaidDate] = useState<string>(order.paidDate ?? '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setStatus(order.paymentStatus)
    setDueDate(order.paymentDueDate ?? '')
    setPaidDate(order.paidDate ?? '')
  }, [order.id, order.paymentStatus, order.paymentDueDate, order.paidDate])

  const dirty = status !== order.paymentStatus
    || (dueDate || '') !== (order.paymentDueDate ?? '')
    || (paidDate || '') !== (order.paidDate ?? '')

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const services = await getServices()
      const updated = await services.purchaseOrders.updatePurchaseOrder(order.id, {
        paymentStatus: status,
        paymentDueDate: dueDate || undefined,
        paidDate: paidDate || undefined,
      })
      onUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleUpload = async (file: File) => {
    setError('')
    if (file.size > 30 * 1024 * 1024) {
      setError('30MBを超えるファイルはアップロードできません')
      return
    }
    setUploading(true)
    try {
      const url = await uploadPurchaseOrderInvoice(file, order.id)
      if (!url) throw new Error('アップロードURLの取得に失敗しました')
      const services = await getServices()
      const updated = await services.purchaseOrders.updatePurchaseOrder(order.id, {
        invoice: {
          name: file.name,
          url,
          uploadedAt: new Date().toISOString().slice(0, 10),
          size: file.size,
        },
        paymentStatus: order.paymentStatus === 'uninvoiced' ? 'unpaid' : order.paymentStatus,
      })
      onUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
    }
  }

  const handleRemoveInvoice = async () => {
    if (!order.invoice) return
    if (!confirm('請求書を削除しますか？')) return
    setError('')
    try {
      if (order.invoice.url) await deleteStorageObjectByUrl(order.invoice.url)
      const services = await getServices()
      const updated = await services.purchaseOrders.updatePurchaseOrder(order.id, { invoice: null })
      onUpdated(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました')
    }
  }

  const cellInputCls = 'rounded-lg border border-[#d9d1be] bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-600'

  return (
    <tr className="border-b border-[#f0ebdf] text-[#173c2a] hover:bg-[#faf8f2]">
      <td className="whitespace-nowrap px-3 py-3"><StatusBadge status={order.status} /></td>
      <td className={`whitespace-nowrap px-3 py-3 font-medium ${order.status === 'cancelled' ? 'text-gray-400 line-through' : ''}`}>
        {order.supplierName}
      </td>
      <td className="whitespace-nowrap px-3 py-3">
        <div className="font-medium">{first?.productName ?? '-'}</div>
        <div className="text-[11px] text-[#68756c]">{first?.productSku}{rest}</div>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right">{formatKg(order.totalQuantityKg)}</td>
      <td className="whitespace-nowrap px-3 py-3 text-right">
        <div className="font-semibold">{formatCurrency(computePoTaxIncluded(order))}</div>
        <div className="text-[10px] text-[#68756c]">税抜 {formatCurrency(order.totalAmount)}</div>
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-[#68756c]">{formatDate(order.orderDate)}</td>
      <td className="whitespace-nowrap px-3 py-3 text-[#68756c]">{formatDate(order.expectedDeliveryDate)}</td>
      <td className="whitespace-nowrap px-3 py-3">
        {canEdit ? (
          <select
            value={status}
            onChange={e => setStatus(e.target.value as PurchaseOrderPaymentStatus)}
            className={cellInputCls}
          >
            <option value="uninvoiced">未請求</option>
            <option value="unpaid">未払</option>
            <option value="paid">支払済</option>
          </select>
        ) : (
          <PaymentStatusBadge status={order.paymentStatus} hasInvoice={!!order.invoice} />
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3">
        {canEdit ? (
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className={cellInputCls}
          />
        ) : (
          <span className="text-[#68756c]">{formatDate(order.paymentDueDate)}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3">
        {canEdit ? (
          <input
            type="date"
            value={paidDate}
            onChange={e => setPaidDate(e.target.value)}
            className={cellInputCls}
          />
        ) : (
          <span className="text-[#68756c]">{formatDate(order.paidDate)}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-3">
        <div className="flex items-center gap-1">
          {order.invoice ? (
            <>
              <a
                href={order.invoice.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-lg bg-[#f7f5ee] px-2 py-1 text-[11px] text-[#174c33] hover:bg-[#eef3eb]"
                title={order.invoice.name}
              >
                <FileText size={12} /> PDF
              </a>
              {canEdit && (
                <button
                  type="button"
                  onClick={handleRemoveInvoice}
                  className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="請求書を削除"
                  title="請求書を削除"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </>
          ) : canEdit ? (
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-dashed border-[#d9d1be] bg-white px-2 py-1 text-[11px] text-[#174c33] hover:bg-[#eef3eb]">
              {uploading ? 'アップロード中…' : '添付'}
              <input
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                disabled={uploading}
                onChange={async e => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) await handleUpload(file)
                }}
              />
            </label>
          ) : (
            <span className="text-[11px] text-[#a59f8c]">未添付</span>
          )}
        </div>
        {error && <p className="mt-1 text-[10px] text-red-600">{error}</p>}
      </td>
      <td className="whitespace-nowrap px-3 py-3 text-right">
        <div className="flex justify-end gap-1">
          {canEdit && dirty && (
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-[#174c33] px-2 py-1 text-[11px] font-medium text-white shadow hover:bg-[#205f43] disabled:opacity-60"
            >
              {saving ? '…' : '保存'}
            </button>
          )}
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
                onClick={onEdit}
                className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-[#173c2a]"
                aria-label="編集"
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={onDelete}
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
}
