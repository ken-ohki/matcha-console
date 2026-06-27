'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Filter,
  Mail,
  Wallet,
} from 'lucide-react'
import { X, Undo2 } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { getServices } from '@/lib/services'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useModalDismiss } from '@/hooks/useModalDismiss'
import type { EcSaleRecord, PaymentStatus, SaleRecord, SaleStatus, ShippingStatus } from '@/types'
import { computeSaleTaxIncluded } from '@/lib/cashflow'
import { computeSaleTaxBuckets, saleFeesToTaxLines, sumSaleFees } from '@/lib/tax'
import { PAYMENT_METHODS } from '@/lib/payment-methods'
import { formatCurrency, formatKg, todayIso } from '@/lib/format'
import { bucketOf, makeBucketLabels, BUCKET_COLORS, BUCKET_ORDER_ALL, type Bucket } from '@/lib/payment-buckets'
import { fetchWholesaleOrders, orderToSale, patchWholesaleOrder } from '@/lib/wholesaleAdapter'

// Tax-inclusive billed amount (matches the invoice document and 支払管理).
function saleIncome(sale: SaleRecord): number {
  return computeSaleTaxIncluded(sale)
}

// Tax-exclusive base, for the small secondary line.
function saleIncomeExcl(sale: SaleRecord): number {
  return sale.invoiceAmount > 0 ? sale.invoiceAmount : sale.revenue
}

const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  uninvoiced: '未請求',
  invoiced: '請求済',
  paid: '入金済',
}

const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  negotiating: '商談中',
  confirmed: '確定',
  cancelled: '取消',
}

const SHIPPING_STATUS_LABELS: Record<ShippingStatus, string> = {
  ordering: '発注対応中',
  producing: '製造中',
  ready_to_ship: '出荷準備完了',
  shipped: '出荷済',
}

const BUCKET_LABELS = makeBucketLabels('入金済')

export default function ReceivablesPage() {
  const { user } = useAuth()
  const { confirm } = useConfirm()
  // 経理ページ: admin と finance のみ編集可。viewer は閲覧のみ。
  const canEdit = user?.role === 'admin' || user?.role === 'finance'
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [ecSales, setEcSales] = useState<EcSaleRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [detailSale, setDetailSale] = useState<SaleRecord | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<SaleRecord | null>(null)
  const [confirmDate, setConfirmDate] = useState<string>(todayIso())
  // 入金確認直後に出す「元に戻す」用（支払管理のlastUndoバナーと体験を揃える）。
  const [lastUndo, setLastUndo] = useState<{ id: string; name: string } | null>(null)
  useModalDismiss(!!confirmTarget, () => setConfirmTarget(null)) // 入金確認ダイアログ: Esc＋スクロールロック
  useModalDismiss(!!detailSale, () => setDetailSale(null))
  const [activeBucket, setActiveBucket] = useState<Bucket | 'ec'>('actionNeeded')

  const load = async () => {
    setLoading(true)
    try {
      const svc = await getServices()
      const [products, ec, wOrders] = await Promise.all([
        svc.inventory.getProductsWithInventory(),
        svc.ecSales.getEcSaleRecords(),
        fetchWholesaleOrders(),
      ])
      const costMap: Record<string, number> = {}
      for (const p of products) costMap[p.id] = p.purchaseUnitPrice ?? 0
      // Direct sales are now wholesale_orders; show billable (confirmed/paid/shipped).
      setSales(wOrders.map(o => orderToSale(o, costMap)).filter(s => s.status === 'confirmed'))
      // Shopify EC only — wholesale ledger rows are counted via the orders above.
      setEcSales(ec.filter(e => e.status !== 'cancelled' && e.channel !== 'Wholesale' && e.channel !== 'WholesaleSample'))
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sales.filter(s => !q || s.buyerName.toLowerCase().includes(q) || s.items.some(i => i.productName.toLowerCase().includes(q)))
  }, [sales, query])

  const ecRev = (ec: EcSaleRecord) => ec.revenue != null ? ec.revenue : (ec.unitPrice ?? 0) * ec.quantityKg

  const ecThisMonth = useMemo(() => {
    const ym = todayIso().slice(0, 7)
    return ecSales
      .filter(e => (e.soldOn ?? '').startsWith(ym))
      .reduce((s, e) => s + ecRev(e), 0)
  }, [ecSales])

  const ecFiltered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...ecSales]
      .filter(e => !q || (e.productName ?? '').toLowerCase().includes(q) || (e.orderNumber ?? '').toLowerCase().includes(q))
      .sort((a, b) => (b.soldOn ?? '').localeCompare(a.soldOn ?? ''))
      .slice(0, 50)
  }, [ecSales, query])

  const grouped = useMemo(() => {
    const groups: Record<Bucket, SaleRecord[]> = { actionNeeded: [], nextMonth: [], later: [], noDate: [], paid: [] }
    for (const s of filtered) groups[bucketOf(s.dueDate, s.paymentStatus === 'paid')].push(s)
    for (const k of Object.keys(groups) as Bucket[]) {
      groups[k].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
    }
    return groups
  }, [filtered])

  const kpis = useMemo(() => {
    // All KPIs share the same population as the list below (search-filtered).
    // 未入金残高は検索に依存しない全件(sales)で算出（検索で残高が変動するのを防ぐ）。
    const outstanding = sales.filter(s => s.paymentStatus !== 'paid').reduce((sum, s) => sum + saleIncome(s), 0)
    const actionNeeded = grouped.actionNeeded.reduce((s, r) => s + saleIncome(r), 0)
    const collectedThisMonth = filtered
      .filter(s => s.paymentStatus === 'paid' && (s.paymentDate ?? '').startsWith(todayIso().slice(0, 7)))
      .reduce((sum, s) => sum + saleIncome(s), 0) + ecThisMonth
    return { outstanding, actionNeeded, collectedThisMonth }
  }, [sales, filtered, grouped, ecThisMonth])

  const openConfirm = (sale: SaleRecord) => {
    setConfirmTarget(sale)
    setConfirmDate(todayIso())
  }

  const unconfirmPaid = async (sale: SaleRecord) => {
    if (!(await confirm({ message: `${sale.buyerName} の入金確認を取り消して「請求済」に戻しますか？\n入金日・入金確認日もクリアされます。`, danger: true, confirmLabel: '取消す' }))) return
    setSavingId(sale.id)
    setFeedback(null)
    try {
      await patchWholesaleOrder({ orderId: sale.id, action: 'unconfirm_payment' })
      setSales(prev => prev.map(s => s.id === sale.id ? { ...s, paymentStatus: 'invoiced', paymentDate: undefined, paymentConfirmedAt: undefined } : s))
      setFeedback('入金確認を取り消しました')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '更新に失敗しました')
    } finally { setSavingId(null) }
  }

  const markPaid = async (id: string, paymentDate: string) => {
    setSavingId(id)
    setFeedback(null)
    try {
      const date = paymentDate || todayIso()
      await patchWholesaleOrder({ orderId: id, action: 'set_billing', paymentStatus: 'paid', paymentDate: date })
      setSales(prev => prev.map(s => s.id === id ? { ...s, paymentStatus: 'paid', paymentDate: date, paymentConfirmedAt: new Date().toISOString() } : s))
      setConfirmTarget(null)
      setLastUndo({ id, name: sales.find(s => s.id === id)?.buyerName ?? '' })
      setFeedback('入金確認しました')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '更新に失敗しました')
    } finally { setSavingId(null) }
  }

  // 「元に戻す」: 直近の入金確認を確認ダイアログ無しで取り消す（バナーからの即時undo）。
  const undoLastPaid = async () => {
    if (!lastUndo) return
    const { id } = lastUndo
    setSavingId(id)
    setFeedback(null)
    try {
      await patchWholesaleOrder({ orderId: id, action: 'unconfirm_payment' })
      setSales(prev => prev.map(s => s.id === id ? { ...s, paymentStatus: 'invoiced', paymentDate: undefined, paymentConfirmedAt: undefined } : s))
      setLastUndo(null)
      setFeedback('入金確認を取り消しました')
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '更新に失敗しました')
    } finally { setSavingId(null) }
  }

  const updateInline = async (id: string, patch: { paymentStatus?: PaymentStatus; dueDate?: string; paymentDate?: string; paymentMethod?: string }) => {
    setSavingId(id)
    setFeedback(null)
    try {
      await patchWholesaleOrder({
        orderId: id,
        action: 'set_billing',
        ...(patch.paymentStatus !== undefined && { paymentStatus: patch.paymentStatus }),
        ...(patch.dueDate !== undefined && { dueDate: patch.dueDate }),
        ...(patch.paymentDate !== undefined && { paymentDate: patch.paymentDate }),
        ...(patch.paymentMethod !== undefined && { paymentMethod: patch.paymentMethod }),
      })
      setSales(prev => prev.map(s => {
        if (s.id !== id) return s
        const next = { ...s }
        if (patch.dueDate !== undefined) next.dueDate = patch.dueDate || undefined
        if (patch.paymentMethod !== undefined) next.paymentMethod = patch.paymentMethod || undefined
        if (patch.paymentStatus !== undefined) {
          next.paymentStatus = patch.paymentStatus
          // 「入金済」以外へ戻したら入金日・確認日もクリア（サーバの paidAt 削除と整合）。
          if (patch.paymentStatus !== 'paid') {
            next.paymentDate = undefined
            next.paymentConfirmedAt = undefined
          }
        }
        if (patch.paymentDate !== undefined) {
          next.paymentDate = patch.paymentDate || undefined
          if (patch.paymentStatus === undefined) next.paymentStatus = patch.paymentDate ? 'paid' : 'invoiced'
        }
        return next
      }))
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : '更新に失敗しました')
    } finally { setSavingId(null) }
  }

  const bucketsToRender: Bucket[] = BUCKET_ORDER_ALL

  const renderSaleRow = (s: SaleRecord) => {
    const productLabel = s.items[0]?.productName + (s.items.length > 1 ? ` 他${s.items.length - 1}件` : '')
    const isOverdue = !!s.dueDate && s.dueDate < todayIso()
    return (
      <tr key={s.id} className="border-t border-white/60">
        <td className="px-3 py-2">
          <input
            type="date"
            value={s.dueDate ?? ''}
            onChange={e => updateInline(s.id, { dueDate: e.target.value })}
            disabled={!canEdit}
            className={`rounded-lg border bg-white px-2 py-1 text-xs disabled:bg-bone disabled:text-mist ${isOverdue ? 'border-alert/40 text-alert' : 'border-line'}`}
          />
        </td>
        <td className="px-3 py-2 text-ink">
          <button type="button" onClick={() => setDetailSale(s)} className="text-left hover:underline">{s.buyerName}</button>
        </td>
        <td className="px-3 py-2 text-mist">{productLabel}</td>
        <td className="px-3 py-2 text-right">
          <div className="font-semibold text-ink">{formatCurrency(saleIncome(s))}</div>
          <div className="text-[10px] text-mist">税抜 {formatCurrency(saleIncomeExcl(s))}</div>
          {((s.shippingFee || 0) > 0 || (s.fees ?? []).length > 0) && (
            <div className="text-[10px] text-mist">
              商品 {formatCurrency(s.revenue)}
              {(s.shippingFee || 0) > 0 && <> ＋送料 {formatCurrency(s.shippingFee)}</>}
              {(s.fees ?? []).length > 0 && <> ＋諸費用 {formatCurrency(sumSaleFees(s.fees))}</>}
            </div>
          )}
        </td>
        <td className="px-3 py-2">
          {/* 「入金済」への遷移は必ず『入金確認』ボタン(モーダル)経由に一本化。
              インラインselectでは paid を選べない（paid行はselect無効＝取消ボタンで戻す）。 */}
          <select
            value={s.paymentStatus}
            onChange={e => updateInline(s.id, { paymentStatus: e.target.value as PaymentStatus })}
            disabled={!canEdit || s.paymentStatus === 'paid'}
            className="rounded-lg border border-line bg-white px-2 py-1 text-xs disabled:bg-bone disabled:text-mist"
          >
            <option value="uninvoiced">{PAYMENT_LABELS.uninvoiced}</option>
            <option value="invoiced">{PAYMENT_LABELS.invoiced}</option>
            {s.paymentStatus === 'paid' && <option value="paid">{PAYMENT_LABELS.paid}</option>}
          </select>
        </td>
        <td className="px-3 py-2">
          {/* 支払日は入金済の行のみ編集可（未入金行で日付だけ入れて自動paid化するのを防ぐ）。 */}
          <input
            type="date"
            value={s.paymentDate ?? ''}
            onChange={e => updateInline(s.id, { paymentDate: e.target.value })}
            disabled={!canEdit || s.paymentStatus !== 'paid'}
            className="rounded-lg border border-line bg-white px-2 py-1 text-xs disabled:bg-bone disabled:text-mist"
          />
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-[11px] text-mist">
          {s.paymentConfirmedAt ? new Date(s.paymentConfirmedAt).toLocaleDateString('ja-JP') : '-'}
        </td>
        <td className="px-3 py-2">
          <select
            value={s.paymentMethod ?? ''}
            onChange={e => updateInline(s.id, { paymentMethod: e.target.value })}
            disabled={!canEdit}
            className="rounded-lg border border-line bg-white px-2 py-1 text-xs disabled:bg-bone disabled:text-mist"
          >
            <option value="">未設定</option>
            {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            {s.paymentMethod && !PAYMENT_METHODS.includes(s.paymentMethod as never) && (
              <option value={s.paymentMethod}>{s.paymentMethod}</option>
            )}
          </select>
        </td>
        <td className="px-3 py-2 text-right">
          {canEdit && (s.paymentStatus !== 'paid' ? (
            <button
              type="button"
              onClick={() => openConfirm(s)}
              disabled={savingId === s.id}
              className="inline-flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1 text-[11px] font-medium text-paper shadow hover:bg-[#205f43] disabled:opacity-60"
            >
              <CheckCircle2 size={12} /> 入金確認
            </button>
          ) : (
            <button
              type="button"
              onClick={() => unconfirmPaid(s)}
              disabled={savingId === s.id}
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1 text-[11px] font-medium text-alert hover:bg-alert/5 disabled:opacity-60"
            >
              <Undo2 size={12} /> 入金取消
            </button>
          ))}
          {s.paymentStatus !== 'paid' && isOverdue && (
            <a
              href={`mailto:?subject=${encodeURIComponent('お支払いのお願い')}&body=${encodeURIComponent(`${s.buyerName} 様\n\n下記の請求につきまして、ご入金状況をご確認ください。\n金額: ${formatCurrency(saleIncome(s))}\n期日: ${s.dueDate ?? ''}`)}`}
              className="ml-1 inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb]"
              title="督促メール下書き"
            >
              <Mail size={12} />
            </a>
          )}
        </td>
      </tr>
    )
  }

  const renderSaleCard = (label: string, colorClass: string, list: SaleRecord[]) => (
    <div className={`rounded-2xl border-2 ${colorClass}`}>
      <div className="flex items-center gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{label}</h2>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-mist">
          {list.length}件 / {formatCurrency(list.reduce((s, r) => s + saleIncome(r), 0))}
        </span>
      </div>
      <div className="-mx-0.5 overflow-x-auto border-t border-white/60">
        <table className="min-w-[1040px] text-sm">
          <thead className="bg-white/60 text-ink">
            <tr>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">期日</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">販売先</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">商品</th>
              <th className="whitespace-nowrap px-3 py-2 text-right font-medium">請求額(税込)</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">状態</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">入金日</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">入金確認日</th>
              <th className="whitespace-nowrap px-3 py-2 text-left font-medium">支払方法</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>{list.map(renderSaleRow)}</tbody>
        </table>
      </div>
    </div>
  )

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-ink">入金管理</h1>
            <p className="text-sm text-mist">期日が近い／超過した売掛を一目で確認し、入金を一括で記録できます。</p>
          </div>
          <Link href="/financials" className="rounded-full border border-line bg-white px-3 py-1.5 text-xs text-matchaDeep hover:bg-[#eef3eb]">
            収支ダッシュボード →
          </Link>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KPICard title="未入金 残高" value={formatCurrency(kpis.outstanding)} color={kpis.outstanding > 0 ? 'amber' : 'default'} icon={<Wallet size={18} />} />
          <KPICard title="要確認（超過・今月）" value={formatCurrency(kpis.actionNeeded)} color={kpis.actionNeeded > 0 ? 'red' : 'default'} icon={<AlertTriangle size={18} />} />
          <KPICard title="今月入金 (確認済・EC込)" value={formatCurrency(kpis.collectedThisMonth)} color="green" icon={<CheckCircle2 size={18} />} />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-white p-3">
          <Filter size={14} className="text-mist" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="販売先または商品名で検索"
            className="flex-1 min-w-[200px] rounded-lg border border-line bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
          />
          {feedback && (
            <span className="text-xs text-matchaDeep">{feedback}</span>
          )}
        </div>

        {lastUndo && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-matcha/40 bg-[#f1f7f1] px-4 py-2 text-sm">
            <span className="text-matchaDeep">{lastUndo.name ? `${lastUndo.name} の` : ''}入金を確認しました。</span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={undoLastPaid} className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2.5 py-1 text-[11px] text-alert hover:bg-alert/5">
                <Undo2 size={12} /> 元に戻す
              </button>
              <button type="button" onClick={() => setLastUndo(null)} aria-label="閉じる" className="rounded p-1 text-gray-400 hover:text-mist"><X size={14} /></button>
            </div>
          </div>
        )}

        {loading && <p className="text-sm text-mist">読み込み中…</p>}

        {/* バケット＋ECをタブで切り替え */}
        {!loading && (() => {
          const tabs = bucketsToRender
          const hasEc = ecSales.length > 0
          const active = activeBucket === 'ec'
            ? (hasEc ? 'ec' : tabs[0])
            : (tabs.includes(activeBucket as Bucket) ? activeBucket as Bucket : tabs[0])
          const isEc = active === 'ec'
          const rows = isEc ? [] : (grouped[active as Bucket] ?? [])
          // Within 要確認, split into 期限超過 (red) and 今月期限 (yellow) sections.
          const todayStr = todayIso()
          const sortByDue = (a: SaleRecord, b: SaleRecord) => (a.dueDate || '').localeCompare(b.dueDate || '')
          const overGroup = active === 'actionNeeded' ? rows.filter(s => !!s.dueDate && s.dueDate < todayStr).sort(sortByDue) : []
          const dueGroup = active === 'actionNeeded' ? rows.filter(s => !(s.dueDate && s.dueDate < todayStr)).sort(sortByDue) : []
          return (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 border-b border-[#e6dfcf]">
                {tabs.map(b => {
                  const count = (grouped[b] ?? []).length
                  return (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setActiveBucket(b)}
                      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
                        active === b
                          ? 'border-[#174c33] text-ink'
                          : 'border-transparent text-mist hover:text-ink'
                      }`}
                    >
                      {BUCKET_LABELS[b]}
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active === b ? 'bg-ink text-paper' : 'bg-bone text-mist'}`}>{count}</span>
                    </button>
                  )
                })}
                {hasEc && (
                  <button
                    type="button"
                    onClick={() => setActiveBucket('ec')}
                    className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
                      isEc ? 'border-[#174c33] text-ink' : 'border-transparent text-mist hover:text-ink'
                    }`}
                  >
                    EC売上
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${isEc ? 'bg-ink text-paper' : 'bg-bone text-mist'}`}>{ecFiltered.length}</span>
                  </button>
                )}
              </div>

              {isEc ? (
                <div className="rounded-2xl border-2 border-matcha/40 bg-bone">
                  <div className="flex items-center gap-2 px-4 py-3">
                    <h2 className="text-sm font-semibold text-ink">EC売上（入金済・参考）</h2>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-mist">{ecFiltered.length}件 / 今月 {formatCurrency(ecThisMonth)}</span>
                  </div>
                  <div className="overflow-x-auto border-t border-white/60">
                    <table className="min-w-full text-sm">
                      <thead className="bg-white/60 text-ink">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">売上日</th>
                          <th className="px-3 py-2 text-left font-medium">商品</th>
                          <th className="px-3 py-2 text-left font-medium">注文番号</th>
                          <th className="px-3 py-2 text-right font-medium">数量</th>
                          <th className="px-3 py-2 text-right font-medium">売上</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ecFiltered.map(e => (
                          <tr key={e.id} className="border-t border-white/60">
                            <td className="px-3 py-2 text-ink">{e.soldOn || '-'}</td>
                            <td className="px-3 py-2 text-mist">{e.productName}</td>
                            <td className="px-3 py-2 text-mist">{e.orderNumber || '-'}</td>
                            <td className="px-3 py-2 text-right">{formatKg(e.quantityKg)}</td>
                            <td className="px-3 py-2 text-right font-medium">{formatCurrency(ecRev(e))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {ecSales.length > ecFiltered.length && (
                      <p className="px-4 py-2 text-[11px] text-mist">最新 {ecFiltered.length} 件のみ表示しています。</p>
                    )}
                  </div>
                </div>
              ) : active === 'actionNeeded' ? (
                overGroup.length === 0 && dueGroup.length === 0 ? (
                  <p className="rounded-2xl border border-line bg-white p-6 text-center text-sm text-mist">要確認の売掛はありません。</p>
                ) : (
                  <div className="space-y-4">
                    {overGroup.length > 0 && renderSaleCard('期限超過', 'border-alert/40 bg-alert/5', overGroup)}
                    {dueGroup.length > 0 && renderSaleCard('今月期限', 'border-[#a87b1e]/40 bg-bone', dueGroup)}
                  </div>
                )
              ) : rows.length === 0 ? (
                <p className="rounded-2xl border border-line bg-white p-6 text-center text-sm text-mist">{BUCKET_LABELS[active as Bucket]}の売掛はありません。</p>
              ) : (
                renderSaleCard(BUCKET_LABELS[active as Bucket], BUCKET_COLORS[active as Bucket], rows)
              )}
            </div>
          )
        })()}
      </div>

      <SaleDetailModal sale={detailSale} onClose={() => setDetailSale(null)} />

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4" onClick={() => setConfirmTarget(null)}>
          <div className="w-full max-w-sm rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-ink">入金を確認</h2>
            <p className="mt-2 text-sm text-mist">
              <span className="font-medium text-ink">{confirmTarget.buyerName}</span> の入金を確認済みにします。
            </p>
            <p className="mt-1 text-sm">
              請求額（税込）: <span className="font-semibold text-ink">{formatCurrency(saleIncome(confirmTarget))}</span>
            </p>
            <label className="mt-4 block text-xs text-mist">
              <span className="mb-1 block">入金日</span>
              <input
                type="date"
                value={confirmDate}
                onChange={e => setConfirmDate(e.target.value)}
                className="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              />
            </label>
            <p className="mt-1 text-[10px] text-mist">確認日時（{todayIso()}）は自動で記録されます。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmTarget(null)}
                className="rounded-xl border border-line bg-white px-4 py-2 text-sm text-graphite hover:bg-bone"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => markPaid(confirmTarget.id, confirmDate)}
                disabled={savingId === confirmTarget.id}
                className="inline-flex items-center gap-1 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper shadow hover:bg-[#205f43] disabled:opacity-60"
              >
                <CheckCircle2 size={14} /> {savingId === confirmTarget.id ? '確定中…' : '入金確認'}
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

function SaleDetailModal({ sale, onClose }: { sale: SaleRecord | null; onClose: () => void }) {
  if (!sale) return null
  const tax = computeSaleTaxBuckets([...(sale.items ?? []), ...saleFeesToTaxLines(sale.fees)], sale.shippingFee ?? 0)
  const exclTotal = saleIncomeExcl(sale)
  const inclTotal = saleIncome(sale)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[100vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:max-h-[92vh] sm:rounded-3xl sm:p-6" onClick={e => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink">{sale.buyerName}</h2>
            <p className="mt-1 text-xs text-mist">販売案件の詳細（読み取り専用）</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/wholesale/orders/${sale.id}`} className="rounded-full border border-line bg-white px-3 py-1.5 text-xs text-matchaDeep hover:bg-[#eef3eb]">注文詳細 →</Link>
            <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-bone hover:text-mist"><X size={18} /></button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[#e6dfcf] bg-bone p-3">
            <DetailRow label="販売ステータス" value={SALE_STATUS_LABELS[sale.status]} />
            <DetailRow label="入金ステータス" value={PAYMENT_LABELS[sale.paymentStatus]} />
            <DetailRow label="出荷ステータス" value={SHIPPING_STATUS_LABELS[sale.shippingStatus]} />
            <DetailRow label="国" value={sale.country || '-'} />
            <DetailRow label="支払期日" value={sale.dueDate || '-'} />
            <DetailRow label="入金日" value={sale.paymentDate || '-'} />
            <DetailRow label="入金確認日" value={sale.paymentConfirmedAt ? new Date(sale.paymentConfirmedAt).toLocaleString('ja-JP') : '-'} />
            <DetailRow label="支払方法" value={sale.paymentMethod || '-'} />
          </div>
          <div className="rounded-2xl border border-[#e6dfcf] bg-bone p-3">
            <DetailRow label="商品代金（税抜）" value={formatCurrency(sale.revenue)} />
            <DetailRow label="送料" value={formatCurrency(sale.shippingFee ?? 0)} />
            <DetailRow label="諸費用" value={formatCurrency(sumSaleFees(sale.fees))} />
            <DetailRow label="決済手数料" value={formatCurrency((sale.stripeFeeJpy ?? 0) || (sale.paymentFee ?? 0))} />
            {(sale.stripeFeeJpy ?? 0) > 0 && (
              <DetailRow label="入金額（手数料差引後）" value={formatCurrency(sale.stripeNetJpy ?? (inclTotal - (sale.stripeFeeJpy ?? 0)))} />
            )}
            <DetailRow label="10%対象 / 消費税" value={`${formatCurrency(tax.standardSubtotal)} / ${formatCurrency(tax.standardTax)}`} />
            <DetailRow label="8%対象 / 消費税" value={`${formatCurrency(tax.reducedSubtotal)} / ${formatCurrency(tax.reducedTax)}`} />
            <DetailRow label="請求額（税抜）" value={formatCurrency(exclTotal)} />
            <DetailRow label="請求額（税込）" value={<span className="text-base">{formatCurrency(inclTotal)}</span>} />
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
              {(sale.items ?? []).map((item, i) => (
                <tr key={i} className="border-t border-[#f0ebdf] text-ink">
                  <td className="px-3 py-2">{item.productName}{item.productSku && <span className="ml-1 text-[10px] text-mist">({item.productSku})</span>}</td>
                  <td className="px-3 py-2 text-right">{formatKg(item.quantityKg)}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                  <td className="px-3 py-2 text-center">{(item.taxRate ?? 8) === 0 ? '免税' : `${item.taxRate ?? 8}%`}</td>
                  <td className="px-3 py-2 text-right">{formatCurrency(item.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {(sale.shippingAddress || sale.shippingPostalCode || sale.notes) && (
          <div className="mt-4 rounded-2xl border border-[#e6dfcf] bg-bone p-3 text-sm">
            {(sale.shippingPostalCode || sale.shippingAddress) && (
              <p className="text-ink"><span className="text-mist">配送先：</span>{[sale.shippingPostalCode, sale.shippingAddress].filter(Boolean).join(' ')}</p>
            )}
            {sale.notes && <p className="mt-1 whitespace-pre-wrap text-ink"><span className="text-mist">メモ：</span>{sale.notes}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
