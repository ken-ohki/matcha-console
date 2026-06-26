'use client'

import { useMemo, useState } from 'react'
import { ListPlus, Plus, Search, Trash2 } from 'lucide-react'
import type { TaxRate, UnbilledPoLine } from '@/types'
import { formatCurrency, formatKg } from '@/lib/format'

// A draft 'po' line held in the form. `key` is a client-only stable id for React
// keys / edits; it is NOT sent to the service.
export interface PoLineDraft {
  key: string
  purchaseOrderId: string
  poLineId: string
  productName: string
  quantity: number   // kg
  unit: string
  unitPrice: number  // 税抜単価
  taxRate: TaxRate
}

/** Build a draft 'po' line from an unbilled candidate. Uses the PO line's REAL
 *  unit price + tax rate; quantity is derived so the line 税抜 ≈ remaining. */
export function draftFromCandidate(c: UnbilledPoLine): PoLineDraft {
  const unitPrice = c.unitPrice > 0 ? c.unitPrice : (c.receivedKg > 0 ? c.billableRemainingAmount / c.receivedKg : c.billableRemainingAmount)
  const quantity = unitPrice > 0
    ? Math.round((c.billableRemainingAmount / unitPrice) * 1000) / 1000
    : (c.receivedKg > 0 ? c.receivedKg : 1)
  return {
    key: `po-${c.poId}-${c.lineId}-${Date.now()}-${Math.round(Math.random() * 1e5)}`,
    purchaseOrderId: c.poId,
    poLineId: c.lineId,
    productName: c.productName,
    quantity,
    unit: 'kg',
    unitPrice,
    taxRate: c.taxRate ?? 8,
  }
}

const fieldCls =
  'rounded-lg border border-line bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-matcha'

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Picks 'po' (消し込み) lines from received-but-unbilled PO lines, scoped to the
 * entered supplier. Lines already added become editable rows. Fully controlled.
 */
export function PoLinePicker({
  supplierName,
  candidates,
  rows,
  onChange,
  loading,
}: {
  supplierName: string
  candidates: UnbilledPoLine[]
  rows: PoLineDraft[]
  onChange: (next: PoLineDraft[]) => void
  loading?: boolean
}) {
  const [filter, setFilter] = useState('')

  const scoped = useMemo(() => {
    const sup = norm(supplierName)
    const f = norm(filter)
    return candidates
      .filter(c => sup && norm(c.supplierName) === sup)
      .filter(c => !f || norm(c.productName).includes(f) || norm(c.poId).includes(f))
      .sort((a, b) => (a.orderDate || '').localeCompare(b.orderDate || ''))
  }, [candidates, supplierName, filter])

  const isAdded = (c: UnbilledPoLine) =>
    rows.some(r => r.purchaseOrderId === c.poId && r.poLineId === c.lineId)

  const addOne = (c: UnbilledPoLine) => {
    if (isAdded(c)) return
    onChange([...rows, draftFromCandidate(c)])
  }

  const addAll = () => {
    const toAdd = scoped.filter(c => !isAdded(c)).map(draftFromCandidate)
    if (toAdd.length > 0) onChange([...rows, ...toAdd])
  }

  const update = (key: string, patch: Partial<PoLineDraft>) =>
    onChange(rows.map(r => (r.key === key ? { ...r, ...patch } : r)))
  const remove = (key: string) => onChange(rows.filter(r => r.key !== key))

  const availableCount = scoped.filter(c => !isAdded(c)).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">発注の消し込み（請求待ち）</h3>
        <button
          type="button"
          onClick={addAll}
          disabled={!supplierName.trim() || availableCount === 0}
          className="inline-flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1 text-xs font-medium text-paper hover:bg-[#205f43] disabled:opacity-50"
        >
          <ListPlus size={14} /> 全部請求
        </button>
      </div>

      {/* Candidate list */}
      {!supplierName.trim() ? (
        <p className="rounded-xl border border-dashed border-line bg-bone p-3 text-center text-xs text-mist">
          仕入先を入力すると、請求待ちの入荷済み発注が表示されます。
        </p>
      ) : (
        <div className="rounded-xl border border-[#ece8db] bg-bone p-2.5">
          <div className="mb-2 flex items-center gap-2">
            <Search size={13} className="text-mist" />
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="商品名 / 発注IDで絞り込み"
              className={`${fieldCls} flex-1`}
            />
          </div>
          {loading ? (
            <p className="py-3 text-center text-xs text-mist">読み込み中…</p>
          ) : scoped.length === 0 ? (
            <p className="py-3 text-center text-xs text-mist">
              この仕入先の請求待ち明細はありません。
            </p>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {scoped.map(c => {
                const added = isAdded(c)
                return (
                  <li
                    key={`${c.poId}-${c.lineId}`}
                    className="flex items-center gap-2 rounded-lg border border-white/70 bg-white px-2.5 py-1.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-ink">{c.productName}</div>
                      <div className="text-[10px] text-mist">
                        発注日 {c.orderDate || '-'}
                        {c.expectedDeliveryDate ? ` / 入荷予定 ${c.expectedDeliveryDate}` : ''}
                        {` / 入荷 ${formatKg(c.receivedKg)}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-semibold text-ink">
                        {formatCurrency(c.billableRemainingAmount)}
                      </div>
                      <div className="text-[10px] text-mist">請求予定残</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => addOne(c)}
                      disabled={added}
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb] disabled:opacity-50"
                    >
                      <Plus size={12} /> {added ? '追加済' : '追加'}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* Added 'po' lines (editable) */}
      {rows.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-mist">追加済みの発注明細</p>
          {rows.map(r => {
            const lineTotal = (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0)
            return (
              <div
                key={r.key}
                className="rounded-xl border border-[#cfe0d3] bg-[#f3f7f1] p-2.5"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="inline-flex items-center rounded-full bg-[#dcebe0] px-2 py-0.5 text-[10px] font-medium text-matchaDeep">
                      発注
                    </span>
                    <span className="ml-2 truncate text-xs font-medium text-ink">{r.productName}</span>
                  </div>
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
                  <label className="text-[10px] text-mist sm:col-span-3">
                    <span className="mb-0.5 block">数量(kg)</span>
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
                  <label className="text-[10px] text-mist sm:col-span-3">
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
                  <label className="text-[10px] text-mist sm:col-span-3">
                    <span className="mb-0.5 block">税率</span>
                    <select
                      value={r.taxRate}
                      onChange={e => update(r.key, { taxRate: Number(e.target.value) as TaxRate })}
                      className={`${fieldCls} w-full`}
                    >
                      <option value={8}>8%</option>
                      <option value={10}>10%</option>
                      <option value={0}>免税</option>
                    </select>
                  </label>
                  <div className="flex items-end justify-end text-xs sm:col-span-3">
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
