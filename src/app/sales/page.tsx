'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { PageTabs, SALES_TABS } from '@/components/layout/PageTabs'
import { KPICard } from '@/components/ui/KPICard'
import { SalesStatusBadge } from '@/components/ui/StatusBadge'
import { getServices } from '@/lib/services'
import type { Buyer, MasterEntry, PaymentStatus, ProductWithInventory, SaleLineInput, SaleRecord, SaleRecordInput, SaleStatus, ShippingStatus } from '@/types'
import { COUNTRY_OPTIONS } from '@/lib/countries'
import { optionsForType } from '@/lib/masters'
import {
  CircleDollarSign,
  ClipboardPenLine,
  Copy,
  FileText,
  Package2,
  Percent,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'

type ViewMode = 'list' | 'by-month' | 'by-fiscal' | 'by-country' | 'by-product'

interface AggregateRow {
  key: string
  label: string
  count: number
  quantityKg: number
  revenue: number
  costAmount: number
  grossProfit: number
}

function fiscalYearOf(date: Date): number {
  const year = date.getFullYear()
  const month = date.getMonth() // 0-11
  return month >= 3 ? year : year - 1 // Apr (3) - Mar
}

function aggregateSales(records: SaleRecord[], keyFn: (r: SaleRecord) => { key: string; label: string }): AggregateRow[] {
  const groups = new Map<string, AggregateRow>()
  for (const r of records) {
    const { key, label } = keyFn(r)
    const existing = groups.get(key) ?? { key, label, count: 0, quantityKg: 0, revenue: 0, costAmount: 0, grossProfit: 0 }
    existing.count += 1
    existing.quantityKg += r.quantityKg
    existing.revenue += r.revenue
    existing.costAmount += r.costAmount
    existing.grossProfit += r.grossProfit
    groups.set(key, existing)
  }
  return [...groups.values()]
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

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  uninvoiced: '未請求',
  invoiced: '請求済',
  paid: '支払済',
}
const PAYMENT_COLORS: Record<PaymentStatus, string> = {
  uninvoiced: 'bg-gray-100 text-gray-700',
  invoiced: 'bg-amber-100 text-amber-800',
  paid: 'bg-emerald-100 text-emerald-800',
}
const SHIPPING_LABELS: Record<ShippingStatus, string> = {
  ordering: '発注中',
  producing: '製造中',
  ready_to_ship: '発送準備中',
  shipped: '発送完了',
}
const SHIPPING_COLORS: Record<ShippingStatus, string> = {
  ordering: 'bg-slate-100 text-slate-700',
  producing: 'bg-blue-100 text-blue-800',
  ready_to_ship: 'bg-amber-100 text-amber-800',
  shipped: 'bg-emerald-100 text-emerald-800',
}

function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${PAYMENT_COLORS[status]}`}>
      {PAYMENT_LABELS[status]}
    </span>
  )
}
function ShippingBadge({ status }: { status: ShippingStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${SHIPPING_COLORS[status]}`}>
      {SHIPPING_LABELS[status]}
    </span>
  )
}

function getStatusLabel(status: SaleStatus): string {
  if (status === 'confirmed') return '確定'
  if (status === 'cancelled') return '取消'
  return '商談中'
}

function statusColor(status: SaleStatus): string {
  if (status === 'confirmed') return '#2f5d26'
  if (status === 'cancelled') return '#c6c6c6'
  return '#7dbb57'
}

function SaleModal({
  open,
  buyers,
  products,
  masters,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  buyers: Buyer[]
  products: ProductWithInventory[]
  masters: MasterEntry[]
  initial: SaleRecord | null
  onClose: () => void
  onSave: (input: SaleRecordInput) => Promise<void>
}) {
  const termsOptions = useMemo(() => optionsForType(masters, 'terms'), [masters])
  const defaultProductId = products[0]?.id ?? ''
  const [buyerFocused, setBuyerFocused] = useState(false)
  const [form, setForm] = useState<SaleRecordInput>({
    status: 'negotiating',
    paymentStatus: 'uninvoiced',
    shippingStatus: 'ordering',
    buyerName: '',
    items: [{ productId: defaultProductId, quantityKg: 0, unitPrice: 0, taxRate: 8 }],
    shippingFee: 0,
    otherFees: 0,
    otherFeesNote: '',
    paymentFee: 0,
    country: '',
    dueDate: '',
    terms: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return

    const matchedBuyer = buyers.find(buyer => buyer.name === (initial?.buyerName ?? ''))
    const initialItems: SaleLineInput[] = initial && initial.items.length > 0
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

    setForm({
      status: initial?.status ?? 'negotiating',
      paymentStatus: initial?.paymentStatus ?? 'uninvoiced',
      shippingStatus: initial?.shippingStatus ?? 'ordering',
      buyerName: initial?.buyerName ?? '',
      items: initialItems,
      shippingFee: initial?.shippingFee ?? 0,
      otherFees: initial?.otherFees ?? 0,
      otherFeesNote: initial?.otherFeesNote ?? '',
      paymentFee: initial?.paymentFee ?? 0,
      country: initial?.country ?? matchedBuyer?.country ?? '',
      dueDate: initial?.dueDate ?? '',
      terms: initial?.terms ?? matchedBuyer?.terms ?? '',
      notes: initial?.notes ?? matchedBuyer?.notes ?? '',
    })
    setError('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const itemTotals = form.items.map(line => {
    const product = products.find(p => p.id === line.productId)
    const initialLine = initial?.items.find(i => i.productId === line.productId)
    const revenue = (Number(line.quantityKg) || 0) * (Number(line.unitPrice) || 0)
    const costPerKg = product?.purchaseUnitPrice ?? initialLine?.costPerKg ?? 0
    const costAmount = (Number(line.quantityKg) || 0) * costPerKg
    const taxRate = line.taxRate ?? 8
    return { revenue, costAmount, product, taxRate }
  })
  const revenue = itemTotals.reduce((s, t) => s + t.revenue, 0)
  const costAmount = itemTotals.reduce((s, t) => s + t.costAmount, 0)
  const subtotal10 = itemTotals.filter(t => t.taxRate === 10).reduce((s, t) => s + t.revenue, 0)
  const subtotal8 = itemTotals.filter(t => t.taxRate === 8).reduce((s, t) => s + t.revenue, 0)
  const tax10 = Math.floor(subtotal10 * 0.10)
  const tax8 = Math.floor(subtotal8 * 0.08)
  const taxTotal = tax10 + tax8
  const shippingFeeNum = Number(form.shippingFee) || 0
  const otherFeesNum = Number(form.otherFees) || 0
  const paymentFeeNum = Number(form.paymentFee) || 0
  const invoiceAmount = revenue + shippingFeeNum + otherFeesNum
  const grossProfit = revenue - costAmount - paymentFeeNum
  // Stock remaining: sum across distinct products
  const distinctProductIds = Array.from(new Set(form.items.map(i => i.productId).filter(Boolean)))
  const stockSummary = distinctProductIds.map(pid => {
    const product = products.find(p => p.id === pid)
    const requested = form.items
      .filter(i => i.productId === pid)
      .reduce((s, i) => s + (Number(i.quantityKg) || 0), 0)
    const initialAllocated = initial
      ? initial.items.filter(i => i.productId === pid).reduce((s, i) => s + i.quantityKg, 0)
      : 0
    const remaining = (product?.currentStockKg ?? 0) + initialAllocated - requested
    return { productId: pid, name: product?.name ?? '', remaining }
  })
  const minRemaining = stockSummary.length === 0 ? 0 : Math.min(...stockSummary.map(s => s.remaining))
  const buyerSuggestions = useMemo(() => {
    const query = form.buyerName.trim().toLowerCase()
    const filtered = query
      ? buyers.filter(buyer => buyer.name.toLowerCase().includes(query))
      : buyers

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

  const updateItem = (index: number, patch: Partial<SaleLineInput>) => {
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
        unitPrice: product?.standardWholesalePrice ?? item.unitPrice,
      } : item),
    }))
  }
  const addItem = () => {
    const defaultPid = products[0]?.id ?? ''
    const defaultPrice = products[0]?.standardWholesalePrice ?? 0
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

  const handleBuyerNameChange = (buyerName: string) => {
    setForm(prev => ({ ...prev, buyerName }))
    const matched = buyers.find(buyer => buyer.name === buyerName)
    if (matched) applyBuyer(matched)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
      if (form.items.length === 0 || form.items.some(item => !item.productId)) {
        throw new Error('商品を選択してください')
      }
      if (form.items.some(item => !(Number(item.quantityKg) > 0))) {
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
            <h2 className="text-xl font-semibold text-[#173c2a]">{initial ? '販売案件を編集' : '販売案件を登録'}</h2>
            <p className="text-sm text-[#68756c] mt-1">登録済みの販売先は候補から再利用できます。</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">販売ステータス</label>
              <select
                value={form.status}
                onChange={event => setForm(prev => ({ ...prev, status: event.target.value as SaleStatus }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
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
                onBlur={() => {
                  window.setTimeout(() => setBuyerFocused(false), 120)
                }}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                placeholder="例: Tea Atelier SORA"
              />
              {buyerFocused && buyerSuggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-10 overflow-hidden rounded-xl border border-[#d9d1be] bg-white shadow-lg">
                  {buyerSuggestions.map(buyer => (
                    <button
                      key={buyer.id}
                      type="button"
                      onMouseDown={event => {
                        event.preventDefault()
                        applyBuyer(buyer)
                      }}
                      className="flex w-full items-start justify-between gap-3 border-b border-[#f0ebdf] px-3 py-2.5 text-left last:border-b-0 hover:bg-[#f7f5ee]"
                    >
                      <span>
                        <span className="block text-sm font-medium text-[#173c2a]">{buyer.name}</span>
                        <span className="block text-xs text-[#68756c]">
                          {buyer.country || '国未設定'}
                          {buyer.terms ? ` / ${buyer.terms}` : ''}
                        </span>
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

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-700">商品</label>
              <span className="text-xs text-[#68756c]">合計 {formatCurrency(revenue)}</span>
            </div>
            <div className="space-y-2">
              {form.items.map((line, index) => {
                const lineRevenue = (Number(line.quantityKg) || 0) * (Number(line.unitPrice) || 0)
                const lineRate = line.taxRate ?? 8
                const lineTax = lineRate === 0 ? 0 : Math.floor(lineRevenue * (lineRate === 8 ? 0.08 : 0.10))
                const lineIncl = lineRevenue + lineTax
                return (
                  <div key={index} className="grid gap-2 rounded-xl border border-[#e6dfcf] bg-[#faf8f2] p-3 md:grid-cols-[1.3fr,0.6fr,0.7fr,0.55fr,auto,auto]">
                    <select
                      value={line.productId}
                      onChange={event => handleItemProductChange(index, event.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    >
                      <option value="">選択してください</option>
                      {[...products]
                        .sort((a, b) => a.name.localeCompare(b.name, 'en'))
                        .map(product => (
                          <option key={product.id} value={product.id}>
                            {product.name} ({product.sku})
                          </option>
                        ))}
                    </select>
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
              <label className="mb-1 block text-sm font-medium text-gray-700">国</label>
              <select
                required
                value={form.country}
                onChange={event => setForm(prev => ({ ...prev, country: event.target.value }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
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
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">取引条件</label>
              <select
                value={form.terms ?? ''}
                onChange={event => setForm(prev => ({ ...prev, terms: event.target.value }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="">未選択</option>
                {termsOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label || option.value}
                  </option>
                ))}
                {form.terms && !termsOptions.some(o => o.value === form.terms) && (
                  <option value={form.terms}>{form.terms}（未登録）</option>
                )}
              </select>
              {termsOptions.length === 0 && (
                <p className="mt-1 text-[11px] text-amber-700">
                  設定 → マスター管理 → 取引条件 で項目を登録してください
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">メモ</label>
            <textarea
              value={form.notes}
              onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))}
              rows={3}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              placeholder="商談の補足や条件など"
            />
          </div>

          <div className="rounded-2xl border border-[#d9d1be] bg-white p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#68756c]">費用・請求</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">送料</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.shippingFee ?? 0}
                  onChange={event => setForm(prev => ({ ...prev, shippingFee: Number(event.target.value) || 0 }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">諸費用</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.otherFees ?? 0}
                  onChange={event => setForm(prev => ({ ...prev, otherFees: Number(event.target.value) || 0 }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-700">諸費用メモ</label>
                <input
                  type="text"
                  value={form.otherFeesNote ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, otherFeesNote: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  placeholder="例: 通関手数料、梱包資材費 など"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">支払手数料（粗利から差引）</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.paymentFee ?? 0}
                  onChange={event => setForm(prev => ({ ...prev, paymentFee: Number(event.target.value) || 0 }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-gray-700">請求額（税抜・自動）</p>
                <p className="mt-1 rounded-xl border border-dashed border-[#d9d1be] bg-[#f7f5ee] px-3 py-2 text-sm font-semibold text-[#173c2a]">
                  {formatCurrency(invoiceAmount)}
                </p>
                <p className="mt-1 text-[10px] text-[#68756c]">商品代金 + 送料 + 諸費用</p>
                <p className="mt-1 text-[10px] text-[#68756c]">
                  消費税: 10%対象 {formatCurrency(tax10)} / 8%対象 {formatCurrency(tax8)} / 合計 {formatCurrency(taxTotal)}
                </p>
                <p className="mt-0.5 text-[10px] text-[#68756c]">
                  税込目安 {formatCurrency(invoiceAmount + taxTotal)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 rounded-2xl border border-[#d9d1be] bg-[#f7f5ee] p-4 md:grid-cols-5">
            <div>
              <p className="text-xs text-[#68756c]">商品代金</p>
              <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(revenue)}</p>
            </div>
            <div>
              <p className="text-xs text-[#68756c]">原価</p>
              <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(costAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-[#68756c]">請求額（税抜）</p>
              <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(invoiceAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-[#68756c]">粗利</p>
              <p className="mt-1 text-lg font-semibold text-emerald-700">{formatCurrency(grossProfit)}</p>
            </div>
            <div>
              <p className="text-xs text-[#68756c]">登録後の残在庫（最少）</p>
              <p className={`mt-1 text-lg font-semibold ${minRemaining < 0 ? 'text-red-700' : 'text-[#173c2a]'}`}>
                {formatKg(minRemaining)}
              </p>
              {stockSummary.length > 1 && (
                <p className="mt-1 text-[10px] text-[#68756c]">
                  {stockSummary.map(s => `${s.name}: ${s.remaining.toFixed(1)}kg`).join(' / ')}
                </p>
              )}
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

export default function SalesPage() {
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [masters, setMasters] = useState<MasterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilters, setStatusFilters] = useState<Set<SaleStatus>>(new Set())
  const [buyerFilters, setBuyerFilters] = useState<Set<string>>(new Set())
  const [countryFilters, setCountryFilters] = useState<Set<string>>(new Set())
  const [productFilters, setProductFilters] = useState<Set<string>>(new Set())
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSale, setEditingSale] = useState<SaleRecord | null>(null)
  const [prefillSale, setPrefillSale] = useState<SaleRecord | null>(null)
  const [detailSaleId, setDetailSaleId] = useState<string | null>(null)

  const handleDuplicate = (record: SaleRecord) => {
    setEditingSale(null)
    setPrefillSale({
      ...record,
      id: '',
      status: 'negotiating',
      paymentStatus: 'uninvoiced',
      shippingStatus: 'ordering',
      dueDate: undefined,
      notes: record.notes ? `${record.notes}（複製）` : '複製',
    })
    setModalOpen(true)
  }
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const [nextSales, nextBuyers, nextProducts, nextMasters] = await Promise.all([
      services.sales.getSaleRecords(),
      services.sales.getBuyers(),
      services.inventory.getProductsWithInventory(),
      services.masters.listMasters(),
    ])
    setSales(nextSales)
    setBuyers(nextBuyers)
    setProducts(nextProducts)
    setMasters(nextMasters)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    const handler = () => {
      if (modalOpen) return
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', handler)
    window.addEventListener('focus', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen])

  const filteredSales = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fromTime = dateFrom ? new Date(dateFrom).getTime() : null
    const toTime = dateTo ? new Date(dateTo).getTime() + 24 * 60 * 60 * 1000 - 1 : null
    return sales.filter(record => {
      if (statusFilters.size > 0 && !statusFilters.has(record.status)) return false
      if (buyerFilters.size > 0 && !buyerFilters.has(record.buyerName)) return false
      if (countryFilters.size > 0 && !countryFilters.has(record.country || '(未設定)')) return false
      if (productFilters.size > 0) {
        const matched = record.items.some(item => productFilters.has(item.productSku || item.productId))
        if (!matched) return false
      }
      const t = record.createdAt.getTime()
      if (fromTime != null && t < fromTime) return false
      if (toTime != null && t > toTime) return false
      if (!q) return true
      return (
        record.buyerName.toLowerCase().includes(q) ||
        record.country.toLowerCase().includes(q) ||
        record.items.some(item =>
          item.productName.toLowerCase().includes(q) ||
          item.productSku.toLowerCase().includes(q)
        )
      )
    })
  }, [sales, search, statusFilters, buyerFilters, countryFilters, productFilters, dateFrom, dateTo])

  // Statistics exclude cancelled deals (取消)
  const analyticsSales = useMemo(() => filteredSales.filter(s => s.status !== 'cancelled'), [filteredSales])

  const aggregations = useMemo(() => ({
    monthly: aggregateSales(analyticsSales, r => {
      const d = r.createdAt
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      return { key, label: key }
    }).sort((a, b) => b.key.localeCompare(a.key)),
    fiscal: aggregateSales(analyticsSales, r => {
      const fy = fiscalYearOf(r.createdAt)
      return { key: String(fy), label: `FY${fy}（${fy}/4 - ${fy + 1}/3）` }
    }).sort((a, b) => b.key.localeCompare(a.key)),
    country: aggregateSales(analyticsSales, r => ({ key: r.country || '(未設定)', label: r.country || '(未設定)' }))
      .sort((a, b) => b.revenue - a.revenue),
    product: (() => {
      const groups = new Map<string, AggregateRow>()
      for (const sale of analyticsSales) {
        const seenInSale = new Set<string>()
        for (const item of sale.items) {
          const key = `${item.productSku || item.productId}::${item.productName}`
          const label = item.productName
          const existing = groups.get(key) ?? { key, label, count: 0, quantityKg: 0, revenue: 0, costAmount: 0, grossProfit: 0 }
          // Count each sale once per product
          if (!seenInSale.has(key)) {
            existing.count += 1
            seenInSale.add(key)
          }
          existing.quantityKg += item.quantityKg
          existing.revenue += item.revenue
          existing.costAmount += item.costAmount
          existing.grossProfit += item.grossProfit
          groups.set(key, existing)
        }
      }
      return [...groups.values()].sort((a, b) => b.revenue - a.revenue)
    })(),
  }), [analyticsSales])

  const filterOptions = useMemo(() => {
    const buyers = new Set<string>()
    const countries = new Set<string>()
    const products = new Map<string, string>() // key → label
    for (const r of sales) {
      if (r.buyerName) buyers.add(r.buyerName)
      countries.add(r.country || '(未設定)')
      for (const item of r.items) {
        const key = item.productSku || item.productId
        products.set(key, `${item.productName}${item.productSku ? ` (${item.productSku})` : ''}`)
      }
    }
    return {
      buyers: [...buyers].sort(),
      countries: [...countries].sort(),
      products: [...products.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label)),
    }
  }, [sales])

  const activeFilterCount =
    statusFilters.size + buyerFilters.size + countryFilters.size + productFilters.size +
    (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)

  const toggleSetItem = <T,>(setter: (next: Set<T>) => void, current: Set<T>, item: T) => {
    const next = new Set(current)
    if (next.has(item)) next.delete(item)
    else next.add(item)
    setter(next)
  }

  const resetFilters = () => {
    setStatusFilters(new Set())
    setBuyerFilters(new Set())
    setCountryFilters(new Set())
    setProductFilters(new Set())
    setDateFrom('')
    setDateTo('')
    setSearch('')
  }

  const scopeRevenue = analyticsSales.reduce((sum, record) => sum + record.revenue, 0)
  const scopeQuantity = analyticsSales.reduce((sum, record) => sum + record.quantityKg, 0)
  const scopeProfit = analyticsSales.reduce((sum, record) => sum + record.grossProfit, 0)
  const scopeMargin = scopeRevenue === 0 ? 0 : (scopeProfit / scopeRevenue) * 100
  const scopeAvgUnitPrice = scopeQuantity === 0 ? 0 : scopeRevenue / scopeQuantity

  const scopeLabel = statusFilters.size === 0
    ? '全案件'
    : [...statusFilters].map(getStatusLabel).join(' + ')

  const buyerSummary = Object.values(analyticsSales.reduce<Record<string, {
    buyerName: string
    revenue: number
    profit: number
  }>>((acc, record) => {
    const current = acc[record.buyerName] ?? { buyerName: record.buyerName, revenue: 0, profit: 0 }
    current.revenue += record.revenue
    current.profit += record.grossProfit
    acc[record.buyerName] = current
    return acc
  }, {})).sort((a, b) => b.revenue - a.revenue)

  const maxBuyerRevenue = buyerSummary[0]?.revenue ?? 1
  const statusCounts = {
    negotiating: filteredSales.filter(record => record.status === 'negotiating').length,
    confirmed: filteredSales.filter(record => record.status === 'confirmed').length,
    cancelled: filteredSales.filter(record => record.status === 'cancelled').length,
  }
  const totalStatusCount = statusCounts.negotiating + statusCounts.confirmed + statusCounts.cancelled
  const donut = `conic-gradient(
    ${statusColor('confirmed')} 0deg ${(statusCounts.confirmed / Math.max(totalStatusCount, 1)) * 360}deg,
    ${statusColor('negotiating')} ${(statusCounts.confirmed / Math.max(totalStatusCount, 1)) * 360}deg ${((statusCounts.confirmed + statusCounts.negotiating) / Math.max(totalStatusCount, 1)) * 360}deg,
    ${statusColor('cancelled')} ${((statusCounts.confirmed + statusCounts.negotiating) / Math.max(totalStatusCount, 1)) * 360}deg 360deg
  )`

  const handleSave = async (input: SaleRecordInput) => {
    const services = await getServices()
    if (editingSale) {
      await services.sales.updateSaleRecord(editingSale.id, input)
      setMessage('販売案件を更新しました')
    } else {
      await services.sales.createSaleRecord(input)
      setMessage('販売案件を登録しました')
    }
    setEditingSale(null)
    setPrefillSale(null)
    setModalOpen(false)
    await load()
  }

  const handleDelete = async (record: SaleRecord) => {
    if (!confirm(`${record.buyerName} 向けの案件を削除しますか？`)) return
    const services = await getServices()
    await services.sales.deleteSaleRecord(record.id)
    setMessage('販売案件を削除しました')
    await load()
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageTabs tabs={SALES_TABS} />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="mt-3 text-3xl font-bold text-[#173c2a]">販売管理</h1>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => {
                setEditingSale(null)
                setModalOpen(true)
              }}
              className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-[#174c33] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#123723]"
            >
              <Plus size={16} />
              新規作成
            </button>
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KPICard title={`売上高（${scopeLabel}）`} value={formatCurrency(scopeRevenue)} color="green" icon={<CircleDollarSign size={18} />} />
          <KPICard title="数量" value={formatKg(scopeQuantity)} color="default" icon={<Package2 size={18} />} />
          <KPICard title="粗利" value={formatCurrency(scopeProfit)} color="amber" icon={<ClipboardPenLine size={18} />} />
          <KPICard title="粗利率" value={`${scopeMargin.toFixed(1)}%`} color="violet" icon={<Percent size={18} />} />
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KPICard title="案件数" value={`${analyticsSales.length} 件`} color="default" icon={<ClipboardPenLine size={18} />} />
          <KPICard title="平均単価 / kg" value={scopeAvgUnitPrice > 0 ? formatCurrency(scopeAvgUnitPrice) : '-'} color="default" icon={<CircleDollarSign size={18} />} />
          <KPICard
            title="未請求金額"
            value={formatCurrency(analyticsSales.filter(r => r.paymentStatus !== 'paid').reduce((s, r) => s + r.revenue, 0))}
            color="amber"
            icon={<CircleDollarSign size={18} />}
          />
          <KPICard
            title="未発送件数"
            value={`${analyticsSales.filter(r => r.shippingStatus !== 'shipped').length} 件`}
            color="default"
            icon={<Package2 size={18} />}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
          <section className="rounded-3xl border border-[#d9d1be] bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-[#173c2a]">購入者別売上高・粗利（{scopeLabel}）</h2>
            <div className="mt-6 space-y-4">
              {buyerSummary.length === 0 && (
                <p className="text-sm text-[#68756c]">対象の案件がありません。</p>
              )}
              {buyerSummary.map(item => (
                <div key={item.buyerName} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-[#173c2a]">{item.buyerName}</span>
                    <span className="text-[#68756c]">{formatCurrency(item.revenue)}</span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="rounded-full bg-[#eef3eb]">
                      <div className="h-4 rounded-full bg-[#2f5d26]" style={{ width: `${(item.revenue / maxBuyerRevenue) * 100}%` }} />
                    </div>
                    <div className="rounded-full bg-[#eef3eb]">
                      <div className="h-4 rounded-full bg-[#7dbb57]" style={{ width: `${Math.max((item.profit / maxBuyerRevenue) * 100, 3)}%` }} />
                    </div>
                  </div>
                  <div className="flex gap-5 text-xs text-[#68756c]">
                    <span>売上高 {formatCurrency(item.revenue)}</span>
                    <span>粗利 {formatCurrency(item.profit)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-[#d9d1be] bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-[#173c2a]">ステータス分布</h2>
            <div className="mt-8 flex flex-col items-center gap-6 lg:flex-row lg:justify-center">
              <div className="relative h-48 w-48 rounded-full" style={{ background: donut }}>
                <div className="absolute inset-[32px] rounded-full bg-white" />
              </div>
              <div className="space-y-4 text-sm text-[#4d5b52]">
                {(['negotiating', 'confirmed', 'cancelled'] as SaleStatus[]).map(status => (
                  <div key={status} className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: statusColor(status) }} />
                    <span>{getStatusLabel(status)}</span>
                    <span className="font-semibold text-[#173c2a]">
                      {status === 'negotiating' ? statusCounts.negotiating : status === 'confirmed' ? statusCounts.confirmed : statusCounts.cancelled}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="rounded-3xl border border-[#d9d1be] bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap gap-2">
            {([
              { mode: 'list', label: '一覧' },
              { mode: 'by-month', label: '月別' },
              { mode: 'by-fiscal', label: '年度別' },
              { mode: 'by-country', label: '国別' },
              { mode: 'by-product', label: '商品別' },
            ] as { mode: ViewMode; label: string }[]).map(tab => (
              <button
                key={tab.mode}
                type="button"
                onClick={() => setViewMode(tab.mode)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  viewMode === tab.mode
                    ? 'bg-[#174c33] text-white'
                    : 'border border-[#d9d1be] bg-white text-[#173c2a] hover:bg-[#ece8db]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-lg font-semibold text-[#173c2a]">
              {viewMode === 'list' ? '販売案件一覧'
                : viewMode === 'by-month' ? '月別集計'
                : viewMode === 'by-fiscal' ? '年度別集計（4月〜3月）'
                : viewMode === 'by-country' ? '国別集計'
                : '商品別集計'}
              <span className="ml-2 text-sm font-normal text-[#68756c]">({filteredSales.length}件)</span>
            </h2>
            <div className="flex flex-wrap gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="商品名・購入者・国で検索"
                  className="w-full rounded-xl border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 sm:w-56"
                />
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen(prev => !prev)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                詳細フィルタ
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-[#174c33] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-xl px-3 py-2 text-sm text-[#68756c] underline-offset-2 hover:underline"
                >
                  リセット
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {(['negotiating', 'confirmed', 'cancelled'] as SaleStatus[]).map(status => {
              const active = statusFilters.has(status)
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggleSetItem(setStatusFilters, statusFilters, status)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    active
                      ? 'bg-[#174c33] text-white'
                      : 'border border-[#d9d1be] bg-white text-[#173c2a] hover:bg-[#ece8db]'
                  }`}
                >
                  {getStatusLabel(status)}
                </button>
              )
            })}
            <span className="self-center text-[11px] text-[#68756c]">
              {statusFilters.size === 0 ? '全ステータス表示中' : `${statusFilters.size} ステータス選択中`}
            </span>
          </div>

          {filtersOpen && (
            <div className="mt-3 grid gap-4 rounded-2xl border border-[#e6dfcf] bg-[#faf8f1] p-4 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[#68756c]">期間（作成日）</p>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  <span className="text-xs text-[#68756c]">〜</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              </div>
              <FilterMultiSelect
                label="購入者"
                options={filterOptions.buyers.map(name => ({ value: name, label: name }))}
                selected={buyerFilters}
                onToggle={value => toggleSetItem(setBuyerFilters, buyerFilters, value)}
                onClear={() => setBuyerFilters(new Set())}
              />
              <FilterMultiSelect
                label="国"
                options={filterOptions.countries.map(name => ({ value: name, label: name }))}
                selected={countryFilters}
                onToggle={value => toggleSetItem(setCountryFilters, countryFilters, value)}
                onClear={() => setCountryFilters(new Set())}
              />
              <FilterMultiSelect
                label="商品"
                options={filterOptions.products.map(p => ({ value: p.key, label: p.label }))}
                selected={productFilters}
                onToggle={value => toggleSetItem(setProductFilters, productFilters, value)}
                onClear={() => setProductFilters(new Set())}
              />
            </div>
          )}

          {viewMode !== 'list' && (
            <div className="mt-5 overflow-x-auto">
              <AggregateTable
                rows={
                  viewMode === 'by-month' ? aggregations.monthly
                    : viewMode === 'by-fiscal' ? aggregations.fiscal
                    : viewMode === 'by-country' ? aggregations.country
                    : aggregations.product
                }
                groupLabel={
                  viewMode === 'by-month' ? '月'
                    : viewMode === 'by-fiscal' ? '年度'
                    : viewMode === 'by-country' ? '国'
                    : '商品'
                }
              />
            </div>
          )}

          <div className={`mt-5 space-y-3 ${viewMode === 'list' ? 'md:hidden' : 'hidden'}`}>
            {!loading && filteredSales.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#d9d1be] px-4 py-10 text-center text-sm text-[#68756c]">
                条件に合う販売案件はありません。
              </div>
            )}
            {filteredSales.map(record => (
              <div
                key={record.id}
                onClick={() => setDetailSaleId(record.id)}
                className="cursor-pointer rounded-2xl border border-[#ece5d7] bg-[#faf8f2] p-4 transition hover:border-[#bcb39a]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-[#173c2a]">{record.buyerName}</div>
                    <div className="mt-1 text-xs text-[#68756c]">{record.country} / 納期 {record.dueDate || '-'}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <SalesStatusBadge status={record.status} />
                    <PaymentBadge status={record.paymentStatus} />
                    <ShippingBadge status={record.shippingStatus} />
                  </div>
                </div>
                <div className="mt-3 rounded-xl bg-white p-3">
                  <div className="text-sm text-[#173c2a]">
                    {record.items[0]?.productName ?? record.productName}
                    {record.items.length > 1 && (
                      <span className="text-xs text-[#68756c]"> +他{record.items.length - 1}件</span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-[#68756c]">{record.items[0]?.productSku ?? record.productSku}</div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-white p-3 text-xs text-[#68756c]">
                    <div>数量 {formatKg(record.quantityKg)}</div>
                    <div className="mt-1">売上高 {formatCurrency(record.revenue)}</div>
                    <div className="mt-1">原価 {formatCurrency(record.costAmount)}</div>
                    <div className="mt-1 font-semibold text-emerald-700">粗利 {formatCurrency(record.grossProfit)}</div>
                  </div>
                  <div className="rounded-xl bg-white p-3 text-xs text-[#68756c]">
                    <div>メモ {record.notes || '-'}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-2" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => handleDuplicate(record)}
                    aria-label="複製"
                    className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    onClick={() => {
                      setEditingSale(record)
                      setModalOpen(true)
                    }}
                    className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(record)}
                    className="rounded-lg p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className={`mt-5 overflow-x-auto ${viewMode === 'list' ? 'hidden md:block' : 'hidden'}`}>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[#e6dfcf] text-left text-[#68756c]">
                  <th className="px-3 py-3 font-medium">ステータス</th>
                  <th className="px-3 py-3 font-medium">購入者</th>
                  <th className="px-3 py-3 font-medium">商品</th>
                  <th className="px-3 py-3 font-medium">数量</th>
                  <th className="px-3 py-3 font-medium">売上高</th>
                  <th className="px-3 py-3 font-medium">原価</th>
                  <th className="px-3 py-3 font-medium">粗利</th>
                  <th className="px-3 py-3 font-medium">国</th>
                  <th className="px-3 py-3 font-medium">納期</th>
                  <th className="px-3 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filteredSales.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-3 py-10 text-center text-sm text-[#68756c]">
                      条件に合う販売案件はありません。
                    </td>
                  </tr>
                )}
                {filteredSales.map(record => (
                  <tr
                    key={record.id}
                    onClick={() => setDetailSaleId(record.id)}
                    className="cursor-pointer border-b border-[#f0ebdf] text-[#173c2a] transition hover:bg-[#faf8f2]"
                  >
                    <td className="px-3 py-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SalesStatusBadge status={record.status} />
                        <PaymentBadge status={record.paymentStatus} />
                        <ShippingBadge status={record.shippingStatus} />
                      </div>
                    </td>
                    <td className="px-3 py-4 font-medium">{record.buyerName}</td>
                    <td className="px-3 py-4">
                      <div>
                        {record.items[0]?.productName ?? record.productName}
                        {record.items.length > 1 && (
                          <span className="text-xs text-[#68756c]"> +他{record.items.length - 1}件</span>
                        )}
                      </div>
                      <div className="text-xs text-[#68756c]">{record.items[0]?.productSku ?? record.productSku}</div>
                    </td>
                    <td className="px-3 py-4">{formatKg(record.quantityKg)}</td>
                    <td className="px-3 py-4 font-medium">{formatCurrency(record.revenue)}</td>
                    <td className="px-3 py-4">{formatCurrency(record.costAmount)}</td>
                    <td className="px-3 py-4 font-medium text-emerald-700">{formatCurrency(record.grossProfit)}</td>
                    <td className="px-3 py-4">{record.country}</td>
                    <td className="px-3 py-4">{record.dueDate || '-'}</td>
                    <td className="px-3 py-4">
                      <div className="flex flex-wrap justify-end gap-1" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => handleDuplicate(record)}
                          aria-label="複製"
                          className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          onClick={() => {
                            setEditingSale(record)
                            setModalOpen(true)
                          }}
                          className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(record)}
                          className="rounded-lg p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <SaleModal
          open={modalOpen}
          buyers={buyers}
          masters={masters}
          products={products}
          initial={editingSale ?? prefillSale}
          onClose={() => {
            setModalOpen(false)
            setEditingSale(null)
            setPrefillSale(null)
          }}
          onSave={handleSave}
        />

        {detailSaleId && (() => {
          const detailRecord = sales.find(s => s.id === detailSaleId)
          if (!detailRecord) return null
          const detailBuyer = buyers.find(b => b.name === detailRecord.buyerName)
          return (
            <SaleDetailModal
              record={detailRecord}
              buyerShippingAddress={detailBuyer?.shippingAddress ?? ''}
              onClose={() => setDetailSaleId(null)}
              onEdit={() => {
                setEditingSale(detailRecord)
                setModalOpen(true)
                setDetailSaleId(null)
              }}
              onUpdate={async input => {
                const services = await getServices()
                await services.sales.updateSaleRecord(detailRecord.id, input)
                await load()
              }}
            />
          )
        })()}
      </div>
    </AppLayout>
  )
}

function FilterMultiSelect({
  label,
  options,
  selected,
  onToggle,
  onClear,
}: {
  label: string
  options: { value: string; label: string }[]
  selected: Set<string>
  onToggle: (value: string) => void
  onClear: () => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[#68756c]">
          {label} <span className="ml-1 text-[10px] text-[#a59f8c]">({selected.size === 0 ? '全' : selected.size}/{options.length})</span>
        </p>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[11px] text-[#174c33] underline-offset-2 hover:underline"
          >
            クリア
          </button>
        )}
      </div>
      <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
        {options.length === 0 ? (
          <p className="px-1 py-2 text-xs text-[#a59f8c]">選択肢がありません</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {options.map(opt => {
              const active = selected.has(opt.value)
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onToggle(opt.value)}
                  className={`rounded-full px-2.5 py-0.5 text-xs transition ${
                    active
                      ? 'bg-[#174c33] text-white'
                      : 'border border-[#d9d1be] bg-white text-[#173c2a] hover:bg-[#ece8db]'
                  }`}
                  title={opt.label}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function SaleDetailModal({
  record,
  buyerShippingAddress,
  onClose,
  onEdit,
  onUpdate,
}: {
  record: SaleRecord
  buyerShippingAddress: string
  onClose: () => void
  onEdit: () => void
  onUpdate: (input: Partial<SaleRecordInput>) => Promise<void>
}) {
  const [shipping, setShipping] = useState({
    shippingStatus: record.shippingStatus,
    shippingAddress: record.shippingAddress ?? buyerShippingAddress ?? '',
    shippingMethod: record.shippingMethod ?? '',
    shippingDate: record.shippingDate ?? '',
    trackingNumber: record.trackingNumber ?? '',
  })
  const [savingSection, setSavingSection] = useState<'shipping' | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const shippingDirty =
    shipping.shippingStatus !== record.shippingStatus ||
    (shipping.shippingAddress || '') !== (record.shippingAddress ?? '') ||
    (shipping.shippingMethod || '') !== (record.shippingMethod ?? '') ||
    (shipping.shippingDate || '') !== (record.shippingDate ?? '') ||
    (shipping.trackingNumber || '') !== (record.trackingNumber ?? '')

  const saveShipping = async () => {
    setSavingSection('shipping')
    setFeedback(null)
    try {
      await onUpdate({
        shippingStatus: shipping.shippingStatus,
        shippingAddress: shipping.shippingAddress.trim() || undefined,
        shippingMethod: shipping.shippingMethod.trim() || undefined,
        shippingDate: shipping.shippingDate || undefined,
        trackingNumber: shipping.trackingNumber.trim() || undefined,
      })
      setFeedback('発送情報を更新しました')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSavingSection(null)
    }
  }

  const fieldClass =
    'w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 bg-white'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="absolute right-3 top-3 rounded-full p-1.5 text-[#68756c] transition hover:bg-[#f4f2ea] hover:text-[#173c2a]"
        >
          <X size={18} />
        </button>
        <div className="border-b border-[#ece8db] px-6 pb-4 pt-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-[#68756c]">販売案件</p>
          <h2 className="mt-1 text-xl font-semibold text-[#173c2a]">{record.buyerName}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <SalesStatusBadge status={record.status} />
            <PaymentBadge status={record.paymentStatus} />
            <ShippingBadge status={record.shippingStatus} />
          </div>
        </div>

        <div className="space-y-5 px-6 py-5">
          {/* 注文内容 */}
          <Section title="注文内容" onEdit={onEdit}>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <DetailField label="国" value={record.country || '-'} />
              <DetailField label="納期" value={record.dueDate || '-'} />
              <DetailField label="取引条件" value={record.terms || '-'} />
              <DetailField label="作成日" value={record.createdAt.toLocaleDateString('ja-JP')} />
              <DetailField label="商品代金" value={formatCurrency(record.revenue)} />
              <DetailField label="送料" value={formatCurrency(record.shippingFee || 0)} />
              <DetailField
                label="諸費用"
                value={`${formatCurrency(record.otherFees || 0)}${record.otherFeesNote ? ` (${record.otherFeesNote})` : ''}`}
              />
              <DetailField label="請求額（税抜）" value={formatCurrency(record.invoiceAmount || record.revenue)} valueClass="font-semibold" />
              <DetailField label="支払手数料" value={formatCurrency(record.paymentFee || 0)} />
              <DetailField label="原価" value={formatCurrency(record.costAmount)} />
              <DetailField label="粗利" value={formatCurrency(record.grossProfit)} valueClass="text-emerald-700 font-semibold" />
            </div>
            <div className="mt-3 overflow-hidden rounded-xl border border-[#ece8db]">
              <table className="min-w-full text-sm">
                <thead className="bg-[#faf8f1] text-left text-[11px] uppercase tracking-wider text-[#68756c]">
                  <tr>
                    <th className="px-3 py-2 font-medium">商品</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium text-right">数量</th>
                    <th className="px-3 py-2 font-medium text-right">単価</th>
                    <th className="px-3 py-2 font-medium text-right">小計</th>
                  </tr>
                </thead>
                <tbody>
                  {record.items.map((item, i) => (
                    <tr key={i} className="border-t border-[#ece8db] text-[#173c2a]">
                      <td className="px-3 py-2">{item.productName}</td>
                      <td className="px-3 py-2 text-[#68756c]">{item.productSku}</td>
                      <td className="px-3 py-2 text-right">{formatKg(item.quantityKg)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(item.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {record.notes && (
              <div className="mt-3">
                <p className="text-[11px] uppercase tracking-wider text-[#68756c]">メモ</p>
                <p className="mt-1 whitespace-pre-wrap rounded-xl border border-[#ece5d7] bg-[#faf8f2] p-2.5 text-sm text-[#173c2a]">{record.notes}</p>
              </div>
            )}
          </Section>

          {/* 支払い */}
          <Section title="支払い">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wider text-[#68756c]">支払いステータス</p>
                <div className="py-1.5"><PaymentBadge status={record.paymentStatus} /></div>
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wider text-[#68756c]">支払い方法</p>
                <p className="text-sm text-[#173c2a]">{record.paymentMethod || '未設定'}</p>
              </div>
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-wider text-[#68756c]">支払い日</p>
                <p className="text-sm text-[#173c2a]">{record.paymentDate || '-'}</p>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Link
                href="/receivables"
                className="text-xs font-medium text-[#174c33] hover:underline"
              >
                入金管理で編集 →
              </Link>
            </div>
          </Section>

          {/* 発送 */}
          <Section title="発送">
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <DetailField label="発送ステータス" value={<ShippingBadge status={record.shippingStatus} />} />
              <DetailField label="発送方法" value={record.shippingMethod || '-'} />
              <DetailField label="発送日" value={record.shippingDate || '-'} />
              <DetailField label="追跡番号" value={record.trackingNumber || '-'} />
              <DetailField label="郵便番号" value={record.shippingPostalCode || '-'} />
              <div className="sm:col-span-2">
                <p className="text-[11px] uppercase tracking-wider text-[#68756c]">発送先</p>
                <p className="mt-1 whitespace-pre-wrap rounded-xl border border-[#ece5d7] bg-[#faf8f2] p-2.5 text-sm text-[#173c2a]">
                  {record.shippingAddress || buyerShippingAddress || '-'}
                </p>
              </div>
            </div>
            <p className="mt-3 text-right text-xs">
              <Link href="/shipping" className="text-[#174c33] hover:underline">発送管理で編集 →</Link>
            </p>
          </Section>

          {/* 書類発行 */}
          <section className="rounded-2xl border border-[#ece5d7] bg-[#faf8f2] p-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[#68756c]">書類発行</p>
            <div className="space-y-2">
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-[#68756c]">日本語</p>
                <div className="flex flex-wrap gap-2">
                  <a href={`/sales/${record.id}/document?type=invoice&lang=ja`} className="inline-flex items-center gap-2 rounded-xl bg-[#174c33] px-3 py-1.5 text-xs font-medium text-white shadow transition hover:bg-[#205f43]">
                    <FileText size={14} /> 請求書を発行
                  </a>
                  <a href={`/sales/${record.id}/document?type=delivery&lang=ja`} className="inline-flex items-center gap-2 rounded-xl border border-[#174c33] bg-white px-3 py-1.5 text-xs font-medium text-[#174c33] transition hover:bg-[#ece8db]">
                    <FileText size={14} /> 納品書を発行
                  </a>
                  <a href={`/sales/${record.id}/document?type=quotation&lang=ja`} className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50">
                    <FileText size={14} /> 見積書を発行
                  </a>
                </div>
              </div>
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-[#68756c]">English</p>
                <div className="flex flex-wrap gap-2">
                  <a href={`/sales/${record.id}/document?type=invoice&lang=en`} className="inline-flex items-center gap-2 rounded-xl bg-[#174c33] px-3 py-1.5 text-xs font-medium text-white shadow transition hover:bg-[#205f43]">
                    <FileText size={14} /> Issue Invoice
                  </a>
                  <a href={`/sales/${record.id}/document?type=delivery&lang=en`} className="inline-flex items-center gap-2 rounded-xl border border-[#174c33] bg-white px-3 py-1.5 text-xs font-medium text-[#174c33] transition hover:bg-[#ece8db]">
                    <FileText size={14} /> Issue Delivery Note
                  </a>
                  <a href={`/sales/${record.id}/document?type=quotation&lang=en`} className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50">
                    <FileText size={14} /> Issue Quotation
                  </a>
                </div>
              </div>
            </div>
          </section>

          {feedback && (
            <p className="text-sm text-emerald-700">{feedback}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              閉じる
            </button>
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#174c33] px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-[#205f43]"
            >
              <Pencil size={14} />
              すべての項目を編集
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Section({ title, onEdit, children }: { title: string; onEdit?: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#ece5d7] bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[#173c2a]">{title}</h3>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="text-xs text-[#174c33] underline-offset-2 hover:underline"
          >
            編集
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function DetailField({ label, value, valueClass }: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-[#68756c]">{label}</p>
      <p className={`mt-0.5 text-sm text-[#173c2a] ${valueClass ?? ''}`}>{value}</p>
    </div>
  )
}

function AggregateTable({ rows, groupLabel }: { rows: AggregateRow[]; groupLabel: string }) {
  const totals = rows.reduce<AggregateRow>((acc, r) => ({
    key: '',
    label: '合計',
    count: acc.count + r.count,
    quantityKg: acc.quantityKg + r.quantityKg,
    revenue: acc.revenue + r.revenue,
    costAmount: acc.costAmount + r.costAmount,
    grossProfit: acc.grossProfit + r.grossProfit,
  }), { key: '', label: '合計', count: 0, quantityKg: 0, revenue: 0, costAmount: 0, grossProfit: 0 })
  const totalMargin = totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : 0

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#d9d1be] px-4 py-10 text-center text-sm text-[#68756c]">
        集計対象の販売案件がありません。
      </div>
    )
  }

  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr className="border-b border-[#e6dfcf] text-left text-[#68756c]">
          <th className="px-3 py-3 font-medium">{groupLabel}</th>
          <th className="px-3 py-3 text-right font-medium">件数</th>
          <th className="px-3 py-3 text-right font-medium">数量</th>
          <th className="px-3 py-3 text-right font-medium">売上</th>
          <th className="px-3 py-3 text-right font-medium">原価</th>
          <th className="px-3 py-3 text-right font-medium">粗利</th>
          <th className="px-3 py-3 text-right font-medium">粗利率</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => {
          const margin = row.revenue > 0 ? (row.grossProfit / row.revenue) * 100 : 0
          return (
            <tr key={row.key} className="border-b border-[#f0ebdf] text-[#173c2a]">
              <td className="px-3 py-3 font-medium">{row.label}</td>
              <td className="px-3 py-3 text-right">{row.count}</td>
              <td className="px-3 py-3 text-right">{formatKg(row.quantityKg)}</td>
              <td className="px-3 py-3 text-right">{formatCurrency(row.revenue)}</td>
              <td className="px-3 py-3 text-right text-[#68756c]">{formatCurrency(row.costAmount)}</td>
              <td className="px-3 py-3 text-right font-semibold text-emerald-700">{formatCurrency(row.grossProfit)}</td>
              <td className="px-3 py-3 text-right">{margin.toFixed(1)}%</td>
            </tr>
          )
        })}
        <tr className="bg-[#faf8f1] text-[#173c2a]">
          <td className="px-3 py-3 font-semibold">合計</td>
          <td className="px-3 py-3 text-right font-semibold">{totals.count}</td>
          <td className="px-3 py-3 text-right font-semibold">{formatKg(totals.quantityKg)}</td>
          <td className="px-3 py-3 text-right font-semibold">{formatCurrency(totals.revenue)}</td>
          <td className="px-3 py-3 text-right font-semibold">{formatCurrency(totals.costAmount)}</td>
          <td className="px-3 py-3 text-right font-semibold text-emerald-700">{formatCurrency(totals.grossProfit)}</td>
          <td className="px-3 py-3 text-right font-semibold">{totalMargin.toFixed(1)}%</td>
        </tr>
      </tbody>
    </table>
  )
}
