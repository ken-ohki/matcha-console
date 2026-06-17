'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, X, Ban, RefreshCw } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'

interface Member {
  uid: string
  email?: string
  status?: string
  companyName?: string
  contactName?: string
  phone?: string
  country?: string
  postalCode?: string
  address?: string
  website?: string
  businessType?: string
  socialMedia?: string
  businessStage?: string
  annualVolumeEstimate?: string
  taxId?: string
  buyerId?: string
  createdAtMs?: number
}

interface OrderItem {
  productName?: string
  quantityKg?: number
  sampleUnits?: number
  kind?: string
}
interface Order {
  id: string
  orderNumber?: string
  items?: OrderItem[]
  totalJpy?: number
  paymentMethod?: string
  paymentStatus?: string
  status?: string
  shippingCountry?: string
  createdAtMs?: number
}

const STATUS_LABEL: Record<string, string> = { pending: '承認待ち', approved: '承認済み', rejected: '却下', suspended: '停止' }
const ORDER_STATUS_LABEL: Record<string, string> = { pending_payment: '支払い待ち', paid: '支払い済み', shipped: '出荷済み', cancelled: '取消' }
const BUSINESS_STAGE_LABEL: Record<string, string> = { pre_opening: '開業前', operating: '開業済' }
const VOLUME_LABEL: Record<string, string> = {
  undecided: '未定', under_10kg: '10kg未満', '10_50kg': '10〜50kg', '50_100kg': '50〜100kg', over_100kg: '100kg以上',
}

async function token(): Promise<string> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

function fmtDate(ms?: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function WholesaleMemberDetailPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = use(params)
  const [member, setMember] = useState<Member | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/wholesale/members/${uid}`, { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' })
      if (!res.ok) {
        setError(res.status === 404 ? '会員が見つかりません' : '読み込みに失敗しました')
        return
      }
      const data = (await res.json()) as { member: Member; orders: Order[] }
      setMember(data.member)
      setOrders(data.orders ?? [])
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [uid])

  useEffect(() => {
    load()
  }, [load])

  const act = async (action: 'approve' | 'reject' | 'suspend') => {
    setBusy(true)
    setError(null)
    try {
      const reason = action === 'reject' ? window.prompt('却下理由（任意）') ?? undefined : undefined
      const res = await fetch(`/api/wholesale/members/${uid}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ action, reason }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setError(d.error === 'staff_account_conflict' ? 'このUIDはスタッフ用アカウントです' : '操作に失敗しました')
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  // Purchase summary — count & spend exclude cancelled orders; spend counts paid only.
  const live = orders.filter(o => o.status !== 'cancelled')
  const paidSpend = orders.filter(o => o.paymentStatus === 'paid').reduce((s, o) => s + (o.totalJpy ?? 0), 0)

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl">
        <Link href="/wholesale/members" className="mb-4 inline-flex items-center gap-1 text-sm text-[#68756c] hover:text-[#173c2a]">
          <ArrowLeft size={15} /> 会員一覧へ戻る
        </Link>

        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
        {loading && <p className="text-sm text-[#68756c]">読み込み中…</p>}

        {member && (
          <>
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-[#173c2a]">{member.companyName ?? '(社名未設定)'}</h1>
                  <span className="rounded-full bg-[#eff8f0] px-2.5 py-0.5 text-xs text-[#174c33]">{STATUS_LABEL[member.status ?? ''] ?? member.status}</span>
                </div>
                <p className="mt-1 text-sm text-[#68756c]">{member.contactName} · {member.email}</p>
                <p className="text-xs text-[#a59f8c]">登録日: {fmtDate(member.createdAtMs)}</p>
              </div>
              <div className={`flex shrink-0 items-center gap-2 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                <button onClick={load} className="flex items-center gap-1 rounded-xl border border-[#d9d1be] px-3 py-2 text-sm text-[#173c2a] hover:bg-[#f4f2ea]">
                  <RefreshCw size={15} /> 更新
                </button>
                {member.status === 'pending' && (
                  <>
                    <button onClick={() => act('approve')} className="flex items-center gap-1 rounded-lg bg-[#174c33] px-3 py-1.5 text-sm text-white hover:opacity-90"><Check size={14} /> 承認</button>
                    <button onClick={() => act('reject')} className="flex items-center gap-1 rounded-lg border border-[#d9d1be] px-3 py-1.5 text-sm text-[#9d3d28] hover:bg-[#fff0ec]"><X size={14} /> 却下</button>
                  </>
                )}
                {member.status === 'approved' && (
                  <button onClick={() => act('suspend')} className="flex items-center gap-1 rounded-lg border border-[#d9d1be] px-3 py-1.5 text-sm text-[#8d5b08] hover:bg-[#fff6e5]"><Ban size={14} /> 停止</button>
                )}
                {(member.status === 'suspended' || member.status === 'rejected') && (
                  <button onClick={() => act('approve')} className="flex items-center gap-1 rounded-lg bg-[#174c33] px-3 py-1.5 text-sm text-white hover:opacity-90"><Check size={14} /> 承認</button>
                )}
              </div>
            </div>

            {/* Summary stats */}
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="注文件数（有効）" value={`${live.length} 件`} />
              <Stat label="累計購入額（支払済）" value={`¥${paidSpend.toLocaleString()}`} />
              <Stat label="販売先ID" value={member.buyerId ?? '未連携'} mono />
            </div>

            {/* Customer info */}
            <section className="mb-8 rounded-2xl border border-[#d9d1be] bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#68756c]">顧客情報</h2>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                <Field label="会社名 / 屋号" value={member.companyName} />
                <Field label="ご担当者名" value={member.contactName} />
                <Field label="メール" value={member.email} />
                <Field label="電話番号" value={member.phone} />
                <Field label="国 / 地域" value={member.country} />
                <Field label="郵便番号" value={member.postalCode} />
                <Field label="住所" value={member.address} />
                <Field label="業種" value={member.businessType} />
                <Field label="ウェブサイト" value={member.website} />
                <Field label="SNS" value={member.socialMedia} />
                <Field label="開業状況" value={member.businessStage ? BUSINESS_STAGE_LABEL[member.businessStage] ?? member.businessStage : undefined} />
                <Field label="年間購入見込" value={member.annualVolumeEstimate ? VOLUME_LABEL[member.annualVolumeEstimate] ?? member.annualVolumeEstimate : undefined} />
                <Field label="税番号 / 登録番号" value={member.taxId} />
              </dl>
            </section>

            {/* Purchase history */}
            <section className="rounded-2xl border border-[#d9d1be] bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#68756c]">購入履歴 ({orders.length})</h2>
              {orders.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[#d9d1be] px-4 py-6 text-center text-sm text-[#a59f8c]">購入履歴はありません。</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-[#e7e1d2] text-left text-xs text-[#a59f8c]">
                        <th className="py-2 pr-3 font-medium">注文番号</th>
                        <th className="py-2 pr-3 font-medium">日付</th>
                        <th className="py-2 pr-3 font-medium">明細</th>
                        <th className="py-2 pr-3 font-medium">状態</th>
                        <th className="py-2 pr-3 font-medium">支払</th>
                        <th className="py-2 pr-3 text-right font-medium">合計</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map(o => (
                        <tr key={o.id} className="border-b border-[#f0ece0]">
                          <td className="py-2.5 pr-3 font-mono text-[#173c2a]">{o.orderNumber ?? o.id}</td>
                          <td className="py-2.5 pr-3 text-[#68756c]">{fmtDate(o.createdAtMs)}</td>
                          <td className="py-2.5 pr-3 text-[#68756c]">
                            {(o.items ?? [])
                              .map(i => `${i.productName ?? ''}${i.kind === 'sample' ? `(試供${(i.sampleUnits ?? 0) * 10}g)` : ` ×${i.quantityKg ?? 0}kg`}`)
                              .join(' / ') || '—'}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="rounded-full bg-[#f4f2ea] px-2 py-0.5 text-xs text-[#173c2a]">{ORDER_STATUS_LABEL[o.status ?? ''] ?? o.status}</span>
                          </td>
                          <td className="py-2.5 pr-3 text-[#68756c]">{o.paymentMethod === 'bank_transfer' ? '銀行振込' : 'カード'}</td>
                          <td className="py-2.5 pr-3 text-right font-semibold text-[#173c2a]">¥{(o.totalJpy ?? 0).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AppLayout>
  )
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-[#d9d1be] bg-white p-4">
      <p className="text-xs text-[#a59f8c]">{label}</p>
      <p className={`mt-1 text-lg font-semibold text-[#173c2a] ${mono ? 'font-mono text-sm' : ''}`}>{value}</p>
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[#f0ece0] py-1.5">
      <dt className="shrink-0 text-xs text-[#a59f8c]">{label}</dt>
      <dd className="text-right text-sm text-[#173c2a]">{value || '—'}</dd>
    </div>
  )
}
