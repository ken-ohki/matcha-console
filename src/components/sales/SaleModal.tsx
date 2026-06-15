'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { Buyer, MasterEntry, ProductWithInventory, SaleRecord, SaleRecordInput } from '@/types'
import {
  buildSaleForm,
  computeSaleDerived,
  validateSaleForm,
  SaleBasicSection,
  SaleItemsSection,
  SaleFeesSection,
  SaleTermsSection,
  SaleChargesSection,
  SaleSummarySection,
} from './SaleFormSections'

export function SaleModal({
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
  const [form, setForm] = useState<SaleRecordInput>(() => buildSaleForm(null, products))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const matchedBuyer = buyers.find(b => b.name === (initial?.buyerName ?? ''))
    setForm(buildSaleForm(initial, products, matchedBuyer))
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const derived = computeSaleDerived(form, products, initial)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      validateSaleForm(form)
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
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <SaleBasicSection form={form} setForm={setForm} buyers={buyers} />
          <SaleItemsSection form={form} setForm={setForm} products={products} initial={initial} />
          <SaleFeesSection form={form} setForm={setForm} />
          <SaleTermsSection form={form} setForm={setForm} masters={masters} />
          <SaleChargesSection form={form} setForm={setForm} derived={derived} />
          <SaleSummarySection derived={derived} />

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
