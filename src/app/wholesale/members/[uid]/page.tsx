'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, X, Ban, RefreshCw } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { businessTypeText } from '@/lib/wholesaleBusinessTypes'

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
  businessTypes?: string[]
  socialMedia?: string
  businessStage?: string
  annualVolumeEstimate?: string
  taxId?: string
  featureConsent?: boolean
  rank?: string
  buyerId?: string
  createdAtMs?: number
}

const RANKS = ['standard', 'premium', 'exclusive'] as const

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
const ORDER_STATUS_LABEL: Record<string, string> = { pending_approval: '承認待ち', pending_quote: '見積り待ち', quoted: '見積り済み', pending_payment: '支払い待ち', paid: '支払い済み', shipped: '出荷済み', cancelled: '取消' }
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

  const setRank = async (rank: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/wholesale/members/${uid}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ action: 'set_rank', rank }),
      })
      if (!res.ok) {
        setError('ランクの更新に失敗しました')
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
        <Link href="/wholesale/members" className="mb-4 inline-flex items-center gap-1 text-sm text-mist hover:text-ink">
          <ArrowLeft size={15} /> 会員一覧へ戻る
        </Link>

        {error && <p className="mb-4 rounded-lg border border-alert/40 bg-alert/5 px-4 py-2 text-sm text-alert">{error}</p>}
        {loading && <p className="text-sm text-mist">読み込み中…</p>}

        {member && (
          <>
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-ink">{member.companyName ?? '(社名未設定)'}</h1>
                  <span className="rounded-full bg-[#eff8f0] px-2.5 py-0.5 text-xs text-matchaDeep">{STATUS_LABEL[member.status ?? ''] ?? member.status}</span>
                </div>
                <p className="mt-1 text-sm text-mist">{member.contactName} · {member.email}</p>
                <p className="text-xs text-mist">登録日: {fmtDate(member.createdAtMs)}</p>
              </div>
              <div className={`flex shrink-0 items-center gap-2 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                <button onClick={load} className="flex items-center gap-1 rounded-xl border border-line px-3 py-2 text-sm text-ink hover:bg-bone">
                  <RefreshCw size={15} /> 更新
                </button>
                {member.status === 'pending' && (
                  <>
                    <button onClick={() => act('approve')} className="flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-sm text-paper hover:opacity-90"><Check size={14} /> 承認</button>
                    <button onClick={() => act('reject')} className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm text-alert hover:bg-bone"><X size={14} /> 却下</button>
                  </>
                )}
                {member.status === 'approved' && (
                  <button onClick={() => act('suspend')} className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-sm text-[#a87b1e] hover:bg-bone"><Ban size={14} /> 停止</button>
                )}
                {(member.status === 'suspended' || member.status === 'rejected') && (
                  <button onClick={() => act('approve')} className="flex items-center gap-1 rounded-lg bg-ink px-3 py-1.5 text-sm text-paper hover:opacity-90"><Check size={14} /> 承認</button>
                )}
              </div>
            </div>

            {/* Rank */}
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-4">
              <span className="text-sm font-medium text-ink">顧客ランク</span>
              <select
                value={member.rank ?? 'standard'}
                onChange={e => setRank(e.target.value)}
                disabled={busy}
                className="rounded-xl border border-line px-3 py-1.5 text-sm capitalize focus:outline-none focus:ring-2 focus:ring-matcha disabled:opacity-60"
              >
                {RANKS.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <span className="text-[11px] text-mist">割引率は「設定 → 卸売設定」で定義します。</span>
            </div>

            {/* Summary stats */}
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="注文件数（有効）" value={`${live.length} 件`} />
              <Stat label="累計購入額（支払済）" value={`¥${paidSpend.toLocaleString()}`} />
              <Stat label="販売先ID" value={member.buyerId ?? '未連携'} mono />
            </div>

            {/* Customer info */}
            <section className="mb-8 rounded-2xl border border-line bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-mist">顧客情報</h2>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
                <Field label="会社名 / 屋号" value={member.companyName} />
                <Field label="ご担当者名" value={member.contactName} />
                <Field label="メール" value={member.email} />
                <Field label="電話番号" value={member.phone} />
                <Field label="国 / 地域" value={member.country} />
                <Field label="郵便番号" value={member.postalCode} />
                <Field label="住所" value={member.address} />
                <Field label="業種" value={businessTypeText(member.businessTypes, member.businessType)} />
                <Field label="ウェブサイト" value={member.website} />
                <Field label="SNS" value={member.socialMedia} />
                <Field label="開業状況" value={member.businessStage ? BUSINESS_STAGE_LABEL[member.businessStage] ?? member.businessStage : undefined} />
                <Field label="年間購入見込" value={member.annualVolumeEstimate ? VOLUME_LABEL[member.annualVolumeEstimate] ?? member.annualVolumeEstimate : undefined} />
                <Field label="税番号 / 登録番号" value={member.taxId} />
                <Field label="ビジネス紹介の許可" value={member.featureConsent ? '許可' : '不可'} />
              </dl>
            </section>

            {/* Purchase history */}
            <section className="rounded-2xl border border-line bg-white p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-mist">購入履歴 ({orders.length})</h2>
              {orders.length === 0 ? (
                <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-mist">購入履歴はありません。</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-mist">
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
                        <tr key={o.id} className="border-b border-line">
                          <td className="py-2.5 pr-3 font-mono text-ink">{o.orderNumber ?? o.id}</td>
                          <td className="py-2.5 pr-3 text-mist">{fmtDate(o.createdAtMs)}</td>
                          <td className="py-2.5 pr-3 text-mist">
                            {(() => {
                              const items = o.items ?? []
                              if (items.length === 0) return '—'
                              const fmt = (i: OrderItem) => `${i.productName ?? ''}${i.kind === 'sample' ? `(試供${(i.sampleUnits ?? 0) * 10}g)` : ` ×${i.quantityKg ?? 0}kg`}`
                              const full = items.map(fmt).join(' / ')
                              const label = items.length > 1 ? `${fmt(items[0])} 他${items.length - 1}件` : fmt(items[0])
                              return <span className="block max-w-[280px] truncate" title={full}>{label}</span>
                            })()}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="rounded-full bg-bone px-2 py-0.5 text-xs text-ink">{ORDER_STATUS_LABEL[o.status ?? ''] ?? o.status}</span>
                          </td>
                          <td className="py-2.5 pr-3 text-mist">{o.paymentMethod === 'bank_transfer' ? '銀行振込' : 'カード'}</td>
                          <td className="py-2.5 pr-3 text-right font-semibold text-ink">¥{(o.totalJpy ?? 0).toLocaleString()}</td>
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
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-xs text-mist">{label}</p>
      <p className={`mt-1 text-lg font-semibold text-ink ${mono ? 'font-mono text-sm' : ''}`}>{value}</p>
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1.5">
      <dt className="shrink-0 text-xs text-mist">{label}</dt>
      <dd className="text-right text-sm text-ink">{value || '—'}</dd>
    </div>
  )
}
