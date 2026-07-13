'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useConfirm } from '@/contexts/ConfirmContext'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { formatCurrency } from '@/lib/format'
import { useStickyState } from '@/hooks/useStickyState'
import { RefreshCw, Download } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { deriveOrderView, legacyPaymentStateLabel, legacyShippingStateLabel, isOverdue, isBankPending } from '@/lib/orderView'
import * as XLSX from 'xlsx'

interface OrderItem {
  productName: string
  quantityKg: number
  kind?: string
  madeToOrder?: boolean
}
interface Order {
  id: string
  orderNumber: string
  memberCompanyName?: string
  contactName?: string
  items?: OrderItem[]
  totalJpy?: number
  paymentMethod?: string
  paymentStatus?: string
  status?: string
  shippedAt?: string
  shipRequestedAt?: string
  isDomestic?: boolean
  overseasCarrier?: string
  origin?: string
  transferReportedAt?: string
  createdAtMs?: number
  bankDueAtMs?: number
  acceptanceExpiresAtMs?: number
}

// Status-label / bucket helpers (isOverdue / isClosed / isBankPending / payment &
// shipping badges) now live in the shared @/lib/orderView projection.

type OrdersTab = 'all' | 'ec' | 'direct'

async function token(): Promise<string> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

const CARRIER_LABEL: Record<string, string> = {
  ems: 'EMS',
  epacket: '国際エアパケット',
  dhl: 'DHL',
  designated: '御社指定業者',
}

function shippingMethod(o: Order): string {
  if (o.isDomestic === false) return o.overseasCarrier ? `海外 / ${CARRIER_LABEL[o.overseasCarrier] ?? o.overseasCarrier}` : '海外（未定）'
  return '国内配送'
}

function paymentMethodLabel(o: Order): string {
  if (o.paymentMethod === 'bank_transfer') return '銀行振込'
  if (o.paymentMethod === 'stripe') return 'カード'
  return '—'
}

// Payment vs shipping are separate concerns; `status` mixes them. The label
// derivation lives in @/lib/orderView (legacyPaymentStateLabel / legacyShippingStateLabel).

// Date-only formatter for the list (createdAtMs is epoch-ms; shippedAt is ISO).
function fmtDay(value?: number | string): string {
  if (value == null || value === '') return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// Work-tray = what a staffer must do next for this order (from the shared
// deriveOrderView phase model). Staff pick a tray and process it top-down instead
// of scanning an 11-column table hunting for the one order that needs them.
type ConcreteTray = 'quote' | 'approve' | 'accept' | 'confirm' | 'ship' | 'notify' | 'progress' | 'done'
type Tray = 'action' | ConcreteTray | 'all'
// Ordered list of the action trays shown as chips (progress/done handled separately).
const ACTION_TRAYS: ConcreteTray[] = ['quote', 'approve', 'accept', 'confirm', 'ship', 'notify', 'progress']
const TRAY_LABEL: Record<ConcreteTray, string> = {
  quote: '送料見積が必要',
  approve: '承認が必要',
  accept: '承諾の反映',
  confirm: '入金確認が必要',
  ship: '発送が必要',
  notify: '発送通知が必要',
  progress: '対応中',
  done: '完了・取消',
}

function trayOf(o: Order, now: number): ConcreteTray {
  const v = deriveOrderView(o, now)
  if (v.phase === 'cancelled' || v.phase === 'done') return 'done'
  if (v.phase === 'shipped') return 'notify' // 発送済み・通知未 → 発送通知が必要
  if (v.phase === 'fulfilling') return 'ship' // 入金済み・未発送 → 発送
  if (v.phase === 'awaiting_payment') return o.paymentMethod === 'bank_transfer' ? 'confirm' : 'progress'
  if (v.phase === 'estimate') {
    if (v.phaseReason === 'quote_shipping') return 'quote'
    if (v.phaseReason === 'production_approval') return 'approve'
    return 'accept'
  }
  return 'progress'
}

export default function WholesaleOrdersPage() {
  const router = useRouter()
  const { confirm, notify } = useConfirm()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useStickyState<OrdersTab>('orders.tab', 'all')
  const [tray, setTray] = useStickyState<Tray>('orders.tray', 'action')
  const [search, setSearch] = useState('')
  const [bankPendingOnly, setBankPendingOnly] = useState(false)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const nowMs = Date.now()

  // EC = self-service web orders (origin 'self' or legacy undefined); 直販 = staff-entered/migrated.
  const shown = orders.filter(o => tab === 'all' ? true : tab === 'direct' ? o.origin === 'direct' : o.origin !== 'direct')
  const counts = {
    all: orders.length,
    ec: orders.filter(o => o.origin !== 'direct').length,
    direct: orders.filter(o => o.origin === 'direct').length,
  }

  // Bucket each shown order into its work-tray once (deriveOrderView per order).
  const trayById = new Map(shown.map(o => [o.id, trayOf(o, nowMs)]))
  const trayFor = (o: Order): ConcreteTray => trayById.get(o.id) ?? 'progress'
  const trayCounts = {
    action: shown.filter(o => trayFor(o) !== 'done').length,
    done: shown.filter(o => trayFor(o) === 'done').length,
    all: shown.length,
  } as Record<Tray, number>
  for (const t of ACTION_TRAYS) trayCounts[t] = shown.filter(o => trayFor(o) === t).length
  const list =
    tray === 'action'
      ? shown.filter(o => trayFor(o) !== 'done')
      : tray === 'all'
        ? [...shown].sort((a, b) => Number(trayFor(a) === 'done') - Number(trayFor(b) === 'done')) // 対応が必要を上に
        : shown.filter(o => trayFor(o) === tray)

  // Reconciliation helpers: 銀行振込・入金待ちの絞り込み + 注文番号/会社名/金額の検索。
  const q = search.trim().toLowerCase()
  const nq = q.replace(/[,¥\s]/g, '')
  const filtered = list.filter(o => {
    if (bankPendingOnly && !isBankPending(o)) return false
    if (overdueOnly && !isOverdue(o, nowMs)) return false
    if (!q) return true
    return (
      (o.orderNumber ?? '').toLowerCase().includes(q) ||
      (o.memberCompanyName ?? '').toLowerCase().includes(q) ||
      (o.contactName ?? '').toLowerCase().includes(q) ||
      (nq !== '' && String(o.totalJpy ?? '').includes(nq))
    )
  })
  const bankPendingCount = shown.filter(isBankPending).length
  const overdueCount = shown.filter(o => isOverdue(o, nowMs)).length

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/wholesale/orders', { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' })
      const data = (await res.json()) as { orders?: Order[] }
      setOrders(data.orders ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  // Export the currently-shown list (respects tab / bucket / search / 入金待ち filters).
  const handleExportExcel = () => {
    if (filtered.length === 0) {
      notify('書き出す注文がありません。', 'info')
      return
    }
    const fmt = (ms?: number) => (ms ? new Date(ms).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
    const rows = filtered.map(o => ({
      '注文番号': o.orderNumber,
      '注文日時': fmt(o.createdAtMs),
      '注文者': o.memberCompanyName || o.contactName || '',
      'チャネル': o.origin === 'direct' ? '直販' : 'EC',
      '商品': (o.items ?? []).map(i => `${i.productName} ${i.quantityKg}kg`).join(', '),
      '数量(kg)': (o.items ?? []).reduce((s, i) => s + (i.quantityKg ?? 0), 0),
      '金額(税込)': o.totalJpy ?? '',
      '支払い方法': paymentMethodLabel(o),
      '支払い状況': legacyPaymentStateLabel(o).label,
      '発送方法': shippingMethod(o),
      '発送状況': legacyShippingStateLabel(o).label,
      '振込報告': o.transferReportedAt ? new Date(o.transferReportedAt).toLocaleDateString('ja-JP') : '',
    }))
    const sheet = XLSX.utils.json_to_sheet(rows)
    const headers = Object.keys(rows[0])
    sheet['!cols'] = headers.map(h => {
      const maxLen = rows.reduce((m, r) => Math.max(m, String((r as Record<string, unknown>)[h] ?? '').length), h.length)
      return { wch: Math.min(Math.max(maxLen + 2, 8), 48) }
    })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, '注文一覧')
    XLSX.writeFile(wb, `orders_${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // Inline 入金確認 (manual bank reconciliation) — confirm without opening the order.
  const confirmPayment = async (o: Order) => {
    if (!(await confirm({ title: '入金確認', message: `注文「${o.orderNumber}」（¥${(o.totalJpy ?? 0).toLocaleString()} / ${o.memberCompanyName ?? o.contactName ?? ''}）を入金確認済みにしますか？`, confirmLabel: '確認済みにする' }))) return
    setBusyId(o.id)
    try {
      const res = await fetch('/api/wholesale/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ orderId: o.id, action: 'confirm_payment' }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        notify(`入金確認に失敗しました（${d.error ?? 'error'}）`, 'error')
        return
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }

  // Release (cancel) an overdue order — frees its stock hold and emails the buyer.
  const releaseOrder = async (o: Order) => {
    if (!(await confirm({ title: '注文の取消', message: `期限超過の注文「${o.orderNumber}」（${o.memberCompanyName ?? o.contactName ?? ''}）を取消して在庫を解放しますか？\n\nお客様にキャンセル通知メールが送信されます。`, confirmLabel: '取消する', danger: true }))) return
    setBusyId(o.id)
    try {
      const res = await fetch('/api/wholesale/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ orderId: o.id, action: 'cancel' }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        notify(`取消に失敗しました（${d.error ?? 'error'}）`, 'error')
        return
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }

  useEffect(() => {
    load()
  }, [load])

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl">
        <div className="mb-bl-6 flex items-end justify-between border-b border-ink pb-bl-3">
          <div>
            <p className="kicker mb-bl">SABO WHOLESALE</p>
            <h1 className="display-2 text-2xl text-ink">卸売注文</h1>
            <p className="mt-bl text-sm text-mist">wholesale.sabo-matcha.jp からの注文。行をクリックすると詳細・操作（入金確認・取消・送料見積）を開きます。</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/wholesale/orders/new" className="btn-primary">＋ 新規注文</Link>
            <button onClick={handleExportExcel} className="btn-ghost">
              <Download size={14} /> Excel 書き出し
            </button>
            <button onClick={load} className="btn-ghost">
              <RefreshCw size={14} /> 更新
            </button>
          </div>
        </div>

        <div className="mb-bl-3 flex gap-1 border-b border-line">
          {([['all', '一覧'], ['ec', 'EC（wholesale.sabo-matcha.jp）'], ['direct', '直販']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${tab === key ? 'border-ink text-ink' : 'border-transparent text-mist hover:text-ink'}`}
            >
              {label}
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${tab === key ? 'bg-ink text-paper' : 'bg-bone text-mist'}`}>{counts[key]}</span>
            </button>
          ))}
        </div>

        {/* 作業トレイ — 「次にやること」で自動フィルタ。空のトレイは表示しない。 */}
        <div className="mb-bl-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTray('action')}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${tray === 'action' ? 'border-[#174c33] bg-ink text-paper' : 'border-line bg-white text-ink hover:bg-bone'}`}
          >
            対応が必要 ({trayCounts.action})
          </button>
          {ACTION_TRAYS.filter(t => trayCounts[t] > 0).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTray(t)}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${tray === t ? 'border-[#174c33] bg-ink text-paper' : 'border-line bg-white text-ink hover:bg-bone'}`}
            >
              {TRAY_LABEL[t]} ({trayCounts[t]})
            </button>
          ))}
          <button
            type="button"
            onClick={() => setTray('done')}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${tray === 'done' ? 'border-[#174c33] bg-ink text-paper' : 'border-line bg-white text-ink hover:bg-bone'}`}
          >
            完了・取消 ({trayCounts.done})
          </button>
          <button
            type="button"
            onClick={() => setTray('all')}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${tray === 'all' ? 'border-[#174c33] bg-ink text-paper' : 'border-line bg-white text-ink hover:bg-bone'}`}
          >
            すべて ({trayCounts.all})
          </button>
          <span className="mx-1 text-line">|</span>
          <button
            type="button"
            onClick={() => setBankPendingOnly(v => !v)}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${bankPendingOnly ? 'border-[#a87b1e] bg-[#a87b1e] text-paper' : 'border-line bg-white text-ink hover:bg-bone'}`}
          >
            入金待ち（銀行振込）({bankPendingCount})
          </button>
          <button
            type="button"
            onClick={() => setOverdueOnly(v => !v)}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${overdueOnly ? 'border-alert bg-alert text-paper' : 'border-line bg-white text-ink hover:bg-bone'}`}
            title="支払期限/見積期限の超過、未見積/未承認が30日以上の注文"
          >
            期限超過 ({overdueCount})
          </button>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="注文番号 / 会社名 / 金額で検索"
            className="ml-auto w-64 rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink outline-none focus:border-ink"
          />
        </div>

        {loading ? (
          <p className="text-sm text-mist">読み込み中…</p>
        ) : filtered.length === 0 ? (
          <EmptyState message={search || bankPendingOnly ? '該当する注文はありません。' : tray === 'action' ? '対応が必要な注文はありません。' : tray === 'done' ? '完了済みの注文はありません。' : '注文はありません。'} />
        ) : (
          <div className="overflow-x-auto panel">
            <table className="min-w-[1280px] w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-bone text-left text-xs text-mist">
                  <th className="whitespace-nowrap px-4 py-3 font-medium">注文番号</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">注文日</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">注文者名</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">商品名</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">購入数量</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">売上高</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">発送方法</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">支払い方法</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">支払い状況</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">発送状況</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">出荷日</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => (
                  <tr
                    key={o.id}
                    onClick={() => router.push(`/wholesale/orders/${o.id}`)}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-bone"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-ink">{o.orderNumber}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-mist">{fmtDay(o.createdAtMs)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink">{o.memberCompanyName || o.contactName || '—'}</td>
                    <td className="px-4 py-3 text-mist">
                      {(() => {
                        const items = o.items ?? []
                        if (items.length === 0) return '—'
                        const full = items.map(i => `${i.productName} ${i.quantityKg}kg`).join(', ')
                        const head = items[0].productName
                        const label = items.length > 1 ? `${head} 他${items.length - 1}件` : head
                        return <span className="block max-w-[260px] truncate" title={full}>{label}</span>
                      })()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-ink">
                      {(() => {
                        const items = o.items ?? []
                        if (items.length === 0) return '—'
                        const totalKg = items.reduce((s, i) => s + (i.quantityKg ?? 0), 0)
                        return `${totalKg % 1 === 0 ? totalKg : totalKg.toFixed(1)}kg`
                      })()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-ink">{o.totalJpy != null ? formatCurrency(o.totalJpy) : '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-mist">{shippingMethod(o)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-mist">{paymentMethodLabel(o)}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block rounded border px-2 py-0.5 text-[11px] ${legacyPaymentStateLabel(o).tone}`}>{legacyPaymentStateLabel(o).label}</span>
                        {isBankPending(o) && o.transferReportedAt && (
                          <span className="rounded border border-[#a87b1e] bg-[#fdf6e9] px-1.5 py-0.5 text-[10px] text-[#a87b1e]" title={`振込報告: ${o.transferReportedAt.slice(0, 10)}`}>振込報告あり</span>
                        )}
                        {isBankPending(o) && (
                          <button
                            type="button"
                            disabled={busyId === o.id}
                            onClick={e => { e.stopPropagation(); confirmPayment(o) }}
                            className="rounded border border-matcha px-2 py-0.5 text-[11px] font-medium text-matcha hover:bg-[#eef3eb] disabled:opacity-50"
                          >
                            入金確認
                          </button>
                        )}
                        {isOverdue(o, nowMs) && (
                          <button
                            type="button"
                            disabled={busyId === o.id}
                            onClick={e => { e.stopPropagation(); releaseOrder(o) }}
                            className="rounded border border-alert px-2 py-0.5 text-[11px] font-medium text-alert hover:bg-[#fdecec] disabled:opacity-50"
                            title="期限超過 — 取消して在庫を解放"
                          >
                            期限超過・解放
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={`inline-block rounded border px-2 py-0.5 text-[11px] ${legacyShippingStateLabel(o).tone}`}>{legacyShippingStateLabel(o).label}</span>
                        {o.shipRequestedAt && o.status !== 'shipped' && o.status !== 'cancelled' && (
                          <span className="inline-block rounded border border-matcha bg-[#e6f0e8] px-1.5 py-0.5 text-[10px] font-medium text-matchaDeep" title={`発送指示: ${o.shipRequestedAt.slice(0, 16).replace('T', ' ')}`}>発送指示</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-mist">{fmtDay(o.shippedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
