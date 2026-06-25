'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { formatCurrency } from '@/lib/format'
import { useStickyState } from '@/hooks/useStickyState'
import { RefreshCw, Download } from 'lucide-react'
import * as XLSX from 'xlsx'

interface OrderItem {
  productName: string
  quantityKg: number
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

// Orders whose hold/deadline has lapsed and need staff to release (cancel) the stock.
const STALE_DAYS = 30
function isOverdue(o: Order, now: number): boolean {
  if (isClosed(o) || o.paymentStatus === 'paid' || o.status === 'paid') return false
  if (o.paymentMethod === 'bank_transfer' && o.status === 'pending_payment' && o.bankDueAtMs && o.bankDueAtMs < now) return true
  if (o.status === 'pending_acceptance' && o.acceptanceExpiresAtMs && o.acceptanceExpiresAtMs < now) return true
  const ageMs = now - (o.createdAtMs ?? now)
  if ((o.status === 'pending_quote' || o.status === 'pending_approval') && ageMs > STALE_DAYS * 86_400_000) return true
  return false
}

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

// Payment vs shipping are separate concerns; `status` mixes them, so derive each.
function paymentStateLabel(o: Order): { label: string; tone: string } {
  if (o.status === 'cancelled') return { label: '取消', tone: 'border-line text-mist' }
  if (o.status === 'pending_acceptance') return { label: '承諾待ち（見積）', tone: 'border-[#a87b1e] text-[#a87b1e]' }
  if (o.status === 'pending_approval') return { label: '承認待ち', tone: 'border-[#a87b1e] text-[#a87b1e]' }
  if (o.status === 'pending_quote') return { label: '見積待ち', tone: 'border-[#a87b1e] text-[#a87b1e]' }
  if (o.status === 'quoted') return { label: '支払い待ち（見積済）', tone: 'border-[#a87b1e] text-[#a87b1e]' }
  if (o.paymentStatus === 'paid' || o.status === 'paid' || o.status === 'shipped') return { label: '支払い済み', tone: 'border-matcha text-matcha' }
  return { label: '支払い待ち', tone: 'border-[#a87b1e] text-[#a87b1e]' }
}
function shippingStateLabel(o: Order): { label: string; tone: string } {
  if (o.status === 'cancelled') return { label: '—', tone: 'border-line text-mist' }
  if (o.status === 'shipped' || o.shippedAt) return { label: '出荷済み', tone: 'border-ink text-ink' }
  return { label: '未発送', tone: 'border-line text-mist' }
}

// Closed = 取引完了済（出荷済み）or 取消. Everything else still needs staff action.
function isClosed(o: Order): boolean {
  return o.status === 'shipped' || !!o.shippedAt || o.status === 'cancelled'
}

// Date-only formatter for the list (createdAtMs is epoch-ms; shippedAt is ISO).
function fmtDay(value?: number | string): string {
  if (value == null || value === '') return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

// Manual bank-transfer order still awaiting deposit — the rows staff reconcile by hand.
function isBankPending(o: Order): boolean {
  return o.paymentMethod === 'bank_transfer' && o.paymentStatus !== 'paid' && (o.status === 'pending_payment' || o.status === 'quoted')
}

type OrdersBucket = 'action' | 'done' | 'all'

export default function WholesaleOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useStickyState<OrdersTab>('orders.tab', 'all')
  const [bucket, setBucket] = useStickyState<OrdersBucket>('orders.bucket', 'action')
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

  // 対応が必要 / 取引完了済 split, applied on top of the channel tab.
  const bucketCounts = {
    action: shown.filter(o => !isClosed(o)).length,
    done: shown.filter(isClosed).length,
    all: shown.length,
  }
  const list =
    bucket === 'action'
      ? shown.filter(o => !isClosed(o))
      : bucket === 'done'
        ? shown.filter(isClosed)
        : [...shown].sort((a, b) => Number(isClosed(a)) - Number(isClosed(b))) // すべて: 対応が必要を上に

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
      window.alert('書き出す注文がありません。')
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
      '支払い状況': paymentStateLabel(o).label,
      '発送方法': shippingMethod(o),
      '発送状況': shippingStateLabel(o).label,
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
    if (!window.confirm(`注文「${o.orderNumber}」（¥${(o.totalJpy ?? 0).toLocaleString()} / ${o.memberCompanyName ?? o.contactName ?? ''}）を入金確認済みにしますか？`)) return
    setBusyId(o.id)
    try {
      const res = await fetch('/api/wholesale/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ orderId: o.id, action: 'confirm_payment' }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        window.alert(`入金確認に失敗しました（${d.error ?? 'error'}）`)
        return
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }

  // Release (cancel) an overdue order — frees its stock hold and emails the buyer.
  const releaseOrder = async (o: Order) => {
    if (!window.confirm(`期限超過の注文「${o.orderNumber}」（${o.memberCompanyName ?? o.contactName ?? ''}）を取消して在庫を解放しますか？\n\nお客様にキャンセル通知メールが送信されます。`)) return
    setBusyId(o.id)
    try {
      const res = await fetch('/api/wholesale/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ orderId: o.id, action: 'cancel' }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        window.alert(`取消に失敗しました（${d.error ?? 'error'}）`)
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

        <div className="mb-bl-3 flex flex-wrap items-center gap-1.5">
          {([['action', '対応が必要'], ['done', '取引完了済'], ['all', 'すべて']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setBucket(key)}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${bucket === key ? 'border-[#174c33] bg-ink text-paper' : 'border-line bg-white text-ink hover:bg-bone'}`}
            >
              {label} ({bucketCounts[key]})
            </button>
          ))}
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
          <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-mist">
            {search || bankPendingOnly ? '該当する注文はありません。' : bucket === 'action' ? '対応が必要な注文はありません。' : bucket === 'done' ? '完了済みの注文はありません。' : '注文はありません。'}
          </p>
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
                        <span className={`inline-block rounded border px-2 py-0.5 text-[11px] ${paymentStateLabel(o).tone}`}>{paymentStateLabel(o).label}</span>
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
                        <span className={`inline-block rounded border px-2 py-0.5 text-[11px] ${shippingStateLabel(o).tone}`}>{shippingStateLabel(o).label}</span>
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
