'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { getServices } from '@/lib/services'
import type {
  ProductWithInventory,
  SelfConsumptionRecord,
  SelfConsumptionRecordInput,
  SelfConsumptionUsageType,
} from '@/types'
import { Package2, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { formatKg } from '@/lib/format'

const usageLabels: Record<SelfConsumptionUsageType, string> = {
  ingredient: '原料',
  retail: '小売',
  sample: 'サンプル',
}

function formatDate(value: string): string {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(parsed)
}

function SelfConsumptionModal({
  open,
  products,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  products: ProductWithInventory[]
  initial: SelfConsumptionRecord | null
  onClose: () => void
  onSave: (input: SelfConsumptionRecordInput) => Promise<void>
}) {
  const [form, setForm] = useState<SelfConsumptionRecordInput>({
    productId: products[0]?.id ?? '',
    quantityKg: 0,
    usedOn: new Date().toISOString().slice(0, 10),
    usageType: 'retail',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setForm({
      productId: initial?.productId ?? products[0]?.id ?? '',
      quantityKg: initial?.quantityKg ?? 0,
      usedOn: initial?.usedOn ?? new Date().toISOString().slice(0, 10),
      usageType: initial?.usageType ?? 'retail',
      notes: initial?.notes ?? '',
    })
    setError('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const selectedProduct = products.find(product => product.id === form.productId)
  const currentQty = initial?.productId === form.productId ? initial.quantityKg : 0
  const remainingStock = (selectedProduct?.currentStockKg ?? 0) + currentQty - form.quantityKg

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
      await onSave({
        ...form,
        usedOn: form.usedOn.trim(),
        notes: form.notes?.trim() || undefined,
      })
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
            <h2 className="text-xl font-semibold text-ink">{initial ? '自社消費を編集' : '自社消費を登録'}</h2>
            <p className="mt-1 text-sm text-mist">小売やサンプルなど、社内利用分を在庫から差し引きます。</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 transition hover:bg-bone hover:text-mist">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-alert/40 bg-alert/5 px-4 py-3 text-sm text-alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">商品</label>
              <select
                required
                value={form.productId}
                onChange={event => setForm(prev => ({ ...prev, productId: event.target.value }))}
                className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              >
                {products.map(product => (
                  <option key={product.id} value={product.id}>
                    {product.name} ({product.sku})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">数量 (kg)</label>
              <input
                required
                type="number"
                min="0.1"
                step="0.1"
                value={form.quantityKg}
                onChange={event => setForm(prev => ({ ...prev, quantityKg: Number(event.target.value) || 0 }))}
                className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">日付</label>
              <input
                required
                type="date"
                value={form.usedOn}
                onChange={event => setForm(prev => ({ ...prev, usedOn: event.target.value }))}
                className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">用途</label>
              <select
                value={form.usageType}
                onChange={event => setForm(prev => ({ ...prev, usageType: event.target.value as SelfConsumptionUsageType }))}
                className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              >
                <option value="ingredient">原料</option>
                <option value="retail">小売</option>
                <option value="sample">サンプル</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-graphite">備考</label>
            <textarea
              value={form.notes ?? ''}
              onChange={event => setForm(prev => ({ ...prev, notes: event.target.value }))}
              rows={3}
              className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              placeholder="用途の補足やメモ"
            />
          </div>

          <div className="rounded-2xl border border-line bg-bone p-4">
            <p className="text-xs text-mist">登録後の残在庫</p>
            <p className={`mt-1 text-lg font-semibold ${remainingStock < 0 ? 'text-alert' : 'text-ink'}`}>
              {formatKg(remainingStock)}
            </p>
          </div>

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
              disabled={saving || products.length === 0}
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

export default function SelfConsumptionPage() {
  const [records, setRecords] = useState<SelfConsumptionRecord[]>([])
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [usageFilter, setUsageFilter] = useState<'all' | SelfConsumptionUsageType>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<SelfConsumptionRecord | null>(null)
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const [nextRecords, nextProducts] = await Promise.all([
      services.selfConsumption.getSelfConsumptionRecords(),
      services.inventory.getProductsWithInventory(),
    ])
    setRecords(nextRecords)
    setProducts(nextProducts)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const filteredRecords = useMemo(() => records.filter(record => {
    if (usageFilter !== 'all' && record.usageType !== usageFilter) return false
    if (!search) return true
    const query = search.toLowerCase()
    return (
      record.productName.toLowerCase().includes(query) ||
      record.productSku.toLowerCase().includes(query) ||
      usageLabels[record.usageType].toLowerCase().includes(query) ||
      (record.notes ?? '').toLowerCase().includes(query)
    )
  }), [records, search, usageFilter])

  const totalKg = filteredRecords.reduce((sum, record) => sum + record.quantityKg, 0)
  const retailKg = filteredRecords
    .filter(record => record.usageType === 'retail')
    .reduce((sum, record) => sum + record.quantityKg, 0)
  const sampleKg = filteredRecords
    .filter(record => record.usageType === 'sample')
    .reduce((sum, record) => sum + record.quantityKg, 0)
  const ingredientKg = filteredRecords
    .filter(record => record.usageType === 'ingredient')
    .reduce((sum, record) => sum + record.quantityKg, 0)

  const handleSave = async (input: SelfConsumptionRecordInput) => {
    const services = await getServices()
    if (editingRecord) {
      await services.selfConsumption.updateSelfConsumptionRecord(editingRecord.id, input)
      setMessage('自社消費を更新しました')
    } else {
      await services.selfConsumption.createSelfConsumptionRecord(input)
      setMessage('自社消費を登録しました')
    }
    setEditingRecord(null)
    setModalOpen(false)
    await load()
  }

  const handleDelete = async (record: SelfConsumptionRecord) => {
    if (!confirm(`${record.productName} の自社消費記録を削除しますか？`)) return
    const services = await getServices()
    await services.selfConsumption.deleteSelfConsumptionRecord(record.id)
    setMessage('自社消費を削除しました')
    await load()
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="mt-3 text-3xl font-bold text-ink">自社消費</h1>
            <p className="mt-2 text-sm text-mist">原料・小売・サンプルなどの社内利用分を記録して在庫へ反映します。</p>
          </div>
          <button
            onClick={() => {
              setEditingRecord(null)
              setModalOpen(true)
            }}
            disabled={products.length === 0}
            className="inline-flex items-center gap-2 self-start rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-paper transition hover:bg-matchaDeep disabled:bg-[#4f7c65]"
          >
            <Plus size={16} />
            新規作成
          </button>
        </div>

        {message && (
          <div className="rounded-xl border border-matcha/40 bg-bone px-4 py-3 text-sm text-matcha">
            {message}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KPICard title="自社消費合計" value={formatKg(totalKg)} color="amber" icon={<Package2 size={18} />} />
          <KPICard title="原料" value={formatKg(ingredientKg)} color="violet" icon={<Package2 size={18} />} />
          <KPICard title="小売向け" value={formatKg(retailKg)} color="default" icon={<Package2 size={18} />} />
          <KPICard title="サンプル" value={formatKg(sampleKg)} color="green" icon={<Package2 size={18} />} />
        </div>

        <div className="rounded-3xl border border-line bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-ink">自社消費一覧</h2>
              {products.length === 0 && (
                <p className="mt-1 text-sm text-alert">先に在庫管理で商品を登録してください。</p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="商品名・SKU・用途で検索"
                  className="w-full rounded-xl border border-line py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-matcha sm:w-56"
                />
              </div>
              <select
                value={usageFilter}
                onChange={event => setUsageFilter(event.target.value as 'all' | SelfConsumptionUsageType)}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha sm:w-auto"
              >
                <option value="all">すべての用途</option>
                <option value="ingredient">原料</option>
                <option value="retail">小売</option>
                <option value="sample">サンプル</option>
              </select>
            </div>
          </div>

          <div className="mt-5 space-y-3 md:hidden">
            {!loading && filteredRecords.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-sm text-mist">
                条件に合う自社消費の記録はありません。
              </div>
            )}
            {filteredRecords.map(record => (
              <div key={record.id} className="rounded-2xl border border-line bg-bone p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-ink">{record.productName}</div>
                    <div className="mt-1 text-xs text-mist">{record.productSku}</div>
                  </div>
                  <div className="rounded-full bg-white px-3 py-1 text-xs font-medium text-ink">
                    {usageLabels[record.usageType]}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-white p-3 text-xs text-mist">
                    <div>日付 {formatDate(record.usedOn)}</div>
                    <div className="mt-1 font-semibold text-ink">数量 {formatKg(record.quantityKg)}</div>
                  </div>
                  <div className="rounded-xl bg-white p-3 text-xs text-mist">
                    <div>備考 {record.notes || '-'}</div>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setEditingRecord(record)
                      setModalOpen(true)
                    }}
                    className="rounded-lg p-2 text-gray-400 transition hover:bg-bone hover:text-matchaDeep"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(record)}
                    className="rounded-lg p-2 text-gray-400 transition hover:bg-alert/5 hover:text-alert"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[#e6dfcf] text-left text-mist">
                  <th className="px-3 py-3 font-medium">日付</th>
                  <th className="px-3 py-3 font-medium">商品</th>
                  <th className="px-3 py-3 font-medium">数量</th>
                  <th className="px-3 py-3 font-medium">用途</th>
                  <th className="px-3 py-3 font-medium">備考</th>
                  <th className="px-3 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filteredRecords.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-mist">
                      条件に合う自社消費の記録はありません。
                    </td>
                  </tr>
                )}
                {filteredRecords.map(record => (
                  <tr key={record.id} className="border-b border-[#f0ebdf] text-ink">
                    <td className="px-3 py-4">{formatDate(record.usedOn)}</td>
                    <td className="px-3 py-4">
                      <div className="font-medium">{record.productName}</div>
                      <div className="text-xs text-mist">{record.productSku}</div>
                    </td>
                    <td className="px-3 py-4">{formatKg(record.quantityKg)}</td>
                    <td className="px-3 py-4">{usageLabels[record.usageType]}</td>
                    <td className="px-3 py-4">{record.notes || '-'}</td>
                    <td className="px-3 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditingRecord(record)
                            setModalOpen(true)
                          }}
                          className="rounded-lg p-2 text-gray-400 transition hover:bg-bone hover:text-matchaDeep"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(record)}
                          className="rounded-lg p-2 text-gray-400 transition hover:bg-alert/5 hover:text-alert"
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

        <SelfConsumptionModal
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
