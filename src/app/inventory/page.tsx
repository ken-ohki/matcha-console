'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { StockStatusBadge } from '@/components/ui/StatusBadge'
import { useAuth } from '@/contexts/AuthContext'
import { formatCultivars, formatOptionList } from '@/lib/product-master'
import { optionsForType, translateValues, type MasterOption } from '@/lib/masters'
import { getServices } from '@/lib/services'
import type {
  ArrivalRecord,
  InventoryCheckRecord,
  InventoryGroup,
  InventoryGroupInput,
  MasterEntry,
  ProductInput,
  ProductWithInventory,
} from '@/types'
import { ArrowDown, ArrowUp, ArrowUpDown, Copy, Download, GripVertical, ImagePlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import * as XLSX from 'xlsx'
import { uploadProductImage } from '@/lib/firebase/storage'

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

function toIsoDateInput(value: string): string {
  const v = value?.trim()
  if (!v) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  const m = v.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  const d = new Date(v)
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return ''
}

function formatSignedKg(value: number): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)} kg`
}

function createArrivalRecord(): ArrivalRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    arrivalDate: '',
    quantityKg: 0,
  }
}

function createInventoryCheckRecord(): InventoryCheckRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    checkedDate: '',
    countedQuantityKg: 0,
    expectedQuantityKg: 0,
    adjustmentKg: 0,
  }
}

function getArrivalRecordsTotal(records: ArrivalRecord[]): number {
  return records.reduce((sum, record) => sum + (Number(record.quantityKg) || 0), 0)
}

function getInventoryAdjustmentTotal(records: InventoryCheckRecord[]): number {
  return records.reduce((sum, record) => sum + (Number(record.adjustmentKg) || 0), 0)
}

function buildProductForm(
  initial: (Partial<ProductWithInventory> & { id?: string }) | undefined,
  defaultGroupId: string,
): ProductInput {
  return {
    sku: initial?.sku ?? '',
    name: initial?.name ?? '',
    purchaseProductName: initial?.purchaseProductName ?? '',
    supplier: initial?.supplier ?? '',
    teaType: initial?.teaType ?? '',
    grade: initial?.grade ?? '',
    origins: initial?.origins ?? [],
    cultivars: initial?.cultivars ?? [],
    pluckingMethods: initial?.pluckingMethods ?? [],
    harvestSeasons: initial?.harvestSeasons ?? [],
    shadingMethods: initial?.shadingMethods ?? [],
    certifications: initial?.certifications ?? [],
    arrivalRecords: initial?.arrivalRecords ?? [],
    inventoryChecks: initial?.inventoryChecks ?? [],
    arrivalDate: initial?.arrivalDate ?? '',
    inventoryGroupId: initial?.inventoryGroupId ?? defaultGroupId,
    initialStockKg: initial?.initialStockKg ?? getArrivalRecordsTotal(initial?.arrivalRecords ?? []),
    standardWholesalePrice: initial?.standardWholesalePrice,
    purchaseUnitPrice: initial?.purchaseUnitPrice,
    adminNote: initial?.adminNote ?? '',
    salesNote: initial?.salesNote ?? '',
    flavorNotes: initial?.flavorNotes ?? '',
    imageUrl: initial?.imageUrl ?? '',
    showInCatalog: initial?.showInCatalog ?? true,
    inquireToOrder: initial?.inquireToOrder ?? false,
  }
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

function ImageUploader({
  imageUrl,
  productKey,
  onChange,
}: {
  imageUrl: string
  productKey: string
  onChange: (url: string) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const handleFile = async (file: File) => {
    setError('')
    if (!file.type.startsWith('image/')) {
      setError('画像ファイルを選択してください')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('画像サイズは 10MB 以下にしてください')
      return
    }
    setUploading(true)
    try {
      const url = await uploadProductImage(file, productKey)
      onChange(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white p-3">
      {imageUrl ? (
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="商品画像" loading="lazy" decoding="async" className="h-28 w-28 rounded-lg object-cover" />
          <div className="flex flex-col gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50">
              <ImagePlus size={12} />
              {uploading ? 'アップロード中…' : '画像を差し替え'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) void handleFile(file)
                  e.target.value = ''
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => onChange('')}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              <Trash2 size={12} />
              削除
            </button>
          </div>
        </div>
      ) : (
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg bg-[#faf8f1] px-6 py-8 text-sm text-[#68756c] transition hover:bg-[#f1ede0]">
          <ImagePlus size={20} />
          <span>{uploading ? 'アップロード中…' : '画像を選択 / ドロップ'}</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={e => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
              e.target.value = ''
            }}
          />
        </label>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}

function TagInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder: string
  hint?: string
}) {
  const [draft, setDraft] = useState('')

  const commitDraft = () => {
    const parts = draft
      .split(/[,\n、]/)
      .map(item => item.trim())
      .filter(Boolean)

    if (parts.length === 0) {
      setDraft('')
      return
    }

    const nextValues = [...value]
    parts.forEach(part => {
      if (!nextValues.includes(part)) {
        nextValues.push(part)
      }
    })
    onChange(nextValues)
    setDraft('')
  }

  const removeValue = (target: string) => {
    onChange(value.filter(item => item !== target))
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {hint && <p className="mb-2 text-xs text-[#68756c]">{hint}</p>}
      <div className="rounded-2xl border border-gray-300 bg-white px-3 py-3">
        <div className="mb-2 flex flex-wrap gap-2">
          {value.map(item => (
            <span key={item} className="inline-flex items-center gap-1 rounded-full bg-[#eef3eb] px-3 py-1 text-xs font-medium text-[#174c33]">
              {item}
              <button
                type="button"
                onClick={() => removeValue(item)}
                className="rounded-full text-[#174c33] transition hover:text-[#0f2f1f]"
                aria-label={`${item} を削除`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {value.length === 0 && <span className="text-xs text-gray-400">未設定</span>}
        </div>
        <input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              commitDraft()
            }
          }}
          placeholder={placeholder}
          className="w-full border-0 p-0 text-sm focus:outline-none focus:ring-0"
        />
      </div>
    </div>
  )
}

function MultiSelectChecklist({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string
  options: MasterOption[]
  value: string[]
  onChange: (next: string[]) => void
  hint?: string
}) {
  const toggle = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter(item => item !== optionValue))
      return
    }
    onChange([...value, optionValue])
  }

  // Show selected values that are not in the master list as a notice
  const orphanValues = value.filter(v => !options.some(o => o.value === v))

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {hint && <p className="mb-2 text-xs text-[#68756c]">{hint}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(option => {
          const checked = value.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                checked
                  ? 'border-[#174c33] bg-[#eef3eb] text-[#174c33]'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {option.label}
              <span className="ml-1 text-[10px] text-gray-400">{option.value}</span>
            </button>
          )
        })}
      </div>
      {orphanValues.length > 0 && (
        <p className="mt-2 text-[11px] text-amber-700">
          マスター未登録: {orphanValues.join(', ')}（設定画面で追加できます）
        </p>
      )}
    </div>
  )
}

function ProductModal({
  open,
  initial,
  groups,
  defaultGroupId,
  masters,
  onClose,
  onSave,
}: {
  open: boolean
  initial?: Partial<ProductWithInventory> & { id?: string }
  groups: InventoryGroup[]
  defaultGroupId: string
  masters: MasterEntry[]
  onClose: () => void
  onSave: (input: ProductInput) => Promise<void>
}) {
  const [pendingInventoryCheck, setPendingInventoryCheck] = useState<{ checkedDate: string; countedQuantityKg: string }>({
    checkedDate: '',
    countedQuantityKg: '',
  })
  const [form, setForm] = useState<ProductInput>(() => buildProductForm(initial, defaultGroupId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const teaTypeOptions = useMemo(() => optionsForType(masters, 'tea_type'), [masters])
  const gradeOptions = useMemo(() => optionsForType(masters, 'grade'), [masters])
  const originOptions = useMemo(() => optionsForType(masters, 'origin'), [masters])
  const cultivarOptions = useMemo(() => optionsForType(masters, 'cultivar'), [masters])
  const pluckingOptions = useMemo(() => optionsForType(masters, 'plucking'), [masters])
  const harvestOptions = useMemo(() => optionsForType(masters, 'harvest'), [masters])
  const shadingOptions = useMemo(() => optionsForType(masters, 'shading'), [masters])
  const certificationOptions = useMemo(() => optionsForType(masters, 'certification'), [masters])
  const totalArrivalKg = useMemo(() => getArrivalRecordsTotal(form.arrivalRecords), [form.arrivalRecords])
  const totalInventoryAdjustmentKg = useMemo(() => getInventoryAdjustmentTotal(form.inventoryChecks), [form.inventoryChecks])
  const salesAllocatedKg = initial?.salesAllocatedKg ?? 0
  const selfConsumedKg = initial?.selfConsumedKg ?? 0
  const currentStockKg = initial?.currentStockKg ?? 0
  const simulatedCurrentStockKg = useMemo(
    () => totalArrivalKg + totalInventoryAdjustmentKg - salesAllocatedKg - selfConsumedKg,
    [salesAllocatedKg, selfConsumedKg, totalArrivalKg, totalInventoryAdjustmentKg],
  )
  const hasPendingInventoryCheckInput = pendingInventoryCheck.checkedDate.trim() !== '' || pendingInventoryCheck.countedQuantityKg.trim() !== ''
  const pendingCountedQuantityKg = pendingInventoryCheck.countedQuantityKg.trim() === ''
    ? null
    : Number(pendingInventoryCheck.countedQuantityKg)
  const simulatedCurrentStockAfterCheckKg = pendingCountedQuantityKg == null
    ? simulatedCurrentStockKg
    : pendingCountedQuantityKg
  const pendingInventoryAdjustmentKg = pendingCountedQuantityKg == null
    ? 0
    : pendingCountedQuantityKg - simulatedCurrentStockKg

  useEffect(() => {
    if (!open) return
    setForm(buildProductForm(initial, defaultGroupId))
    setPendingInventoryCheck({ checkedDate: '', countedQuantityKg: '' })
    setError('')
  }, [open, initial, defaultGroupId])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (hasPendingInventoryCheckInput) {
      if (!pendingInventoryCheck.checkedDate.trim() || pendingCountedQuantityKg == null || Number.isNaN(pendingCountedQuantityKg)) {
        setError('棚卸を反映するには、確認日と在庫数量を両方入力してください')
        return
      }
    }

    setSaving(true)
    setError('')

    try {
      const nextInventoryChecks = hasPendingInventoryCheckInput && pendingCountedQuantityKg != null
        ? [
            ...form.inventoryChecks,
            {
              ...createInventoryCheckRecord(),
              checkedDate: pendingInventoryCheck.checkedDate.trim(),
              countedQuantityKg: pendingCountedQuantityKg,
              expectedQuantityKg: simulatedCurrentStockKg,
              adjustmentKg: pendingInventoryAdjustmentKg,
            },
          ]
        : form.inventoryChecks

      await onSave({
        ...form,
        sku: form.sku.trim(),
        name: form.name.trim(),
        purchaseProductName: form.purchaseProductName?.trim() || undefined,
        supplier: form.supplier?.trim() || undefined,
        teaType: form.teaType?.trim() || undefined,
        grade: form.grade?.trim() || undefined,
        origins: form.origins.map(item => item.trim()).filter(Boolean),
        cultivars: form.cultivars.map(item => item.trim()).filter(Boolean),
        pluckingMethods: form.pluckingMethods.map(item => item.trim()).filter(Boolean),
        harvestSeasons: form.harvestSeasons.map(item => item.trim()).filter(Boolean),
        shadingMethods: form.shadingMethods.map(item => item.trim()).filter(Boolean),
        certifications: form.certifications.map(item => item.trim()).filter(Boolean),
        arrivalRecords: form.arrivalRecords
          .map(record => ({
            ...record,
            id: record.id || createArrivalRecord().id,
            arrivalDate: record.arrivalDate.trim(),
            quantityKg: Number(record.quantityKg) || 0,
          }))
          .filter(record => record.arrivalDate || record.quantityKg > 0),
        inventoryChecks: nextInventoryChecks,
        arrivalDate: '',
        initialStockKg: totalArrivalKg,
        adminNote: form.adminNote?.trim() || undefined,
        salesNote: form.salesNote?.trim() || undefined,
        flavorNotes: form.flavorNotes?.trim() || undefined,
        imageUrl: form.imageUrl?.trim() || undefined,
        showInCatalog: form.showInCatalog,
        inquireToOrder: form.inquireToOrder,
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
      <div className="max-h-[100vh] w-full max-w-5xl overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:max-h-[92vh] sm:rounded-3xl sm:p-6">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-[#173c2a]">{initial?.id ? '商品編集' : '商品登録'}</h2>
            <p className="mt-1 text-sm text-[#68756c]">画像で定義された茶葉マスターに合わせて登録します。</p>
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
          <div className="rounded-2xl border border-[#d9d1be] bg-[#f7f5ee] p-4">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#68756c]">運用管理項目</p>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">SKU</label>
                <input
                  type="text"
                  required
                  value={form.sku}
                  onChange={event => setForm(prev => ({ ...prev, sku: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">入荷累計 (kg)</label>
                <div className="rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm font-medium text-[#173c2a]">
                  {totalArrivalKg.toFixed(1)} kg
                </div>
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
            </div>

            <div className="mt-4 rounded-2xl border border-[#e6dfcf] bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">入荷記録</p>
                  <p className="text-xs text-[#68756c]">入荷は「発注管理」で発注を「入荷済」にすると自動で追加されます。</p>
                </div>
                <div className="rounded-xl bg-[#f7f5ee] px-3 py-2 text-xs text-[#68756c]">
                  累計 <span className="font-semibold text-[#173c2a]">{totalArrivalKg.toFixed(1)} kg</span>
                </div>
              </div>

              <div className="space-y-2">
                {form.arrivalRecords.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-gray-300 px-4 py-5 text-sm text-[#68756c]">
                    まだ入荷記録がありません。
                  </div>
                ) : (
                  form.arrivalRecords
                    .slice()
                    .sort((a, b) => b.arrivalDate.localeCompare(a.arrivalDate))
                    .map(record => (
                      <div key={record.id} className="flex items-center justify-between rounded-xl border border-[#ece5d7] bg-[#faf8f2] px-3 py-2 text-sm">
                        <span className="text-[#173c2a]">{toIsoDateInput(record.arrivalDate) || '日付未設定'}</span>
                        <span className="font-medium text-[#173c2a]">{record.quantityKg.toFixed(1)} kg</span>
                      </div>
                    ))
                )}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[#e6dfcf] bg-white p-4">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">棚卸</p>
                  <p className="text-xs text-[#68756c]">現状在庫は編集せず表示し、フォームの変更内容を保存後シミュレーションへ反映します。</p>
                </div>
                <div className="rounded-xl bg-[#f7f5ee] px-3 py-2 text-xs text-[#68756c]">
                  現状の在庫数: <span className="font-semibold text-[#173c2a]">{formatKg(currentStockKg)}</span>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[180px_1fr_180px]">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">現状の在庫数 (編集不可)</label>
                  <div className="rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm font-medium text-[#173c2a]">
                    {formatKg(currentStockKg)}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">確認日</label>
                  <input
                    type="date"
                    value={pendingInventoryCheck.checkedDate}
                    onChange={event => setPendingInventoryCheck(prev => ({ ...prev, checkedDate: event.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">在庫数量 (kg)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={pendingInventoryCheck.countedQuantityKg}
                    onChange={event => setPendingInventoryCheck(prev => ({ ...prev, countedQuantityKg: event.target.value }))}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    placeholder="実棚数量"
                  />
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-[#ece5d7] bg-[#faf8f2] p-3">
                  <p className="text-xs text-[#68756c]">保存後の見込み在庫</p>
                  <p className="mt-1 text-sm font-semibold text-[#173c2a]">{formatKg(simulatedCurrentStockKg)}</p>
                  <p className="mt-1 text-[11px] text-[#68756c]">入荷・棚卸履歴の変更を反映</p>
                </div>
                <div className="rounded-xl border border-[#ece5d7] bg-[#faf8f2] p-3">
                  <p className="text-xs text-[#68756c]">今回の棚卸差分</p>
                  <p className={`mt-1 text-sm font-semibold ${
                    pendingCountedQuantityKg == null
                      ? 'text-[#68756c]'
                      : pendingInventoryAdjustmentKg < 0
                        ? 'text-red-700'
                        : pendingInventoryAdjustmentKg > 0
                          ? 'text-emerald-700'
                          : 'text-[#173c2a]'
                  }`}>
                    {pendingCountedQuantityKg == null ? '入力待ち' : formatSignedKg(pendingInventoryAdjustmentKg)}
                  </p>
                </div>
                <div className="rounded-xl border border-[#ece5d7] bg-[#faf8f2] p-3">
                  <p className="text-xs text-[#68756c]">棚卸反映後の在庫</p>
                  <p className="mt-1 text-sm font-semibold text-[#173c2a]">
                    {formatKg(simulatedCurrentStockAfterCheckKg)}
                  </p>
                  <p className="mt-1 text-[11px] text-[#68756c]">棚卸を入力しなければ上の見込み在庫と同じです</p>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {form.inventoryChecks.length === 0 && (
                  <div className="rounded-xl border border-dashed border-gray-300 px-4 py-5 text-sm text-[#68756c]">
                    まだ棚卸記録がありません。必要なタイミングで追加してください。
                  </div>
                )}
                {form.inventoryChecks
                  .slice()
                  .sort((left, right) => right.checkedDate.localeCompare(left.checkedDate))
                  .map(record => (
                    <div key={record.id} className="grid gap-3 rounded-xl border border-[#ece5d7] bg-[#faf8f2] p-3 md:grid-cols-[1fr_140px_140px_140px_auto]">
                      <div>
                        <p className="text-xs font-medium text-gray-600">確認日</p>
                        <p className="mt-1 text-sm text-[#173c2a]">{record.checkedDate || '-'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-600">実棚数量</p>
                        <p className="mt-1 text-sm text-[#173c2a]">{formatKg(record.countedQuantityKg)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-600">理論在庫</p>
                        <p className="mt-1 text-sm text-[#173c2a]">{formatKg(record.expectedQuantityKg)}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-600">反映差分</p>
                        <p className={`mt-1 text-sm font-semibold ${
                          record.adjustmentKg < 0 ? 'text-red-700' : record.adjustmentKg > 0 ? 'text-emerald-700' : 'text-[#173c2a]'
                        }`}>
                          {formatSignedKg(record.adjustmentKg)}
                        </p>
                      </div>
                      <div className="flex items-end justify-end">
                        <button
                          type="button"
                          onClick={() => setForm(prev => ({
                            ...prev,
                            inventoryChecks: prev.inventoryChecks.filter(item => item.id !== record.id),
                          }))}
                          className="rounded-lg p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700"
                          aria-label={`${record.checkedDate || '棚卸'} を削除`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#68756c]">商品マスター</p>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">商品名</label>
                <p className="mb-2 text-xs text-[#68756c]">販売用の商品名</p>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">仕入商品名</label>
                <p className="mb-2 text-xs text-[#68756c]">仕入れ元の商品名（発注用）</p>
                <input
                  type="text"
                  value={form.purchaseProductName ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, purchaseProductName: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">仕入先</label>
                <input
                  type="text"
                  value={form.supplier ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, supplier: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">茶種</label>
                <select
                  value={form.teaType ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, teaType: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  <option value="">未設定</option>
                  {teaTypeOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}（{option.value}）</option>
                  ))}
                  {form.teaType && !teaTypeOptions.some(o => o.value === form.teaType) && (
                    <option value={form.teaType}>{form.teaType}（未登録）</option>
                  )}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">グレード</label>
                <select
                  value={form.grade ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, grade: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  <option value="">未設定</option>
                  {gradeOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}（{option.value}）</option>
                  ))}
                  {form.grade && !gradeOptions.some(o => o.value === form.grade) && (
                    <option value={form.grade}>{form.grade}（未登録）</option>
                  )}
                </select>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <MultiSelectChecklist
                label="産地"
                options={originOptions}
                value={form.origins}
                onChange={origins => setForm(prev => ({ ...prev, origins }))}
                hint="DBには英語名が保存されます。"
              />
              <MultiSelectChecklist
                label="品種"
                options={cultivarOptions}
                value={form.cultivars}
                onChange={cultivars => setForm(prev => ({ ...prev, cultivars }))}
                hint="未選択の場合は一覧上で「ブレンド」と表示します。"
              />
              <MultiSelectChecklist
                label="摘採方法"
                options={pluckingOptions}
                value={form.pluckingMethods}
                onChange={pluckingMethods => setForm(prev => ({ ...prev, pluckingMethods }))}
              />
              <MultiSelectChecklist
                label="摘採時期"
                options={harvestOptions}
                value={form.harvestSeasons}
                onChange={harvestSeasons => setForm(prev => ({ ...prev, harvestSeasons }))}
              />
              <MultiSelectChecklist
                label="被覆方法"
                options={shadingOptions}
                value={form.shadingMethods}
                onChange={shadingMethods => setForm(prev => ({ ...prev, shadingMethods }))}
              />
              <MultiSelectChecklist
                label="認証"
                options={certificationOptions}
                value={form.certifications}
                onChange={certifications => setForm(prev => ({ ...prev, certifications }))}
              />
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">仕入単価</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.purchaseUnitPrice ?? ''}
                  onChange={event => setForm(prev => ({
                    ...prev,
                    purchaseUnitPrice: event.target.value ? Number(event.target.value) : undefined,
                  }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">標準卸売単価</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.standardWholesalePrice ?? ''}
                  onChange={event => setForm(prev => ({
                    ...prev,
                    standardWholesalePrice: event.target.value ? Number(event.target.value) : undefined,
                  }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">備考（管理用）</label>
                <textarea
                  rows={4}
                  value={form.adminNote ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, adminNote: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">備考（販売用）</label>
                <textarea
                  rows={4}
                  value={form.salesNote ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, salesNote: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  placeholder="販売時の説明・補足"
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-700">フレーバーノート</label>
                <textarea
                  rows={3}
                  value={form.flavorNotes ?? ''}
                  onChange={event => setForm(prev => ({ ...prev, flavorNotes: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  placeholder="例: 上品な甘み、栗のような香ばしさ、ミルキーな余韻"
                />
                <p className="mt-1 text-[11px] text-[#68756c]">カタログの商品詳細に表示されます</p>
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-gray-700">商品画像</label>
              <p className="mb-2 text-xs text-[#68756c]">JPG / PNG 推奨。カタログのカード・詳細に表示されます。</p>
              <ImageUploader
                imageUrl={form.imageUrl ?? ''}
                productKey={initial?.id || form.sku || 'unsorted'}
                onChange={url => setForm(prev => ({ ...prev, imageUrl: url }))}
              />
            </div>

            <div className="mt-4 flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-700">カタログに表示</p>
                <p className="text-xs text-gray-500">オフにすると公開カタログから除外されます</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.showInCatalog ?? true}
                onClick={() => setForm(prev => ({ ...prev, showInCatalog: !(prev.showInCatalog ?? true) }))}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  (form.showInCatalog ?? true) ? 'bg-[#174c33]' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    (form.showInCatalog ?? true) ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            <div className="mt-2 flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-700">問い合わせを有効化</p>
                <p className="text-xs text-gray-500">入荷予定品・受注生産品に使用。カタログで在庫が「ASK」と表示されます</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={form.inquireToOrder ?? false}
                onClick={() => setForm(prev => ({ ...prev, inquireToOrder: !(prev.inquireToOrder ?? false) }))}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  (form.inquireToOrder ?? false) ? 'bg-amber-500' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    (form.inquireToOrder ?? false) ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
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
  const [editingProduct, setEditingProduct] = useState<ProductWithInventory | null>(null)
  const [prefillProduct, setPrefillProduct] = useState<Partial<ProductWithInventory> | null>(null)

  const handleDuplicateProduct = (product: ProductWithInventory) => {
    setEditingProduct(null)
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
  }, [])

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

  const handleSaveProduct = async (input: ProductInput) => {
    const services = await getServices()
    const savedProduct = editingProduct
      ? await services.inventory.updateProduct(editingProduct.id, input)
      : await services.inventory.createProduct(input)

    if (editingProduct) {
      setFeedbackTone('success')
      setFeedbackMessage('商品情報を更新しました')
    } else {
      setFeedbackTone('success')
      setFeedbackMessage('商品を登録しました')
    }
    setModalOpen(false)
    setEditingProduct(null)
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
                  onClick={() => {
                    setEditingProduct(null)
                    setModalOpen(true)
                  }}
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

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <p className="text-sm text-[#68756c]">総商品数</p>
            <p className="mt-1 text-3xl font-bold text-[#173c2a]">{groupProducts.length}</p>
          </div>
          <div className="rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <p className="text-sm text-[#68756c]">累計入荷量</p>
            <p className="mt-1 text-3xl font-bold text-[#173c2a]">{totalInitialStockKg.toFixed(1)} kg</p>
          </div>
          <div className="rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
            <p className="text-sm text-[#68756c]">残在庫量 / 販売引当 / 自社消費</p>
            <p className={`mt-1 text-3xl font-bold ${totalCurrentStockKg <= totalInitialStockKg * 0.2 ? 'text-amber-600' : 'text-[#173c2a]'}`}>
              {totalCurrentStockKg.toFixed(1)} kg
            </p>
            <p className="mt-1 text-sm text-[#68756c]">
              引当 {totalAllocatedKg.toFixed(1)} kg / 自社消費 {totalSelfConsumedKg.toFixed(1)} kg
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
            <div key={product.id} className="rounded-2xl border border-[#d9d1be] bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[#173c2a]">{product.name}</span>
                    {product.inquireToOrder && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">ASK</span>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-xs text-[#68756c]">{product.sku}</div>
                  <div className="mt-2 text-xs text-[#68756c]">
                    最終入荷 {product.arrivalDate || '-'} / 棚卸 {product.latestInventoryCheck?.checkedDate || '未実施'}
                  </div>
                </div>
                <StockStatusBadge status={product.stockStatus} />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-[#f7f5ee] p-3">
                  <p className="text-xs text-[#68756c]">残在庫</p>
                  <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatKg(product.currentStockKg)}</p>
                </div>
                <div className="rounded-xl bg-[#f7f5ee] p-3 text-xs text-[#68756c]">
                  <div>入荷 {formatKg(product.initialStockKg)}</div>
                  <div>棚卸 {formatSignedKg(product.inventoryAdjustmentKg)}</div>
                  <div>引当 {formatKg(product.salesAllocatedKg)}</div>
                  <div>自社消費 {formatKg(product.selfConsumedKg)}</div>
                </div>
              </div>

              <div className="mt-3 text-xs text-[#68756c]">
                {product.latestInventoryCheck
                  ? `最新棚卸: ${product.latestInventoryCheck.checkedDate} / 実棚 ${formatKg(product.latestInventoryCheck.countedQuantityKg)}`
                  : '棚卸記録なし'}
              </div>

              {user?.role === 'admin' && (
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={() => handleDuplicateProduct(product)}
                    aria-label="複製"
                    className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                  >
                    <Copy size={16} />
                  </button>
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
            <table className="w-full text-sm">
              <thead className="bg-[#f7f5ee]">
                <tr>
                  {user?.role === 'admin' && <th className="w-10 px-4 py-3 text-left font-medium text-[#68756c]" />}
                  <SortableTh label="SKU" sortKey="sku" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="商品名" sortKey="name" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="茶種 / グレード / 品種" sortKey="tea" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="産地 / 仕入先 / 認証" sortKey="origin" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="在庫 / 入荷履歴" sortKey="stock" current={sortKey} dir={sortDir} onSort={handleSort} />
                  <SortableTh label="単価 (kg)" sortKey="price" current={sortKey} dir={sortDir} onSort={handleSort} align="right" />
                  <SortableTh label="状態" sortKey="status" current={sortKey} dir={sortDir} onSort={handleSort} />
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
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#173c2a]">{product.name}</span>
                        {product.inquireToOrder && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">ASK</span>
                        )}
                      </div>
                      <div className="text-xs text-[#68756c]">{compactText(product.purchaseProductName)}</div>
                      <div className="mt-1 text-xs text-[#9a9a8f]">
                        最終入荷 {product.arrivalDate || '-'} / 履歴 {product.arrivalRecords.length} 件
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-700">
                      <div>
                        {[
                          translateValues(masters, 'tea_type', product.teaType ? [product.teaType] : [])[0] ?? product.teaType,
                          translateValues(masters, 'grade', product.grade ? [product.grade] : [])[0] ?? product.grade,
                        ]
                          .filter(Boolean)
                          .join(' / ') || '-'}
                      </div>
                      <div className="text-xs text-[#68756c]">品種: {formatCultivars(translateValues(masters, 'cultivar', product.cultivars))}</div>
                      <div className="text-xs text-[#68756c]">摘採: {formatOptionList(translateValues(masters, 'plucking', product.pluckingMethods))}</div>
                    </td>
                    <td className="px-4 py-4 text-gray-700">
                      <div>{formatOptionList(translateValues(masters, 'origin', product.origins))}</div>
                      <div className="text-xs text-[#68756c]">仕入先: {compactText(product.supplier)}</div>
                      <div className="text-xs text-[#68756c]">認証: {formatOptionList(translateValues(masters, 'certification', product.certifications))}</div>
                    </td>
                    <td className="px-4 py-4 text-gray-700">
                      <div className="font-semibold text-[#173c2a]">{product.currentStockKg.toFixed(1)} kg</div>
                      <div className="text-xs text-[#68756c]">
                        入荷 {product.initialStockKg.toFixed(1)} / 棚卸 {formatSignedKg(product.inventoryAdjustmentKg)}
                      </div>
                      <div className="mt-1 text-xs text-[#68756c]">
                        引当 {product.salesAllocatedKg.toFixed(1)} / 自社消費 {product.selfConsumedKg.toFixed(1)}
                      </div>
                      <div className="mt-1 text-xs text-[#68756c]">
                        {product.latestInventoryCheck
                          ? `棚卸 ${product.latestInventoryCheck.checkedDate} 実棚 ${product.latestInventoryCheck.countedQuantityKg.toFixed(1)}kg`
                          : product.arrivalRecords.length > 0
                            ? product.arrivalRecords
                                .slice()
                                .sort((left, right) => right.arrivalDate.localeCompare(left.arrivalDate))
                                .slice(0, 2)
                                .map(record => `${record.arrivalDate} ${record.quantityKg.toFixed(1)}kg`)
                                .join(' / ')
                            : '入荷履歴なし'}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-700">
                      {(() => {
                        const wholesale = product.standardWholesalePrice
                        const cost = product.purchaseUnitPrice
                        const margin = wholesale != null && cost != null ? wholesale - cost : undefined
                        const marginRate = wholesale != null && cost != null && wholesale > 0
                          ? ((wholesale - cost) / wholesale) * 100
                          : undefined
                        return (
                          <div className="text-right">
                            <div>
                              <span className="text-xs text-[#68756c]">卸 </span>
                              <span className="font-semibold text-[#173c2a]">{formatCurrency(wholesale)}</span>
                            </div>
                            <div className="text-xs text-[#68756c]">
                              仕入 <span className="text-[#173c2a]">{formatCurrency(cost)}</span>
                            </div>
                            <div className={`mt-0.5 text-xs ${margin == null ? 'text-[#68756c]' : margin < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                              粗利 {margin == null ? '-' : formatCurrency(margin)}
                              {marginRate != null && (
                                <span className="ml-1 text-[10px]">({marginRate.toFixed(1)}%)</span>
                              )}
                            </div>
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-4"><StockStatusBadge status={product.stockStatus} /></td>
                    {user?.role === 'admin' && (
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleDuplicateProduct(product)}
                            aria-label="複製"
                            className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-700"
                          >
                            <Copy size={16} />
                          </button>
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
                    <td colSpan={user?.role === 'admin' ? 9 : 8} className="px-4 py-12 text-center text-[#68756c]">
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
          initial={editingProduct ? { ...editingProduct, id: editingProduct.id } : prefillProduct ?? undefined}
          groups={groups}
          defaultGroupId={activeGroupId !== 'all' ? activeGroupId : groups[0]?.id || ''}
          masters={masters}
          onClose={() => {
            setModalOpen(false)
            setEditingProduct(null)
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
