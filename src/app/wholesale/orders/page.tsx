'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { formatCurrency } from '@/lib/format'
import { RefreshCw } from 'lucide-react'

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
  isDomestic?: boolean
  overseasCarrier?: string
  origin?: string
}

type OrdersTab = 'all' | 'ec' | 'direct'

async function token(): Promise<string> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

const CARRIER_LABEL: Record<string, string> = {
  ems: 'EMS',
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

export default function WholesaleOrdersPage() {
  const router = useRouter()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<OrdersTab>('all')

  // EC = self-service web orders (origin 'self' or legacy undefined); 直販 = staff-entered/migrated.
  const shown = orders.filter(o => tab === 'all' ? true : tab === 'direct' ? o.origin === 'direct' : o.origin !== 'direct')
  const counts = {
    all: orders.length,
    ec: orders.filter(o => o.origin !== 'direct').length,
    direct: orders.filter(o => o.origin === 'direct').length,
  }

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

        {loading ? (
          <p className="text-sm text-mist">読み込み中…</p>
        ) : shown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-mist">注文はありません。</p>
        ) : (
          <div className="overflow-x-auto panel">
            <table className="min-w-[1280px] w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-bone text-left text-xs text-mist">
                  <th className="whitespace-nowrap px-4 py-3 font-medium">注文番号</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">注文者名</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">商品名</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">購入数量</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">売上高</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">発送方法</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">支払い方法</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">支払い状況</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">発送状況</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(o => (
                  <tr
                    key={o.id}
                    onClick={() => router.push(`/wholesale/orders/${o.id}`)}
                    className="cursor-pointer border-b border-line last:border-0 hover:bg-bone"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-ink">{o.orderNumber}</td>
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
                      <span className={`inline-block rounded border px-2 py-0.5 text-[11px] ${paymentStateLabel(o).tone}`}>{paymentStateLabel(o).label}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={`inline-block rounded border px-2 py-0.5 text-[11px] ${shippingStateLabel(o).tone}`}>{shippingStateLabel(o).label}</span>
                    </td>
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
