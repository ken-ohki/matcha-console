'use client'

import { useMemo, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import type {
  Buyer,
  MasterEntry,
  PaymentStatus,
  ProductWithInventory,
  SaleFeeItem,
  SaleLineInput,
  SaleRecord,
  SaleRecordInput,
  SaleStatus,
  ShippingStatus,
  TaxRate,
} from '@/types'
import { COUNTRY_OPTIONS } from '@/lib/countries'
import { optionsForType, type MasterOption } from '@/lib/masters'
import { PAYMENT_METHODS } from '@/lib/payment-methods'
import { computeSaleTaxBuckets, computeTaxBuckets, defaultTaxRateForCountry, saleFeesToTaxLines, sumSaleFees } from '@/lib/tax'
import { formatCurrency, formatKg } from '@/lib/format'

// ---- labels / badges --------------------------------------------------------

export const SHIPPING_LABELS: Record<ShippingStatus, string> = {
  ordering: '発注中',
  producing: '製造中',
  ready_to_ship: '発送準備中',
  shipped: '発送完了',
}

const PAYMENT_BADGE: Record<PaymentStatus, { label: string; cls: string }> = {
  uninvoiced: { label: '未請求', cls: 'bg-slate-100 text-slate-700' },
  invoiced: { label: '請求済', cls: 'bg-amber-100 text-amber-800' },
  paid: { label: '入金済', cls: 'bg-emerald-100 text-emerald-800' },
}

const SHIPPING_BADGE: Record<ShippingStatus, string> = {
  ordering: 'bg-slate-100 text-slate-700',
  producing: 'bg-blue-100 text-blue-800',
  ready_to_ship: 'bg-amber-100 text-amber-800',
  shipped: 'bg-emerald-100 text-emerald-800',
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const m = PAYMENT_BADGE[status]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${m.cls}`}>{m.label}</span>
}

export function ShippingBadge({ status }: { status: ShippingStatus }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${SHIPPING_BADGE[status]}`}>{SHIPPING_LABELS[status]}</span>
}

// ---- form state + derived ---------------------------------------------------

export function buildSaleForm(
  initial: SaleRecord | null,
  products: ProductWithInventory[],
  matchedBuyer?: Buyer,
): SaleRecordInput {
  const defaultProductId = products[0]?.id ?? ''
  const items: SaleLineInput[] = initial && initial.items.length > 0
    ? initial.items.map(item => ({
        productId: item.productId,
        quantityKg: item.quantityKg,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate ?? 8,
      }))
    : [{
        productId: defaultProductId,
        quantityKg: 0,
        unitPrice: products.find(p => p.id === defaultProductId)?.standardWholesalePrice ?? 0,
        taxRate: 10,
      }]
  return {
    status: initial?.status ?? 'negotiating',
    paymentStatus: initial?.paymentStatus ?? 'uninvoiced',
    shippingStatus: initial?.shippingStatus ?? 'ordering',
    buyerName: initial?.buyerName ?? '',
    items,
    shippingFee: initial?.shippingFee ?? 0,
    fees: initial?.fees ? initial.fees.map(f => ({ ...f })) : [],
    paymentFee: initial?.paymentFee ?? 0,
    paymentMethod: initial?.paymentMethod ?? '',
    paymentDate: initial?.paymentDate ?? '',
    country: initial?.country ?? matchedBuyer?.country ?? '',
    dueDate: initial?.dueDate ?? '',
    terms: initial?.terms ?? matchedBuyer?.terms ?? '',
    notes: initial?.notes ?? matchedBuyer?.notes ?? '',
    shippingAddress: initial?.shippingAddress ?? '',
    shippingPostalCode: initial?.shippingPostalCode ?? '',
    shippingMethod: initial?.shippingMethod ?? '',
    shippingDate: initial?.shippingDate ?? '',
    trackingNumber: initial?.trackingNumber ?? '',
    shippingNote: initial?.shippingNote ?? '',
  }
}

export interface SaleDerived {
  revenue: number
  costAmount: number
  shippingFee: number
  paymentFee: number
  feesTotal: number
  invoiceAmount: number
  grossProfit: number
  tax10: number
  tax8: number
  taxTotal: number
  stockSummary: { productId: string; name: string; remaining: number }[]
  minRemaining: number
}

export function computeSaleDerived(
  form: SaleRecordInput,
  products: ProductWithInventory[],
  initial: SaleRecord | null,
): SaleDerived {
  const itemTotals = form.items.map(line => {
    const product = products.find(p => p.id === line.productId)
    const initialLine = initial?.items.find(i => i.productId === line.productId)
    const revenue = (Number(line.quantityKg) || 0) * (Number(line.unitPrice) || 0)
    const costPerKg = product?.purchaseUnitPrice ?? initialLine?.costPerKg ?? 0
    const costAmount = (Number(line.quantityKg) || 0) * costPerKg
    return { revenue, costAmount }
  })
  const revenue = itemTotals.reduce((s, t) => s + t.revenue, 0)
  const costAmount = itemTotals.reduce((s, t) => s + t.costAmount, 0)
  const shippingFee = Number(form.shippingFee) || 0
  const paymentFee = Number(form.paymentFee) || 0
  const feesList = form.fees ?? []
  const feesTotal = sumSaleFees(feesList)
  const taxBuckets = computeSaleTaxBuckets([...form.items, ...saleFeesToTaxLines(feesList)], shippingFee)
  const invoiceAmount = revenue + shippingFee + feesTotal
  const grossProfit = revenue - costAmount - paymentFee

  const distinctProductIds = Array.from(new Set(form.items.map(i => i.productId).filter(Boolean)))
  const stockSummary = distinctProductIds.map(pid => {
    const product = products.find(p => p.id === pid)
    const requested = form.items.filter(i => i.productId === pid).reduce((s, i) => s + (Number(i.quantityKg) || 0), 0)
    const initialAllocated = initial ? initial.items.filter(i => i.productId === pid).reduce((s, i) => s + i.quantityKg, 0) : 0
    const remaining = (product?.currentStockKg ?? 0) + initialAllocated - requested
    return { productId: pid, name: product?.name ?? '', remaining }
  })
  const minRemaining = stockSummary.length === 0 ? 0 : Math.min(...stockSummary.map(s => s.remaining))

  return { revenue, costAmount, shippingFee, paymentFee, feesTotal, invoiceAmount, grossProfit, tax10: taxBuckets.standardTax, tax8: taxBuckets.reducedTax, taxTotal: taxBuckets.tax, stockSummary, minRemaining }
}

export function validateSaleForm(form: SaleRecordInput) {
  if (!form.buyerName.trim()) throw new Error('販売先を入力してください')
  if (form.items.length === 0 || form.items.some(item => !item.productId)) {
    throw new Error('商品を選択してください')
  }
  if (form.items.some(item => !(Number(item.quantityKg) > 0))) {
    throw new Error('各商品の数量を入力してください')
  }
}

// ---- product picker (free-text search of existing products) -----------------

function productSubLabel(p: ProductWithInventory): string {
  const parts = [p.teaType, p.grade].filter(Boolean)
  const origin = (p.origins ?? []).filter(Boolean).join('・')
  if (origin) parts.push(origin)
  return parts.join(' / ')
}

export function ProductSelectCombobox({
  products,
  value,
  onSelect,
}: {
  products: ProductWithInventory[]
  value: string
  onSelect: (productId: string) => void
}) {
  const [focused, setFocused] = useState(false)
  const [query, setQuery] = useState('')

  const selected = value ? products.find(p => p.id === value) : undefined
  const displayValue = focused ? query : selected ? `${selected.name}（${selected.sku}）` : ''

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? products.filter(p =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.teaType ?? '').toLowerCase().includes(q) ||
          (p.grade ?? '').toLowerCase().includes(q) ||
          (p.origins ?? []).some(o => o.toLowerCase().includes(q)),
        )
      : products
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ja')).slice(0, 12)
  }, [products, query])

  return (
    <div className="relative">
      <input
        type="text"
        value={displayValue}
        onChange={e => { setQuery(e.target.value); setFocused(true) }}
        onFocus={() => { setQuery(''); setFocused(true) }}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="商品名・SKUで検索"
        className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
      />
      {focused && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-[#d9d1be] bg-white shadow-lg">
          {suggestions.map(p => (
            <button
              key={p.id}
              type="button"
              onMouseDown={() => { onSelect(p.id); setQuery(''); setFocused(false) }}
              className="block w-full border-b border-[#f0ebe0] px-3 py-2 text-left last:border-b-0 hover:bg-[#f7f5ee]"
            >
              <div className="text-sm font-medium text-[#173c2a]">
                {p.name}
                <span className="ml-1 text-xs font-normal text-[#9a8f76]">{p.sku}</span>
              </div>
              {productSubLabel(p) && <div className="text-[11px] text-[#68756c]">{productSubLabel(p)}</div>}
            </button>
          ))}
          {suggestions.length === 0 && (
            <div className="px-3 py-2 text-sm text-[#9a8f76]">該当する商品がありません</div>
          )}
        </div>
      )}
    </div>
  )
}

// ---- sections ---------------------------------------------------------------

type FormProps = {
  form: SaleRecordInput
  setForm: React.Dispatch<React.SetStateAction<SaleRecordInput>>
}

const fieldCls =
  'w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600'

export function SaleBasicSection({ form, setForm, buyers }: FormProps & { buyers: Buyer[] }) {
  const [buyerFocused, setBuyerFocused] = useState(false)

  const buyerSuggestions = useMemo(() => {
    const query = form.buyerName.trim().toLowerCase()
    const filtered = query ? buyers.filter(b => b.name.toLowerCase().includes(query)) : buyers
    return filtered.slice(0, 8)
  }, [buyers, form.buyerName])

  const applyBuyer = (buyer: Buyer) => {
    setForm(prev => ({
      ...prev,
      buyerName: buyer.name,
      country: buyer.country ?? prev.country,
      terms: buyer.terms ?? prev.terms,
      notes: prev.notes || buyer.notes || '',
    }))
    setBuyerFocused(false)
  }

  const handleBuyerNameChange = (buyerName: string) => {
    setForm(prev => ({ ...prev, buyerName }))
    const matched = buyers.find(b => b.name === buyerName)
    if (matched) applyBuyer(matched)
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">販売ステータス</label>
          <select
            value={form.status}
            onChange={event => setForm(prev => ({ ...prev, status: event.target.value as SaleStatus }))}
            className={fieldCls}
          >
            <option value="negotiating">商談中</option>
            <option value="confirmed">確定</option>
            <option value="cancelled">取消</option>
          </select>
        </div>
        <div className="relative">
          <label className="mb-1 block text-sm font-medium text-gray-700">販売先</label>
          <input
            required
            value={form.buyerName}
            onChange={event => handleBuyerNameChange(event.target.value)}
            onFocus={() => setBuyerFocused(true)}
            onBlur={() => window.setTimeout(() => setBuyerFocused(false), 120)}
            className={fieldCls}
            placeholder="例: Tea Atelier SORA"
          />
          {buyerFocused && buyerSuggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-10 overflow-hidden rounded-xl border border-[#d9d1be] bg-white shadow-lg">
              {buyerSuggestions.map(buyer => (
                <button
                  key={buyer.id}
                  type="button"
                  onMouseDown={event => { event.preventDefault(); applyBuyer(buyer) }}
                  className="flex w-full items-start justify-between gap-3 border-b border-[#f0ebdf] px-3 py-2.5 text-left last:border-b-0 hover:bg-[#f7f5ee]"
                >
                  <span>
                    <span className="block text-sm font-medium text-[#173c2a]">{buyer.name}</span>
                    <span className="block text-xs text-[#68756c]">{buyer.country || '国未設定'}{buyer.terms ? ` / ${buyer.terms}` : ''}</span>
                  </span>
                  <span className="shrink-0 text-xs text-[#68756c]">{buyer.saleCount}件</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {buyers.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-[#68756c]">最近の販売先</p>
          <div className="flex flex-wrap gap-2">
            {buyers.slice(0, 6).map(buyer => (
              <button
                key={buyer.id}
                type="button"
                onClick={() => applyBuyer(buyer)}
                className="rounded-full border border-[#d9d1be] bg-[#f7f5ee] px-3 py-1.5 text-xs text-[#173c2a] transition hover:border-[#b5aa90] hover:bg-white"
              >
                {buyer.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function SaleItemsSection({
  form,
  setForm,
  products,
  initial,
}: FormProps & { products: ProductWithInventory[]; initial: SaleRecord | null }) {
  const revenue = form.items.reduce((s, l) => s + (Number(l.quantityKg) || 0) * (Number(l.unitPrice) || 0), 0)

  const updateItem = (index: number, patch: Partial<SaleLineInput>) => {
    setForm(prev => ({ ...prev, items: prev.items.map((item, i) => i === index ? { ...item, ...patch } : item) }))
  }
  const handleItemProductChange = (index: number, productId: string) => {
    const product = products.find(item => item.id === productId)
    setForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) => i === index ? { ...item, productId, unitPrice: product?.standardWholesalePrice ?? item.unitPrice } : item),
    }))
  }
  const addItem = () => {
    const defaultPid = products[0]?.id ?? ''
    const defaultPrice = products[0]?.standardWholesalePrice ?? 0
    setForm(prev => ({
      ...prev,
      items: [...prev.items, { productId: defaultPid, quantityKg: 0, unitPrice: defaultPrice, taxRate: defaultTaxRateForCountry(prev.country) }],
    }))
  }
  const removeItem = (index: number) => {
    setForm(prev => ({ ...prev, items: prev.items.length <= 1 ? prev.items : prev.items.filter((_, i) => i !== index) }))
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">商品</label>
        <span className="text-xs text-[#68756c]">合計 {formatCurrency(revenue)}</span>
      </div>
      <div className="space-y-2">
        {form.items.map((line, index) => {
          const lineRevenue = (Number(line.quantityKg) || 0) * (Number(line.unitPrice) || 0)
          const lineRate = line.taxRate ?? 8
          const lineIncl = computeTaxBuckets([line]).total
          const lineProduct = products.find(p => p.id === line.productId)
          const lineInitial = initial?.items.find(i => i.productId === line.productId)
          const lineCostPerKg = lineProduct?.purchaseUnitPrice ?? lineInitial?.costPerKg ?? 0
          const lineCost = (Number(line.quantityKg) || 0) * lineCostPerKg
          const lineProfit = lineRevenue - lineCost
          const lineMargin = lineRevenue > 0 ? (lineProfit / lineRevenue) * 100 : null
          return (
            <div key={index} className="grid gap-2 rounded-xl border border-[#e6dfcf] bg-[#faf8f2] p-3 md:grid-cols-[1.3fr,0.6fr,0.7fr,0.55fr,auto,auto]">
              <ProductSelectCombobox
                products={products}
                value={line.productId}
                onSelect={pid => handleItemProductChange(index, pid)}
              />
              <input
                required
                type="number"
                min="0.1"
                step="0.1"
                value={line.quantityKg}
                placeholder="数量 (kg)"
                onChange={event => updateItem(index, { quantityKg: Number(event.target.value) || 0 })}
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <input
                required
                type="number"
                min="0"
                step="1"
                value={line.unitPrice}
                placeholder="税抜単価"
                onChange={event => updateItem(index, { unitPrice: Number(event.target.value) || 0 })}
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
              <select
                value={lineRate}
                onChange={event => {
                  const v = Number(event.target.value)
                  updateItem(index, { taxRate: v === 0 ? 0 : v === 10 ? 10 : 8 })
                }}
                title="消費税区分"
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value={0}>免税</option>
                <option value={8}>8%軽減</option>
                <option value={10}>10%</option>
              </select>
              <div className="flex flex-col items-end justify-center text-xs md:px-2">
                <span className="font-medium text-[#173c2a]">{formatCurrency(lineIncl)}</span>
                <span className="text-[10px] text-[#68756c]">税抜 {formatCurrency(lineRevenue)}</span>
                <span className={`text-[10px] ${lineProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  粗利 {formatCurrency(lineProfit)}{lineMargin != null && ` (${lineMargin.toFixed(1)}%)`}
                </span>
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
  )
}

export function SaleTermsSection({ form, setForm, masters }: FormProps & { masters: MasterEntry[] }) {
  const termsOptions = useMemo(() => optionsForType(masters, 'terms'), [masters])
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">国</label>
          <select
            required
            value={form.country}
            onChange={event => setForm(prev => ({ ...prev, country: event.target.value }))}
            className={fieldCls}
          >
            <option value="">選択してください</option>
            {COUNTRY_OPTIONS.map(option => (
              <option key={option.code} value={option.name}>{option.name}</option>
            ))}
            {form.country && !COUNTRY_OPTIONS.some(c => c.name === form.country) && (
              <option value={form.country}>{form.country}（未登録）</option>
            )}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">納期</label>
          <input
            type="date"
            value={form.dueDate}
            onChange={event => setForm(prev => ({ ...prev, dueDate: event.target.value }))}
            className={fieldCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">取引条件</label>
          <select
            value={form.terms ?? ''}
            onChange={event => setForm(prev => ({ ...prev, terms: event.target.value }))}
            className={fieldCls}
          >
            <option value="">未選択</option>
            {termsOptions.map(option => (
              <option key={option.value} value={option.value}>{option.label || option.value}</option>
            ))}
            {form.terms && !termsOptions.some(o => o.value === form.terms) && (
              <option value={form.terms}>{form.terms}（未登録）</option>
            )}
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">メモ</label>
        <textarea
          value={form.notes}
          onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))}
          rows={3}
          className={fieldCls}
          placeholder="商談の補足や条件など"
        />
      </div>
    </div>
  )
}

export function SaleFeesSection({ form, setForm }: FormProps) {
  const feesList = form.fees ?? []
  const addFee = () => setForm(prev => ({ ...prev, fees: [...(prev.fees ?? []), { name: '', quantity: 1, unit: '式', unitPrice: 0, taxRate: 10 }] }))
  const updateFee = (index: number, patch: Partial<SaleFeeItem>) =>
    setForm(prev => ({ ...prev, fees: (prev.fees ?? []).map((f, i) => i === index ? { ...f, ...patch } : f) }))
  const removeFee = (index: number) =>
    setForm(prev => ({ ...prev, fees: (prev.fees ?? []).filter((_, i) => i !== index) }))

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700">諸費用（包装代・手数料など・請求額に加算）</label>
        <button
          type="button"
          onClick={addFee}
          className="inline-flex items-center gap-1 rounded-lg border border-[#d9d1be] bg-white px-3 py-1.5 text-xs font-medium text-[#174c33] transition hover:bg-[#ece8db]"
        >
          <Plus size={14} /> 諸費用を追加
        </button>
      </div>
      {feesList.length === 0 ? (
        <p className="text-[11px] text-[#9aa39a]">包装代・通関手数料などを、商品と同じように項目ごとに追加できます。</p>
      ) : (
        <div className="space-y-2">
          {feesList.map((fee, index) => (
            <div key={index} className="grid gap-2 rounded-xl border border-[#e6dfcf] bg-[#faf8f2] p-3 md:grid-cols-[1.3fr,0.6fr,0.55fr,0.7fr,0.55fr,auto]">
              <input
                type="text"
                value={fee.name}
                onChange={e => updateFee(index, { name: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                placeholder="項目名（例: 包装代）"
              />
              <input
                type="number"
                min="0"
                step="0.1"
                value={fee.quantity}
                onChange={e => updateFee(index, { quantity: Number(e.target.value) || 0 })}
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                placeholder="数量"
              />
              <input
                type="text"
                value={fee.unit}
                onChange={e => updateFee(index, { unit: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                placeholder="単位"
              />
              <input
                type="number"
                min="0"
                step="1"
                value={fee.unitPrice}
                onChange={e => updateFee(index, { unitPrice: Number(e.target.value) || 0 })}
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-right text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                placeholder="単価"
              />
              <select
                value={fee.taxRate}
                onChange={e => updateFee(index, { taxRate: Number(e.target.value) as TaxRate })}
                title="消費税区分"
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value={10}>10%</option>
                <option value={8}>8%軽減</option>
                <option value={0}>免税</option>
              </select>
              <button
                type="button"
                onClick={() => removeFee(index)}
                className="self-center rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-red-600"
                aria-label="削除"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// readOnly: 詳細ページの「商品・金額」タブで使用。送料・支払手数料は表示のみ
// （送料は発送タブ、支払手数料は請求・入金タブで編集）。作成モーダルでは編集可。
export function SaleChargesSection({ form, setForm, derived, readOnly = false }: FormProps & { derived: SaleDerived; readOnly?: boolean }) {
  const readOnlyBox = 'mt-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-[#173c2a]'
  return (
    <div className="rounded-2xl border border-[#d9d1be] bg-white p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#68756c]">費用・請求</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">送料{readOnly && '（発送タブで編集）'}</label>
          {readOnly ? (
            <div className={readOnlyBox}>{formatCurrency(form.shippingFee ?? 0)}</div>
          ) : (
            <input type="number" min="0" step="1" value={form.shippingFee ?? 0}
              onChange={event => setForm(prev => ({ ...prev, shippingFee: Number(event.target.value) || 0 }))}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">支払手数料（粗利から差引）{readOnly && '（請求・入金タブで編集）'}</label>
          {readOnly ? (
            <div className={readOnlyBox}>{formatCurrency(form.paymentFee ?? 0)}</div>
          ) : (
            <input type="number" min="0" step="1" value={form.paymentFee ?? 0}
              onChange={event => setForm(prev => ({ ...prev, paymentFee: Number(event.target.value) || 0 }))}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600" />
          )}
        </div>
        {!readOnly && (
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">支払い方法</label>
            <select value={form.paymentMethod ?? ''}
              onChange={event => setForm(prev => ({ ...prev, paymentMethod: event.target.value || undefined }))}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600">
              <option value="">未設定</option>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              {form.paymentMethod && !PAYMENT_METHODS.includes(form.paymentMethod as never) && (
                <option value={form.paymentMethod}>{form.paymentMethod}</option>
              )}
            </select>
          </div>
        )}
        <div className="md:col-span-2">
          <p className="mb-1 text-xs font-medium text-gray-700">請求額（税込・自動）</p>
          <p className="mt-1 rounded-xl border border-dashed border-[#d9d1be] bg-[#f7f5ee] px-3 py-2 text-base font-semibold text-[#173c2a]">
            {formatCurrency(derived.invoiceAmount + derived.taxTotal)}
            <span className="ml-2 text-[11px] font-normal text-[#68756c]">税抜 {formatCurrency(derived.invoiceAmount)}</span>
          </p>
          <p className="mt-1 text-[10px] text-[#68756c]">商品代金 + 送料{derived.feesTotal > 0 ? ' + 諸費用' : ''}</p>
          <p className="mt-1 text-[10px] text-[#68756c]">消費税: 10%対象 {formatCurrency(derived.tax10)} / 8%対象 {formatCurrency(derived.tax8)} / 合計 {formatCurrency(derived.taxTotal)}</p>
        </div>
      </div>
    </div>
  )
}

export function SalePaymentSection({ form, setForm }: FormProps) {
  return (
    <div className="rounded-2xl border border-[#d9d1be] bg-white p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#68756c]">請求・入金</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">支払いステータス</label>
          <select value={form.paymentStatus}
            onChange={e => setForm(p => ({ ...p, paymentStatus: e.target.value as PaymentStatus }))}
            className={fieldCls}>
            <option value="uninvoiced">未請求</option>
            <option value="invoiced">請求済</option>
            <option value="paid">入金済</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">支払い方法</label>
          <select value={form.paymentMethod ?? ''}
            onChange={e => setForm(p => ({ ...p, paymentMethod: e.target.value || undefined }))}
            className={fieldCls}>
            <option value="">未設定</option>
            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            {form.paymentMethod && !PAYMENT_METHODS.includes(form.paymentMethod as never) && (
              <option value={form.paymentMethod}>{form.paymentMethod}</option>
            )}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">支払期日</label>
          <input type="date" value={form.dueDate ?? ''}
            onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} className={fieldCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">入金日</label>
          <input type="date" value={form.paymentDate ?? ''}
            onChange={e => setForm(p => ({ ...p, paymentDate: e.target.value }))} className={fieldCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">支払手数料（粗利から差引）</label>
          <input type="number" min="0" step="1" value={form.paymentFee ?? 0}
            onChange={e => setForm(p => ({ ...p, paymentFee: Number(e.target.value) || 0 }))} className={fieldCls} />
        </div>
      </div>
    </div>
  )
}

export function SaleShippingSection({ form, setForm, buyerShippingAddress, shippingMethods }: FormProps & { buyerShippingAddress?: string; shippingMethods?: MasterOption[] }) {
  return (
    <div className="rounded-2xl border border-[#d9d1be] bg-white p-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#68756c]">発送</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">発送ステータス</label>
          <select value={form.shippingStatus}
            onChange={e => setForm(p => ({ ...p, shippingStatus: e.target.value as ShippingStatus }))}
            className={fieldCls}>
            {(Object.keys(SHIPPING_LABELS) as ShippingStatus[]).map(k => (
              <option key={k} value={k}>{SHIPPING_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">送料</label>
          <input type="number" min="0" step="1" value={form.shippingFee ?? 0}
            onChange={e => setForm(p => ({ ...p, shippingFee: Number(e.target.value) || 0 }))} className={fieldCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">発送方法</label>
          {shippingMethods && shippingMethods.length > 0 ? (
            <select value={form.shippingMethod ?? ''} onChange={e => setForm(p => ({ ...p, shippingMethod: e.target.value }))} className={fieldCls}>
              <option value="">未設定</option>
              {shippingMethods.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              {form.shippingMethod && !shippingMethods.some(o => o.value === form.shippingMethod) && (
                <option value={form.shippingMethod}>{form.shippingMethod}（未登録）</option>
              )}
            </select>
          ) : (
            <input value={form.shippingMethod ?? ''}
              onChange={e => setForm(p => ({ ...p, shippingMethod: e.target.value }))} className={fieldCls} placeholder="例: ヤマト宅急便" />
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">発送日</label>
          <input type="date" value={form.shippingDate ?? ''}
            onChange={e => setForm(p => ({ ...p, shippingDate: e.target.value }))} className={fieldCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">追跡番号</label>
          <input value={form.trackingNumber ?? ''}
            onChange={e => setForm(p => ({ ...p, trackingNumber: e.target.value }))} className={fieldCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">郵便番号</label>
          <input value={form.shippingPostalCode ?? ''}
            onChange={e => setForm(p => ({ ...p, shippingPostalCode: e.target.value }))} className={fieldCls} placeholder="〒" />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-700">発送先</label>
          <textarea rows={2} value={form.shippingAddress ?? ''}
            onChange={e => setForm(p => ({ ...p, shippingAddress: e.target.value }))}
            className={fieldCls} placeholder={buyerShippingAddress || '住所'} />
        </div>
        <div className="md:col-span-2">
          <label className="mb-1 block text-xs font-medium text-gray-700">発送担当者へのメモ</label>
          <textarea rows={2} value={form.shippingNote ?? ''}
            onChange={e => setForm(p => ({ ...p, shippingNote: e.target.value }))}
            className="w-full rounded-xl border border-amber-300 bg-amber-50/40 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            placeholder="例: ギフト包装、納品書同梱不可、冷蔵便 など（発送管理に表示されます）" />
        </div>
      </div>
    </div>
  )
}

export function SaleSummarySection({ derived }: { derived: SaleDerived }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-[#d9d1be] bg-[#f7f5ee] p-4 md:grid-cols-6">
      <div>
        <p className="text-xs text-[#68756c]">商品代金</p>
        <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(derived.revenue)}</p>
      </div>
      <div>
        <p className="text-xs text-[#68756c]">原価</p>
        <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(derived.costAmount)}</p>
      </div>
      <div>
        <p className="text-xs text-[#68756c]">請求額（税込）</p>
        <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(derived.invoiceAmount + derived.taxTotal)}</p>
        <p className="text-[10px] text-[#68756c]">税抜 {formatCurrency(derived.invoiceAmount)}</p>
      </div>
      <div>
        <p className="text-xs text-[#68756c]">粗利</p>
        <p className={`mt-1 text-lg font-semibold ${derived.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{formatCurrency(derived.grossProfit)}</p>
      </div>
      <div>
        <p className="text-xs text-[#68756c]">粗利率</p>
        <p className={`mt-1 text-lg font-semibold ${derived.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          {derived.revenue > 0 ? `${((derived.grossProfit / derived.revenue) * 100).toFixed(1)}%` : '-'}
        </p>
      </div>
      <div>
        <p className="text-xs text-[#68756c]">登録後の残在庫（最少）</p>
        <p className={`mt-1 text-lg font-semibold ${derived.minRemaining < 0 ? 'text-red-700' : 'text-[#173c2a]'}`}>{formatKg(derived.minRemaining)}</p>
        {derived.minRemaining < 0 && (
          <p className="mt-1 text-[10px] font-medium text-red-700">在庫不足（マイナス）ですが登録できます。入荷後に解消されます。</p>
        )}
        {derived.stockSummary.length > 1 && (
          <p className="mt-1 text-[10px] text-[#68756c]">{derived.stockSummary.map(s => `${s.name}: ${s.remaining.toFixed(1)}kg`).join(' / ')}</p>
        )}
      </div>
    </div>
  )
}
