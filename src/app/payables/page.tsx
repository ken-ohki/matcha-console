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
import { useAuth } from '@/contexts/AuthContext'
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
import { hasInstallmentSchedule } from '@/components/InstallmentScheduleEditor'
import { useModalDismiss } from '@/hooks/useModalDismiss'
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
  stageKind?: 'deposit' | 'balance'
}

interface PayModalState {
  kind: 'invoice' | 'po'
  id: string              // invoice/po id (for stage rows = the real PO id, not the composite row id)
  label: string
  mode: 'pay' | 'edit'
  amount: number          // remaining to pay (pay) / the payment amount (edit)
  paymentId?: string      // edit: which payment to change
  stageKind?: 'deposit' | 'balance' // set for 前払金/残金 stage rows → confirm updates that stage in place
  paidDate: string
  method: string
}

interface PayableRow {
  kind: 'invoice' | 'po'
  typeLabel: string // 行種別の表示ラベル（請求書 / 発注(前払金) / 発注(残金) / 発注(直接払い)）
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
  // 前払金/残金 の段階行のとき設定。支払確認/取消はこの段階(kind一致のpayment)を
  // その場で更新する（請求書/PO直接と同じ操作に統一）。
  stageKind?: 'deposit' | 'balance'
}

/** Most recent payment date among the records (ISO), or undefined. */
function latestPaidDate(payments: { paidDate?: string }[] | undefined): string | undefined {
  const ds = (payments ?? []).map(p => p.paidDate).filter((d): d is string => !!d).sort()
  return ds[ds.length - 1]
}

const STAGE_LABEL: Record<'deposit' | 'balance', string> = { deposit: '前払金', balance: '残金' }

function invLineSummary(inv: PurchaseInvoice): string {
  const first = inv.lines[0]?.productName ?? ''
  return first + (inv.lines.length > 1 ? ` 他${inv.lines.length - 1}件` : '')
}
function poLineSummary(o: PurchaseOrder): string {
  return (o.items[0]?.productName ?? '') + (o.items.length > 1 ? ` 他${o.items.length - 1}件` : '')
}

export default function PayablesPage() {
  const router = useRouter()
  const { user } = useAuth()
  // 経理ページ: 支払確認(入出金)は admin と finance が編集可、viewer は閲覧のみ。
  const canEdit = user?.role === 'admin' || user?.role === 'finance'
  // 受領請求書の新規登録は「仕入」領域のため admin 限定。
  const isAdmin = user?.role === 'admin'
  const [invoices, setInvoices] = useState<PurchaseInvoice[]>([])
  // PO-direct payables: legacy single/free-form payments AND 前払金＋残金 schedules
  // (a schedule makes the PO PO-direct via isLegacyPayablePo). Split into per-PO rows
  // (no schedule) and per-stage rows (schedule) when building the table below.
  const [legacyPos, setLegacyPos] = useState<PurchaseOrder[]>([])
  const [unbilled, setUnbilled] = useState<UnbilledPoLine[]>([])
  const [bankInfoBySupplier, setBankInfoBySupplier] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [detailRow, setDetailRow] = useState<PayableRow | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('actionNeeded')
  // Payment confirm/edit dialog (also serves as the misclick guard — a single
  // stray click only opens it; committing needs an explicit 確定/更新).
  const [payModal, setPayModal] = useState<PayModalState | null>(null)
  // Just-confirmed payment, surfaced with an inline 元に戻す affordance.
  const [lastUndo, setLastUndo] = useState<UndoState | null>(null)
  useModalDismiss(!!payModal, () => setPayModal(null)) // 支払確認ダイアログ: Escで閉じる＋スクロールロック

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
      typeLabel: '請求書',
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
    // PO直接（分割払いスケジュール無し）: 発注1件を全額1行で表示。
    const poRows: PayableRow[] = legacyPos
      .filter(o => !hasInstallmentSchedule(o.payments))
      .map(o => ({
        kind: 'po',
        typeLabel: '発注(直接払い)',
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
    // 分割払い（前払金／残金）のPO: 段階ごとに1行で表示。各段に支払期限があり、
    // 詳細モーダルの2段階エディタで支払確認する。
    const scheduleRows: PayableRow[] = legacyPos
      .filter(o => hasInstallmentSchedule(o.payments))
      .flatMap(o =>
        (o.payments ?? [])
          .filter((p): p is typeof p & { kind: 'deposit' | 'balance' } => p.kind === 'deposit' || p.kind === 'balance')
          .map(p => {
            const amount = Number(p.amount) || 0
            const confirmed = p.paid !== false
            const label = STAGE_LABEL[p.kind]
            return {
              kind: 'po' as const,
              typeLabel: `発注(${label})`,
              id: `${o.id}#${p.kind}`,
              supplierName: o.supplierName,
              dueDate: p.dueDate || o.paymentDueDate,
              totalIncl: amount,
              paid: confirmed ? amount : 0,
              remaining: confirmed ? 0 : amount,
              isPaid: confirmed,
              statusLabel: `${label}・${confirmed ? '支払済' : '未払'}`,
              paidDate: confirmed ? p.paidDate || undefined : undefined,
              docUrl: o.invoice?.url,
              sub: `${poLineSummary(o)} / ${label}`,
              po: o,
              stageKind: p.kind,
            }
          }),
      )
    return [...invRows, ...poRows, ...scheduleRows]
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

  // 請求待ち(unbilled)は getUnbilledReceivedPoLines が PO直接(legacy/schedule)を除外済み。
  const filteredPending = useMemo(() => {
    const q = query.trim().toLowerCase()
    return unbilled.filter(u => !q || u.supplierName.toLowerCase().includes(q) || u.productName.toLowerCase().includes(q))
  }, [unbilled, query])

  const kpis = useMemo(() => {
    const outstanding = rows.filter(r => !r.isPaid).reduce((s, r) => s + r.remaining, 0)
    const actionNeeded = grouped.actionNeeded.reduce((s, r) => s + r.remaining, 0)
    const pendingTotal = unbilled.reduce((s, u) => s + u.billableRemainingAmount, 0)
    const ym = todayIso().slice(0, 7)
    // legacyPos は分割払い(前払金/残金)POも含む。確認済み payment(paidDate)が splits に入る。
    const paidThisMonth =
      invoices.reduce((s, inv) => s + (inv.payments ?? []).filter(p => (p.paidDate ?? '').startsWith(ym)).reduce((t, p) => t + p.amount, 0), 0) +
      legacyPos.reduce((s, o) => {
        const splits = (o.payments ?? []).filter(p => (p.paidDate ?? '').startsWith(ym)).reduce((t, p) => t + p.amount, 0)
        const legacy = (o.payments ?? []).length === 0 && o.paymentStatus === 'paid' && (o.paidDate ?? '').startsWith(ym) ? computePoTaxIncluded(o) : 0
        return s + splits + legacy
      }, 0)
    return { outstanding, actionNeeded, pendingTotal, paidThisMonth }
  }, [rows, grouped, unbilled, invoices, legacyPos])

  // Open the confirm dialog for an unpaid/partial row (record a new payment, or for a
  // 前払金/残金 stage row, confirm that stage). Same dialog for every row type.
  const openPay = (r: PayableRow) => {
    setLastUndo(null)
    const poId = r.po?.id ?? r.id
    setPayModal({
      kind: r.kind,
      id: r.stageKind ? poId : r.id,
      stageKind: r.stageKind,
      label: r.stageKind ? `${r.supplierName}（${STAGE_LABEL[r.stageKind]}）` : r.supplierName,
      mode: 'pay',
      amount: r.stageKind ? r.totalIncl : (r.remaining > 0 ? r.remaining : r.totalIncl),
      paidDate: todayIso(),
      method: '',
    })
  }

  // Open the dialog to change the recorded 支払日 / 支払方法. For a stage row, edit that
  // stage's payment; otherwise the latest payment on the invoice/PO.
  const openEdit = (r: PayableRow) => {
    const target = r.stageKind
      ? (r.po?.payments ?? []).find(p => p.kind === r.stageKind)
      : (() => {
          const payments = r.kind === 'invoice' ? r.invoice?.payments : r.po?.payments
          return (payments ?? [])[(payments?.length ?? 0) - 1]
        })()
    if (!target) return
    setLastUndo(null)
    setPayModal({
      kind: r.kind,
      id: r.stageKind ? (r.po?.id ?? r.id) : r.id,
      stageKind: r.stageKind,
      label: r.stageKind ? `${r.supplierName}（${STAGE_LABEL[r.stageKind]}）` : r.supplierName,
      mode: 'edit',
      amount: target.amount,
      paymentId: target.id,
      paidDate: target.paidDate || todayIso(),
      method: target.method || '',
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
        if (m.stageKind) {
          // 前払金/残金 段階の支払確認: 該当段階(kind一致)を paid:true に更新（append しない）。
          const o = legacyPos.find(x => x.id === m.id)
          if (!o) return
          const next = (o.payments ?? []).map(p =>
            p.kind === m.stageKind ? { ...p, paid: true, paidDate, ...(method ? { method } : {}) } : p)
          const updated = await svc.purchaseOrders.updatePurchaseOrderPayments(m.id, next)
          setLegacyPos(prev => prev.map(x => x.id === m.id ? updated : x))
          setLastUndo({ kind: m.kind, id: m.id, paymentId: '', label: m.label, amount: m.amount, stageKind: m.stageKind })
        } else {
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
            const updated = await svc.purchaseOrders.updatePurchaseOrderPayments(m.id, [...(o.payments ?? []), payment])
            setLegacyPos(prev => prev.map(x => x.id === m.id ? updated : x))
          }
          setLastUndo({ kind: m.kind, id: m.id, paymentId: payId, label: m.label, amount: m.amount })
        }
      } else {
        // Edit the chosen payment's date/method (amount unchanged). For a stage, match by kind.
        const apply = (payments: PurchaseOrderPayment[] | undefined): PurchaseOrderPayment[] =>
          (payments ?? []).map(p =>
            (m.stageKind ? p.kind === m.stageKind : p.id === m.paymentId) ? { ...p, paidDate, method } : p)
        if (m.kind === 'invoice') {
          const inv = invoices.find(x => x.id === m.id)
          if (!inv) return
          const updated = await svc.purchaseInvoices.updateInvoicePayments(m.id, apply(inv.payments))
          setInvoices(prev => prev.map(x => x.id === m.id ? updated : x))
        } else {
          const o = legacyPos.find(x => x.id === m.id)
          if (!o) return
          const updated = await svc.purchaseOrders.updatePurchaseOrderPayments(m.id, apply(o.payments))
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
  const removePayment = async (kind: 'invoice' | 'po', id: string, paymentId?: string, stageKind?: 'deposit' | 'balance') => {
    const key = `${kind}:${id}`
    setSavingKey(key)
    setFeedback(null)
    try {
      const svc = await getServices()
      if (stageKind) {
        // 前払金/残金 段階の取消: 段階を消さず paid:false（予定）に戻す。
        const o = legacyPos.find(x => x.id === id)
        if (!o) return
        const next = (o.payments ?? []).map(p =>
          p.kind === stageKind ? { ...p, paid: false, paidDate: '' } : p)
        const updated = await svc.purchaseOrders.updatePurchaseOrderPayments(id, next)
        setLegacyPos(prev => prev.map(x => x.id === id ? updated : x))
      } else if (kind === 'invoice') {
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
        const updated = await svc.purchaseOrders.updatePurchaseOrderPayments(id, next)
        setLegacyPos(prev => prev.map(x => x.id === id ? updated : x))
      }
      setLastUndo(null)
      setFeedback('支払いを取り消しました')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '取り消しに失敗しました')
    } finally { setSavingKey(null) }
  }


  const renderRow = (r: PayableRow, showPaidDate = false) => {
    const overdue = !!r.dueDate && !r.isPaid && r.dueDate < todayIso()
    // 段階行(前払金/残金)の id は合成値だが savingKey は実PO idで設定されるため、
    // 無効化判定も実PO idベースに揃える（保存中の二重送信を防ぐ）。
    const rowSaveKey = `${r.kind}:${r.stageKind ? (r.po?.id ?? r.id) : r.id}`
    return (
      <tr
        key={`${r.kind}:${r.id}`}
        onClick={() => setDetailRow(r)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailRow(r) } }}
        role="button"
        tabIndex={0}
        className="cursor-pointer border-t border-white/60 hover:bg-white/50 focus:bg-white/60 focus:outline-none"
      >
        <td className="px-3 py-2">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${r.kind === 'invoice' ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-200 text-gray-700'}`}>
            {r.typeLabel}
          </span>
        </td>
        <td className={`px-3 py-2 ${overdue ? 'text-alert' : 'text-mist'}`}>{r.dueDate || '—'}</td>
        <td className="px-3 py-2 text-ink">
          <span className="hover:underline">{r.supplierName}</span>
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
            <a href={r.docUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1 text-matchaDeep hover:underline"><FileText size={12} /> PDF</a>
          ) : (
            <span className="text-mist text-xs">未添付</span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          {/* 請求書・PO直接・前払金・残金 すべて同じ操作（支払確認→確認ダイアログ）。viewerは非表示。
              行クリックの詳細表示と二重発火しないよう伝播を止める。 */}
          <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
            {canEdit && !r.isPaid && (
              <button
                type="button"
                onClick={() => openPay(r)}
                disabled={savingKey === rowSaveKey}
                className="inline-flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1 text-[11px] font-medium text-paper shadow hover:bg-[#205f43] disabled:opacity-60"
              >
                <CheckCircle2 size={12} /> 支払確認
              </button>
            )}
            {canEdit && r.paid > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => openEdit(r)}
                  disabled={savingKey === rowSaveKey}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb] disabled:opacity-60"
                >
                  <Pencil size={12} /> 支払日・方法
                </button>
                <button
                  type="button"
                  onClick={() => removePayment(r.kind, r.stageKind ? (r.po?.id ?? r.id) : r.id, undefined, r.stageKind)}
                  disabled={savingKey === rowSaveKey}
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
                  {lines.length}件 / 請求予定 {formatCurrency(lines.reduce((s, u) => s + u.billableRemainingAmount, 0))}
                </span>
              </div>
              {isAdmin && (
                <Link
                  href={`/purchase-invoices/new?supplier=${encodeURIComponent(supplier)}`}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb]"
                >
                  <Plus size={12} /> まとめて請求書作成
                </Link>
              )}
            </div>
            <div className="overflow-x-auto border-t border-white/60">
              <table className="min-w-[760px] text-sm">
                <thead className="bg-white/60 text-ink">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-medium">発注日</th>
                    <th className="whitespace-nowrap px-3 py-2 text-left font-medium">商品</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">入荷</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">請求予定(税抜)</th>
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
                        {isAdmin && (
                          <Link
                            href={`/purchase-invoices/new?supplier=${encodeURIComponent(supplier)}&poId=${u.poId}&lineId=${u.lineId}`}
                            className="inline-flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1 text-[11px] font-medium text-paper hover:bg-[#205f43]"
                          >
                            <Link2 size={12} /> 請求書に紐付け
                          </Link>
                        )}
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
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-ink">支払管理</h1>
            <p className="text-sm text-mist">受領した請求書を支払い単位に管理します。発注は請求書を登録した時点で支払い対象になります。</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <button
                type="button"
                onClick={() => router.push('/purchase-invoices/new')}
                className="inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:bg-[#205f43]"
              >
                <Plus size={14} /> 請求書を受領
              </button>
            )}
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
                onClick={() => removePayment(lastUndo.kind, lastUndo.id, lastUndo.paymentId, lastUndo.stageKind)}
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
      </div>

      <PayableDetailModal
        row={detailRow}
        bankInfo={detailRow ? bankInfoBySupplier[detailRow.supplierName] : undefined}
        onClose={() => setDetailRow(null)}
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

/** 仕入先クリック時の統一・読み取り専用 詳細モーダル。請求書/発注(直接支払い)とも
 *  同じ見た目で 内容・請求先(振込先) を表示し、「編集」で各編集画面へ遷移する。 */
function PayableDetailModal({ row, bankInfo, onClose }: {
  row: PayableRow | null
  bankInfo?: string
  onClose: () => void
}) {
  useModalDismiss(!!row, onClose) // Escで閉じる＋背景スクロールロック
  if (!row) return null
  const inv = row.invoice
  const po = row.po
  const editHref = inv ? `/purchase-invoices/${inv.id}` : po ? `/purchase-orders/${po.id}` : '#'
  const taxLabel = (r: number) => (r === 0 ? '免税' : `${r}%`)
  const poTax = po ? computeTaxBuckets(po.items ?? [], (po.shippingFee ?? 0) + (po.otherFees ?? 0)) : null

  const bankBlock = (
    <div className="mb-4 rounded-2xl border border-[#e6dfcf] bg-bone p-3 text-sm">
      <p className="mb-1 text-xs font-medium text-mist">請求先・振込先（支払口座）</p>
      {bankInfo
        ? <p className="whitespace-pre-wrap text-ink">{bankInfo}</p>
        : <p className="text-mist">仕入先マスタに未登録です。<Link href="/suppliers" className="text-matchaDeep hover:underline">仕入先管理</Link>で登録してください。</p>}
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[100vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:max-h-[92vh] sm:rounded-3xl sm:p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink">{row.supplierName}</h2>
            <p className="mt-1 text-xs text-mist">{row.typeLabel} の詳細（読み取り専用）</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={editHref} className="inline-flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-medium text-matchaDeep hover:bg-[#eef3eb]"><Pencil size={12} /> 編集 →</Link>
            <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-bone hover:text-mist"><X size={18} /></button>
          </div>
        </div>

        {/* 前払金/残金 の行から開いた場合は「今回いくら払うか」を最上部に強調表示 */}
        {po && row.stageKind && (
          <div className="mb-4 rounded-2xl border-2 border-matcha/50 bg-[#f1f7f1] p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs font-medium text-matchaDeep">今回のお支払い（{STAGE_LABEL[row.stageKind]}）</p>
                <p className="mt-0.5 text-2xl font-bold text-ink">{formatCurrency(row.totalIncl)}</p>
              </div>
              <div className="text-right text-xs text-mist">
                <p>支払期限: <span className="text-ink">{row.dueDate || '-'}</span></p>
                <p className="mt-0.5">状態: <span className={row.isPaid ? 'font-medium text-matcha' : 'font-medium text-alert'}>{row.isPaid ? '支払済' : '未払'}</span></p>
              </div>
            </div>
            <div className="mt-3 border-t border-matcha/30 pt-2 text-xs text-mist">
              <p className="mb-1">分割払いの内訳（発注全体 {formatCurrency(computePoTaxIncluded(po))}）</p>
              <div className="space-y-0.5">
                {(po.payments ?? [])
                  .filter((p): p is typeof p & { kind: 'deposit' | 'balance' } => p.kind === 'deposit' || p.kind === 'balance')
                  .map((p, i) => {
                    const current = p.kind === row.stageKind
                    return (
                      <div key={i} className={`flex justify-between ${current ? 'font-semibold text-ink' : ''}`}>
                        <span>{STAGE_LABEL[p.kind]}{p.dueDate ? `（期限 ${p.dueDate}）` : ''}</span>
                        <span>{formatCurrency(Number(p.amount) || 0)}・{p.paid !== false ? '支払済' : '未払'}</span>
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>
        )}

        {/* 請求書の行も「お支払い額（未払い残額）」を最上部に強調表示 */}
        {inv && (
          <div className="mb-4 rounded-2xl border-2 border-matcha/50 bg-[#f1f7f1] p-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs font-medium text-matchaDeep">お支払い額（未払い残額）</p>
                <p className="mt-0.5 text-2xl font-bold text-ink">{formatCurrency(invoiceRemaining(inv))}</p>
              </div>
              <div className="text-right text-xs text-mist">
                <p>支払期限: <span className="text-ink">{inv.paymentDueDate || '-'}</span></p>
                <p className="mt-0.5">状態: <span className={inv.paymentStatus === 'paid' ? 'font-medium text-matcha' : 'font-medium text-alert'}>{INV_PAY_LABELS[inv.paymentStatus]}</span></p>
              </div>
            </div>
            <div className="mt-3 space-y-0.5 border-t border-matcha/30 pt-2 text-xs text-mist">
              <div className="flex justify-between"><span>合計（税込）</span><span>{formatCurrency(inv.totalAmount)}</span></div>
              <div className="flex justify-between"><span>支払済</span><span>{formatCurrency(invoicePaidTotal(inv))}</span></div>
              <div className="flex justify-between font-semibold text-ink"><span>未払い残額</span><span>{formatCurrency(invoiceRemaining(inv))}</span></div>
            </div>
          </div>
        )}

        {/* 請求先・振込先は画面上部に表示 */}
        {bankBlock}

        {inv ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-[#e6dfcf] bg-bone p-3">
                <DetailRow label="種別" value={row.typeLabel} />
                <DetailRow label="支払ステータス" value={INV_PAY_LABELS[inv.paymentStatus]} />
                <DetailRow label="請求書番号" value={inv.invoiceNumber || '-'} />
                <DetailRow label="請求日" value={inv.invoiceDate || '-'} />
                <DetailRow label="受領日" value={inv.receivedDate || '-'} />
                <DetailRow label="支払期日" value={inv.paymentDueDate || '-'} />
              </div>
              <div className="rounded-2xl border border-[#e6dfcf] bg-bone p-3">
                <DetailRow label="税抜小計" value={formatCurrency(inv.computedSubtotal)} />
                <DetailRow label="消費税" value={formatCurrency(inv.computedTax)} />
                <DetailRow label="合計（税込）" value={<span className="text-base">{formatCurrency(inv.totalAmount)}</span>} />
                <DetailRow label="支払済" value={formatCurrency(invoicePaidTotal(inv))} />
                <DetailRow label="残額" value={formatCurrency(invoiceRemaining(inv))} />
                <DetailRow label="PDF" value={inv.file?.url ? <a href={inv.file.url} target="_blank" rel="noopener noreferrer" className="text-matchaDeep hover:underline">PDF</a> : '未添付'} />
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-[#e6dfcf]">
              <table className="min-w-full text-sm">
                <thead className="bg-bone text-left text-ink">
                  <tr>
                    <th className="px-3 py-2 font-medium">品目</th>
                    <th className="px-3 py-2 font-medium text-right">数量</th>
                    <th className="px-3 py-2 font-medium text-right">単価(税抜)</th>
                    <th className="px-3 py-2 font-medium text-center">税率</th>
                    <th className="px-3 py-2 font-medium text-right">金額(税抜)</th>
                  </tr>
                </thead>
                <tbody>
                  {(inv.lines ?? []).map((l, i) => (
                    <tr key={l.id || i} className="border-t border-[#f0ebdf] text-ink">
                      <td className="px-3 py-2">{l.productName}{l.category && <span className="ml-1 text-[10px] text-mist">({l.category})</span>}{l.kind === 'adhoc' && <span className="ml-1 text-[10px] text-mist">[発注外]</span>}</td>
                      <td className="px-3 py-2 text-right">{!l.unit || l.unit === 'kg' ? formatKg(l.quantity) : `${l.quantity}${l.unit}`}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(l.unitPrice)}</td>
                      <td className="px-3 py-2 text-center">{taxLabel(l.taxRate)}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(l.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {inv.notes && (
              <div className="mt-4 rounded-2xl border border-[#e6dfcf] bg-bone p-3 text-sm text-ink">
                <span className="text-mist">メモ：</span>{inv.notes}
              </div>
            )}
          </>
        ) : po ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-[#e6dfcf] bg-bone p-3">
                <DetailRow label="種別" value={row.typeLabel} />
                <DetailRow label="発注ステータス" value={PO_STATUS_LABELS[po.status]} />
                <DetailRow label="支払ステータス" value={PAY_LABELS[po.paymentStatus]} />
                <DetailRow label="発注日" value={po.orderDate || '-'} />
                <DetailRow label="入荷予定日" value={po.expectedDeliveryDate || '-'} />
                <DetailRow label="入荷日" value={po.actualDeliveryDate || '-'} />
                <DetailRow label="支払期日" value={po.paymentDueDate || '-'} />
              </div>
              <div className="rounded-2xl border border-[#e6dfcf] bg-bone p-3">
                <DetailRow label="商品代金（税抜）" value={formatCurrency(po.totalAmount)} />
                <DetailRow label="送料" value={formatCurrency(po.shippingFee ?? 0)} />
                <DetailRow label="諸経費" value={formatCurrency(po.otherFees ?? 0)} />
                {poTax && <DetailRow label="10%対象 / 消費税" value={`${formatCurrency(poTax.standardSubtotal)} / ${formatCurrency(poTax.standardTax)}`} />}
                {poTax && <DetailRow label="8%対象 / 消費税" value={`${formatCurrency(poTax.reducedSubtotal)} / ${formatCurrency(poTax.reducedTax)}`} />}
                <DetailRow label="合計（税込）" value={<span className="text-base">{formatCurrency(computePoTaxIncluded(po))}</span>} />
                <DetailRow label="支払済" value={formatCurrency(poPaidTotal(po))} />
                <DetailRow label="残額" value={formatCurrency(poRemaining(po))} />
              </div>
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
                  {(po.items ?? []).map((item, i) => (
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

            {(po.otherFeesNote || po.notes) && (
              <div className="mt-4 rounded-2xl border border-[#e6dfcf] bg-bone p-3 text-sm">
                {po.otherFeesNote && <p className="text-ink"><span className="text-mist">諸経費メモ：</span>{po.otherFeesNote}</p>}
                {po.notes && <p className="mt-1 whitespace-pre-wrap text-ink"><span className="text-mist">メモ：</span>{po.notes}</p>}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
