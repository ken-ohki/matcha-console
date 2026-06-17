'use client'

import { useEffect, useMemo, useState } from 'react'
import { ImagePlus, Trash2, X } from 'lucide-react'
import { optionsForType, type MasterOption } from '@/lib/masters'
import type {
  ArrivalRecord,
  InventoryCheckRecord,
  InventoryGroup,
  MasterEntry,
  ProductInput,
  ProductWithInventory,
  WholesaleOption,
} from '@/types'
import { getServices } from '@/lib/services'
import { uploadProductImage } from '@/lib/firebase/storage'

// ---- helpers (kept local so detail page + modal render identically) ---------

export function formatKg(value: number): string {
  return `${value.toFixed(1)} kg`
}

export function formatSignedKg(value: number): string {
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toFixed(1)} kg`
}

export function toIsoDateInput(value: string): string {
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

export function createArrivalRecord(): ArrivalRecord {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, arrivalDate: '', quantityKg: 0 }
}

export function createInventoryCheckRecord(): InventoryCheckRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    checkedDate: '',
    countedQuantityKg: 0,
    expectedQuantityKg: 0,
    adjustmentKg: 0,
  }
}

export function getArrivalRecordsTotal(records: ArrivalRecord[]): number {
  return records.reduce((sum, record) => sum + (Number(record.quantityKg) || 0), 0)
}

export function getInventoryAdjustmentTotal(records: InventoryCheckRecord[]): number {
  return records.reduce((sum, record) => sum + (Number(record.adjustmentKg) || 0), 0)
}

export function buildProductForm(
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
    featured: initial?.featured ?? false,
    inquireToOrder: initial?.inquireToOrder ?? false,
    wholesaleAvailableKg: initial?.wholesaleAvailableKg,
    standardPackageKg: initial?.standardPackageKg,
    wholesaleOptions: initial?.wholesaleOptions,
    sampleAvailable: initial?.sampleAvailable ?? false,
    samplePrice: initial?.samplePrice,
  }
}

export type PendingInventoryCheck = { checkedDate: string; countedQuantityKg: string }
export type ProductStockInfo = { currentStockKg: number; salesAllocatedKg: number; selfConsumedKg: number }

export const EMPTY_PENDING_CHECK: PendingInventoryCheck = { checkedDate: '', countedQuantityKg: '' }

// Fold the pending 棚卸 input into inventoryChecks and produce a clean ProductInput
// for saving. Mirrors the original modal's submit logic. Throws on partial input.
export function finalizeProductInput(
  form: ProductInput,
  pending: PendingInventoryCheck,
  stock: ProductStockInfo,
): ProductInput {
  const totalArrivalKg = getArrivalRecordsTotal(form.arrivalRecords)
  const totalAdjustmentKg = getInventoryAdjustmentTotal(form.inventoryChecks)
  const simulatedCurrentStockKg = totalArrivalKg + totalAdjustmentKg - stock.salesAllocatedKg - stock.selfConsumedKg

  const hasPending = pending.checkedDate.trim() !== '' || pending.countedQuantityKg.trim() !== ''
  const pendingCounted = pending.countedQuantityKg.trim() === '' ? null : Number(pending.countedQuantityKg)
  if (hasPending) {
    if (!pending.checkedDate.trim() || pendingCounted == null || Number.isNaN(pendingCounted)) {
      throw new Error('棚卸を反映するには、確認日と在庫数量を両方入力してください')
    }
  }

  const nextInventoryChecks = hasPending && pendingCounted != null
    ? [
        ...form.inventoryChecks,
        {
          ...createInventoryCheckRecord(),
          checkedDate: pending.checkedDate.trim(),
          countedQuantityKg: pendingCounted,
          expectedQuantityKg: simulatedCurrentStockKg,
          adjustmentKg: pendingCounted - simulatedCurrentStockKg,
        },
      ]
    : form.inventoryChecks

  return {
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
    featured: form.featured,
    inquireToOrder: form.inquireToOrder,
    wholesaleAvailableKg: form.wholesaleAvailableKg,
    standardPackageKg: form.standardPackageKg,
    wholesaleOptions: form.wholesaleOptions,
    sampleAvailable: form.sampleAvailable,
    samplePrice: form.samplePrice,
  }
}

// ---- reusable inputs --------------------------------------------------------

export function ImageUploader({
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

export function MultiSelectChecklist({
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

// ---- form sections (shared by create modal and detail page) -----------------

type FormProps = {
  form: ProductInput
  setForm: React.Dispatch<React.SetStateAction<ProductInput>>
}

const fieldCls =
  'w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600'

export function ProductStockSection({
  form,
  setForm,
  groups,
  pending,
  setPending,
  stock,
}: FormProps & {
  groups: InventoryGroup[]
  pending: PendingInventoryCheck
  setPending: React.Dispatch<React.SetStateAction<PendingInventoryCheck>>
  stock: ProductStockInfo
}) {
  const totalArrivalKg = useMemo(() => getArrivalRecordsTotal(form.arrivalRecords), [form.arrivalRecords])
  const totalInventoryAdjustmentKg = useMemo(() => getInventoryAdjustmentTotal(form.inventoryChecks), [form.inventoryChecks])
  const simulatedCurrentStockKg = totalArrivalKg + totalInventoryAdjustmentKg - stock.salesAllocatedKg - stock.selfConsumedKg
  const hasPending = pending.checkedDate.trim() !== '' || pending.countedQuantityKg.trim() !== ''
  const pendingCounted = pending.countedQuantityKg.trim() === '' ? null : Number(pending.countedQuantityKg)
  const simulatedAfterCheckKg = pendingCounted == null ? simulatedCurrentStockKg : pendingCounted
  const pendingAdjustmentKg = pendingCounted == null ? 0 : pendingCounted - simulatedCurrentStockKg

  return (
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
            className={fieldCls}
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
            className={fieldCls}
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
                <div key={record.id} className="flex items-center justify-between gap-3 rounded-xl border border-[#ece5d7] bg-[#faf8f2] px-3 py-2 text-sm">
                  <span className="text-[#173c2a]">{toIsoDateInput(record.arrivalDate) || '日付未設定'}</span>
                  <span className="flex items-center gap-3">
                    {record.unitPrice != null && record.unitPrice > 0 && (
                      <span className="text-xs text-[#68756c]">@{new Intl.NumberFormat('ja-JP').format(Math.round(record.unitPrice))} 円/kg</span>
                    )}
                    <span className="font-medium text-[#173c2a]">{record.quantityKg.toFixed(1)} kg</span>
                  </span>
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
            現状の在庫数: <span className="font-semibold text-[#173c2a]">{formatKg(stock.currentStockKg)}</span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-[180px_1fr_180px]">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">現状の在庫数 (編集不可)</label>
            <div className="rounded-xl border border-gray-300 bg-gray-50 px-3 py-2.5 text-sm font-medium text-[#173c2a]">
              {formatKg(stock.currentStockKg)}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">確認日</label>
            <input
              type="date"
              value={pending.checkedDate}
              onChange={event => setPending(prev => ({ ...prev, checkedDate: event.target.value }))}
              className={fieldCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">在庫数量 (kg)</label>
            <input
              type="number"
              min="0"
              step="0.1"
              value={pending.countedQuantityKg}
              onChange={event => setPending(prev => ({ ...prev, countedQuantityKg: event.target.value }))}
              className={fieldCls}
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
              pendingCounted == null
                ? 'text-[#68756c]'
                : pendingAdjustmentKg < 0
                  ? 'text-red-700'
                  : pendingAdjustmentKg > 0
                    ? 'text-emerald-700'
                    : 'text-[#173c2a]'
            }`}>
              {pendingCounted == null ? '入力待ち' : formatSignedKg(pendingAdjustmentKg)}
            </p>
          </div>
          <div className="rounded-xl border border-[#ece5d7] bg-[#faf8f2] p-3">
            <p className="text-xs text-[#68756c]">棚卸反映後の在庫</p>
            <p className="mt-1 text-sm font-semibold text-[#173c2a]">{formatKg(simulatedAfterCheckKg)}</p>
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
  )
}

export function ProductMasterSection({
  form,
  setForm,
  masters,
  productKey,
}: FormProps & { masters: MasterEntry[]; productKey: string }) {
  const teaTypeOptions = useMemo(() => optionsForType(masters, 'tea_type'), [masters])
  const gradeOptions = useMemo(() => optionsForType(masters, 'grade'), [masters])
  const originOptions = useMemo(() => optionsForType(masters, 'origin'), [masters])
  const cultivarOptions = useMemo(() => optionsForType(masters, 'cultivar'), [masters])
  const pluckingOptions = useMemo(() => optionsForType(masters, 'plucking'), [masters])
  const harvestOptions = useMemo(() => optionsForType(masters, 'harvest'), [masters])
  const shadingOptions = useMemo(() => optionsForType(masters, 'shading'), [masters])
  const certificationOptions = useMemo(() => optionsForType(masters, 'certification'), [masters])

  return (
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
            className={fieldCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">仕入商品名</label>
          <p className="mb-2 text-xs text-[#68756c]">仕入れ元の商品名（発注用）</p>
          <input
            type="text"
            value={form.purchaseProductName ?? ''}
            onChange={event => setForm(prev => ({ ...prev, purchaseProductName: event.target.value }))}
            className={fieldCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">仕入先</label>
          <input
            type="text"
            value={form.supplier ?? ''}
            onChange={event => setForm(prev => ({ ...prev, supplier: event.target.value }))}
            className={fieldCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">茶種</label>
          <select
            value={form.teaType ?? ''}
            onChange={event => setForm(prev => ({ ...prev, teaType: event.target.value }))}
            className={fieldCls}
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
            className={fieldCls}
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
        <MultiSelectChecklist label="産地" options={originOptions} value={form.origins} onChange={origins => setForm(prev => ({ ...prev, origins }))} hint="DBには英語名が保存されます。" />
        <MultiSelectChecklist label="品種" options={cultivarOptions} value={form.cultivars} onChange={cultivars => setForm(prev => ({ ...prev, cultivars }))} hint="未選択の場合は一覧上で「ブレンド」と表示します。" />
        <MultiSelectChecklist label="摘採方法" options={pluckingOptions} value={form.pluckingMethods} onChange={pluckingMethods => setForm(prev => ({ ...prev, pluckingMethods }))} />
        <MultiSelectChecklist label="摘採時期" options={harvestOptions} value={form.harvestSeasons} onChange={harvestSeasons => setForm(prev => ({ ...prev, harvestSeasons }))} />
        <MultiSelectChecklist label="被覆方法" options={shadingOptions} value={form.shadingMethods} onChange={shadingMethods => setForm(prev => ({ ...prev, shadingMethods }))} />
        <MultiSelectChecklist label="認証" options={certificationOptions} value={form.certifications} onChange={certifications => setForm(prev => ({ ...prev, certifications }))} />
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">フレーバーノート</label>
        <textarea
          rows={3}
          value={form.flavorNotes ?? ''}
          onChange={event => setForm(prev => ({ ...prev, flavorNotes: event.target.value }))}
          className={fieldCls}
          placeholder="例: 上品な甘み、栗のような香ばしさ、ミルキーな余韻"
        />
        <p className="mt-1 text-[11px] text-[#68756c]">カタログの商品詳細に表示されます</p>
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">商品画像</label>
        <p className="mb-2 text-xs text-[#68756c]">JPG / PNG 推奨。カタログのカード・詳細に表示されます。</p>
        <ImageUploader
          imageUrl={form.imageUrl ?? ''}
          productKey={productKey}
          onChange={url => setForm(prev => ({ ...prev, imageUrl: url }))}
        />
      </div>
    </div>
  )
}

export function ProductPricingSection({ form, setForm }: FormProps) {
  const [masterOptions, setMasterOptions] = useState<WholesaleOption[]>([])
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const services = await getServices()
        const settings = await services.settings.getSettings()
        if (active) setMasterOptions((settings.wholesaleOptions ?? []).filter(o => o.active))
      } catch {
        /* ignore — options simply unavailable */
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const configs = form.wholesaleOptions ?? []
  const configFor = (optionId: string) => configs.find(c => c.optionId === optionId)
  const setConfigs = (next: typeof configs) => setForm(prev => ({ ...prev, wholesaleOptions: next }))

  const toggleOption = (opt: WholesaleOption, on: boolean) => {
    if (on) setConfigs([...configs.filter(c => c.optionId !== opt.id), { optionId: opt.id, tierIds: opt.tiers.map(t => t.id) }])
    else setConfigs(configs.filter(c => c.optionId !== opt.id))
  }
  const toggleTier = (optionId: string, tierId: string, on: boolean) => {
    setConfigs(
      configs.map(c => {
        if (c.optionId !== optionId) return c
        const set = new Set(c.tierIds)
        if (on) set.add(tierId)
        else set.delete(tierId)
        return { ...c, tierIds: [...set] }
      }),
    )
  }

  return (
    <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4">
      <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-[#68756c]">価格・販売設定</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">仕入単価</label>
          <input
            type="number"
            min="0"
            step="1"
            value={form.purchaseUnitPrice ?? ''}
            onChange={event => setForm(prev => ({ ...prev, purchaseUnitPrice: event.target.value ? Number(event.target.value) : undefined }))}
            className={fieldCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">標準卸売単価</label>
          <input
            type="number"
            min="0"
            step="1"
            value={form.standardWholesalePrice ?? ''}
            onChange={event => setForm(prev => ({ ...prev, standardWholesalePrice: event.target.value ? Number(event.target.value) : undefined }))}
            className={fieldCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">EC即時購入可能数量</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={form.wholesaleAvailableKg ?? ''}
            onChange={event => setForm(prev => ({ ...prev, wholesaleAvailableKg: event.target.value ? Number(event.target.value) : undefined }))}
            className={fieldCls}
            placeholder="未設定なら在庫全量"
          />
          <p className="mt-1 text-[11px] text-[#68756c]">卸売サイトでセルフ決済に開放する数量 (kg)。空欄は在庫全量。セルフ決済しきい値は全商品共通で「設定 → 卸売設定」で指定します。</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">標準包装単位 (kg)</label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={form.standardPackageKg ?? ''}
            onChange={event => setForm(prev => ({ ...prev, standardPackageKg: event.target.value ? Number(event.target.value) : undefined }))}
            className={fieldCls}
            placeholder="未設定なら1kg"
          />
          <p className="mt-1 text-[11px] text-[#68756c]">標準の包装形態 (kg)。卸売サイトの注文数量はこの倍数のみ選択できます（例: 5 なら 5kg・10kg…）。空欄は 1kg。</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">サンプル価格（1個 / 10g）</label>
          <input
            type="number"
            min="0"
            step="1"
            value={form.samplePrice ?? ''}
            onChange={event => setForm(prev => ({ ...prev, samplePrice: event.target.value ? Number(event.target.value) : undefined }))}
            className={fieldCls}
            placeholder="例: 500"
          />
          <p className="mt-1 text-[11px] text-[#68756c]">卸売サイトのサンプル1個(10g)あたりの価格。サンプルは1商品2個(20g)まで注文可。</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">備考（管理用）</label>
          <textarea
            rows={4}
            value={form.adminNote ?? ''}
            onChange={event => setForm(prev => ({ ...prev, adminNote: event.target.value }))}
            className={fieldCls}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">備考（販売用）</label>
          <textarea
            rows={4}
            value={form.salesNote ?? ''}
            onChange={event => setForm(prev => ({ ...prev, salesNote: event.target.value }))}
            className={fieldCls}
            placeholder="販売時の説明・補足"
          />
        </div>
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
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            (form.showInCatalog ?? true) ? 'translate-x-5' : 'translate-x-0.5'
          }`} />
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
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            (form.inquireToOrder ?? false) ? 'translate-x-5' : 'translate-x-0.5'
          }`} />
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-gray-700">サンプル販売を有効化</p>
          <p className="text-xs text-gray-500">卸売サイトで1商品2個(20g)までサンプル注文可。上の「サンプル価格」を設定してください</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.sampleAvailable ?? false}
          onClick={() => setForm(prev => ({ ...prev, sampleAvailable: !(prev.sampleAvailable ?? false) }))}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            (form.sampleAvailable ?? false) ? 'bg-[#174c33]' : 'bg-gray-300'
          }`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            (form.sampleAvailable ?? false) ? 'translate-x-5' : 'translate-x-0.5'
          }`} />
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-gray-700">おすすめ商品（未ログイン公開）</p>
          <p className="text-xs text-gray-500">卸売サイトでログインしていない訪問者にも表示されます。注文には会員ログインが必要です</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.featured ?? false}
          onClick={() => setForm(prev => ({ ...prev, featured: !(prev.featured ?? false) }))}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            (form.featured ?? false) ? 'bg-[#174c33]' : 'bg-gray-300'
          }`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            (form.featured ?? false) ? 'translate-x-5' : 'translate-x-0.5'
          }`} />
        </button>
      </div>

      {/* 注文オプション（小分けサービス等）— 商品ごとに有効化・許可サイズ選択 */}
      {masterOptions.length > 0 && (
        <div className="mt-4 border-t border-[#f0ece0] pt-4">
          <p className="mb-2 text-sm font-medium text-gray-700">注文オプション</p>
          <p className="mb-3 text-[11px] text-[#68756c]">この商品で利用できる注文オプションと、許可する小分けサイズを選びます（マスタは「設定 → 卸売設定」で編集）。</p>
          <div className="space-y-3">
            {masterOptions.map(opt => {
              const cfg = configFor(opt.id)
              const on = !!cfg
              return (
                <div key={opt.id} className="rounded-xl border border-[#e7e1d2] p-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-[#173c2a]">
                    <input type="checkbox" checked={on} onChange={e => toggleOption(opt, e.target.checked)} className="h-4 w-4 accent-[#174c33]" />
                    {opt.name}
                  </label>
                  {on && opt.tiers.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-3 pl-6">
                      {opt.tiers.map(t => (
                        <label key={t.id} className="flex items-center gap-1.5 text-xs text-[#68756c]">
                          <input
                            type="checkbox"
                            checked={cfg!.tierIds.length === 0 || cfg!.tierIds.includes(t.id)}
                            onChange={e => toggleTier(opt.id, t.id, e.target.checked)}
                            className="h-3.5 w-3.5 accent-[#174c33]"
                          />
                          {t.label}（¥{t.pricePerBagJpy.toLocaleString()}/{opt.unitLabel ?? '袋'}）
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
