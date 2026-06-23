'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  Link2,
  Pencil,
  Plus,
  Undo2,
  Wallet,
  X,
} from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { getServices } from '@/lib/services'
import type {
  PurchaseInvoice,
  PurchaseInvoicePaymentStatus,
  PurchaseOrder,
  PurchaseOrderPayment,
  PurchaseOrderPaymentStatus,
  PurchaseOrderStatus,
  UnbilledPoLine,
} from '@/types'
import {
  computePoTaxIncluded,
  invoicePaidTotal,
  invoiceRemaining,
  isLegacyPayablePo,
  poPaidTotal,
  poRemaining,
} from '@/lib/cashflow'
import { PaymentsEditor } from '@/components/PaymentsEditor'
import { PAYMENT_METHODS } from '@/lib/payment-methods'
import { computeTaxBuckets } from '@/lib/tax'
import { formatCurrency, formatKg, todayIso } from '@/lib/format'
import { bucketOf, makeBucketLabels, BUCKET_COLORS, BUCKET_ORDER_OPEN, type Bucket } from '@/lib/payment-buckets'

const PAY_LABELS: Record<PurchaseOrderPaymentStatus, string> = {
  uninvoiced: '未請求',
  unpaid: '未払',
  partial: '一部支払',
  paid: '支払済',
}
const INV_PAY_LABELS: Record<PurchaseInvoicePaymentStatus, string> = {
  unpaid: '未払',
  partial: '一部支払',
  paid: '支払済',
}
const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  placed: '発注済',
  shipped: '発送中',
  received: '入荷済',
  cancelled: '取消',
}

type Tab = Bucket | 'pending'
const BUCKET_LABELS = makeBucketLabels('支払済')
const TAB_LABELS: Record<Tab, string> = { ...BUCKET_LABELS, pending: '請求待ち' }
const TABS: Tab[] = [...BUCKET_ORDER_OPEN, 'pending', 'paid']

// A unified payable: a received supplier invoice OR a legacy (pre-cutover) PO.
interface UndoState {
  kind: 'invoice' | 'po'
  id: string
  paymentId: string
  label: string
  amount: number
}

interface PayModalState {
  kind: 'invoice' | 'po'
  id: string
  label: string
  mode: 'pay' | 'edit'
  amount: number          // remaining to pay (pay) / the payment amount (edit)
  paymentId?: string      // edit: which payment to change
  paidDate: string
  method: string
}

interface PayableRow {
  kind: 'invoice' | 'po'
  id: string
  supplierName: string
  dueDate?: string
  totalIncl: number
  paid: number
  remaining: number
  isPaid: boolean
  statusLabel: string
  paidDate?: string
  docUrl?: string
  sub: string
  invoice?: PurchaseInvoice
  po?: PurchaseOrder
}

/** Most recent payment date among the records (ISO), or undefined. */
function latestPaidDate(payments: { paidDate?: string }[] | undefined): string | undefined {
  const ds = (payments ?? []).map(p => p.paidDate).filter((d): d is string => !!d).sort()
  return ds[ds.length - 1]
}

function invLineSummary(inv: PurchaseInvoice): string {
  const first = inv.lines[0]?.productName ?? ''
  return first + (inv.lines.length > 1 ? ` 他${inv.lines.length - 1}件` : '')
}
function poLineSummary(o: PurchaseOrder): string {
  return (o.items[0]?.productName ?? '') + (o.items.length > 1 ? ` 他${o.items.length - 1}件` : '')
}

export default function PayablesPage() {
  const router = useRouter()
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  const [legacyPos, setLegacyPos] = useState<PurchaseOrder[]>([])
  const [unbilled, setUnbilled] = useState<UnbilledPoLine[]>([])
  const [bankInfoBySupplier, setBankInfoBySupplier] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [detailPo, setDetailPo] = useState<PurchaseOrder | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('actionNeeded')
  // Payment confirm/edit dialog (also serves as the misclick guard — a single
  // stray click only opens it; committing needs an explicit 確定/更新).
  const [payModal, setPayModal] = useState<PayModalState | null>(null)
  // Just-confirmed payment, surfaced with an inline 元に戻す affordance.
  const [lastUndo, setLastUndo] = useState<UndoState | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const svc = await getServices()
      const [allPos, invs, pending, suppliers] = await Promise.all([
        svc.purchaseOrders.getPurchaseOrders(),
        svc.purchaseInvoices.getPurchaseInvoices(),
        svc.purchaseInvoices.getUnbilledReceivedPoLines(),
        svc.suppliers.getSuppliers(),
      ])
      setLegacyPos(allPos.filter(o => o.status !== 'cancelled' && isLegacyPayablePo(o)))
      setInvoices(invs)
      setUnbilled(pending)
      const map: Record<string, string> = {}
      for (const s of suppliers) if (s.bankInfo) map[s.name] = s.bankInfo
      setBankInfoBySupplier(map)
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const rows = useMemo<PayableRow[]>(() => {
    const invRows: PayableRow[] = invoices.map(inv => ({
      kind: 'invoice',
      id: inv.id,
      supplierName: inv.supplierName,
      dueDate: inv.paymentDueDate,
      totalIncl: inv.totalAmount,
      paid: invoicePaidTotal(inv),
      remaining: invoiceRemaining(inv),
      isPaid: inv.paymentStatus === 'paid',
      statusLabel: INV_PAY_LABELS[inv.paymentStatus],
      paidDate: latestPaidDate(inv.payments),
      docUrl: inv.file?.url,
      sub: invLineSummary(inv),
      invoice: inv,
    }))
    const poRows: PayableRow[] = legacyPos.map(o => ({
      kind: 'po',
      id: o.id,
      supplierName: o.supplierName,
      dueDate: o.paymentDueDate,
      totalIncl: computePoTaxIncluded(o),
      paid: poPaidTotal(o),
      remaining: poRemaining(o),
      isPaid: o.paymentStatus === 'paid',
      statusLabel: PAY_LABELS[o.paymentStatus],
      paidDate: latestPaidDate(o.payments) || o.paidDate,
      docUrl: o.invoice?.url,
      sub: poLineSummary(o),
      po: o,
    }))
    return [...invRows, ...poRows]
  }, [invoices, legacyPos])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => r.supplierName.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q))
  }, [rows, query])

  const grouped = useMemo(() => {
    const groups: Record<Bucket, PayableRow[]> = { actionNeeded: [], nextMonth: [], later: [], noDate: [], paid: [] }
    for (const r of filtered) groups[bucketOf(r.dueDate, r.isPaid)].push(r)
    for (const k of Object.keys(groups) as Bucket[]) {
      groups[k].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    }
    return groups
  }, [filtered])

  const filteredPending = useMemo(() => {
    const q = query.trim().toLowerCase()
    return unbilled.filter(u => !q || u.supplierName.toLowerCase().includes(q) || u.productName.toLowerCase().includes(q))
  }, [unbilled, query])

  const kpis = useMemo(() => {
    const outstanding = rows.filter(r => !r.isPaid).reduce((s, r) => s + r.remaining, 0)
    const actionNeeded = grouped.actionNeeded.reduce((s, r) => s + r.remaining, 0)
    const pendingTotal = unbilled.reduce((s, u) => s + u.billableRemainingAmount, 0)
    const ym = todayIso().slice(0, 7)
    const paidThisMonth =
      invoices.reduce((s, inv) => s + (inv.payments ?? []).filter(p => (p.paidDate ?? '').startsWith(ym)).reduce((t, p) => t + p.amount, 0), 0) +
      legacyPos.reduce((s, o) => {
        const splits = (o.payments ?? []).filter(p => (p.paidDate ?? '').startsWith(ym)).reduce((t, p) => t + p.amount, 0)
        const legacy = (o.payments ?? []).length === 0 && o.paymentStatus === 'paid' && (o.paidDate ?? '').startsWith(ym) ? computePoTaxIncluded(o) : 0
        return s + splits + legacy
      }, 0)
    return { outstanding, actionNeeded, pendingTotal, paidThisMonth }
  }, [rows, grouped, unbilled, invoices, legacyPos])

  // Open the confirm dialog for an unpaid/partial row (record a new payment).
  const openPay = (r: PayableRow) => {
    setLastUndo(null)
    setPayModal({
      kind: r.kind,
      id: r.id,
      label: r.supplierName,
      mode: 'pay',
      amount: r.remaining > 0 ? r.remaining : r.totalIncl,
      paidDate: todayIso(),
      method: '',
    })
  }

  // Open the dialog to change the recorded 支払日 / 支払方法 of the latest payment.
  const openEdit = (r: PayableRow) => {
    const payments = r.kind === 'invoice' ? r.invoice?.payments : r.po?.payments
    const last = (payments ?? [])[(payments?.length ?? 0) - 1]
    if (!last) return
    setLastUndo(null)
    setPayModal({
      kind: r.kind,
      id: r.id,
      label: r.supplierName,
      mode: 'edit',
      amount: last.amount,
      paymentId: last.id,
      paidDate: last.paidDate || todayIso(),
      method: last.method || '',
    })
  }

  // Commit the dialog: append a new payment (pay) or update the chosen one (edit).
  const submitPayModal = async () => {
    if (!payModal) return
    const m = payModal
    const key = `${m.kind}:${m.id}`
    setSavingKey(key)
    setFeedback(null)
    try {
      const svc = await getServices()
      const paidDate = m.paidDate || todayIso()
      const method = m.method || undefined
      if (m.mode === 'pay') {
        const payId = `pay-${Date.now()}`
        const payment: PurchaseOrderPayment = { id: payId, amount: m.amount, paidDate, ...(method ? { method } : {}) }
        if (m.kind === 'invoice') {
          const inv = invoices.find(x => x.id === m.id)
          if (!inv) return
          const updated = await svc.purchaseInvoices.updateInvoicePayments(m.id, [...(inv.payments ?? []), payment])
          setInvoices(prev => prev.map(x => x.id === m.id ? updated : x))
        } else {
          const o = legacyPos.find(x => x.id === m.id)
          if (!o) return
          const updated = await svc.purchaseOrders.updatePurchaseOrder(m.id, { payments: [...(o.payments ?? []), payment], paidDate })
          setLegacyPos(prev => prev.map(x => x.id === m.id ? updated : x))
        }
        setLastUndo({ kind: m.kind, id: m.id, paymentId: payId, label: m.label, amount: m.amount })
      } else {
        // Edit the chosen payment's date/method (amount unchanged).
        const apply = (payments: PurchaseOrderPayment[] | undefined): PurchaseOrderPayment[] =>
          (payments ?? []).map(p => p.id === m.paymentId ? { ...p, paidDate, method } : p)
        if (m.kind === 'invoice') {
          const inv = invoices.find(x => x.id === m.id)
          if (!inv) return
          const updated = await svc.purchaseInvoices.updateInvoicePayments(m.id, apply(inv.payments))
          setInvoices(prev => prev.map(x => x.id === m.id ? updated : x))
        } else {
          const o = legacyPos.find(x => x.id === m.id)
          if (!o) return
          const updated = await svc.purchaseOrders.updatePurchaseOrder(m.id, { payments: apply(o.payments), paidDate })
          setLegacyPos(prev => prev.map(x => x.id === m.id ? updated : x))
        }
        setFeedback('支払情報を更新しました')
      }
      setPayModal(null)
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '更新に失敗しました')
    } finally { setSavingKey(null) }
  }

  // Undo a payment: a specific one (元に戻す, by paymentId) or the most recent
  // (支払取消, no paymentId). Recomputes status from the remaining payments.
  const removePayment = async (kind: 'invoice' | 'po', id: string, paymentId?: string) => {
    const key = `${kind}:${id}`
    setSavingKey(key)
    setFeedback(null)
    try {
      const svc = await getServices()
      if (kind === 'invoice') {
        const inv = invoices.find(x => x.id === id)
        if (!inv) return
        const cur = inv.payments ?? []
        const next = paymentId ? cur.filter(p => p.id !== paymentId) : cur.slice(0, -1)
        const updated = await svc.purchaseInvoices.updateInvoicePayments(id, next)
        setInvoices(prev => prev.map(x => x.id === id ? updated : x))
      } else {
        const o = legacyPos.find(x => x.id === id)
        if (!o) return
        const cur = o.payments ?? []
        const next = paymentId ? cur.filter(p => p.id !== paymentId) : cur.slice(0, -1)
        const updated = await svc.purchaseOrders.updatePurchaseOrder(id, {
          payments: next,
          paidDate: '',
          ...(next.length === 0 ? { paymentStatus: 'unpaid' as const } : {}),
        })
        setLegacyPos(prev => prev.map(x => x.id === id ? updated : x))
      }
      setLastUndo(null)
      setFeedback('支払いを取り消しました')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '取り消しに失敗しました')
    } finally { setSavingKey(null) }
  }

  const savePoPayments = async (id: string, payments: PurchaseOrderPayment[]) => {
    setSavingKey(`po:${id}`)
    setFeedback(null)
    try {
      const svc = await getServices()
      const updated = await svc.purchaseOrders.updatePurchaseOrder(id, { payments })
      setLegacyPos(prev => prev.map(o => o.id === id ? updated : o))
      setDetailPo(updated)
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '更新に失敗しました')
    } finally { setSavingKey(null) }
  }

  const renderRow = (r: PayableRow, showPaidDate = false) => {
    const overdue = !!r.dueDate && !r.isPaid && r.dueDate < todayIso()
    return (
      <tr key={`${r.kind}:${r.id}`} className="border-t border-white/60">
        <td className="px-3 py-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${r.kind === 'invoice' ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-200 text-gray-700'}`}>
            {r.kind === 'invoice' ? '請求書' : '発注(旧)'}
          </span>
        </td>
        <td className={`px-3 py-2 ${overdue ? 'text-alert' : 'text-mist'}`}>{r.dueDate || '—'}</td>
        <td className="px-3 py-2 text-ink">
          {r.kind === 'invoice' ? (
            <Link href={`/purchase-invoices/${r.id}`} className="text-left hover:underline">{r.supplierName}</Link>
          ) : (
            <button type="button" onClick={() => r.po && setDetailPo(r.po)} className="text-left hover:underline">{r.supplierName}</button>
          )}
        </td>
        <td className="px-3 py-2 text-mist">{r.sub}</td>
        <td className="px-3 py-2 text-right">
          <div className="font-medium">{formatCurrency(r.totalIncl)}</div>
          {r.paid > 0 && r.remaining > 0 && <div className="text-[10px] text-alert">残額 {formatCurrency(r.remaining)}</div>}
        </td>
        <td className="px-3 py-2">
          <span className="inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium text-sky-800">{r.statusLabel}</span>
        </td>
        {showPaidDate && <td className="px-3 py-2 text-mist">{r.paidDate || '—'}</td>}
        <td className="px-3 py-2">
          {r.docUrl ? (
            <a href={r.docUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-matchaDeep hover:underline"><FileText size={12} /> PDF</a>
          ) : (
            <span className="text-mist text-xs">未添付</span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-1.5">
            {!r.isPaid && (
              <button
                type="button"
                onClick={() => openPay(r)}
                disabled={savingKey === `${r.kind}:${r.id}`}
                className="inline-flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1 text-[11px] font-medium text-paper shadow hover:bg-[#205f43] disabled:opacity-60"
              >
                <CheckCircle2 size={12} /> 支払確認
              </button>
            )}
            {r.paid > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => openEdit(r)}
                  disabled={savingKey === `${r.kind}:${r.id}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb] disabled:opacity-60"
                >
                  <Pencil size={12} /> 支払日・方法
                </button>
                <button
                  type="button"
                  onClick={() => removePayment(r.kind, r.id)}
                  disabled={savingKey === `${r.kind}:${r.id}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11px] text-mist hover:bg-bone disabled:opacity-60"
                >
                  <Undo2 size={12} /> 支払取消
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
    )
  }

  const renderCard = (label: string, colorClass: string, list: PayableRow[], showPaidDate = false) => (
    <div className={`rounded-2xl border-2 ${colorClass}`}>
      <div className="flex items-center gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{label}</h2>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-mist">
          {list.length}件 / {formatCurrency(list.reduce((s, r) => s + (showPaidDate ? r.totalIncl : r.remaining), 0))}
        </span>
      </div>
      <div className="overflow-x-auto border-t border-white/60">
        <table className="min-w-[920px] text-sm">
          <thead className="bg-white/60 text-ink">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">種別</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">支払期日</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">仕入先</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">明細</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">支払額(税込)</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">状態</th>
              {showPaidDate && <th className="whitespace-nowrap px-3 py-2 text-left font-medium">支払日</th>}
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">請求書</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>{list.map(r => renderRow(r, showPaidDate))}</tbody>
        </table>
      </div>
    </div>
  )

  const renderPending = () => {
    // Group unbilled-received PO lines by supplier for a tidy worklist.
    const bySupplier = new Map<string, UnbilledPoLine[]>()
    for (const u of filteredPending) {
      const arr = bySupplier.get(u.supplierName) ?? []
      arr.push(u)
      bySupplier.set(u.supplierName, arr)
    }
    const suppliers = [...bySupplier.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    if (suppliers.length === 0) {
      return <p className="rounded-2xl border border-line bg-white p-6 text-center text-sm text-mist">請求待ち（入荷済み・未請求）の発注はありません。</p>
    }
    return (
      <div className="space-y-4">
        <p className="rounded-xl border border-sky-200 bg-sky-50/50 px-3 py-2 text-xs text-mist">
          入荷済みでまだ請求書が届いていない発注です。請求書が届いたら「請求書に紐付け」から登録・消し込みします（支払い対象にはまだ含まれません）。
        </p>
        {suppliers.map(([supplier, lines]) => (
          <div key={supplier} className="rounded-2xl border-2 border-sky-200 bg-sky-50/30">
            <div className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-ink">{supplier}</h2>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-mist">
                  {lines.length}件 / 請求可能 {formatCurrency(lines.reduce((s, u) => s + u.billableRemainingAmount, 0))}
                </span>
              </div>
              <Link
                href={`/purchase-invoices/new?supplier=${encodeURIComponent(supplier)}`}
                className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb]"
              >
                <Plus size={12} /> まとめて請求書作成
              </Link>
            </div>
            <div className="overflow-x-auto border-t border-white/60">
              <table className="min-w-[760px] text-sm">
                <thead className="bg-white/60 text-ink">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-medium">発注日</th>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-medium">商品</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">入荷</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">請求可能(税抜)</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(u => (
                    <tr key={`${u.poId}:${u.lineId}`} className="border-t border-white/60">
                      <td className="px-3 py-2 text-mist">{u.orderDate || '—'}</td>
                      <td className="px-3 py-2 text-ink">{u.productName}</td>
                      <td className="px-3 py-2 text-right text-mist">{formatKg(u.receivedKg)}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatCurrency(u.billableRemainingAmount)}</td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/purchase-invoices/new?supplier=${encodeURIComponent(supplier)}&poId=${u.poId}&lineId=${u.lineId}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1 text-[11px] font-medium text-paper hover:bg-[#205f43]"
                        >
                          <Link2 size={12} /> 請求書に紐付け
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <AppLayout>
      <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-ink">支払管理</h1>
            <p className="text-sm text-mist">受領した請求書を支払い単位に管理します。発注は請求書を登録した時点で支払い対象になります。</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/purchase-invoices/new')}
              className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:bg-[#205f43]"
            >
              <Plus size={14} /> 請求書を受領
            </button>
            <Link href="/financials" className="rounded-full border border-line bg-white px-3 py-1.5 text-xs text-matchaDeep hover:bg-[#eef3eb]">
              収支ダッシュボード →
            </Link>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard title="未払 残高" value={formatCurrency(kpis.outstanding)} color={kpis.outstanding > 0 ? 'amber' : 'default'} icon={<Wallet size={18} />} />
          <KPICard title="要確認（超過・今月）" value={formatCurrency(kpis.actionNeeded)} color={kpis.actionNeeded > 0 ? 'red' : 'default'} icon={<AlertTriangle size={18} />} />
          <KPICard title="請求待ち（入荷済・未請求）" value={formatCurrency(kpis.pendingTotal)} color="default" icon={<Clock size={18} />} />
          <KPICard title="今月支払 (確認済)" value={formatCurrency(kpis.paidThisMonth)} color="green" icon={<CheckCircle2 size={18} />} />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
          <Filter size={14} className="text-mist" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="仕入先または商品名で検索"
            className="flex-1 min-w-[200px] rounded-lg border border-line bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
          />
          {feedback && <span className="text-xs text-matchaDeep">{feedback}</span>}
        </div>

        {lastUndo && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-4 py-2.5 text-sm">
            <span className="text-ink">
              <CheckCircle2 size={14} className="mr-1 inline text-matcha" />
              「{lastUndo.label}」を支払確認しました（{formatCurrency(lastUndo.amount)}）
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => removePayment(lastUndo.kind, lastUndo.id, lastUndo.paymentId)}
                disabled={savingKey === `${lastUndo.kind}:${lastUndo.id}`}
                className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-medium text-matchaDeep hover:bg-white disabled:opacity-60"
              >
                <Undo2 size={13} /> 元に戻す
              </button>
              <button type="button" onClick={() => setLastUndo(null)} aria-label="閉じる" className="rounded p-1 text-gray-400 hover:text-mist">
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {loading && <p className="text-sm text-mist">読み込み中…</p>}

        {!loading && (() => {
          const active = activeTab
          const todayStr = todayIso()
          const sortByDue = (a: PayableRow, b: PayableRow) => (a.dueDate || '').localeCompare(b.dueDate || '')
          const actionRows = grouped.actionNeeded
          const overGroup = active === 'actionNeeded' ? actionRows.filter(r => !!r.dueDate && r.dueDate < todayStr).sort(sortByDue) : []
          const dueGroup = active === 'actionNeeded' ? actionRows.filter(r => !(r.dueDate && r.dueDate < todayStr)).sort(sortByDue) : []
          return (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 border-b border-[#e6dfcf]">
                {TABS.map(t => {
                  const count = t === 'pending' ? filteredPending.length : (grouped[t] ?? []).length
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setActiveTab(t)}
                      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
                        active === t ? 'border-[#174c33] text-ink' : 'border-transparent text-mist hover:text-ink'
                      }`}
                    >
                      {TAB_LABELS[t]}
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active === t ? 'bg-ink text-paper' : 'bg-bone text-mist'}`}>{count}</span>
                    </button>
                  )
                })}
              </div>

              {active === 'pending' ? (
                renderPending()
              ) : active === 'actionNeeded' ? (
                overGroup.length === 0 && dueGroup.length === 0 ? (
                  <p className="rounded-2xl border border-line bg-white p-6 text-center text-sm text-mist">要確認の支払いはありません。</p>
                ) : (
                  <div className="space-y-4">
                    {overGroup.length > 0 && renderCard('期限超過', 'border-alert/40 bg-alert/5', overGroup)}
                    {dueGroup.length > 0 && renderCard('今月期限', 'border-[#a87b1e]/40 bg-bone', dueGroup)}
                  </div>
                )
              ) : (grouped[active] ?? []).length === 0 ? (
                <p className="rounded-2xl border border-line bg-white p-6 text-center text-sm text-mist">{TAB_LABELS[active]}の支払いはありません。</p>
              ) : (
                renderCard(TAB_LABELS[active], BUCKET_COLORS[active], grouped[active], active === 'paid')
              )}
            </div>
          )
        })()}
      </main>

      <PoDetailModal
        order={detailPo}
        bankInfo={detailPo ? bankInfoBySupplier[detailPo.supplierName] : undefined}
        onClose={() => setDetailPo(null)}
        onSavePayments={savePoPayments}
      />

      {payModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4" onClick={() => setPayModal(null)}>
          <div className="w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">{payModal.mode === 'pay' ? '支払確認' : '支払日・支払方法の変更'}</h2>
              <button onClick={() => setPayModal(null)} className="rounded-full p-1.5 text-gray-400 hover:bg-bone hover:text-mist"><X size={16} /></button>
            </div>
            <p className="mb-3 text-sm text-mist">{payModal.label}</p>
            <div className="mb-3 flex items-center justify-between rounded-xl border border-line bg-bone px-3 py-2 text-sm">
              <span className="text-mist">{payModal.mode === 'pay' ? '支払額（税込）' : '支払額（税込）'}</span>
              <span className="font-semibold text-ink">{formatCurrency(payModal.amount)}</span>
            </div>
            <div className="space-y-3">
              <label className="block text-xs text-mist">
                <span className="mb-1 block">支払日</span>
                <input
                  type="date"
                  value={payModal.paidDate}
                  onChange={e => setPayModal(m => m && { ...m, paidDate: e.target.value })}
                  className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                />
              </label>
              <label className="block text-xs text-mist">
                <span className="mb-1 block">支払方法</span>
                <select
                  value={payModal.method}
                  onChange={e => setPayModal(m => m && { ...m, method: e.target.value })}
                  className="w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                >
                  <option value="">未設定</option>
                  {PAYMENT_METHODS.map(pm => <option key={pm} value={pm}>{pm}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setPayModal(null)} className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-mist hover:bg-bone">取消</button>
              <button
                type="button"
                onClick={submitPayModal}
                disabled={savingKey === `${payModal.kind}:${payModal.id}`}
                className="inline-flex items-center gap-1 rounded-lg bg-ink px-4 py-1.5 text-sm font-medium text-paper shadow hover:bg-[#205f43] disabled:opacity-60"
              >
                <CheckCircle2 size={14} /> {payModal.mode === 'pay' ? '支払確認' : '更新'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-mist">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  )
}

function PoDetailModal({ order, bankInfo, onClose, onSavePayments }: {
  order: PurchaseOrder | null
  bankInfo?: string
  onClose: () => void
  onSavePayments: (id: string, payments: PurchaseOrderPayment[]) => Promise<void>
}) {
  if (!order) return null
  const fees = (order.shippingFee ?? 0) + (order.otherFees ?? 0)
  const tax = computeTaxBuckets(order.items ?? [], fees)
  const inclTotal = computePoTaxIncluded(order)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[100vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:max-h-[92vh] sm:rounded-3xl sm:p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink">{order.supplierName}</h2>
            <p className="mt-1 text-xs text-mist">発注の詳細（旧フロー・読み取り専用）</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/purchase-orders/${order.id}/document`} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs text-matchaDeep hover:bg-[#eef3eb]">発注書 →</Link>
            <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-bone hover:text-mist"><X size={18} /></button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[#e6dfcf] bg-bone p-3">
            <DetailRow label="発注ステータス" value={PO_STATUS_LABELS[order.status]} />
            <DetailRow label="支払ステータス" value={PAY_LABELS[order.paymentStatus]} />
            <DetailRow label="発注日" value={order.orderDate || '-'} />
            <DetailRow label="入荷予定日" value={order.expectedDeliveryDate || '-'} />
            <DetailRow label="入荷日" value={order.actualDeliveryDate || '-'} />
            <DetailRow label="支払期日" value={order.paymentDueDate || '-'} />
            <DetailRow label="支払日" value={order.paidDate || '-'} />
          </div>
          <div className="rounded-2xl border border-[#e6dfcf] bg-bone p-3">
            <DetailRow label="商品代金（税抜）" value={formatCurrency(order.totalAmount)} />
            <DetailRow label="送料" value={formatCurrency(order.shippingFee ?? 0)} />
            <DetailRow label="諸経費" value={formatCurrency(order.otherFees ?? 0)} />
            <DetailRow label="10%対象 / 消費税" value={`${formatCurrency(tax.standardSubtotal)} / ${formatCurrency(tax.standardTax)}`} />
            <DetailRow label="8%対象 / 消費税" value={`${formatCurrency(tax.reducedSubtotal)} / ${formatCurrency(tax.reducedTax)}`} />
            <DetailRow label="合計（税抜）" value={formatCurrency(order.totalAmount + (order.shippingFee ?? 0) + (order.otherFees ?? 0))} />
            <DetailRow label="合計（税込）" value={<span className="text-base">{formatCurrency(inclTotal)}</span>} />
            <DetailRow label="請求書" value={order.invoice ? <a href={order.invoice.url} target="_blank" rel="noopener noreferrer" className="text-matchaDeep hover:underline">PDF</a> : '未添付'} />
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-[#e6dfcf] bg-bone p-3 text-sm">
          <p className="mb-1 text-xs font-medium text-mist">振込先（支払口座）</p>
          {bankInfo
            ? <p className="whitespace-pre-wrap text-ink">{bankInfo}</p>
            : <p className="text-mist">仕入先マスタに未登録です。<Link href="/suppliers" className="text-matchaDeep hover:underline">仕入先管理</Link>で登録してください。</p>}
        </div>

        <div className="mt-4 rounded-2xl border border-[#e6dfcf] p-3">
          <p className="mb-2 text-xs font-medium text-mist">支払い（分割対応）</p>
          <PaymentsEditor
            payments={order.payments ?? []}
            totalIncl={computePoTaxIncluded(order)}
            onChange={next => { void onSavePayments(order.id, next) }}
          />
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-[#e6dfcf]">
          <table className="min-w-full text-sm">
            <thead className="bg-bone text-left text-ink">
              <tr>
                <th className="px-3 py-2 font-medium">商品</th>
                <th className="px-3 py-2 font-medium text-right">数量</th>
                <th className="px-3 py-2 font-medium text-right">単価(税抜)</th>
                <th className="px-3 py-2 font-medium text-center">税率</th>
                <th className="px-3 py-2 font-medium text-right">金額</th>
              </tr>
            </thead>
            <tbody>
              {(order.items ?? []).map((item, i) => (
                <tr key={i} className="border-t border-[#f0ebdf] text-ink">
                  <td className="px-3 py-2">{item.productName}{item.productSku && <span className="ml-1 text-[10px] text-mist">({item.productSku})</span>}</td>
                  <td className="px-3 py-2 text-right">{formatKg(item.quantityKg)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                  <td className="px-3 py-2 text-center">{(item.taxRate ?? 8) === 0 ? '免税' : `${item.taxRate ?? 8}%`}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(order.otherFeesNote || order.notes) && (
          <div className="mt-4 rounded-2xl border border-[#e6dfcf] bg-bone p-3 text-sm">
            {order.otherFeesNote && <p className="text-ink"><span className="text-mist">諸経費メモ：</span>{order.otherFeesNote}</p>}
            {order.notes && <p className="mt-1 whitespace-pre-wrap text-ink"><span className="text-mist">メモ：</span>{order.notes}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
