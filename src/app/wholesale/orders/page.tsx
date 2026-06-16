'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { RefreshCw } from 'lucide-react'

interface OrderItem {
  productName: string
  quantityKg: number
}
interface Order {
  id: string
  orderNumber: string
  memberCompanyName?: string
  items?: OrderItem[]
  totalJpy?: number
  paymentMethod?: string
  paymentStatus?: string
  status?: string
  shippingCountry?: string
}

async function token(): Promise<string> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: '支払い待ち',
  paid: '支払い済み',
  shipped: '出荷済み',
  cancelled: '取消',
}

export default function WholesaleOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

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

  const act = async (orderId: string, action: 'confirm_payment' | 'cancel' | 'mark_shipped') => {
    if (action === 'cancel' && !window.confirm('この注文を取消し、在庫予約を解放しますか？')) return
    setBusy(orderId)
    try {
      await fetch('/api/wholesale/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ orderId, action }),
      })
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#173c2a]">卸売注文</h1>
            <p className="mt-1 text-sm text-[#68756c]">wholesale.sabo-matcha.jp からの注文。銀行振込の入金確認・取消（在庫解放）を行います。</p>
          </div>
          <button onClick={load} className="flex items-center gap-1 rounded-xl border border-[#d9d1be] px-3 py-2 text-sm text-[#173c2a] hover:bg-[#f4f2ea]">
            <RefreshCw size={15} /> 更新
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-[#68756c]">読み込み中…</p>
        ) : orders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#d9d1be] px-4 py-8 text-center text-sm text-[#a59f8c]">注文はありません。</p>
        ) : (
          <div className="space-y-3">
            {orders.map(o => (
              <div key={o.id} className={`rounded-2xl border border-[#d9d1be] bg-white p-4 ${busy === o.id ? 'opacity-50' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm text-[#173c2a]">{o.orderNumber}</p>
                    <p className="text-sm text-[#173c2a]">{o.memberCompanyName}</p>
                    <p className="mt-1 text-xs text-[#68756c]">
                      {(o.items ?? []).map(i => `${i.productName} ${i.quantityKg}kg`).join(', ')}
                    </p>
                    <p className="mt-1 text-xs text-[#a59f8c]">{o.shippingCountry} · {o.paymentMethod === 'bank_transfer' ? '銀行振込' : 'カード'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-[#173c2a]">¥{(o.totalJpy ?? 0).toLocaleString()}</p>
                    <span className="rounded-full bg-[#f4f2ea] px-2.5 py-0.5 text-xs text-[#173c2a]">{STATUS_LABEL[o.status ?? ''] ?? o.status}</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {o.status === 'pending_payment' && o.paymentMethod === 'bank_transfer' && (
                    <button onClick={() => act(o.id, 'confirm_payment')} className="rounded-lg bg-[#174c33] px-3 py-1.5 text-sm text-white hover:opacity-90">入金確認</button>
                  )}
                  {o.status === 'paid' && (
                    <button onClick={() => act(o.id, 'mark_shipped')} className="rounded-lg border border-[#d9d1be] px-3 py-1.5 text-sm text-[#173c2a] hover:bg-[#f4f2ea]">出荷済みにする</button>
                  )}
                  {o.status !== 'cancelled' && o.status !== 'shipped' && (
                    <button onClick={() => act(o.id, 'cancel')} className="rounded-lg border border-[#d9d1be] px-3 py-1.5 text-sm text-[#9d3d28] hover:bg-[#fff0ec]">取消・在庫解放</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
