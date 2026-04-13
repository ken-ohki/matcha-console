'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { StockStatusBadge } from '@/components/ui/StatusBadge'
import { useAuth } from '@/contexts/AuthContext'
import {
  CERTIFICATION_OPTIONS,
  CULTIVAR_OPTIONS,
  GRADE_OPTIONS,
  HARVEST_SEASON_OPTIONS,
  PLUCKING_METHOD_OPTIONS,
  SHADING_METHOD_OPTIONS,
  TEA_TYPE_OPTIONS,
  formatCultivars,
  formatOptionList,
} from '@/lib/product-master'
import { getServices } from '@/lib/services'
import type {
  ArrivalRecord,
  InventoryGroup,
  InventoryGroupInput,
  ProductInput,
  ProductWithInventory,
} from '@/types'
import { GripVertical, Pencil, Plus, Search, Trash2, X } from 'lucide-react'

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

function createArrivalRecord(): ArrivalRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    arrivalDate: '',
    quantityKg: 0,
  }
}

function getArrivalRecordsTotal(records: ArrivalRecord[]): number {
  return records.reduce((sum, record) => sum + (Number(record.quantityKg) || 0), 0)
}

function buildProductForm(
  initial: (Partial<ProductInput> & { id?: string }) | undefined,
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
    arrivalDate: initial?.arrivalDate ?? '',
    inventoryGroupId: initial?.inventoryGroupId ?? defaultGroupId,
    initialStockKg: initial?.initialStockKg ?? getArrivalRecordsTotal(initial?.arrivalRecords ?? []),
    haizUsedKg: initial?.haizUsedKg ?? 0,
    standardWholesalePrice: initial?.standardWholesalePrice,
    purchaseUnitPrice: initial?.purchaseUnitPrice,
    adminNote: initial?.adminNote ?? '',
    salesNote: initial?.salesNote ?? '',
  }
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
  options: readonly string[]
  value: string[]
  onChange: (next: string[]) => void
  hint?: string
}) {
  const toggle = (option: string) => {
    if (value.includes(option)) {
      onChange(value.filter(item => item !== option))
      return
    }
    onChange([...value, option])
  }

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {hint && <p className="mb-2 text-xs text-[#68756c]">{hint}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(option => {
          const checked = value.includes(option)
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              className={`rounded-xl border px-3 py-2 text-left text-sm transition ${
                checked
                  ? 'border-[#174c33] bg-[#eef3eb] text-[#174c33]'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {option}
            </button>
          )
        })}
      </div>
    </div>
  )
}

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
  const [form, setForm] = useState<ProductInput>(() => buildProductForm(initial, defaultGroupId))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const totalArrivalKg = useMemo(() => getArrivalRecordsTotal(form.arrivalRecords), [form.arrivalRecords])

  useEffect(() => {
    if (!open) return
    setForm(buildProductForm(initial, defaultGroupId))
    setError('')
  }, [open, initial, defaultGroupId])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')

    try {
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
        arrivalDate: '',
        initialStockKg: totalArrivalKg,
        adminNote: form.adminNote?.trim() || undefined,
        salesNote: form.salesNote?.trim() || undefined,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl">
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
                  disabled={Boolean(initial?.id)}
                  value={form.sku}
                  onChange={event => setForm(prev => ({ ...prev, sku: event.target.value }))}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-gray-50"
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

            <div className="mt-4 rounded-2xl border border-[#e6dfcf] bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">入荷記録</p>
                  <p className="text-xs text-[#68756c]">入荷日と数量を追加していくと、その累計が在庫元帳になります。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, arrivalRecords: [...prev.arrivalRecords, createArrivalRecord()] }))}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  <Plus size={14} />
                  入荷記録を追加
                </button>
              </div>

              <div className="space-y-3">
                {form.arrivalRecords.length === 0 && (
                  <div className="rounded-xl border border-dashed border-gray-300 px-4 py-5 text-sm text-[#68756c]">
                    まだ入荷記録がありません。必要なタイミングで追加してください。
                  </div>
                )}
                {form.arrivalRecords.map((record, index) => (
                  <div key={record.id} className="grid gap-3 rounded-xl border border-[#ece5d7] bg-[#faf8f2] p-3 md:grid-cols-[1fr_160px_auto]">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">入荷日</label>
                      <input
                        type="text"
                        placeholder="2026/04/13"
                        value={record.arrivalDate}
                        onChange={event => setForm(prev => ({
                          ...prev,
                          arrivalRecords: prev.arrivalRecords.map(item => (
                            item.id === record.id ? { ...item, arrivalDate: event.target.value } : item
                          )),
                        }))}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600">数量 (kg)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={record.quantityKg}
                        onChange={event => setForm(prev => ({
                          ...prev,
                          arrivalRecords: prev.arrivalRecords.map(item => (
                            item.id === record.id ? { ...item, quantityKg: Number(event.target.value) || 0 } : item
                          )),
                        }))}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      />
                    </div>
                    <div className="flex items-end justify-end">
                      <button
                        type="button"
                        onClick={() => setForm(prev => ({
                          ...prev,
                          arrivalRecords: prev.arrivalRecords.filter(item => item.id !== record.id),
                        }))}
                        className="rounded-lg p-2 text-red-500 transition hover:bg-red-50 hover:text-red-700"
                        aria-label={`入荷記録 ${index + 1} を削除`}
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
                  {TEA_TYPE_OPTIONS.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
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
                  {GRADE_OPTIONS.map(option => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <TagInput
                label="産地"
                value={form.origins}
                onChange={origins => setForm(prev => ({ ...prev, origins }))}
                placeholder="例: 京都府宇治市, 静岡県藤枝市"
                hint="Enter またはカンマで追加"
              />
              <MultiSelectChecklist
                label="品種"
                options={CULTIVAR_OPTIONS}
                value={form.cultivars}
                onChange={cultivars => setForm(prev => ({ ...prev, cultivars }))}
                hint="未選択の場合は一覧上で「ブレンド」と表示します。"
              />
              <MultiSelectChecklist
                label="摘採方法"
                options={PLUCKING_METHOD_OPTIONS}
                value={form.pluckingMethods}
                onChange={pluckingMethods => setForm(prev => ({ ...prev, pluckingMethods }))}
              />
              <MultiSelectChecklist
                label="摘採時期"
                options={HARVEST_SEASON_OPTIONS}
                value={form.harvestSeasons}
                onChange={harvestSeasons => setForm(prev => ({ ...prev, harvestSeasons }))}
              />
              <MultiSelectChecklist
                label="被覆方法"
                options={SHADING_METHOD_OPTIONS}
                value={form.shadingMethods}
                onChange={shadingMethods => setForm(prev => ({ ...prev, shadingMethods }))}
              />
              <MultiSelectChecklist
                label="認証"
                options={CERTIFICATION_OPTIONS}
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
    return groupProducts.filter(product => {
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

      return searchText.includes(query)
    })
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
            <p className="mt-1 text-sm text-[#68756c]">全{products.length}件 / 茶葉マスターを画像定義に更新</p>
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
            <p className="text-sm text-[#68756c]">累計入荷量</p>
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

        <div className="flex items-center gap-1 overflow-x-auto border-b border-gray-200">
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

        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="SKU / 商品名 / 仕入商品名 / 仕入先 / 品種で検索..."
            className="w-full rounded-xl border border-gray-300 py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 md:w-[32rem]"
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
                  <th className="px-4 py-3 text-left font-medium text-[#68756c]">茶種 / グレード / 品種</th>
                  <th className="px-4 py-3 text-left font-medium text-[#68756c]">産地 / 仕入先 / 認証</th>
                  <th className="px-4 py-3 text-left font-medium text-[#68756c]">在庫 / 入荷履歴</th>
                  <th className="px-4 py-3 text-left font-medium text-[#68756c]">標準卸売単価</th>
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
                      <div className="text-xs text-[#68756c]">{compactText(product.purchaseProductName)}</div>
                      <div className="mt-1 text-xs text-[#9a9a8f]">
                        最終入荷 {product.arrivalDate || '-'} / 履歴 {product.arrivalRecords.length} 件
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-700">
                      <div>{[product.teaType, product.grade].filter(Boolean).join(' / ') || '-'}</div>
                      <div className="text-xs text-[#68756c]">品種: {formatCultivars(product.cultivars)}</div>
                      <div className="text-xs text-[#68756c]">摘採: {formatOptionList(product.pluckingMethods)}</div>
                    </td>
                    <td className="px-4 py-4 text-gray-700">
                      <div>{formatOptionList(product.origins)}</div>
                      <div className="text-xs text-[#68756c]">仕入先: {compactText(product.supplier)}</div>
                      <div className="text-xs text-[#68756c]">認証: {formatOptionList(product.certifications)}</div>
                    </td>
                    <td className="px-4 py-4 text-gray-700">
                      <div className="font-semibold text-[#173c2a]">{product.currentStockKg.toFixed(1)} kg</div>
                      <div className="text-xs text-[#68756c]">
                        入荷 {product.initialStockKg.toFixed(1)} / Shopify {product.haizUsedKg.toFixed(1)} / 引当 {product.salesAllocatedKg.toFixed(1)}
                      </div>
                      <div className="mt-1 text-xs text-[#68756c]">
                        {product.arrivalRecords.length > 0
                          ? product.arrivalRecords
                              .slice()
                              .sort((left, right) => right.arrivalDate.localeCompare(left.arrivalDate))
                              .slice(0, 2)
                              .map(record => `${record.arrivalDate} ${record.quantityKg.toFixed(1)}kg`)
                              .join(' / ')
                          : '入荷履歴なし'}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-700">{formatCurrency(product.standardWholesalePrice)}</td>
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
