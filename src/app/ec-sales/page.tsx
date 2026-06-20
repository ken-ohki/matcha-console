'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { PageTabs, SALES_TABS } from '@/components/layout/PageTabs'
import { KPICard } from '@/components/ui/KPICard'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type {
  EcSaleRecord,
  EcSaleRecordInput,
  ProductWithInventory,
} from '@/types'
import { CircleDollarSign, Package2, Pencil, Plus, Search, ShoppingBag, Trash2, X } from 'lucide-react'
import { formatCurrency, formatKg } from '@/lib/format'

function formatDate(value: string): string {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed)
}

function todayString(): string {
  const d = new Date()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

function EcSaleModal({
  open,
  products,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  products: ProductWithInventory[]
  initial: EcSaleRecord | null
  onClose: () => void
  onSave: (input: EcSaleRecordInput) => Promise<void>
}) {
  const defaultProductId = products[0]?.id ?? ''
  const [form, setForm] = useState<EcSaleRecordInput>({
    productId: defaultProductId,
    quantityKg: 0,
    soldOn: todayString(),
    orderNumber: '',
    unitPrice: undefined,
    channel: 'Shopify',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setForm({
      productId: initial?.productId ?? defaultProductId,
      quantityKg: initial?.quantityKg ?? 0,
      soldOn: initial?.soldOn ?? todayString(),
      orderNumber: initial?.orderNumber ?? '',
      unitPrice: initial?.unitPrice,
      channel: initial?.channel ?? 'Shopify',
      notes: initial?.notes ?? '',
    })
    setError('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  if (!open) return null

  const selectedProduct = products.find(p => p.id === form.productId)
  const revenue = form.unitPrice != null ? form.quantityKg * form.unitPrice : null

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave({
        ...form,
        soldOn: form.soldOn.trim(),
        orderNumber: form.orderNumber?.trim() || undefined,
        channel: form.channel?.trim() || undefined,
        notes: form.notes?.trim() || undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="閉じる" className="absolute right-3 top-3 rounded-full p-1.5 text-mist hover:bg-bone hover:text-ink">
          <X size={18} />
        </button>
        <h2 className="text-xl font-semibold text-ink">{initial ? 'Shopify販売を編集' : 'Shopify販売を登録'}</h2>
        {error && <p className="mt-3 text-sm text-alert">{error}</p>}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">商品</label>
              <select
                required
                value={form.productId}
                onChange={e => setForm(prev => ({ ...prev, productId: e.target.value }))}
                className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              >
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.sku ? ` (${p.sku})` : ''} - 残{p.currentStockKg.toFixed(1)}kg
                  </option>
                ))}
              </select>
              {selectedProduct && (
                <p className="mt-1 text-xs text-mist">残在庫: {formatKg(selectedProduct.currentStockKg)}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">販売日</label>
              <input
                required
                type="date"
                value={form.soldOn}
                onChange={e => setForm(prev => ({ ...prev, soldOn: e.target.value }))}
                className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">数量 (kg)</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={form.quantityKg || ''}
                onChange={e => setForm(prev => ({ ...prev, quantityKg: Number(e.target.value) || 0 }))}
                className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">販売単価 (kg)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.unitPrice ?? ''}
                onChange={e => setForm(prev => ({ ...prev, unitPrice: e.target.value ? Number(e.target.value) : undefined }))}
                className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                placeholder="任意"
              />
              {revenue != null && (
                <p className="mt-1 text-xs text-mist">売上: {formatCurrency(revenue)}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">チャネル</label>
              <input
                type="text"
                value={form.channel ?? ''}
                onChange={e => setForm(prev => ({ ...prev, channel: e.target.value }))}
                className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                placeholder="例: Shopify"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">注文番号</label>
              <input
                type="text"
                value={form.orderNumber ?? ''}
                onChange={e => setForm(prev => ({ ...prev, orderNumber: e.target.value }))}
                className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                placeholder="例: #1001"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-graphite">メモ</label>
            <textarea
              rows={2}
              value={form.notes ?? ''}
              onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
              className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-medium text-graphite transition hover:bg-bone">
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper shadow transition hover:bg-[#205f43] disabled:opacity-60"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function EcSalesPage() {
  const [records, setRecords] = useState<EcSaleRecord[]>([])
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<EcSaleRecord | null>(null)
  const [message, setMessage] = useState('')
  const { user } = useAuth()

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const [nextRecords, nextProducts] = await Promise.all([
      services.ecSales.getEcSaleRecords(),
      services.inventory.getProductsWithInventory(),
    ])
    setRecords(nextRecords)
    setProducts(nextProducts)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredRecords = useMemo(() => {
    if (!search) return records
    const query = search.toLowerCase()
    return records.filter(r => (
      r.productName.toLowerCase().includes(query) ||
      r.productSku.toLowerCase().includes(query) ||
      (r.orderNumber ?? '').toLowerCase().includes(query) ||
      (r.channel ?? '').toLowerCase().includes(query) ||
      (r.notes ?? '').toLowerCase().includes(query)
    ))
  }, [records, search])

  const totalKg = filteredRecords.reduce((sum, r) => sum + (r.status === 'cancelled' ? 0 : r.quantityKg), 0)
  const totalRevenue = filteredRecords.reduce((sum, r) => sum + (r.status === 'cancelled' ? 0 : (r.revenue ?? 0)), 0)

  const handleSave = async (input: EcSaleRecordInput) => {
    const services = await getServices()
    if (editingRecord) {
      await services.ecSales.updateEcSaleRecord(editingRecord.id, input)
      setMessage('Shopify販売を更新しました')
    } else {
      await services.ecSales.createEcSaleRecord(input)
      setMessage('Shopify販売を登録しました')
    }
    setEditingRecord(null)
    setModalOpen(false)
    await load()
  }

  const handleDelete = async (record: EcSaleRecord) => {
    if (!confirm(`${record.productName} のShopify販売記録を削除しますか？`)) return
    const services = await getServices()
    await services.ecSales.deleteEcSaleRecord(record.id)
    setMessage('Shopify販売を削除しました')
    await load()
  }

  const canEdit = user?.role === 'admin'

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageTabs tabs={SALES_TABS} />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#ffeed9] px-3 py-1 text-sm font-medium text-[#a76a1e]">
              <ShoppingBag size={15} />
              Shopify
            </div>
            <h1 className="mt-3 text-3xl font-bold text-ink">Shopify（小売）</h1>
            <p className="mt-2 text-sm text-mist">Shopify（小売）の販売を記録し、在庫から自動的に差し引きます。</p>
          </div>
          {canEdit && (
            <button
              onClick={() => {
                setEditingRecord(null)
                setModalOpen(true)
              }}
              className="inline-flex items-center gap-2 self-start rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:bg-matchaDeep"
            >
              <Plus size={16} />
              Shopify販売を登録
            </button>
          )}
        </div>

        {message && (
          <div className="rounded-xl border border-matcha/40 bg-bone px-4 py-3 text-sm text-matcha">
            {message}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <KPICard title="Shopify 合計数量" value={formatKg(totalKg)} color="amber" icon={<Package2 size={18} />} />
          <KPICard title="Shopify 合計売上" value={totalRevenue > 0 ? formatCurrency(totalRevenue) : '-'} color="green" icon={<CircleDollarSign size={18} />} />
          <KPICard title="件数" value={`${filteredRecords.length} 件`} color="default" icon={<ShoppingBag size={18} />} />
        </div>

        <div className="rounded-3xl border border-line bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-lg font-semibold text-ink">Shopify販売一覧</h2>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="商品名・注文番号・チャネルで検索"
                className="w-full rounded-xl border border-line py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-matcha sm:w-64"
              />
            </div>
          </div>

          <div className="mt-5 space-y-3 md:hidden">
            {!loading && filteredRecords.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-mist">
                Shopify販売記録はまだありません。
              </div>
            )}
            {filteredRecords.map(record => (
              <div key={record.id} className="rounded-2xl border border-line bg-bone p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-medium text-ink ${record.status === 'cancelled' ? 'line-through text-gray-400' : ''}`}>{record.productName}</span>
                      {record.shopifyOrderId && (
                        <span className="rounded-full bg-[#dcf0e4] px-2 py-0.5 text-[10px] font-medium text-[#1b6b41]">自動取込</span>
                      )}
                      {record.status === 'cancelled' && (
                        <span className="rounded-full bg-alert/10 px-2 py-0.5 text-[10px] font-medium text-alert">キャンセル</span>
                      )}
                    </div>
                    <div className="mt-1 font-mono text-xs text-mist">{record.productSku}</div>
                    <div className="mt-2 text-xs text-mist">
                      {formatDate(record.soldOn)} / {record.channel || 'EC'}
                      {record.orderNumber ? ` / 注文 ${record.orderNumber}` : ''}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-base font-semibold text-ink">{formatKg(record.quantityKg)}</div>
                    {record.revenue != null && (
                      <div className="mt-1 text-xs text-matcha">{formatCurrency(record.revenue)}</div>
                    )}
                  </div>
                </div>
                {record.notes && <div className="mt-3 text-xs text-mist">{record.notes}</div>}
                {canEdit && (
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      onClick={() => {
                        setEditingRecord(record)
                        setModalOpen(true)
                      }}
                      className="rounded-lg p-2 text-mist transition hover:bg-bone hover:text-graphite"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(record)}
                      className="rounded-lg p-2 text-alert transition hover:bg-alert/5 hover:text-alert"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="mt-5 hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[#e6dfcf] text-left text-mist">
                  <th className="px-3 py-3 font-medium">販売日</th>
                  <th className="px-3 py-3 font-medium">商品</th>
                  <th className="px-3 py-3 font-medium text-right">数量</th>
                  <th className="px-3 py-3 font-medium text-right">単価</th>
                  <th className="px-3 py-3 font-medium text-right">売上</th>
                  <th className="px-3 py-3 font-medium">チャネル / 注文番号</th>
                  <th className="px-3 py-3 font-medium">メモ</th>
                  {canEdit && <th className="px-3 py-3 font-medium text-right">操作</th>}
                </tr>
              </thead>
              <tbody>
                {!loading && filteredRecords.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 8 : 7} className="px-3 py-10 text-center text-sm text-mist">
                      Shopify販売記録はまだありません。
                    </td>
                  </tr>
                )}
                {filteredRecords.map(record => {
                  const cancelled = record.status === 'cancelled'
                  return (
                  <tr key={record.id} className={`border-b border-[#f0ebdf] ${cancelled ? 'text-gray-400' : 'text-ink'}`}>
                    <td className="px-3 py-4">{formatDate(record.soldOn)}</td>
                    <td className="px-3 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${cancelled ? 'line-through' : ''}`}>{record.productName}</span>
                        {record.shopifyOrderId && (
                          <span className="rounded-full bg-[#dcf0e4] px-2 py-0.5 text-[10px] font-medium text-[#1b6b41]">自動取込</span>
                        )}
                        {cancelled && (
                          <span className="rounded-full bg-alert/10 px-2 py-0.5 text-[10px] font-medium text-alert">キャンセル</span>
                        )}
                      </div>
                      <div className="text-xs text-mist">{record.productSku}{cancelled && record.cancelledAt ? ` / ${record.cancelledAt} 取消` : ''}</div>
                    </td>
                    <td className={`px-3 py-4 text-right font-medium ${cancelled ? 'line-through' : ''}`}>{formatKg(record.quantityKg)}</td>
                    <td className="px-3 py-4 text-right">{record.unitPrice != null ? formatCurrency(record.unitPrice) : '-'}</td>
                    <td className={`px-3 py-4 text-right font-semibold ${cancelled ? 'text-gray-400' : 'text-matcha'}`}>{record.revenue != null ? formatCurrency(record.revenue) : '-'}</td>
                    <td className="px-3 py-4">
                      <div>{record.channel || '-'}</div>
                      <div className="text-xs text-mist">{record.orderNumber || ''}</div>
                    </td>
                    <td className="px-3 py-4 max-w-xs truncate text-mist">{record.notes || '-'}</td>
                    {canEdit && (
                      <td className="px-3 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setEditingRecord(record)
                              setModalOpen(true)
                            }}
                            className="rounded-lg p-2 text-mist transition hover:bg-bone hover:text-graphite"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(record)}
                            className="rounded-lg p-2 text-alert transition hover:bg-alert/5 hover:text-alert"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <EcSaleModal
          open={modalOpen}
          products={products}
          initial={editingRecord}
          onClose={() => {
            setModalOpen(false)
            setEditingRecord(null)
          }}
          onSave={handleSave}
        />
      </div>
    </AppLayout>
  )
}
