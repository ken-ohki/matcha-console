'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { getServices } from '@/lib/services'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { orderToSale, type WholesaleOrderRow } from '@/lib/wholesaleAdapter'
import type { SaleRecord } from '@/types'
import { UserCheck, CreditCard, FileText, RefreshCw, ArrowRight, PackageMinus } from 'lucide-react'

interface WOrder {
  id: string
  orderNumber?: string
  memberCompanyName?: string
  totalJpy?: number
  status?: string
  paymentMethod?: string
  createdAtMs?: number
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_approval: '承認待ち',
  pending_quote: '見積待ち',
  quoted: '支払い待ち(見積済)',
  pending_payment: '支払い待ち',
  paid: '支払い済み',
  shipped: '出荷済み',
  cancelled: '取消',
}
const ATTENTION_STATUSES = ['pending_approval', 'pending_quote', 'quoted', 'pending_payment']

async function token(): Promise<string> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`
const fmtDate = (ms?: number) => (ms ? new Date(ms).toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' }) : '—')

function monthKeys(): { key: string; label: string }[] {
  const now = new Date()
  const out: { key: string; label: string }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${d.getMonth() + 1}月` })
  }
  return out
}

export default function DashboardPage() {
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [orders, setOrders] = useState<WOrder[]>([])
  const [pendingMembers, setPendingMembers] = useState(0)
  const [lowStock, setLowStock] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const svc = await getServices()
      const products = await svc.inventory.getProductsWithInventory()
      setLowStock(products.filter(p => p.isActive !== false && (p.stockStatus === 'low' || p.stockStatus === 'out')).length)
      const costMap: Record<string, number> = {}
      for (const p of products) costMap[p.id] = p.purchaseUnitPrice ?? 0

      const auth = `Bearer ${await token()}`
      const [oRes, mRes] = await Promise.all([
        fetch('/api/wholesale/orders', { headers: { Authorization: auth }, cache: 'no-store' }),
        fetch('/api/wholesale/members?status=pending', { headers: { Authorization: auth }, cache: 'no-store' }),
      ])
      const oData = (await oRes.json().catch(() => ({}))) as { orders?: WholesaleOrderRow[] }
      const wOrders = oData.orders ?? []
      setOrders(wOrders as WOrder[])
      // Monthly revenue/gross now come from wholesale orders (direct sales were merged in).
      setSales(wOrders.map(o => orderToSale(o, costMap)))
      const mData = (await mRes.json().catch(() => ({}))) as { members?: unknown[] }
      setPendingMembers((mData.members ?? []).length)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const months = useMemo(() => monthKeys(), [])
  const monthly = useMemo(() => {
    const agg = new Map(months.map(m => [m.key, { revenue: 0, gross: 0, qty: 0 }]))
    for (const s of sales) {
      // Only confirmed sales count as revenue — exclude cancelled, overseas
      // quotes (pending_quote/quoted) and made-to-order approvals (pending_approval).
      if (s.status !== 'confirmed') continue
      const date = s.orderDate || s.dueDate
      if (!date) continue
      const a = agg.get(date.slice(0, 7))
      if (!a) continue
      a.revenue += s.revenue || 0
      a.gross += s.grossProfit || 0
      a.qty += s.quantityKg || 0
    }
    return months.map(m => ({ ...m, ...(agg.get(m.key) as { revenue: number; gross: number; qty: number }) }))
  }, [sales, months])

  const thisMonth = monthly[monthly.length - 1] ?? { revenue: 0, gross: 0, qty: 0 }
  const attentionOrders = orders.filter(o => ATTENTION_STATUSES.includes(o.status ?? '')).sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
  // Staff-actionable: bank-transfer orders awaiting payment confirmation (card
  // orders wait on the customer, so they aren't a staff to-do).
  const bankConfirmWaiting = orders.filter(o => o.paymentMethod === 'bank_transfer' && (o.status === 'pending_payment' || o.status === 'quoted')).length
  const quoteWaiting = orders.filter(o => o.status === 'pending_quote').length

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl">
        <div className="mb-bl-6 flex items-end justify-between border-b border-ink pb-bl-3">
          <div>
            <p className="kicker mb-bl">Overview</p>
            <h1 className="display-2 text-2xl text-ink">ダッシュボード</h1>
            <p className="mt-bl text-sm text-mist">新規注文・対応が必要な取引と、今月の業績サマリー。</p>
          </div>
          <button onClick={load} className="btn-ghost">
            <RefreshCw size={14} /> 更新
          </button>
        </div>

        {/* Attention cards — staff to-dos */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <AttentionCard icon={<UserCheck size={18} />} label="承認待ち会員" value={pendingMembers} href="/wholesale/members" tone={pendingMembers > 0 ? 'alert' : 'calm'} />
          <AttentionCard icon={<CreditCard size={18} />} label="入金確認待ち(振込)" value={bankConfirmWaiting} href="/wholesale/orders" tone={bankConfirmWaiting > 0 ? 'alert' : 'calm'} />
          <AttentionCard icon={<FileText size={18} />} label="見積待ち(海外)" value={quoteWaiting} href="/wholesale/orders" tone={quoteWaiting > 0 ? 'alert' : 'calm'} />
          <AttentionCard icon={<PackageMinus size={18} />} label="低在庫の商品" value={lowStock} href="/inventory" tone={lowStock > 0 ? 'alert' : 'calm'} />
        </div>

        {/* Orders needing action */}
        <div className="mb-6 panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">対応が必要な卸売注文</h2>
            <Link href="/wholesale/orders" className="flex items-center gap-1 text-xs text-matchaDeep hover:underline">すべて見る <ArrowRight size={12} /></Link>
          </div>
          {loading ? (
            <p className="py-6 text-center text-sm text-mist">読み込み中…</p>
          ) : attentionOrders.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-mist">対応が必要な注文はありません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-max min-w-full text-sm">
                <thead className="text-left text-xs text-mist">
                  <tr className="whitespace-nowrap">
                    <th className="py-2 pr-4 font-medium">注文番号</th>
                    <th className="py-2 pr-4 font-medium">顧客</th>
                    <th className="py-2 pr-4 font-medium">状態</th>
                    <th className="py-2 pr-4 font-medium">日付</th>
                    <th className="py-2 pr-4 text-right font-medium">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {attentionOrders.slice(0, 8).map(o => (
                    <tr key={o.id} className="whitespace-nowrap border-t border-line">
                      <td className="py-2.5 pr-4 font-mono text-ink">{o.orderNumber ?? o.id}</td>
                      <td className="py-2.5 pr-4 text-graphite">{o.memberCompanyName ?? '—'}</td>
                      <td className="py-2.5 pr-4"><span className="inline-block rounded border border-[#a87b1e] px-2 py-0.5 text-[11px] text-[#a87b1e]">{ORDER_STATUS_LABEL[o.status ?? ''] ?? o.status}</span></td>
                      <td className="py-2.5 pr-4 text-mist">{fmtDate(o.createdAtMs)}</td>
                      <td className="py-2.5 pr-4 text-right font-semibold text-ink">{yen(o.totalJpy ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* This month KPIs */}
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink">今月の業績</h2>
          <span className="text-xs text-mist">{months[months.length - 1]?.key}（販売管理データ）</span>
        </div>
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="売上" value={yen(thisMonth.revenue)} />
          <Kpi label="粗利" value={yen(thisMonth.gross)} sub={thisMonth.revenue > 0 ? `${((thisMonth.gross / thisMonth.revenue) * 100).toFixed(1)}%` : undefined} />
          <Kpi label="注文数量" value={`${thisMonth.qty.toFixed(1)} kg`} />
        </div>

        {/* 6-month charts */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <ChartCard title="売上（6ヶ月）" data={monthly.map(m => ({ label: m.label, value: m.revenue }))} color="#5b6b4f" fmt={n => `¥${Math.round(n / 1000)}k`} />
          <ChartCard title="粗利（6ヶ月）" data={monthly.map(m => ({ label: m.label, value: m.gross }))} color="#384430" fmt={n => `¥${Math.round(n / 1000)}k`} />
          <ChartCard title="注文数量 kg（6ヶ月）" data={monthly.map(m => ({ label: m.label, value: m.qty }))} color="#3a3a3a" fmt={n => `${Math.round(n)}`} />
        </div>
      </div>
    </AppLayout>
  )
}

function AttentionCard({ icon, label, value, href, tone }: { icon: React.ReactNode; label: string; value: number; href: string; tone: 'alert' | 'calm' }) {
  return (
    <Link href={href} className={`panel block p-4 transition hover:border-ink ${tone === 'alert' ? 'border-l-2 border-l-alert' : ''}`}>
      <div className="flex items-center justify-between">
        <span className={tone === 'alert' ? 'text-alert' : 'text-mist'}>{icon}</span>
        <ArrowRight size={14} className="text-mist" />
      </div>
      <div className="mt-2 text-2xl font-bold text-ink">{value}</div>
      <div className="text-xs text-mist">{label}</div>
    </Link>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel p-5">
      <div className="text-xs text-mist">{label}</div>
      <div className="mt-1 text-2xl font-bold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-matcha">粗利率 {sub}</div>}
    </div>
  )
}

function ChartCard({ title, data, color, fmt }: { title: string; data: { label: string; value: number }[]; color: string; fmt: (n: number) => string }) {
  const max = Math.max(1, ...data.map(d => d.value))
  return (
    <div className="panel p-5">
      <h3 className="mb-3 text-xs font-semibold text-mist">{title}</h3>
      <div className="flex h-40 items-end gap-2">
        {data.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[9px] text-mist">{d.value > 0 ? fmt(d.value) : ''}</span>
            <div
              className="w-full rounded-t"
              style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 4 : 0, backgroundColor: color }}
            />
            <span className="text-[10px] text-mist">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
