'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { StockStatusBadge } from '@/components/ui/StatusBadge'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type {
  InventoryGroup,
  InventoryGroupInput,
  ProductInput,
  ProductWithInventory,
} from '@/types'
import { GripVertical, Pencil, Plus, Search, Trash2, X } from 'lucide-react'

function ProductModal({
  open,
  initial,
  groups,
  defaultGroupId,
  onClose,
  onSave,
}: {
  open: boolean
  initial?: Partial<ProductInput> & { id?: string }
  groups: InventoryGroup[]
  defaultGroupId: string
  onClose: () => void
  onSave: (input: ProductInput) => Promise<void>
}) {
  const [form, setForm] = useState<ProductInput>({
    sku: '',
    name: '',
    arrivalDate: '',
    inventoryGroupId: defaultGroupId,
    initialStockKg: 0,
    haizUsedKg: 0,
    variety: '',
    process: '',
    producer: '',
    farm: '',
    altitude: '',
    region: '',
    price: undefined,
    cost: undefined,
    ...initial,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setForm({
      sku: '',
      name: '',
      arrivalDate: '',
      inventoryGroupId: defaultGroupId,
      initialStockKg: 0,
      haizUsedKg: 0,
      variety: '',
      process: '',
      producer: '',
      farm: '',
      altitude: '',
      region: '',
      price: undefined,
      cost: undefined,
      ...initial,
    })
    setError('')
  }, [open, initial, defaultGroupId])

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
          <h2 className="text-xl font-semibold text-[#173c2a]">{initial?.id ? '商品編集' : '商品登録'}</h2>
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
              <label className="mb-1 block text-sm font-medium text-gray-700">SKU</label>
              <input
                type="text"
                required
                disabled={Boolean(initial?.id)}
                value={form.sku}
                onChange={event => setForm(prev => ({ ...prev, sku: event.target.value }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-gray-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">商品名</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">入荷月</label>
              <input
                type="text"
                required
                placeholder="2026/04"
                value={form.arrivalDate}
                onChange={event => setForm(prev => ({ ...prev, arrivalDate: event.target.value }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">在庫グループ</label>
              <select
                value={form.inventoryGroupId}
                onChange={event => setForm(prev => ({ ...prev, inventoryGroupId: event.target.value }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                {groups.map(group => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">shopify在庫分 (kg)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={form.haizUsedKg}
                onChange={event => setForm(prev => ({ ...prev, haizUsedKg: Number(event.target.value) || 0 }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">初期在庫 (kg)</label>
              <input
                type="number"
                required
                min="0"
                step="0.1"
                value={form.initialStockKg}
                onChange={event => setForm(prev => ({ ...prev, initialStockKg: Number(event.target.value) || 0 }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">売価 (円/kg)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.price ?? ''}
                onChange={event => setForm(prev => ({ ...prev, price: event.target.value ? Number(event.target.value) : undefined }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">原価 (円/kg)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={form.cost ?? ''}
                onChange={event => setForm(prev => ({ ...prev, cost: event.target.value ? Number(event.target.value) : undefined }))}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-[#e6dfcf] bg-[#f7f5ee] p-4 space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#68756c]">任意の属性</p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">品種</label>
                <input
                  type="text"
                  value={form.variety ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, variety: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">製法</label>
                <input
                  type="text"
                  value={form.process ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, process: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">生産者</label>
                <input
                  type="text"
                  value={form.producer ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, producer: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">農園 / 工房</label>
                <input
                  type="text"
                  value={form.farm ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, farm: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">標高</label>
                <input
                  type="text"
                  value={form.altitude ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, altitude: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">産地</label>
                <input
                  type="text"
                  value={form.region ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, region: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
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

function GroupModal({
  open,
  initial,
  onClose,
  onSave,
}: {
  open: boolean
  initial: InventoryGroup | null
  onClose: () => void
  onSave: (input: InventoryGroupInput) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setError('')
  }, [open, initial])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
      await onSave({ name })
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
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[#173c2a]">{initial ? 'グループ編集' : 'グループ追加'}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">グループ名</label>
            <input
              required
              autoFocus
              value={name}
              onChange={event => setName(event.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div className="flex gap-3">
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

export default function InventoryPage() {
  const [groups, setGroups] = useState<InventoryGroup[]>([])
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [loading, setLoading] = useState(true)
  const [activeGroupId, setActiveGroupId] = useState('')
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<ProductWithInventory | null>(null)
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<InventoryGroup | null>(null)
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error'>('success')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragGroupId, setDragGroupId] = useState<string | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)
  const { user } = useAuth()

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const [nextGroups, nextProducts] = await Promise.all([
      services.inventory.getInventoryGroups(),
      services.inventory.getProductsWithInventory(),
    ])
    setGroups(nextGroups)
    setProducts(nextProducts)
    setActiveGroupId(prev => {
      if (prev && nextGroups.some(group => group.id === prev)) return prev
      return nextGroups[0]?.id ?? ''
    })
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  const groupProducts = useMemo(() => (
    products
      .filter(product => product.inventoryGroupId === activeGroupId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
  ), [products, activeGroupId])

  const filtered = useMemo(() => {
    if (!search) return groupProducts
    const query = search.toLowerCase()
    return groupProducts.filter(product => (
      product.sku.toLowerCase().includes(query) ||
      product.name.toLowerCase().includes(query)
    ))
  }, [groupProducts, search])

  const totalInitialStockKg = useMemo(() => groupProducts.reduce((sum, product) => sum + product.initialStockKg, 0), [groupProducts])
  const totalCurrentStockKg = useMemo(() => groupProducts.reduce((sum, product) => sum + product.currentStockKg, 0), [groupProducts])
  const totalAllocatedKg = useMemo(() => groupProducts.reduce((sum, product) => sum + product.salesAllocatedKg, 0), [groupProducts])
  const isDraggable = !search && user?.role === 'admin'

  const handleSaveProduct = async (input: ProductInput) => {
    const services = await getServices()
    if (editingProduct) {
      await services.inventory.updateProduct(editingProduct.id, input)
      setFeedbackTone('success')
      setFeedbackMessage('商品情報を更新しました')
    } else {
      await services.inventory.createProduct(input)
      setFeedbackTone('success')
      setFeedbackMessage('商品を登録しました')
    }
    setModalOpen(false)
    setEditingProduct(null)
    await load()
  }

  const handleSaveGroup = async (input: InventoryGroupInput) => {
    const services = await getServices()
    if (editingGroup) {
      await services.inventory.updateInventoryGroup(editingGroup.id, input)
      setFeedbackMessage('グループ名を更新しました')
    } else {
      await services.inventory.createInventoryGroup(input)
      setFeedbackMessage('グループを追加しました')
    }
    setFeedbackTone('success')
    setGroupModalOpen(false)
    setEditingGroup(null)
    await load()
  }

  const handleDeleteProduct = async (product: ProductWithInventory) => {
    if (!confirm(`${product.name} を削除しますか？`)) return
    try {
      const services = await getServices()
      await services.inventory.deleteProduct(product.id)
      setFeedbackTone('success')
      setFeedbackMessage('商品を削除しました')
      await load()
    } catch (err) {
      setFeedbackTone('error')
      setFeedbackMessage(err instanceof Error ? err.message : '商品の削除に失敗しました')
    }
  }

  const handleDeleteGroup = async (group: InventoryGroup) => {
    if (!confirm(`グループ「${group.name}」を削除しますか？`)) return
    try {
      const services = await getServices()
      await services.inventory.deleteInventoryGroup(group.id)
      setFeedbackTone('success')
      setFeedbackMessage('グループを削除しました')
      await load()
    } catch (err) {
      setFeedbackTone('error')
      setFeedbackMessage(err instanceof Error ? err.message : 'グループの削除に失敗しました')
    }
  }

  const handleProductDrop = async (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null)
      setDragOverId(null)
      return
    }

    const orderedIds = groupProducts.map(product => product.id)
    const from = orderedIds.indexOf(dragId)
    const to = orderedIds.indexOf(targetId)
    if (from === -1 || to === -1) return

    const nextOrder = [...orderedIds]
    nextOrder.splice(from, 1)
    nextOrder.splice(to, 0, dragId)

    const services = await getServices()
    await services.inventory.updateProductsSortOrder(nextOrder)
    setDragId(null)
    setDragOverId(null)
    await load()
  }

  const handleGroupDrop = async (targetGroupId: string) => {
    if (!dragGroupId || dragGroupId === targetGroupId) {
      setDragGroupId(null)
      setDragOverGroupId(null)
      return
    }

    const orderedIds = groups.map(group => group.id)
    const from = orderedIds.indexOf(dragGroupId)
    const to = orderedIds.indexOf(targetGroupId)
    if (from === -1 || to === -1) return

    const nextOrder = [...orderedIds]
    nextOrder.splice(from, 1)
    nextOrder.splice(to, 0, dragGroupId)

    const services = await getServices()
    await services.inventory.updateInventoryGroupsSortOrder(nextOrder)
    setDragGroupId(null)
    setDragOverGroupId(null)
    await load()
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="text-sm text-[#68756c]">在庫データを読み込み中...</div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#173c2a]">在庫マスター</h1>
            <p className="text-sm text-[#68756c] mt-1">全{products.length}件</p>
          </div>
          {user?.role === 'admin' && (
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setEditingGroup(null)
                  setGroupModalOpen(true)
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                <Plus size={16} />
                グループ追加
              </button>
              <button
                onClick={() => {
                  setEditingProduct(null)
                  setModalOpen(true)
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-[#174c33] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#123723]"
              >
                <Plus size={16} />
                商品登録
              </button>
            </div>
          )}
        </div>

        {feedbackMessage && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${
            feedbackTone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}>
            {feedbackMessage}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <p className="text-sm text-[#68756c]">総商品数</p>
            <p className="mt-1 text-3xl font-bold text-[#173c2a]">{groupProducts.length}</p>
          </div>
          <div className="rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <p className="text-sm text-[#68756c]">総在庫量</p>
            <p className="mt-1 text-3xl font-bold text-[#173c2a]">{totalInitialStockKg.toFixed(1)} kg</p>
          </div>
          <div className="rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <p className="text-sm text-[#68756c]">残在庫量 / 販売引当</p>
            <p className={`mt-1 text-3xl font-bold ${totalCurrentStockKg <= totalInitialStockKg * 0.2 ? 'text-amber-600' : 'text-[#173c2a]'}`}>
              {totalCurrentStockKg.toFixed(1)} kg
            </p>
            <p className="mt-1 text-sm text-[#68756c]">引当 {totalAllocatedKg.toFixed(1)} kg</p>
          </div>
        </div>

        <div className="flex items-center border-b border-gray-200 gap-1 overflow-x-auto">
            {groups.map(group => (
              <div
                key={group.id}
                draggable={user?.role === 'admin'}
                onDragStart={() => setDragGroupId(group.id)}
                onDragOver={event => {
                  if (user?.role !== 'admin') return
                  event.preventDefault()
                  setDragOverGroupId(group.id)
                }}
                onDragLeave={() => setDragOverGroupId(prev => (prev === group.id ? null : prev))}
                onDrop={() => handleGroupDrop(group.id)}
                onDragEnd={() => {
                  setDragGroupId(null)
                  setDragOverGroupId(null)
                }}
                className={`group flex shrink-0 items-center gap-1 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px cursor-pointer transition-colors ${
                  activeGroupId === group.id
                    ? 'border-[#174c33] text-[#174c33]'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                } ${dragOverGroupId === group.id && dragGroupId !== group.id ? 'bg-[#eef3eb]' : ''} ${dragGroupId === group.id ? 'opacity-50' : ''}`}
                onClick={() => setActiveGroupId(group.id)}
              >
                {user?.role === 'admin' && <GripVertical size={14} className="text-gray-300" />}
                {group.name}
                <span className="ml-1 text-xs text-gray-400">
                  ({products.filter(product => product.inventoryGroupId === group.id).length})
                </span>
                {user?.role === 'admin' && (
                  <>
                    <button
                      onClick={event => {
                        event.stopPropagation()
                        setEditingGroup(group)
                        setGroupModalOpen(true)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-[#174c33] transition-all"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={event => {
                        event.stopPropagation()
                        void handleDeleteGroup(group)
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-red-600 transition-all"
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            ))}
        </div>

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="SKU or 商品名で検索..."
            className="w-full rounded-xl border border-gray-300 py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 md:w-80"
          />
        </div>

        <div className="overflow-hidden rounded-2xl border border-[#d9d1be] bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#f7f5ee]">
                <tr>
                  {user?.role === 'admin' && <th className="w-10 px-4 py-3 text-left font-medium text-[#68756c]" />}
                  <th className="px-4 py-3 text-left font-medium text-[#68756c]">SKU</th>
                  <th className="px-4 py-3 text-left font-medium text-[#68756c]">商品名</th>
                  <th className="px-4 py-3 text-left font-medium text-[#68756c]">品種 / 製法</th>
                  <th className="px-4 py-3 text-left font-medium text-[#68756c]">産地</th>
                  <th className="px-4 py-3 text-left font-medium text-[#68756c]">初期在庫</th>
                  <th className="px-4 py-3 text-left font-medium text-[#68756c]">shopify在庫分</th>
                  <th className="px-4 py-3 text-left font-medium text-[#68756c]">販売引当</th>
                  <th className="px-4 py-3 text-left font-medium text-[#68756c]">現在在庫</th>
                  <th className="px-4 py-3 text-left font-medium text-[#68756c]">状態</th>
                  {user?.role === 'admin' && <th className="px-4 py-3 text-right font-medium text-[#68756c]">操作</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(product => (
                  <tr
                    key={product.id}
                    draggable={isDraggable}
                    onDragStart={() => setDragId(product.id)}
                    onDragOver={event => {
                      if (!isDraggable) return
                      event.preventDefault()
                      setDragOverId(product.id)
                    }}
                    onDragLeave={() => setDragOverId(prev => (prev === product.id ? null : prev))}
                    onDrop={() => handleProductDrop(product.id)}
                    className={`border-t border-[#ece5d7] hover:bg-[#faf8f2] ${dragOverId === product.id ? 'bg-[#eef3eb]' : ''}`}
                  >
                    {user?.role === 'admin' && (
                      <td className="px-4 py-4 align-top text-gray-400">
                        <GripVertical size={16} />
                      </td>
                    )}
                    <td className="px-4 py-4 font-mono text-gray-700">{product.sku}</td>
                    <td className="px-4 py-4">
                      <div className="font-medium text-[#173c2a]">{product.name}</div>
                      <div className="text-xs text-[#68756c]">{product.arrivalDate}</div>
                    </td>
                    <td className="px-4 py-4 text-gray-700">
                      <div>{product.variety || '-'}</div>
                      <div className="text-xs text-[#68756c]">{product.process || '-'}</div>
                    </td>
                    <td className="px-4 py-4 text-gray-700">{product.region || '-'}</td>
                    <td className="px-4 py-4 text-gray-700">{product.initialStockKg.toFixed(1)} kg</td>
                    <td className="px-4 py-4 text-gray-700">{product.haizUsedKg.toFixed(1)} kg</td>
                    <td className="px-4 py-4 text-gray-700">{product.salesAllocatedKg.toFixed(1)} kg</td>
                    <td className="px-4 py-4 font-semibold text-[#173c2a]">{product.currentStockKg.toFixed(1)} kg</td>
                    <td className="px-4 py-4"><StockStatusBadge status={product.stockStatus} /></td>
                    {user?.role === 'admin' && (
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => {
                              setEditingProduct(product)
                              setModalOpen(true)
                            }}
                            className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteProduct(product)}
                            className="rounded-lg p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={user?.role === 'admin' ? 11 : 10} className="px-4 py-12 text-center text-[#68756c]">
                      商品がありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <ProductModal
          open={modalOpen}
          initial={editingProduct ? { ...editingProduct, id: editingProduct.id } : undefined}
          groups={groups}
          defaultGroupId={activeGroupId || groups[0]?.id || ''}
          onClose={() => {
            setModalOpen(false)
            setEditingProduct(null)
          }}
          onSave={handleSaveProduct}
        />

        <GroupModal
          open={groupModalOpen}
          initial={editingGroup}
          onClose={() => {
            setGroupModalOpen(false)
            setEditingGroup(null)
          }}
          onSave={handleSaveGroup}
        />
      </div>
    </AppLayout>
  )
}
