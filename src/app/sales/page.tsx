'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { SalesStatusBadge } from '@/components/ui/StatusBadge'
import { getServices } from '@/lib/services'
import type { ProductWithInventory, SaleRecord, SaleRecordInput, SaleStatus } from '@/types'
import {
  CircleDollarSign,
  ClipboardPenLine,
  Package2,
  Percent,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'

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
  products,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  products: ProductWithInventory[]
  initial: SaleRecord | null
  onClose: () => void
  onSave: (input: SaleRecordInput) => Promise<void>
}) {
  const defaultProductId = products[0]?.id ?? ''
  const [form, setForm] = useState<SaleRecordInput>({
    status: 'negotiating',
    buyerName: '',
    productId: defaultProductId,
    quantityKg: 0,
    unitPrice: 0,
    country: '',
    dueDate: '',
    terms: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return

    const nextProductId = initial?.productId ?? defaultProductId
    const selected = products.find(product => product.id === nextProductId) ?? products[0]

    setForm({
      status: initial?.status ?? 'negotiating',
      buyerName: initial?.buyerName ?? '',
      productId: nextProductId,
      quantityKg: initial?.quantityKg ?? 0,
      unitPrice: initial?.unitPrice ?? selected?.price ?? 0,
      country: initial?.country ?? '',
      dueDate: initial?.dueDate ?? '',
      terms: initial?.terms ?? '',
      notes: initial?.notes ?? '',
    })
    setError('')
  }, [open, initial, defaultProductId, products])

  const selectedProduct = products.find(product => product.id === form.productId)
  const revenue = form.quantityKg * form.unitPrice
  const costAmount = form.quantityKg * (selectedProduct?.cost ?? initial?.costPerKg ?? 0)
  const grossProfit = revenue - costAmount
  const remainingStock = (selectedProduct?.currentStockKg ?? 0) + (initial?.productId === form.productId ? initial.quantityKg : 0) - form.quantityKg

  const handleProductChange = (productId: string) => {
    const product = products.find(item => item.id === productId)
    setForm(prev => ({
      ...prev,
      productId,
      unitPrice: product?.price ?? prev.unitPrice,
    }))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#173c2a]">{initial ? '販売案件を編集' : '販売案件を登録'}</h2>
            <p className="text-sm text-[#68756c] mt-1">商品選択に応じて売上と粗利を自動計算します。</p>
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
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">販売先</label>
              <input
                required
                value={form.buyerName}
                onChange={event => setForm(prev => ({ ...prev, buyerName: event.target.value }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                placeholder="例: Tea Atelier SORA"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[1.2fr,0.8fr,0.8fr]">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">商品</label>
              <select
                value={form.productId}
                onChange={event => handleProductChange(event.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                {products.map(product => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.sku})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">数量 (kg)</label>
              <input
                required
                type="number"
                min="0.1"
                step="0.1"
                value={form.quantityKg}
                onChange={event => setForm(prev => ({ ...prev, quantityKg: Number(event.target.value) || 0 }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">単価 (円/kg)</label>
              <input
                required
                type="number"
                min="0"
                step="1"
                value={form.unitPrice}
                onChange={event => setForm(prev => ({ ...prev, unitPrice: Number(event.target.value) || 0 }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">国</label>
              <input
                required
                value={form.country}
                onChange={event => setForm(prev => ({ ...prev, country: event.target.value }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                placeholder="例: 日本"
              />
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
              <label className="mb-1 block text-sm font-medium text-gray-700">条件</label>
              <input
                value={form.terms}
                onChange={event => setForm(prev => ({ ...prev, terms: event.target.value }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                placeholder="例: 前金50%"
              />
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

          <div className="grid gap-3 rounded-2xl border border-[#d9d1be] bg-[#f7f5ee] p-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-[#68756c]">売上高</p>
              <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(revenue)}</p>
            </div>
            <div>
              <p className="text-xs text-[#68756c]">原価</p>
              <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(costAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-[#68756c]">粗利</p>
              <p className="mt-1 text-lg font-semibold text-emerald-700">{formatCurrency(grossProfit)}</p>
            </div>
            <div>
              <p className="text-xs text-[#68756c]">登録後の残在庫</p>
              <p className={`mt-1 text-lg font-semibold ${remainingStock < 0 ? 'text-red-700' : 'text-[#173c2a]'}`}>
                {formatKg(remainingStock)}
              </p>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
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
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | SaleStatus>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSale, setEditingSale] = useState<SaleRecord | null>(null)
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const [nextSales, nextProducts] = await Promise.all([
      services.sales.getSaleRecords(),
      services.inventory.getProductsWithInventory(),
    ])
    setSales(nextSales)
    setProducts(nextProducts)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const filteredSales = useMemo(() => sales.filter(record => {
    if (statusFilter !== 'all' && record.status !== statusFilter) return false
    if (!search) return true
    const query = search.toLowerCase()
    return (
      record.buyerName.toLowerCase().includes(query) ||
      record.productName.toLowerCase().includes(query) ||
      record.productSku.toLowerCase().includes(query) ||
      record.country.toLowerCase().includes(query)
    )
  }), [sales, search, statusFilter])

  const confirmedSales = filteredSales.filter(record => record.status === 'confirmed')
  const confirmedRevenue = confirmedSales.reduce((sum, record) => sum + record.revenue, 0)
  const confirmedQuantity = confirmedSales.reduce((sum, record) => sum + record.quantityKg, 0)
  const confirmedProfit = confirmedSales.reduce((sum, record) => sum + record.grossProfit, 0)
  const confirmedMargin = confirmedRevenue === 0 ? 0 : (confirmedProfit / confirmedRevenue) * 100

  const buyerSummary = Object.values(confirmedSales.reduce<Record<string, {
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#e5efe5] px-3 py-1 text-sm font-medium text-[#174c33]">
              <ClipboardPenLine size={15} />
              販売計画管理
            </div>
            <h1 className="mt-3 text-3xl font-bold text-[#173c2a]">販売ステータスと売上を一画面で管理</h1>
            <p className="mt-2 text-sm text-[#68756c]">販売案件を登録すると、対象商品の在庫が自動で引き当てられます。</p>
          </div>
          <button
            onClick={() => {
              setEditingSale(null)
              setModalOpen(true)
            }}
            className="inline-flex items-center gap-2 self-start rounded-xl bg-[#174c33] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#123723]"
          >
            <Plus size={16} />
            新規作成
          </button>
        </div>

        {message && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KPICard title="確定売上高" value={formatCurrency(confirmedRevenue)} color="green" icon={<CircleDollarSign size={18} />} />
          <KPICard title="確定数量" value={formatKg(confirmedQuantity)} color="default" icon={<Package2 size={18} />} />
          <KPICard title="確定粗利" value={formatCurrency(confirmedProfit)} color="amber" icon={<ClipboardPenLine size={18} />} />
          <KPICard title="粗利率" value={`${confirmedMargin.toFixed(1)}%`} color="violet" icon={<Percent size={18} />} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
          <section className="rounded-3xl border border-[#d9d1be] bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-[#173c2a]">購入者別売上高・粗利（確定）</h2>
            <div className="mt-6 space-y-4">
              {buyerSummary.length === 0 && (
                <p className="text-sm text-[#68756c]">確定案件がまだありません。</p>
              )}
              {buyerSummary.map(item => (
                <div key={item.buyerName} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-[#173c2a]">{item.buyerName}</span>
                    <span className="text-[#68756c]">{formatCurrency(item.revenue)}</span>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <div className="rounded-full bg-[#eef3eb]">
                      <div
                        className="h-4 rounded-full bg-[#2f5d26]"
                        style={{ width: `${(item.revenue / maxBuyerRevenue) * 100}%` }}
                      />
                    </div>
                    <div className="rounded-full bg-[#eef3eb]">
                      <div
                        className="h-4 rounded-full bg-[#7dbb57]"
                        style={{ width: `${Math.max((item.profit / maxBuyerRevenue) * 100, 3)}%` }}
                      />
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
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-lg font-semibold text-[#173c2a]">販売案件一覧</h2>
            <div className="flex flex-wrap gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="商品名・購入者で検索"
                  className="w-56 rounded-xl border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <select
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value as 'all' | SaleStatus)}
                className="rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="all">すべて</option>
                <option value="negotiating">商談中</option>
                <option value="confirmed">確定</option>
                <option value="cancelled">取消</option>
              </select>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
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
                  <th className="px-3 py-3 font-medium">条件</th>
                  <th className="px-3 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filteredSales.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-10 text-center text-sm text-[#68756c]">
                      条件に合う販売案件はありません。
                    </td>
                  </tr>
                )}
                {filteredSales.map(record => (
                  <tr key={record.id} className="border-b border-[#f0ebdf] text-[#173c2a]">
                    <td className="px-3 py-4"><SalesStatusBadge status={record.status} /></td>
                    <td className="px-3 py-4 font-medium">{record.buyerName}</td>
                    <td className="px-3 py-4">
                      <div>{record.productName}</div>
                      <div className="text-xs text-[#68756c]">{record.productSku}</div>
                    </td>
                    <td className="px-3 py-4">{formatKg(record.quantityKg)}</td>
                    <td className="px-3 py-4 font-medium">{formatCurrency(record.revenue)}</td>
                    <td className="px-3 py-4">{formatCurrency(record.costAmount)}</td>
                    <td className="px-3 py-4 font-medium text-emerald-700">{formatCurrency(record.grossProfit)}</td>
                    <td className="px-3 py-4">{record.country}</td>
                    <td className="px-3 py-4">{record.dueDate || '-'}</td>
                    <td className="px-3 py-4">{record.terms || '-'}</td>
                    <td className="px-3 py-4">
                      <div className="flex justify-end gap-2">
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
          products={products}
          initial={editingSale}
          onClose={() => {
            setModalOpen(false)
            setEditingSale(null)
          }}
          onSave={handleSave}
        />
      </div>
    </AppLayout>
  )
}
