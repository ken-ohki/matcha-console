'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { getServices } from '@/lib/services'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import type { SaleRecord } from '@/types'
import { UserCheck, CreditCard, FileText, MessageSquare, RefreshCw, ArrowRight } from 'lucide-react'

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
  pending_quote: '見積待ち',
  quoted: '支払い待ち(見積済)',
  pending_payment: '支払い待ち',
  paid: '支払い済み',
  shipped: '出荷済み',
  cancelled: '取消',
}
const ATTENTION_STATUSES = ['pending_quote', 'quoted', 'pending_payment']

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
  const [openInquiries, setOpenInquiries] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const svc = await getServices()
      const [saleRecords] = await Promise.all([svc.sales.getSaleRecords()])
      setSales(saleRecords)

      const auth = `Bearer ${await token()}`
      const [oRes, mRes, iRes] = await Promise.all([
        fetch('/api/wholesale/orders', { headers: { Authorization: auth }, cache: 'no-store' }),
        fetch('/api/wholesale/members?status=pending', { headers: { Authorization: auth }, cache: 'no-store' }),
        fetch('/api/wholesale/inquiries', { headers: { Authorization: auth }, cache: 'no-store' }),
      ])
      const oData = (await oRes.json().catch(() => ({}))) as { orders?: WOrder[] }
      setOrders(oData.orders ?? [])
      const mData = (await mRes.json().catch(() => ({}))) as { members?: unknown[] }
      setPendingMembers((mData.members ?? []).length)
      const iData = (await iRes.json().catch(() => ({}))) as { inquiries?: { status?: string }[] }
      setOpenInquiries((iData.inquiries ?? []).filter(x => x.status !== 'closed' && x.status !== 'resolved' && x.status !== 'done').length)
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
  const payWaiting = orders.filter(o => o.status === 'pending_payment' || o.status === 'quoted').length
  const quoteWaiting = orders.filter(o => o.status === 'pending_quote').length

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#173c2a]">ダッシュボード</h1>
            <p className="mt-1 text-sm text-[#68756c]">新規注文・対応が必要な取引と、今月の業績サマリー。</p>
          </div>
          <button onClick={load} className="flex items-center gap-1 rounded-xl border border-[#d9d1be] px-3 py-2 text-sm text-[#173c2a] hover:bg-[#f4f2ea]">
            <RefreshCw size={15} /> 更新
          </button>
        </div>

        {/* Attention cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <AttentionCard icon={<UserCheck size={18} />} label="承認待ち会員" value={pendingMembers} href="/wholesale/members" tone={pendingMembers > 0 ? 'alert' : 'calm'} />
          <AttentionCard icon={<CreditCard size={18} />} label="支払い待ち注文" value={payWaiting} href="/wholesale/orders" tone={payWaiting > 0 ? 'alert' : 'calm'} />
          <AttentionCard icon={<FileText size={18} />} label="見積待ち(海外)" value={quoteWaiting} href="/wholesale/orders" tone={quoteWaiting > 0 ? 'alert' : 'calm'} />
          <AttentionCard icon={<MessageSquare size={18} />} label="未対応の問い合わせ" value={openInquiries} href="/wholesale/inquiries" tone={openInquiries > 0 ? 'alert' : 'calm'} />
        </div>

        {/* Orders needing action */}
        <div className="mb-6 rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#173c2a]">対応が必要な卸売注文</h2>
            <Link href="/wholesale/orders" className="flex items-center gap-1 text-xs text-[#174c33] hover:underline">すべて見る <ArrowRight size={12} /></Link>
          </div>
          {loading ? (
            <p className="py-6 text-center text-sm text-[#68756c]">読み込み中…</p>
          ) : attentionOrders.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#d9d1be] px-4 py-6 text-center text-sm text-[#a59f8c]">対応が必要な注文はありません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-max min-w-full text-sm">
                <thead className="text-left text-xs text-[#a59f8c]">
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
                    <tr key={o.id} className="whitespace-nowrap border-t border-[#f0ece0]">
                      <td className="py-2.5 pr-4 font-mono text-[#173c2a]">{o.orderNumber ?? o.id}</td>
                      <td className="py-2.5 pr-4 text-gray-700">{o.memberCompanyName ?? '—'}</td>
                      <td className="py-2.5 pr-4"><span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{ORDER_STATUS_LABEL[o.status ?? ''] ?? o.status}</span></td>
                      <td className="py-2.5 pr-4 text-gray-600">{fmtDate(o.createdAtMs)}</td>
                      <td className="py-2.5 pr-4 text-right font-semibold text-[#173c2a]">{yen(o.totalJpy ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* This month KPIs */}
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-[#173c2a]">今月の業績</h2>
          <span className="text-xs text-[#a59f8c]">{months[months.length - 1]?.key}（販売管理データ）</span>
        </div>
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="売上" value={yen(thisMonth.revenue)} />
          <Kpi label="粗利" value={yen(thisMonth.gross)} sub={thisMonth.revenue > 0 ? `${((thisMonth.gross / thisMonth.revenue) * 100).toFixed(1)}%` : undefined} />
          <Kpi label="注文数量" value={`${thisMonth.qty.toFixed(1)} kg`} />
        </div>

        {/* 6-month charts */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <ChartCard title="売上（6ヶ月）" data={monthly.map(m => ({ label: m.label, value: m.revenue }))} color="#174c33" fmt={n => `¥${Math.round(n / 1000)}k`} />
          <ChartCard title="粗利（6ヶ月）" data={monthly.map(m => ({ label: m.label, value: m.gross }))} color="#2f7d52" fmt={n => `¥${Math.round(n / 1000)}k`} />
          <ChartCard title="注文数量 kg（6ヶ月）" data={monthly.map(m => ({ label: m.label, value: m.qty }))} color="#8d6e2f" fmt={n => `${Math.round(n)}`} />
        </div>
      </div>
    </AppLayout>
  )
}

function AttentionCard({ icon, label, value, href, tone }: { icon: React.ReactNode; label: string; value: number; href: string; tone: 'alert' | 'calm' }) {
  return (
    <Link href={href} className={`rounded-2xl border p-4 transition hover:shadow-sm ${tone === 'alert' ? 'border-amber-300 bg-amber-50' : 'border-[#d9d1be] bg-white'}`}>
      <div className="flex items-center justify-between">
        <span className={tone === 'alert' ? 'text-amber-700' : 'text-[#68756c]'}>{icon}</span>
        <ArrowRight size={14} className="text-[#a59f8c]" />
      </div>
      <div className="mt-2 text-2xl font-bold text-[#173c2a]">{value}</div>
      <div className="text-xs text-[#68756c]">{label}</div>
    </Link>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
      <div className="text-xs text-[#68756c]">{label}</div>
      <div className="mt-1 text-2xl font-bold text-[#173c2a]">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-emerald-700">粗利率 {sub}</div>}
    </div>
  )
}

function ChartCard({ title, data, color, fmt }: { title: string; data: { label: string; value: number }[]; color: string; fmt: (n: number) => string }) {
  const max = Math.max(1, ...data.map(d => d.value))
  return (
    <div className="rounded-2xl border border-[#d9d1be] bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-xs font-semibold text-[#68756c]">{title}</h3>
      <div className="flex h-40 items-end gap-2">
        {data.map((d, i) => (
          <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[9px] text-[#68756c]">{d.value > 0 ? fmt(d.value) : ''}</span>
            <div
              className="w-full rounded-t"
              style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 4 : 0, backgroundColor: color }}
            />
            <span className="text-[10px] text-[#68756c]">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
