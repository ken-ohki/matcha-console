'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { InventoryGroup, MasterEntry, ProductInput, ProductWithInventory } from '@/types'
import {
  buildProductForm,
  finalizeProductInput,
  EMPTY_PENDING_CHECK,
  ProductStockSection,
  ProductMasterSection,
  ProductPricingSection,
  type PendingInventoryCheck,
} from './ProductFormSections'

export function ProductModal({
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
  const [form, setForm] = useState<ProductInput>(() => buildProductForm(initial, defaultGroupId))
  const [pending, setPending] = useState<PendingInventoryCheck>(EMPTY_PENDING_CHECK)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setForm(buildProductForm(initial, defaultGroupId))
    setPending(EMPTY_PENDING_CHECK)
    setError('')
    // Re-init only on open / edited record change — not when defaultGroupId
    // changes from a background data refetch (would wipe input).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const stock = {
    currentStockKg: initial?.currentStockKg ?? 0,
    salesAllocatedKg: initial?.salesAllocatedKg ?? 0,
    selfConsumedKg: initial?.selfConsumedKg ?? 0,
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave(finalizeProductInput(form, pending, stock))
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
            <h2 className="text-xl font-semibold text-ink">{initial?.id ? '商品編集' : '商品登録'}</h2>
            <p className="mt-1 text-sm text-mist">茶葉マスターに合わせて登録します。</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 transition hover:bg-bone hover:text-mist">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-alert/40 bg-alert/5 px-4 py-3 text-sm text-alert">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <ProductStockSection
            form={form}
            setForm={setForm}
            groups={groups}
            pending={pending}
            setPending={setPending}
            stock={stock}
          />
          <ProductMasterSection
            form={form}
            setForm={setForm}
            masters={masters}
            productKey={initial?.id || form.sku || 'unsorted'}
          />
          <ProductPricingSection form={form} setForm={setForm} />

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm text-graphite transition hover:bg-bone"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
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
