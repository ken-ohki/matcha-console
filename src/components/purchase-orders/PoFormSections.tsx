'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { FileText, Plus, Trash2, X } from 'lucide-react'
import type {
  InventoryGroup,
  ProductWithInventory,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderLineInput,
  PurchaseOrderPaymentStatus,
  PurchaseOrderStatus,
  Supplier,
} from '@/types'
import { computeTaxBuckets } from '@/lib/tax'
import { PaymentsEditor } from '@/components/PaymentsEditor'
import { InstallmentScheduleEditor, hasInstallmentSchedule } from '@/components/InstallmentScheduleEditor'
import { formatCurrency, formatKg } from '@/lib/format'
import { uploadPurchaseOrderInvoice, deleteStorageObjectByUrl } from '@/lib/firebase/storage'

// ---- Shared labels / badges -------------------------------------------------

export const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  placed: '発注済',
  shipped: '発送中',
  received: '入荷済',
  cancelled: '取消',
}

export const STATUS_COLORS: Record<PurchaseOrderStatus, string> = {
  placed: 'bg-bone text-graphite',
  shipped: 'bg-bone text-graphite',
  received: 'bg-bone text-matcha',
  cancelled: 'bg-bone text-mist',
}

export function PaymentStatusBadge({ status, hasInvoice }: { status: PurchaseOrderPaymentStatus; hasInvoice: boolean }) {
  const map = {
    uninvoiced: { label: '未請求', cls: 'bg-bone text-graphite' },
    unpaid: { label: '未払', cls: 'bg-bone text-[#a87b1e]' },
    partial: { label: '一部支払', cls: 'bg-sky-100 text-sky-800' },
    paid: { label: '支払済', cls: 'bg-bone text-matcha' },
  } as const
  const m = map[status]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>
      {m.label}
      {hasInvoice && <FileText size={9} />}
    </span>
  )
}

export function StatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

export function productSubLabel(p: ProductWithInventory): string {
  const parts = [p.teaType, p.grade].filter(Boolean)
  const origin = (p.origins ?? []).filter(Boolean).join('・')
  if (origin) parts.push(origin)
  return parts.join(' / ')
}

// ---- Totals helper ----------------------------------------------------------

export function computePoFormTotals(form: PurchaseOrderInput) {
  const itemsSubtotal = form.items.reduce(
    (s, i) => s + (Number(i.quantityKg) || 0) * (Number(i.unitPrice) || 0), 0,
  )
  const totalQuantity = form.items.reduce((s, i) => s + (Number(i.quantityKg) || 0), 0)
  const shippingFee = Number(form.shippingFee) || 0
  const otherFees = Number(form.otherFees) || 0
  const totalAmount = itemsSubtotal + shippingFee + otherFees
  // Shared tax logic (fees taxed at 10%) — matches the PO document and 支払管理.
  const buckets = computeTaxBuckets(form.items, shippingFee + otherFees)
  return {
    itemsSubtotal,
    totalQuantity,
    shippingFee,
    otherFees,
    totalAmount,
    tax10: buckets.standardTax,
    tax8: buckets.reducedTax,
    taxTotal: buckets.tax,
    totalIncl: totalAmount + buckets.tax,
  }
}

// ---- Product picker (select existing / create new) --------------------------

export function ProductCombobox({
  products,
  value,
  freeText,
  onSelectProduct,
  onFreeText,
}: {
  products: ProductWithInventory[]
  value: string
  freeText: string
  onSelectProduct: (product: ProductWithInventory) => void
  onFreeText: (name: string) => void
}) {
  const [focused, setFocused] = useState(false)
  const [query, setQuery] = useState('')

  const selected = value ? products.find(p => p.id === value) : undefined
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
        className="w-full rounded-lg border border-line px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
      />
      {focused && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-line bg-white shadow-lg">
          {suggestions.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={() => {
                onSelectProduct(p)
                setQuery('')
                setFocused(false)
              }}
              className="block w-full border-b border-[#f0ebe0] px-3 py-2 text-left last:border-b-0 hover:bg-bone"
            >
              <div className="text-sm font-medium text-ink">
                {p.purchaseProductName || p.name}
                <span className="ml-1 text-xs font-normal text-[#9a8f76]">{p.sku}</span>
              </div>
              {productSubLabel(p) && (
                <div className="text-[11px] text-mist">{productSubLabel(p)}</div>
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
              className="block w-full px-3 py-2 text-left text-sm text-matchaDeep hover:bg-[#eef3eb]"
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

// ---- Form sections (shared by create modal and detail page) -----------------

type FormProps = {
  form: PurchaseOrderInput
  setForm: React.Dispatch<React.SetStateAction<PurchaseOrderInput>>
}

const fieldCls =
  'w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha'

export function PoBasicSection({ form, setForm, suppliers }: FormProps & { suppliers: Supplier[] }) {
  const [supplierFocused, setSupplierFocused] = useState(false)
  const supplierSuggestions = useMemo(() => {
    const query = form.supplierName.trim().toLowerCase()
    const filtered = query ? suppliers.filter(s => s.name.toLowerCase().includes(query)) : suppliers
    return filtered.slice(0, 8)
  }, [suppliers, form.supplierName])

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <label className="mb-1 block text-sm font-medium text-graphite">ステータス</label>
        <select
          value={form.status}
          onChange={e => setForm(prev => ({ ...prev, status: e.target.value as PurchaseOrderStatus }))}
          className={fieldCls}
        >
          <option value="placed">発注済</option>
          <option value="shipped">発送中</option>
          <option value="received">入荷済</option>
          <option value="cancelled">取消</option>
        </select>
      </div>
      <div className="relative">
        <label className="mb-1 block text-sm font-medium text-graphite">発注先</label>
        <input
          required
          value={form.supplierName}
          onChange={e => setForm(prev => ({ ...prev, supplierName: e.target.value }))}
          onFocus={() => setSupplierFocused(true)}
          onBlur={() => window.setTimeout(() => setSupplierFocused(false), 120)}
          className={fieldCls}
          placeholder="例: 山政小山園"
        />
        {supplierFocused && supplierSuggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-10 overflow-hidden rounded-xl border border-line bg-white shadow-lg">
            {supplierSuggestions.map(s => (
              <button
                key={s.id}
                type="button"
                onMouseDown={e => {
                  e.preventDefault()
                  setForm(prev => ({ ...prev, supplierName: s.name }))
                  setSupplierFocused(false)
                }}
                className="flex w-full items-start justify-between gap-3 border-b border-[#f0ebdf] px-3 py-2.5 text-left last:border-b-0 hover:bg-bone"
              >
                <span className="block text-sm font-medium text-ink">{s.name}</span>
                <span className="shrink-0 text-xs text-mist">{s.orderCount}件</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function PoItemsSection({
  form,
  setForm,
  products,
  inventoryGroups,
}: FormProps & { products: ProductWithInventory[]; inventoryGroups: InventoryGroup[] }) {
  const totals = computePoFormTotals(form)

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

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="block text-sm font-medium text-graphite">商品</label>
        <span className="text-xs text-mist">合計 {formatCurrency(totals.totalAmount)}</span>
      </div>
      <div className="space-y-2">
        {form.items.map((line, index) => {
          const lineTotal = (Number(line.quantityKg) || 0) * (Number(line.unitPrice) || 0)
          return (
            <div key={index} className="grid gap-2 rounded-xl border border-[#e6dfcf] bg-bone p-3 md:grid-cols-[1.3fr,0.6fr,0.7fr,0.55fr,auto,auto]">
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
                  <div className="space-y-1 rounded-lg border border-[#a87b1e]/40 bg-bone p-2">
                    <p className="text-[11px] font-medium text-[#a87b1e]">新規商品。SKUと在庫グループを入力すると在庫管理に登録されます（入荷前は0kg）。</p>
                    <div className="flex gap-1.5">
                      <input
                        value={line.newProductSku ?? ''}
                        onChange={e => updateItem(index, { newProductSku: e.target.value })}
                        placeholder="SKU"
                        className="w-1/2 rounded-lg border border-line px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-matcha"
                      />
                      <select
                        value={line.newProductGroupId ?? ''}
                        onChange={e => updateItem(index, { newProductGroupId: e.target.value })}
                        className="w-1/2 rounded-lg border border-line px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-matcha"
                      >
                        <option value="">グループ選択</option>
                        {inventoryGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </div>
                  </div>
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
                className="w-full rounded-lg border border-line px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              />
              <input
                required
                type="number"
                min="0"
                step="1"
                value={line.unitPrice}
                placeholder="税抜単価"
                onChange={e => updateItem(index, { unitPrice: Number(e.target.value) || 0 })}
                className="w-full rounded-lg border border-line px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              />
              <select
                value={line.taxRate ?? 8}
                onChange={e => {
                  const v = Number(e.target.value)
                  updateItem(index, { taxRate: v === 0 ? 0 : v === 10 ? 10 : 8 })
                }}
                title="消費税区分"
                className="w-full rounded-lg border border-line px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              >
                <option value={0}>免税</option>
                <option value={8}>8%軽減</option>
                <option value={10}>10%</option>
              </select>
              <div className="flex items-center justify-end text-xs text-mist md:px-2">
                {formatCurrency(lineTotal)}
              </div>
              <button
                type="button"
                onClick={() => removeItem(index)}
                disabled={form.items.length <= 1}
                aria-label="削除"
                className="self-center rounded-lg p-2 text-mist transition hover:bg-bone hover:text-alert disabled:opacity-30"
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
        className="mt-2 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-matchaDeep transition hover:bg-[#ece8db]"
      >
        <Plus size={14} />
        商品を追加
      </button>
    </div>
  )
}

export function PoDatesSection({ form, setForm }: FormProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div>
        <label className="mb-1 block text-sm font-medium text-graphite">発注日</label>
        <input
          required
          type="date"
          value={form.orderDate}
          onChange={e => setForm(prev => ({ ...prev, orderDate: e.target.value }))}
          className={fieldCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-graphite">入荷予定日</label>
        <input
          type="date"
          value={form.expectedDeliveryDate ?? ''}
          onChange={e => setForm(prev => ({ ...prev, expectedDeliveryDate: e.target.value }))}
          className={fieldCls}
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-graphite">実際の入荷日</label>
        <input
          type="date"
          value={form.actualDeliveryDate ?? ''}
          onChange={e => setForm(prev => ({ ...prev, actualDeliveryDate: e.target.value }))}
          className={fieldCls}
        />
      </div>
    </div>
  )
}

export function PoBillingSection({ form, setForm, poId }: FormProps & { poId: string }) {
  const [uploadingInvoice, setUploadingInvoice] = useState(false)
  const [invoiceError, setInvoiceError] = useState('')
  const totals = computePoFormTotals(form)
  const hasPayments = (form.payments ?? []).length > 0
  // Payment entry mode: a 2-stage 前払金+残金 schedule, or the legacy free-form list.
  // Existing data decides; an empty PO lets the user pick.
  const hasSchedule = hasInstallmentSchedule(form.payments)
  const hasFreeform = (form.payments ?? []).some(p => !p.kind)
  const [payMode, setPayMode] = useState<'free' | 'installment'>(hasSchedule ? 'installment' : 'free')
  const effectiveMode: 'free' | 'installment' = hasSchedule ? 'installment' : hasFreeform ? 'free' : payMode

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-mist">請求・支払い</p>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-mist">支払いステータス</label>
          {hasPayments ? (
            <div className="py-1.5">
              <PaymentStatusBadge status={form.paymentStatus ?? 'uninvoiced'} hasInvoice={!!form.invoice} />
              <p className="mt-0.5 text-[10px] text-mist">分割支払いから自動判定</p>
            </div>
          ) : (
            <select
              value={form.paymentStatus ?? 'uninvoiced'}
              onChange={e => setForm(prev => ({ ...prev, paymentStatus: e.target.value as PurchaseOrderPaymentStatus }))}
              className={fieldCls}
            >
              <option value="uninvoiced">未請求</option>
              <option value="unpaid">未払</option>
              <option value="paid">支払済</option>
            </select>
          )}
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-mist">支払い期日</label>
          <input
            type="date"
            value={form.paymentDueDate ?? ''}
            onChange={e => setForm(prev => ({ ...prev, paymentDueDate: e.target.value }))}
            className={fieldCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] uppercase tracking-wider text-mist">支払日</label>
          <input
            type="date"
            value={form.paidDate ?? ''}
            onChange={e => setForm(prev => ({ ...prev, paidDate: e.target.value }))}
            className={fieldCls}
          />
        </div>
        <div className="md:col-span-3">
          <label className="mb-1 block text-xs font-medium text-graphite">請求書（PDF）</label>
          {form.invoice ? (
            <div className="flex items-center gap-2 rounded-xl border border-[#e6dfcf] bg-bone px-3 py-2 text-sm">
              <a href={form.invoice.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-ink hover:underline">
                {form.invoice.name}
              </a>
              {form.invoice.uploadedAt && <span className="text-[10px] text-mist">{form.invoice.uploadedAt}</span>}
              <button
                type="button"
                onClick={async () => {
                  if (!confirm('請求書を削除しますか？')) return
                  if (form.invoice?.url) await deleteStorageObjectByUrl(form.invoice.url)
                  setForm(prev => ({ ...prev, invoice: null }))
                }}
                className="rounded-lg p-1 text-alert hover:bg-alert/5"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ) : (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-line bg-white px-3 py-2 text-xs font-medium text-matchaDeep transition hover:bg-[#eef3eb]">
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
                    const url = await uploadPurchaseOrderInvoice(file, poId || 'new')
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
          {invoiceError && <p className="mt-1 text-xs text-alert">{invoiceError}</p>}
        </div>
        <div className="md:col-span-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-graphite">支払い（分割対応）</p>
            {!hasSchedule && !hasFreeform && (
              <div className="inline-flex overflow-hidden rounded-lg border border-line text-[11px]">
                <button
                  type="button"
                  onClick={() => setPayMode('installment')}
                  className={`px-2.5 py-1 ${effectiveMode === 'installment' ? 'bg-ink text-paper' : 'bg-white text-mist hover:bg-bone'}`}
                >
                  前払金＋残金
                </button>
                <button
                  type="button"
                  onClick={() => setPayMode('free')}
                  className={`px-2.5 py-1 ${effectiveMode === 'free' ? 'bg-ink text-paper' : 'bg-white text-mist hover:bg-bone'}`}
                >
                  自由入力
                </button>
              </div>
            )}
          </div>
          {effectiveMode === 'installment' ? (
            <InstallmentScheduleEditor
              payments={form.payments ?? []}
              totalIncl={totals.totalIncl}
              onChange={next => setForm(prev => ({ ...prev, payments: next }))}
            />
          ) : (
            <PaymentsEditor
              payments={form.payments ?? []}
              totalIncl={totals.totalIncl}
              onChange={next => setForm(prev => ({ ...prev, payments: next }))}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function PoFeesSection({ form, setForm }: FormProps) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div>
        <label className="mb-1 block text-sm font-medium text-graphite">送料（税抜）</label>
        <input
          type="number"
          min="0"
          step="1"
          value={form.shippingFee ?? 0}
          onChange={e => setForm(prev => ({ ...prev, shippingFee: Number(e.target.value) || 0 }))}
          className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-graphite">諸経費（税抜）</label>
        <input
          type="number"
          min="0"
          step="1"
          value={form.otherFees ?? 0}
          onChange={e => setForm(prev => ({ ...prev, otherFees: Number(e.target.value) || 0 }))}
          className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-graphite">諸経費メモ</label>
        <input
          type="text"
          value={form.otherFeesNote ?? ''}
          onChange={e => setForm(prev => ({ ...prev, otherFeesNote: e.target.value }))}
          placeholder="例: 通関手数料"
          className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
        />
      </div>
    </div>
  )
}

export function PoNotesSection({ form, setForm }: FormProps) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-graphite">メモ</label>
      <textarea
        value={form.notes}
        onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
        rows={3}
        className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
        placeholder="発注内容のメモ"
      />
    </div>
  )
}

export function PoSummarySection({ form }: { form: PurchaseOrderInput }) {
  const t = computePoFormTotals(form)
  return (
    <div className="grid gap-3 rounded-2xl border border-line bg-bone p-4 md:grid-cols-2">
      <div>
        <p className="text-xs text-mist">合計数量</p>
        <p className="mt-1 text-lg font-semibold text-ink">{formatKg(t.totalQuantity)}</p>
      </div>
      <div>
        <p className="text-xs text-mist">合計金額（税抜）</p>
        <p className="mt-1 text-lg font-semibold text-ink">{formatCurrency(t.totalAmount)}</p>
        <p className="mt-1 text-[10px] text-mist">
          内訳: 商品 {formatCurrency(t.itemsSubtotal)} / 送料 {formatCurrency(t.shippingFee)} / 諸経費 {formatCurrency(t.otherFees)}
        </p>
        <p className="mt-1 text-[10px] text-mist">
          消費税: 10%対象 {formatCurrency(t.tax10)} / 8%対象 {formatCurrency(t.tax8)} / 合計 {formatCurrency(t.taxTotal)}
        </p>
        <p className="mt-0.5 text-[10px] text-mist">
          税込目安 {formatCurrency(t.totalIncl)}
        </p>
      </div>
    </div>
  )
}

// Build the editor's initial form state from an existing PO (or blank for new).
export function buildPoFormState(
  initial: PurchaseOrder | null,
  products: ProductWithInventory[],
  orderDate: string,
): PurchaseOrderInput {
  const defaultProductId = products[0]?.id ?? ''
  const items: PurchaseOrderLineInput[] = initial && initial.items.length > 0
    ? initial.items.map(item => ({
        productId: item.productId || undefined,
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
  return {
    supplierName: initial?.supplierName ?? '',
    items,
    shippingFee: initial?.shippingFee ?? 0,
    otherFees: initial?.otherFees ?? 0,
    otherFeesNote: initial?.otherFeesNote ?? '',
    orderDate: initial?.orderDate ?? orderDate,
    expectedDeliveryDate: initial?.expectedDeliveryDate ?? '',
    actualDeliveryDate: initial?.actualDeliveryDate ?? '',
    status: initial?.status ?? 'placed',
    paymentStatus: initial?.paymentStatus ?? 'uninvoiced',
    paymentDueDate: initial?.paymentDueDate ?? '',
    paidDate: initial?.paidDate ?? '',
    payments: initial?.payments ?? [],
    invoice: initial?.invoice,
    notes: initial?.notes ?? '',
  }
}

// Shared form-level validation (throws on invalid).
export function validatePoForm(form: PurchaseOrderInput) {
  if (!form.supplierName.trim()) throw new Error('発注先を入力してください')
  if (form.items.length === 0) throw new Error('商品を選択してください')
  if (form.items.some(i => !i.productId && !(i.productName ?? '').trim())) {
    throw new Error('商品を選択するか、新規商品名を入力してください')
  }
  if (form.items.some(i => !(Number(i.quantityKg) > 0))) {
    throw new Error('各商品の数量を入力してください')
  }
}
