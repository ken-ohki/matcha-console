'use client'

import { Plus, Trash2, Tag } from 'lucide-react'
import type { TaxRate } from '@/types'
import { formatCurrency } from '@/lib/format'

// A draft adhoc (off-PO) line held in the form. `key` is a client-only stable id
// used for React keys / edits; it is NOT sent to the service.
export interface AdhocDraft {
  key: string
  productName: string
  category: string
  quantity: number
  unit: string
  unitPrice: number
  taxRate: TaxRate
  note: string
}

export function newAdhocDraft(): AdhocDraft {
  return {
    key: `adhoc-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    productName: '',
    category: '',
    quantity: 1,
    unit: '',
    unitPrice: 0,
    taxRate: 10,
    note: '',
  }
}

const fieldCls =
  'rounded-lg border border-line bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-matcha'

const CATEGORY_SUGGESTIONS = ['諸費用', '送料', 'サンプル', 'オプション']

/**
 * Editor for off-PO 一時商品 charges. Fully controlled by the parent form.
 */
export function AdhocLineEditor({
  rows,
  onChange,
}: {
  rows: AdhocDraft[]
  onChange: (next: AdhocDraft[]) => void
}) {
  const update = (key: string, patch: Partial<AdhocDraft>) =>
    onChange(rows.map(r => (r.key === key ? { ...r, ...patch } : r)))
  const remove = (key: string) => onChange(rows.filter(r => r.key !== key))
  const add = () => onChange([...rows, newAdhocDraft()])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <Tag size={14} className="text-mist" />
          一時商品（発注外）
        </div>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1 text-xs text-matchaDeep hover:bg-[#eef3eb]"
        >
          <Plus size={14} /> 一時商品を追加
        </button>
      </div>

      <datalist id="adhoc-category-suggestions">
        {CATEGORY_SUGGESTIONS.map(c => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-bone p-3 text-center text-xs text-mist">
          サンプル・送料・諸費用など、発注書に無い項目はここに追加します。
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map(r => {
            const lineTotal = (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0)
            return (
              <div
                key={r.key}
                className="rounded-xl border border-amber-300/70 bg-amber-50/40 p-2.5"
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                    発注外
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(r.key)}
                    aria-label="削除"
                    className="rounded p-1 text-gray-400 hover:bg-alert/5 hover:text-alert"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                  <label className="col-span-2 text-[10px] text-mist sm:col-span-4">
                    <span className="mb-0.5 block">品目名 *</span>
                    <input
                      value={r.productName}
                      onChange={e => update(r.key, { productName: e.target.value })}
                      placeholder="例: 送料 / サンプル抹茶"
                      className={`${fieldCls} w-full`}
                    />
                  </label>
                  <label className="text-[10px] text-mist sm:col-span-2">
                    <span className="mb-0.5 block">区分</span>
                    <input
                      list="adhoc-category-suggestions"
                      value={r.category}
                      onChange={e => update(r.key, { category: e.target.value })}
                      placeholder="諸費用"
                      className={`${fieldCls} w-full`}
                    />
                  </label>
                  <label className="text-[10px] text-mist sm:col-span-1">
                    <span className="mb-0.5 block">数量</span>
                    <input
                      type="number"
                      step="0.1"
                      value={r.quantity}
                      onChange={e =>
                        update(r.key, { quantity: e.target.value === '' ? 0 : Number(e.target.value) })
                      }
                      className={`${fieldCls} w-full`}
                    />
                  </label>
                  <label className="text-[10px] text-mist sm:col-span-1">
                    <span className="mb-0.5 block">単位</span>
                    <input
                      value={r.unit}
                      onChange={e => update(r.key, { unit: e.target.value })}
                      placeholder="個"
                      className={`${fieldCls} w-full`}
                    />
                  </label>
                  <label className="text-[10px] text-mist sm:col-span-2">
                    <span className="mb-0.5 block">税抜単価</span>
                    <input
                      type="number"
                      step="1"
                      value={r.unitPrice}
                      onChange={e =>
                        update(r.key, { unitPrice: e.target.value === '' ? 0 : Number(e.target.value) })
                      }
                      className={`${fieldCls} w-full`}
                    />
                  </label>
                  <label className="text-[10px] text-mist sm:col-span-2">
                    <span className="mb-0.5 block">税率</span>
                    <select
                      value={r.taxRate}
                      onChange={e => update(r.key, { taxRate: Number(e.target.value) as TaxRate })}
                      className={`${fieldCls} w-full`}
                    >
                      <option value={10}>10%</option>
                      <option value={8}>8%</option>
                      <option value={0}>免税</option>
                    </select>
                  </label>
                  <label className="col-span-2 text-[10px] text-mist sm:col-span-10">
                    <span className="mb-0.5 block">メモ</span>
                    <input
                      value={r.note}
                      onChange={e => update(r.key, { note: e.target.value })}
                      className={`${fieldCls} w-full`}
                    />
                  </label>
                  <div className="col-span-2 flex items-end justify-end text-xs sm:col-span-2">
                    <span className="text-mist">
                      税抜 <span className="font-semibold text-ink">{formatCurrency(lineTotal)}</span>
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
