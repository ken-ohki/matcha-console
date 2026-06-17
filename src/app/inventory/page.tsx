'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppLayout } from '@/components/layout/AppLayout'
import { StockStatusBadge } from '@/components/ui/StatusBadge'
import { useAuth } from '@/contexts/AuthContext'
import { formatCultivars, formatOptionList } from '@/lib/product-master'
import { optionsForType, translateValues, type MasterOption } from '@/lib/masters'
import { getServices } from '@/lib/services'
import type {
  InventoryGroup,
  InventoryGroupInput,
  MasterEntry,
  ProductInput,
  ProductWithInventory,
} from '@/types'
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Download, GripVertical, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import * as XLSX from 'xlsx'
import {
  ProductModal,
} from '@/components/inventory/ProductModal'

function formatCurrency(value?: number): string {
  if (value == null) return '-'
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(value)
}

function compactText(value?: string): string {
  return value?.trim() || '-'
}

function formatKg(value: number): string {
  return `${value.toFixed(1)} kg`
}

function InventoryFilterBar({
  groupProducts,
  masters,
  gradeFilters,
  setGradeFilters,
  originFilters,
  setOriginFilters,
  statusFilters,
  setStatusFilters,
  catalogFilter,
  setCatalogFilter,
  askFilter,
  setAskFilter,
}: {
  groupProducts: ProductWithInventory[]
  masters: MasterEntry[]
  gradeFilters: Set<string>
  setGradeFilters: (next: Set<string>) => void
  originFilters: Set<string>
  setOriginFilters: (next: Set<string>) => void
  statusFilters: Set<'out' | 'low' | 'normal'>
  setStatusFilters: (next: Set<'out' | 'low' | 'normal'>) => void
  catalogFilter: 'all' | 'visible' | 'hidden'
  setCatalogFilter: (next: 'all' | 'visible' | 'hidden') => void
  askFilter: 'all' | 'ask' | 'normal'
  setAskFilter: (next: 'all' | 'ask' | 'normal') => void
}) {
  const gradeOptions = useMemo(() => {
    const all = new Set<string>()
    groupProducts.forEach(p => { if (p.grade) all.add(p.grade) })
    const ordered = optionsForType(masters, 'grade').map(o => o.value).filter(name => all.has(name))
    const extras = Array.from(all).filter(name => !ordered.includes(name)).sort()
    return [...ordered, ...extras]
  }, [groupProducts, masters])

  const originOptions = useMemo(() => {
    const all = new Set<string>()
    groupProducts.forEach(p => p.origins.forEach(o => all.add(o)))
    const ordered = optionsForType(masters, 'origin').map(o => o.value).filter(name => all.has(name))
    const extras = Array.from(all).filter(name => !ordered.includes(name)).sort()
    return [...ordered, ...extras]
  }, [groupProducts, masters])

  const toggleSet = <T extends string>(set: Set<T>, value: T, setter: (next: Set<T>) => void) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setter(next)
  }

  const anyActive =
    gradeFilters.size > 0 ||
    originFilters.size > 0 ||
    statusFilters.size > 0 ||
    catalogFilter !== 'all' ||
    askFilter !== 'all'

  const clearAll = () => {
    setGradeFilters(new Set())
    setOriginFilters(new Set())
    setStatusFilters(new Set())
    setCatalogFilter('all')
    setAskFilter('all')
  }

  const pillBase = 'rounded-full border px-2.5 py-1 text-xs transition'
  const pillOn = 'border-[#174c33] bg-[#174c33] text-white'
  const pillOff = 'border-[#d9d1be] bg-white text-[#173c2a] hover:bg-[#f7f5ee]'

  return (
    <div className="space-y-2 rounded-2xl border border-[#e6dfcf] bg-[#faf8f1] p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#68756c]">フィルター</span>
        {anyActive && (
          <button type="button" onClick={clearAll} className="text-xs text-[#174c33] underline hover:text-[#205f43]">
            すべてクリア
          </button>
        )}
      </div>

      {gradeOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[#68756c] mr-1">グレード:</span>
          {gradeOptions.map(g => (
            <button
              key={g}
              type="button"
              onClick={() => toggleSet(gradeFilters, g, setGradeFilters)}
              className={`${pillBase} ${gradeFilters.has(g) ? pillOn : pillOff}`}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {originOptions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-[#68756c] mr-1">産地:</span>
          {originOptions.map(o => (
            <button
              key={o}
              type="button"
              onClick={() => toggleSet(originFilters, o, setOriginFilters)}
              className={`${pillBase} ${originFilters.has(o) ? pillOn : pillOff}`}
            >
              {o}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-[#68756c] mr-1">状態:</span>
        {([
          ['normal', '在庫あり'],
          ['low', '少'],
          ['out', '在庫切れ'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => toggleSet(statusFilters, key, setStatusFilters)}
            className={`${pillBase} ${statusFilters.has(key) ? pillOn : pillOff}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-[#68756c] mr-1">カタログ:</span>
        {([
          ['all', 'すべて'],
          ['visible', '公開'],
          ['hidden', '非公開'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setCatalogFilter(key)}
            className={`${pillBase} ${catalogFilter === key ? pillOn : pillOff}`}
          >
            {label}
          </button>
        ))}
        <span className="text-xs text-[#68756c] ml-3 mr-1">ASK:</span>
        {([
          ['all', 'すべて'],
          ['ask', 'ASK'],
          ['normal', '通常'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setAskFilter(key)}
            className={`${pillBase} ${askFilter === key ? pillOn : pillOff}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

type InventorySortKey = 'manual' | 'sku' | 'name' | 'tea' | 'origin' | 'stock' | 'price' | 'status'

function SortableTh({
  label,
  sortKey,
  current,
  dir,
  onSort,
  align = 'left',
}: {
  label: string
  sortKey: Exclude<InventorySortKey, 'manual'>
  current: InventorySortKey
  dir: 'asc' | 'desc'
  onSort: (key: InventorySortKey) => void
  align?: 'left' | 'right'
}) {
  const active = current === sortKey
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <th className={`px-4 py-3 font-medium text-[#68756c] ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 transition hover:text-[#173c2a] ${active ? 'text-[#173c2a]' : ''}`}
      >
        <span>{label}</span>
        <Icon size={11} className={active ? '' : 'opacity-40'} />
      </button>
    </th>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl sm:p-6">
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
  const [masters, setMasters] = useState<MasterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [activeGroupId, setActiveGroupId] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<'manual' | 'sku' | 'name' | 'tea' | 'origin' | 'stock' | 'price' | 'status'>('manual')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [gradeFilters, setGradeFilters] = useState<Set<string>>(new Set())
  const [originFilters, setOriginFilters] = useState<Set<string>>(new Set())
  const [statusFilters, setStatusFilters] = useState<Set<'out' | 'low' | 'normal'>>(new Set())
  const [catalogFilter, setCatalogFilter] = useState<'all' | 'visible' | 'hidden'>('all')
  const [askFilter, setAskFilter] = useState<'all' | 'ask' | 'normal'>('all')
  const [modalOpen, setModalOpen] = useState(false)
  const [prefillProduct, setPrefillProduct] = useState<Partial<ProductWithInventory> | null>(null)

  const handleDuplicateProduct = (product: ProductWithInventory) => {
    setPrefillProduct({
      ...product,
      id: undefined,
      sku: `${product.sku}-COPY`,
      name: `${product.name} (コピー)`,
      arrivalRecords: [],
      inventoryChecks: [],
      arrivalDate: '',
      initialStockKg: 0,
      salesAllocatedKg: 0,
      selfConsumedKg: 0,
      inventoryAdjustmentKg: 0,
      currentStockKg: 0,
      latestInventoryCheck: undefined,
      isActive: true,
    })
    setModalOpen(true)
  }
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<InventoryGroup | null>(null)
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error'>('success')
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [dragGroupId, setDragGroupId] = useState<string | null>(null)
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null)
  const { user } = useAuth()
  const router = useRouter()
  const openDetail = (id: string) => router.push(`/inventory/${id}`)

  const load = async (preferredActiveGroupId?: string) => {
    setLoading(true)
    const services = await getServices()
    const [nextGroups, nextProducts, nextMasters] = await Promise.all([
      services.inventory.getInventoryGroups(),
      services.inventory.getProductsWithInventory(),
      services.masters.listMasters(),
    ])
    setGroups(nextGroups)
    setProducts(nextProducts)
    setMasters(nextMasters)
    setActiveGroupId(prev => {
      if (preferredActiveGroupId && nextGroups.some(group => group.id === preferredActiveGroupId)) {
        return preferredActiveGroupId
      }
      if (prev === 'all') return 'all'
      if (prev && nextGroups.some(group => group.id === prev)) return prev
      return 'all'
    })
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  // Re-fetch when the tab regains focus / becomes visible, so changes made
  // on other pages (e.g. a new sale) are reflected without a manual reload.
  useEffect(() => {
    const handler = () => {
      if (modalOpen) return
      if (document.visibilityState === 'visible') {
        void load()
      }
    }
    document.addEventListener('visibilitychange', handler)
    window.addEventListener('focus', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen])

  const groupProducts = useMemo(() => {
    if (activeGroupId === 'all') {
      const groupOrder = new Map(groups.map((group, index) => [group.id, index]))
      return [...products].sort((a, b) => {
        const ga = groupOrder.get(a.inventoryGroupId) ?? Number.MAX_SAFE_INTEGER
        const gb = groupOrder.get(b.inventoryGroupId) ?? Number.MAX_SAFE_INTEGER
        if (ga !== gb) return ga - gb
        return a.sortOrder - b.sortOrder
      })
    }
    return products
      .filter(product => product.inventoryGroupId === activeGroupId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [products, activeGroupId, groups])

  const filtered = useMemo(() => {
    const searched = groupProducts.filter(product => {
      if (search) {
        const searchText = [
          product.sku,
          product.name,
          product.purchaseProductName,
          product.supplier,
          product.teaType,
          product.grade,
          ...product.origins,
          ...product.cultivars,
          ...product.certifications,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!searchText.includes(search.toLowerCase())) return false
      }
      if (gradeFilters.size > 0 && !(product.grade && gradeFilters.has(product.grade))) return false
      if (originFilters.size > 0 && !product.origins.some(o => originFilters.has(o))) return false
      if (statusFilters.size > 0 && !statusFilters.has(product.stockStatus)) return false
      if (catalogFilter === 'visible' && !product.showInCatalog) return false
      if (catalogFilter === 'hidden' && product.showInCatalog) return false
      if (askFilter === 'ask' && !product.inquireToOrder) return false
      if (askFilter === 'normal' && product.inquireToOrder) return false
      return true
    })

    if (sortKey === 'manual') return searched

    const STATUS_RANK: Record<string, number> = { out: 0, low: 1, normal: 2 }
    const sorted = [...searched].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      switch (sortKey) {
        case 'sku': return a.sku.localeCompare(b.sku) * dir
        case 'name': return a.name.localeCompare(b.name) * dir
        case 'tea': return ((a.teaType ?? '') + (a.grade ?? '')).localeCompare((b.teaType ?? '') + (b.grade ?? '')) * dir
        case 'origin': return (a.origins[0] ?? '').localeCompare(b.origins[0] ?? '') * dir
        case 'stock': return (a.currentStockKg - b.currentStockKg) * dir
        case 'price': return ((a.standardWholesalePrice ?? 0) - (b.standardWholesalePrice ?? 0)) * dir
        case 'status': return ((STATUS_RANK[a.stockStatus] ?? 99) - (STATUS_RANK[b.stockStatus] ?? 99)) * dir
        default: return 0
      }
    })
    return sorted
  }, [groupProducts, search, sortKey, sortDir, gradeFilters, originFilters, statusFilters, catalogFilter, askFilter])

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) {
      if (sortDir === 'asc') {
        setSortDir('desc')
      } else {
        // 3rd click returns to manual (drag) order
        setSortKey('manual')
        setSortDir('asc')
      }
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const totalInitialStockKg = useMemo(() => groupProducts.reduce((sum, product) => sum + product.initialStockKg, 0), [groupProducts])
  const totalCurrentStockKg = useMemo(() => groupProducts.reduce((sum, product) => sum + product.currentStockKg, 0), [groupProducts])
  const totalAllocatedKg = useMemo(() => groupProducts.reduce((sum, product) => sum + product.salesAllocatedKg, 0), [groupProducts])
  const totalSelfConsumedKg = useMemo(() => groupProducts.reduce((sum, product) => sum + product.selfConsumedKg, 0), [groupProducts])
  const isDraggable = !search && sortKey === 'manual' && user?.role === 'admin' && activeGroupId !== 'all'

  const handleExportExcel = () => {
    const groupName = (id: string) => groups.find(g => g.id === id)?.name ?? ''
    const ja = (type: Parameters<typeof translateValues>[1], values: string[] | undefined) =>
      translateValues(masters, type, values).join('、')
    const jaOne = (type: Parameters<typeof translateValues>[1], value?: string) =>
      value ? translateValues(masters, type, [value])[0] : ''

    const rows = filtered.map(product => {
      const wholesale = product.standardWholesalePrice ?? null
      const cost = product.purchaseUnitPrice ?? null
      const margin = wholesale != null && cost != null ? wholesale - cost : null
      const marginRate = wholesale != null && cost != null && wholesale > 0
        ? Math.round(((wholesale - cost) / wholesale) * 1000) / 10
        : null
      return {
        SKU: product.sku,
        '商品名': product.name,
        '仕入れ商品名': product.purchaseProductName ?? '',
        'グループ': groupName(product.inventoryGroupId),
        '茶種': jaOne('tea_type', product.teaType),
        'グレード': jaOne('grade', product.grade),
        '産地': ja('origin', product.origins),
        '品種': ja('cultivar', product.cultivars),
        '摘採方法': ja('plucking', product.pluckingMethods),
        '摘採時期': ja('harvest', product.harvestSeasons),
        '被覆方法': ja('shading', product.shadingMethods),
        '認証': ja('certification', product.certifications),
        '仕入先': product.supplier ?? '',
        '仕入単価 (JPY/kg)': cost,
        '標準卸売単価 (JPY/kg)': wholesale,
        '粗利 (JPY/kg)': margin,
        '粗利率 (%)': marginRate,
        '備考（管理）': product.adminNote ?? '',
        '備考（販売）': product.salesNote ?? '',
        'カタログ表示': product.showInCatalog === false ? '非表示' : '表示',
        '問い合わせ (ASK)': product.inquireToOrder ? 'はい' : '',
      }
    })

    const sheet = XLSX.utils.json_to_sheet(rows)
    // Auto column widths
    const headers = Object.keys(rows[0] ?? {})
    sheet['!cols'] = headers.map(h => {
      const maxLen = rows.reduce((m, r) => {
        const v = (r as Record<string, unknown>)[h]
        const s = v == null ? '' : String(v)
        return Math.max(m, s.length)
      }, h.length)
      return { wch: Math.min(Math.max(maxLen + 2, 8), 40) }
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, '商品一覧')
    const today = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(wb, `products_${today}.xlsx`)
  }

  // The modal is now create/duplicate only; editing an existing product happens
  // on /inventory/[id].
  const handleSaveProduct = async (input: ProductInput) => {
    const services = await getServices()
    const savedProduct = await services.inventory.createProduct(input)
    setFeedbackTone('success')
    setFeedbackMessage('商品を登録しました')
    setModalOpen(false)
    setPrefillProduct(null)
    await load(savedProduct.inventoryGroupId)
  }

  const handleSaveGroup = async (input: InventoryGroupInput) => {
    const services = await getServices()
    const savedGroup = editingGroup
      ? await services.inventory.updateInventoryGroup(editingGroup.id, input)
      : await services.inventory.createInventoryGroup(input)

    if (editingGroup) {
      setFeedbackMessage('グループ名を更新しました')
    } else {
      setFeedbackMessage('グループを追加しました')
    }
    setFeedbackTone('success')
    setGroupModalOpen(false)
    setEditingGroup(null)
    await load(savedGroup.id)
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
            <h1 className="text-2xl font-bold text-[#173c2a]">在庫管理</h1>
            <p className="mt-1 text-sm text-[#68756c]">全{products.length}件 / 茶葉マスターを画像定義に更新</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleExportExcel}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <Download size={16} />
              Excel 書き出し
            </button>
            {user?.role === 'admin' && (
              <>
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
                  onClick={() => setModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#174c33] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#123723]"
                >
                  <Plus size={16} />
                  商品登録
                </button>
              </>
            )}
          </div>
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

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <p className="text-sm text-[#68756c]">総商品数</p>
            <p className="mt-1 text-3xl font-bold text-[#173c2a]">{groupProducts.length}</p>
          </div>
          <div className="rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <p className="text-sm text-[#68756c]">残在庫量</p>
            <p className={`mt-1 text-3xl font-bold ${totalCurrentStockKg <= totalInitialStockKg * 0.2 ? 'text-amber-600' : 'text-[#173c2a]'}`}>
              {totalCurrentStockKg.toFixed(1)} kg
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 overflow-x-auto border-b border-gray-200">
          <div
            className={`flex shrink-0 items-center gap-1 border-b-2 px-4 py-2.5 text-sm font-medium -mb-px cursor-pointer transition-colors ${
              activeGroupId === 'all'
                ? 'border-[#174c33] text-[#174c33]'
                : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
            onClick={() => setActiveGroupId('all')}
          >
            All
            <span className="ml-1 text-xs text-gray-400">({products.length})</span>
          </div>
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
              className={`group flex shrink-0 items-center gap-1 border-b-2 px-4 py-2.5 text-sm font-medium -mb-px cursor-pointer transition-colors ${
                activeGroupId === group.id
                  ? 'border-[#174c33] text-[#174c33]'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
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
                    className="p-0.5 text-gray-400 opacity-0 transition-all hover:text-[#174c33] group-hover:opacity-100"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={event => {
                      event.stopPropagation()
                      void handleDeleteGroup(group)
                    }}
                    className="p-0.5 text-gray-400 opacity-0 transition-all hover:text-red-600 group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>

        <div className="space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="SKU / 商品名 / 仕入商品名 / 仕入先 / 品種で検索..."
              className="w-full rounded-xl border border-gray-300 py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 md:w-[32rem]"
            />
          </div>
          <InventoryFilterBar
            groupProducts={groupProducts}
            masters={masters}
            gradeFilters={gradeFilters}
            setGradeFilters={setGradeFilters}
            originFilters={originFilters}
            setOriginFilters={setOriginFilters}
            statusFilters={statusFilters}
            setStatusFilters={setStatusFilters}
            catalogFilter={catalogFilter}
            setCatalogFilter={setCatalogFilter}
            askFilter={askFilter}
            setAskFilter={setAskFilter}
          />
        </div>

        <div className="space-y-3 md:hidden">
          {filtered.map(product => (
            <div
              key={product.id}
              onClick={() => openDetail(product.id)}
              className="cursor-pointer rounded-2xl border border-[#d9d1be] bg-white p-4 shadow-sm transition hover:border-[#bcb39a]"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[#173c2a]">{product.name}</span>
                    {product.inquireToOrder && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">ASK</span>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-xs text-[#68756c]">{product.sku}</div>
                </div>
                <StockStatusBadge status={product.stockStatus} />
              </div>

              <div className="mt-4 rounded-xl bg-[#f7f5ee] p-3">
                <p className="text-xs text-[#68756c]">残在庫</p>
                <p className={`mt-1 text-lg font-semibold ${product.currentStockKg < 0 ? 'text-red-700' : 'text-[#173c2a]'}`}>{formatKg(product.currentStockKg)}</p>
              </div>

              {user?.role === 'admin' && (
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={e => { e.stopPropagation(); handleDuplicateProduct(product) }}
                    aria-label="複製"
                    className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Copy size={16} />
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteProduct(product) }}
                    className="rounded-lg p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="rounded-2xl border border-[#d9d1be] bg-white px-4 py-12 text-center text-[#68756c] shadow-sm">
              商品がありません
            </div>
          )}
        </div>

        <div className="hidden overflow-hidden rounded-2xl border border-[#d9d1be] bg-white shadow-sm md:block">
          <div className="overflow-x-auto">
            <table className="w-max min-w-full text-sm">
              <thead className="bg-[#f7f5ee]">
                <tr className="whitespace-nowrap">
                  {user?.role === 'admin' && <th className="w-10 px-3 py-3 text-left font-medium text-[#68756c]" />}
                  <SortableTh label="SKU" sortKey="sku" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="商品名" sortKey="name" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="茶種" sortKey="tea" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-3 text-left font-medium text-[#68756c]">グレード</th>
                  <th className="px-3 py-3 text-left font-medium text-[#68756c]">品種</th>
                  <th className="px-3 py-3 text-left font-medium text-[#68756c]">摘採</th>
                  <SortableTh label="産地" sortKey="origin" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-3 text-left font-medium text-[#68756c]">仕入先</th>
                  <th className="px-3 py-3 text-left font-medium text-[#68756c]">認証</th>
                  <SortableTh label="残在庫" sortKey="stock" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                  <SortableTh label="卸単価" sortKey="price" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                  <th className="px-3 py-3 text-right font-medium text-[#68756c]">仕入単価</th>
                  <th className="px-3 py-3 text-right font-medium text-[#68756c]">粗利</th>
                  <th className="px-3 py-3 text-right font-medium text-[#68756c]">粗利率</th>
                  <SortableTh label="状態" sortKey="status" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <th className="px-3 py-3 text-left font-medium text-[#68756c]">カタログ</th>
                  <th className="px-3 py-3 text-left font-medium text-[#68756c]">おすすめ</th>
                  <th className="px-3 py-3 text-left font-medium text-[#68756c]">サンプル</th>
                  {user?.role === 'admin' && <th className="px-3 py-3 text-right font-medium text-[#68756c]">操作</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(product => {
                  const wholesale = product.standardWholesalePrice
                  const cost = product.purchaseUnitPrice
                  const margin = wholesale != null && cost != null ? wholesale - cost : undefined
                  const marginRate = wholesale != null && cost != null && wholesale > 0 ? ((wholesale - cost) / wholesale) * 100 : undefined
                  return (
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
                    onClick={() => openDetail(product.id)}
                    className={`cursor-pointer whitespace-nowrap border-t border-[#ece5d7] hover:bg-[#faf8f2] ${dragOverId === product.id ? 'bg-[#eef3eb]' : ''}`}
                  >
                    {user?.role === 'admin' && (
                      <td className="px-3 py-3 text-gray-400" onClick={e => e.stopPropagation()}>
                        <GripVertical size={16} />
                      </td>
                    )}
                    <td className="px-3 py-3 font-mono text-gray-700">{product.sku}</td>
                    <td className="px-3 py-3">
                      <span className="font-medium text-[#173c2a]">{product.name}</span>
                      {product.inquireToOrder && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">ASK</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gray-700">{translateValues(masters, 'tea_type', product.teaType ? [product.teaType] : [])[0] ?? product.teaType ?? '-'}</td>
                    <td className="px-3 py-3 text-gray-700">{translateValues(masters, 'grade', product.grade ? [product.grade] : [])[0] ?? product.grade ?? '-'}</td>
                    <td className="px-3 py-3 text-gray-700">{formatCultivars(translateValues(masters, 'cultivar', product.cultivars))}</td>
                    <td className="px-3 py-3 text-gray-700">{formatOptionList(translateValues(masters, 'plucking', product.pluckingMethods))}</td>
                    <td className="px-3 py-3 text-gray-700">{formatOptionList(translateValues(masters, 'origin', product.origins))}</td>
                    <td className="px-3 py-3 text-gray-700">{compactText(product.supplier)}</td>
                    <td className="px-3 py-3 text-gray-700">{formatOptionList(translateValues(masters, 'certification', product.certifications))}</td>
                    <td className={`px-3 py-3 text-right font-semibold ${product.currentStockKg < 0 ? 'text-red-700' : 'text-[#173c2a]'}`}>{product.currentStockKg.toFixed(1)} kg</td>
                    <td className="px-3 py-3 text-right font-semibold text-[#173c2a]">{formatCurrency(wholesale)}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{formatCurrency(cost)}</td>
                    <td className={`px-3 py-3 text-right ${margin == null ? 'text-[#68756c]' : margin < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{margin == null ? '-' : formatCurrency(margin)}</td>
                    <td className={`px-3 py-3 text-right text-xs ${marginRate == null ? 'text-[#68756c]' : marginRate < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{marginRate == null ? '-' : `${marginRate.toFixed(1)}%`}</td>
                    <td className="px-3 py-3"><StockStatusBadge status={product.stockStatus} /></td>
                    <td className="px-3 py-3">
                      {product.showInCatalog !== false
                        ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">表示</span>
                        : <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">非表示</span>}
                    </td>
                    <td className="px-3 py-3">
                      {product.featured
                        ? <span className="rounded-full bg-[#ece8ff] px-2 py-0.5 text-xs text-[#5e44a8]">おすすめ</span>
                        : <span className="text-xs text-[#a59f8c]">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      {product.sampleAvailable
                        ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">可</span>
                        : <span className="text-xs text-[#a59f8c]">不可</span>}
                    </td>
                    {user?.role === 'admin' && (
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleDuplicateProduct(product)}
                            aria-label="複製"
                            className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                          >
                            <Copy size={16} />
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
                  )
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={user?.role === 'admin' ? 20 : 18} className="px-4 py-12 text-center text-[#68756c]">
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
          initial={prefillProduct ?? undefined}
          groups={groups}
          defaultGroupId={activeGroupId !== 'all' ? activeGroupId : groups[0]?.id || ''}
          masters={masters}
          onClose={() => {
            setModalOpen(false)
            setPrefillProduct(null)
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
