'use client'

import { useState } from 'react'
import { CheckCircle2, RotateCcw } from 'lucide-react'
import type { PurchaseOrderPayment } from '@/types'
import { PAYMENT_METHODS } from '@/lib/payment-methods'
import { formatCurrency, todayIso } from '@/lib/format'

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {}
  return `pay-${Date.now()}-${Math.round(Math.random() * 1e6)}`
}

// Single source of truth lives in lib/cashflow (server-safe pure fn); re-export so
// existing importers of this module keep working.
export { hasInstallmentSchedule } from '@/lib/cashflow'

const KIND_LABEL: Record<'deposit' | 'balance', string> = {
  deposit: '前払金（納品前）',
  balance: '残金（納品後）',
}

/**
 * 前払金（納品前）＋残金（納品後）の固定2段階スケジュール editor. Fully controlled:
 * emits the next payments array via onChange; the parent persists it.
 *
 * Each stage carries an amount, a due date (支払期限) and a confirmation state
 * (予定 → 支払確認). A scheduled-but-unpaid stage is `paid:false`; confirming sets
 * `paid:true` + paidDate. Used for PO legacy-flow payables ONLY (never invoices).
 */
export function InstallmentScheduleEditor({
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
  const deposit = payments.find(p => p.kind === 'deposit')
  const balance = payments.find(p => p.kind === 'balance')
  const hasSchedule = !!deposit || !!balance

  const confirmedTotal = payments.reduce((s, p) => s + (p.paid !== false ? Number(p.amount) || 0 : 0), 0)
  const plannedTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const outstanding = Math.max(0, plannedTotal - confirmedTotal)

  const [depositDraft, setDepositDraft] = useState<number | ''>('')

  const fieldCls = 'rounded-lg border border-line bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-matcha'

  // Keep non-installment rows (defensive) and replace the deposit/balance pair.
  const setStages = (dep: PurchaseOrderPayment, bal: PurchaseOrderPayment) => {
    const others = payments.filter(p => p.kind !== 'deposit' && p.kind !== 'balance')
    onChange([...others, dep, bal])
  }

  const initSchedule = () => {
    const dep = Math.max(0, Number(depositDraft) || 0)
    const bal = Math.max(0, totalIncl - dep)
    setStages(
      { id: newId(), kind: 'deposit', amount: dep, dueDate: '', paid: false, paidDate: '' },
      { id: newId(), kind: 'balance', amount: bal, dueDate: '', paid: false, paidDate: '' },
    )
    setDepositDraft('')
  }

  const updateStage = (kind: 'deposit' | 'balance', patch: Partial<PurchaseOrderPayment>) => {
    onChange(payments.map(p => (p.kind === kind ? { ...p, ...patch } : p)))
  }

  const confirmStage = (kind: 'deposit' | 'balance', cur: PurchaseOrderPayment) => {
    updateStage(kind, { paid: true, paidDate: cur.paidDate || todayIso() })
  }
  const unconfirmStage = (kind: 'deposit' | 'balance') => {
    updateStage(kind, { paid: false, paidDate: '' })
  }

  const clearSchedule = () => {
    if (!confirm('前払金＋残金の分割払い設定を解除します。よろしいですか？')) return
    onChange(payments.filter(p => p.kind !== 'deposit' && p.kind !== 'balance'))
  }

  if (!hasSchedule) {
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-line bg-bone p-3">
        <p className="text-xs text-mist">分割払い（前払金＋残金）の支払スケジュールを作成します。前払金額を入力すると、残金（合計 {formatCurrency(totalIncl)} − 前払金）を自動計算します。</p>
        {!disabled && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[10px] text-mist">
              <span className="mb-0.5 block">前払金（税込）</span>
              <input
                type="number" min="0" step="1"
                value={depositDraft}
                onChange={e => setDepositDraft(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="例: 30000"
                className={`${fieldCls} w-32`}
              />
            </label>
            <button
              type="button"
              onClick={initSchedule}
              className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:bg-[#205f43]"
            >
              分割払い(前払金+残金)を設定
            </button>
          </div>
        )}
      </div>
    )
  }

  const rows: PurchaseOrderPayment[] = [deposit, balance].filter((p): p is PurchaseOrderPayment => !!p)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span className="text-mist">合計（税込） <span className="font-semibold text-ink">{formatCurrency(totalIncl)}</span></span>
        <span className="text-mist">支払済（確認） <span className="font-semibold text-matcha">{formatCurrency(confirmedTotal)}</span></span>
        <span className="text-mist">未払い予定 <span className={`font-semibold ${outstanding > 0 ? 'text-alert' : 'text-matcha'}`}>{formatCurrency(outstanding)}</span></span>
        {plannedTotal !== totalIncl && (
          <span className="text-[11px] text-alert">※ 前払金＋残金（{formatCurrency(plannedTotal)}）が合計と一致しません</span>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-[#ece8db]">
        <table className="min-w-full text-xs">
          <thead className="bg-bone text-left text-mist">
            <tr>
              <th className="px-2 py-1.5 font-medium">区分</th>
              <th className="px-2 py-1.5 font-medium text-right">金額（税込）</th>
              <th className="px-2 py-1.5 font-medium">支払期限</th>
              <th className="px-2 py-1.5 font-medium">状態</th>
              <th className="px-2 py-1.5 font-medium">支払日</th>
              <th className="px-2 py-1.5 font-medium">方法</th>
              {!disabled && <th className="px-2 py-1.5 font-medium">操作</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(p => {
              const kind = p.kind as 'deposit' | 'balance'
              const confirmed = p.paid !== false
              return (
                <tr key={p.id} className="border-t border-[#ece8db] text-ink align-middle">
                  <td className="px-2 py-1.5 whitespace-nowrap">{KIND_LABEL[kind]}</td>
                  <td className="px-2 py-1.5 text-right">
                    {disabled || confirmed ? (
                      <span className="font-medium">{formatCurrency(p.amount)}</span>
                    ) : (
                      <input
                        type="number" min="0" step="1"
                        value={Number(p.amount) || 0}
                        onChange={e => updateStage(kind, { amount: Number(e.target.value) || 0 })}
                        className={`${fieldCls} w-28 text-right`}
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {disabled ? (
                      p.dueDate || '-'
                    ) : (
                      <input type="date" value={p.dueDate || ''} onChange={e => updateStage(kind, { dueDate: e.target.value })} className={fieldCls} />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {confirmed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-matcha/10 px-2 py-0.5 text-[11px] font-medium text-matchaDeep">確認済み</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-alert/10 px-2 py-0.5 text-[11px] font-medium text-alert">予定</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {disabled ? (
                      p.paidDate || '-'
                    ) : (
                      // 支払日を空にしたら未確認(予定)へ戻す（確認済みのまま日付なし＝CFに出ず実績現金が消えるのを防ぐ）
                      <input type="date" value={p.paidDate || ''} onChange={e => updateStage(kind, e.target.value ? { paidDate: e.target.value } : { paidDate: '', paid: false })} className={fieldCls} />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {disabled ? (
                      p.method || '-'
                    ) : (
                      <select value={p.method || ''} onChange={e => updateStage(kind, { method: e.target.value || undefined })} className={fieldCls}>
                        <option value="">未設定</option>
                        {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    )}
                  </td>
                  {!disabled && (
                    <td className="px-2 py-1.5">
                      {confirmed ? (
                        <button type="button" onClick={() => unconfirmStage(kind)} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11px] text-mist hover:bg-bone">
                          <RotateCcw size={12} /> 確認取消
                        </button>
                      ) : (
                        <button type="button" onClick={() => confirmStage(kind, p)} className="inline-flex items-center gap-1 rounded-lg bg-ink px-2 py-1 text-[11px] font-medium text-paper hover:bg-[#205f43]">
                          <CheckCircle2 size={12} /> 支払確認
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!disabled && (
        <button type="button" onClick={clearSchedule} className="text-[11px] text-mist underline hover:text-alert">
          分割払い設定を解除
        </button>
      )}
    </div>
  )
}
