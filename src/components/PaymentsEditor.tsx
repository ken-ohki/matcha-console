'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { PurchaseOrderPayment } from '@/types'
import { PAYMENT_METHODS } from '@/lib/payment-methods'
import { formatCurrency, todayIso } from '@/lib/format'
import { useConfirm } from '@/contexts/ConfirmContext'

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {}
  return `pay-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}

/**
 * Editor for a purchase order's split payments. Fully controlled: emits the
 * next payments array via onChange; the parent persists it.
 */
export function PaymentsEditor({
  payments,
  totalIncl,
  onChange,
  disabled,
}: {
  payments: PurchaseOrderPayment[]
  totalIncl: number
  onChange: (next: PurchaseOrderPayment[]) => void
  disabled?: boolean
}) {
  const { confirm } = useConfirm()
  const paid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const remaining = Math.max(0, totalIncl - paid)

  const [draftAmount, setDraftAmount] = useState<number | ''>('')
  const [draftDate, setDraftDate] = useState<string>(todayIso())
  const [draftMethod, setDraftMethod] = useState<string>('')
  const [draftNote, setDraftNote] = useState<string>('')

  const addPayment = async () => {
    const amount = Number(draftAmount) || 0
    if (!(amount > 0)) return
    // Overpayment is allowed (rounding, bank fees) but confirm first.
    if (amount > remaining && !(await confirm({ message: `支払額が残額（${formatCurrency(remaining)}）を超えています。このまま追加しますか？`, confirmLabel: '追加する' }))) return
    onChange([
      ...payments,
      { id: newId(), amount, paidDate: draftDate || todayIso(), method: draftMethod || undefined, note: draftNote || undefined },
    ])
    setDraftAmount('')
    setDraftMethod('')
    setDraftNote('')
  }

  const removePayment = (id: string) => onChange(payments.filter(p => p.id !== id))

  const fieldCls = 'rounded-lg border border-line bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-matcha'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span className="text-mist">合計（税込） <span className="font-semibold text-ink">{formatCurrency(totalIncl)}</span></span>
        <span className="text-mist">支払済 <span className="font-semibold text-matcha">{formatCurrency(paid)}</span></span>
        <span className="text-mist">残額 <span className={`font-semibold ${remaining > 0 ? 'text-alert' : 'text-matcha'}`}>{formatCurrency(remaining)}</span></span>
      </div>

      {payments.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[#ece8db]">
          <table className="min-w-full text-xs">
            <thead className="bg-bone text-left text-mist">
              <tr>
                <th className="px-2 py-1.5 font-medium">支払日</th>
                <th className="px-2 py-1.5 font-medium text-right">金額</th>
                <th className="px-2 py-1.5 font-medium">方法</th>
                <th className="px-2 py-1.5 font-medium">メモ</th>
                {!disabled && <th className="px-2 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id} className="border-t border-[#ece8db] text-ink">
                  <td className="px-2 py-1.5">{p.paidDate || '-'}</td>
                  <td className="px-2 py-1.5 text-right font-medium">{formatCurrency(p.amount)}</td>
                  <td className="px-2 py-1.5">{p.method || '-'}</td>
                  <td className="px-2 py-1.5 text-mist">{p.note || '-'}</td>
                  {!disabled && (
                    <td className="px-2 py-1.5 text-right">
                      <button type="button" onClick={() => removePayment(p.id)} aria-label="削除" className="rounded p-1 text-gray-400 hover:bg-alert/5 hover:text-alert">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!disabled && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-line bg-bone p-2.5">
          <label className="text-[10px] text-mist">
            <span className="mb-0.5 block">金額（税込）</span>
            <input
              type="number" min="0" step="1"
              value={draftAmount}
              onChange={e => setDraftAmount(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={remaining > 0 ? String(remaining) : '0'}
              className={`${fieldCls} w-28`}
            />
          </label>
          <label className="text-[10px] text-mist">
            <span className="mb-0.5 block">支払日</span>
            <input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)} className={fieldCls} />
          </label>
          <label className="text-[10px] text-mist">
            <span className="mb-0.5 block">方法</span>
            <select value={draftMethod} onChange={e => setDraftMethod(e.target.value)} className={fieldCls}>
              <option value="">未設定</option>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="flex-1 text-[10px] text-mist">
            <span className="mb-0.5 block">メモ</span>
            <input value={draftNote} onChange={e => setDraftNote(e.target.value)} placeholder="例: 内金 / 残金" className={`${fieldCls} w-full`} />
          </label>
          <button
            type="button"
            onClick={addPayment}
            className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:bg-[#205f43]"
          >
            <Plus size={14} /> 追加
          </button>
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setDraftAmount(remaining)}
              className="rounded-lg border border-line bg-white px-2 py-1.5 text-[11px] text-matchaDeep hover:bg-[#eef3eb]"
            >
              残額を入力
            </button>
          )}
        </div>
      )}
    </div>
  )
}
