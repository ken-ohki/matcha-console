'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { ArrowLeft, RefreshCw } from 'lucide-react'

interface OrderItem {
  productName: string
  quantityKg: number
  sampleUnits?: number
  lineTotalJpy?: number
  option?: { optionName?: string; tierLabel?: string; bags?: number; feeJpy?: number }
}
interface Order {
  id: string
  orderNumber: string
  memberCompanyName?: string
  contactName?: string
  phone?: string
  items?: OrderItem[]
  subtotalJpy?: number
  taxJpy?: number
  totalJpy?: number
  paymentMethod?: string
  paymentStatus?: string
  status?: string
  shippingCountry?: string
  shippingPostalCode?: string
  shippingAddress?: string
  isDomestic?: boolean
  overseasCarrier?: string
  shippingFeeJpy?: number
  shippingWeightKg?: number
  checkoutUrl?: string
  notes?: string
  buyerTaxId?: string
  trackingNumber?: string
  shippingCarrierLabel?: string
  shippedAt?: string
  shipmentEmailedAt?: string
}

async function token(): Promise<string> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

const STATUS_LABEL: Record<string, string> = {
  pending_quote: '見積待ち',
  quoted: '支払い待ち（見積済）',
  pending_payment: '支払い待ち',
  paid: '支払い済み',
  shipped: '出荷済み',
  cancelled: '取消',
}
const CARRIER_LABEL: Record<string, string> = {
  ems: 'EMS（国際スピード郵便）',
  dhl: 'DHL',
  designated: '御社指定業者',
}

export default function WholesaleOrderDetailPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [tracking, setTracking] = useState('')
  const [carrierLabel, setCarrierLabel] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/wholesale/orders', { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' })
      const data = (await res.json()) as { orders?: Order[] }
      // Order ids can contain ':' (e.g. migrated:<saleId>), which may arrive
      // percent-encoded in the route param — match against the decoded form too.
      let wanted = id
      try { wanted = decodeURIComponent(id) } catch { /* keep raw */ }
      setOrder(data.orders?.find(o => o.id === id || o.id === wanted) ?? null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const act = async (action: 'confirm_payment' | 'cancel' | 'mark_shipped' | 'notify_shipped', extra: Record<string, unknown> = {}) => {
    if (action === 'cancel' && !window.confirm('この注文を取消し、在庫予約を解放しますか？')) return
    setBusy(true)
    try {
      const res = await fetch('/api/wholesale/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ orderId: id, action, ...extra }),
      })
      if (action === 'notify_shipped') {
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        window.alert(d.ok ? '発送通知メールを送信しました。' : `送信に失敗しました（${d.error ?? 'error'}）`)
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  const quote = async (shippingFeeJpy: number, overseasCarrier: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/wholesale/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ orderId: id, action: 'quote', shippingFeeJpy, overseasCarrier }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        window.alert(
          data.error === 'insufficient_stock'
            ? '在庫が不足しているため見積を確定できません。'
            : `見積の確定に失敗しました（${data.error ?? 'error'}）`,
        )
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  const downloadReceipt = async () => {
    if (!order) return
    const atena = window.prompt('宛名（領収書）', `${order.memberCompanyName ?? ''} 御中`)
    if (atena === null) return
    const proviso = window.prompt('但し書き', '抹茶代として')
    if (proviso === null) return
    const res = await fetch(`/api/wholesale/orders/${id}/receipt?atena=${encodeURIComponent(atena)}&proviso=${encodeURIComponent(proviso)}`, {
      headers: { Authorization: `Bearer ${await token()}` },
    })
    if (!res.ok) {
      window.alert('領収書の発行に失敗しました。')
      return
    }
    const blob = await res.blob()
    window.open(URL.createObjectURL(blob), '_blank')
  }

  const o = order

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/wholesale/orders" className="flex items-center gap-1 text-sm text-mist hover:text-ink">
            <ArrowLeft size={15} /> 卸売注文一覧へ
          </Link>
          <button onClick={load} className="flex items-center gap-1 rounded-lg border border-line px-3 py-2 text-sm font-bold text-ink hover:bg-bone">
            <RefreshCw size={15} /> 更新
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-mist">読み込み中…</p>
        ) : !o ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-mist">注文が見つかりません。</p>
        ) : (
          <div className={`space-y-5 ${busy ? 'opacity-50' : ''}`}>
            {/* Header */}
            <div className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm text-ink">{o.orderNumber}</p>
                  <p className="mt-1 text-lg font-semibold text-ink">{o.memberCompanyName}</p>
                  {(o.contactName || o.phone) && (
                    <p className="text-sm text-mist">{[o.contactName, o.phone].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-ink">¥{(o.totalJpy ?? 0).toLocaleString()}</p>
                  <span className="mt-1 inline-block rounded border border-line px-2 py-0.5 text-[11px] text-ink">{STATUS_LABEL[o.status ?? ''] ?? o.status}</span>
                </div>
              </div>
            </div>

            {/* Items */}
            <Section title="商品">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-mist">
                    <th className="py-2 font-medium">商品名</th>
                    <th className="py-2 text-right font-medium">購入数量</th>
                    <th className="py-2 text-right font-medium">金額（税抜）</th>
                  </tr>
                </thead>
                <tbody>
                  {(o.items ?? []).map((i, idx) => (
                    <tr key={idx} className="border-b border-line last:border-0">
                      <td className="py-2 text-ink">
                        {i.productName}
                        {i.option ? <span className="text-mist"> ／ {i.option.optionName}: {i.option.tierLabel} ×{i.option.bags}</span> : null}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right text-mist">{i.sampleUnits ? `サンプル ${i.sampleUnits}×10g` : `${i.quantityKg}kg`}</td>
                      <td className="whitespace-nowrap py-2 text-right text-ink">¥{((i.lineTotalJpy ?? 0) + (i.option?.feeJpy ?? 0)).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                <Row label="小計（税抜）" value={`¥${(o.subtotalJpy ?? 0).toLocaleString()}`} />
                {typeof o.shippingFeeJpy === 'number' && o.shippingFeeJpy > 0 && <Row label="送料" value={`¥${o.shippingFeeJpy.toLocaleString()}`} />}
                <Row label="消費税" value={`¥${(o.taxJpy ?? 0).toLocaleString()}`} />
                <Row label="合計（税込）" value={`¥${(o.totalJpy ?? 0).toLocaleString()}`} strong />
              </dl>
            </Section>

            {/* Shipping & payment */}
            <Section title="発送・支払い">
              <dl className="space-y-1 text-sm">
                <Row label="区分" value={o.isDomestic === false ? '海外' : '国内'} />
                <Row label="発送方法" value={o.isDomestic === false ? (o.overseasCarrier ? CARRIER_LABEL[o.overseasCarrier] ?? o.overseasCarrier : '未定') : '国内配送（重量別）'} />
                {typeof o.shippingWeightKg === 'number' && <Row label="重量" value={`${o.shippingWeightKg.toFixed(2)} kg`} />}
                <Row label="支払い方法" value={o.paymentMethod === 'bank_transfer' ? '銀行振込' : o.paymentMethod === 'stripe' ? 'カード' : '—'} />
                <Row label="支払い状況" value={STATUS_LABEL[o.status ?? ''] ?? o.status ?? '—'} />
              </dl>
            </Section>

            {/* Delivery address */}
            <Section title="お届け先">
              <p className="text-sm text-ink">
                {[o.contactName, o.shippingPostalCode, o.shippingCountry, o.shippingAddress].filter(Boolean).join(' / ') || '—'}
              </p>
              {o.phone && <p className="mt-1 text-sm text-mist">TEL: {o.phone}</p>}
              {o.buyerTaxId && <p className="mt-1 text-xs text-mist">税番号: {o.buyerTaxId}</p>}
              {o.notes && <p className="mt-2 text-sm text-mist">備考: {o.notes}</p>}
            </Section>

            {/* Quote (overseas, not yet quoted) */}
            {o.status === 'pending_quote' && (
              <Section title="送料見積・リンク発行">
                <QuoteForm defaultCarrier={o.overseasCarrier ?? 'ems'} disabled={busy} onSubmit={quote} />
              </Section>
            )}
            {o.status === 'quoted' && o.paymentMethod !== 'bank_transfer' && o.checkoutUrl && (
              <p className="rounded-lg border border-line bg-bone px-4 py-3 text-xs text-mist">
                支払いリンク発行済み（メール送付済み）:{' '}
                <a href={o.checkoutUrl} target="_blank" rel="noreferrer" className="text-matchaDeep underline">リンクを開く</a>
              </p>
            )}
            {o.status === 'quoted' && o.paymentMethod === 'bank_transfer' && (
              <p className="rounded-lg border border-line bg-bone px-4 py-3 text-xs text-mist">銀行振込のご案内をメール送付済み。入金後に「入金確認」を押してください。</p>
            )}

            {/* Fulfillment — tracking + shipment notification */}
            {(o.status === 'paid' || o.status === 'shipped') && (
              <Section title="出荷・発送通知">
                {(o.trackingNumber || o.shippingCarrierLabel || o.shippedAt) && (
                  <p className="mb-2 text-sm text-graphite">
                    {o.shippingCarrierLabel ? `${o.shippingCarrierLabel} ` : ''}{o.trackingNumber ?? ''}
                    {o.shippedAt ? `（${o.shippedAt.slice(0, 10)} 出荷）` : ''}
                  </p>
                )}
                {o.status === 'paid' && (
                  <div className="mb-3 flex flex-wrap items-end gap-2">
                    <label className="text-xs text-mist">発送業者<input className="mt-1 block w-40 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-ink" placeholder="例: ヤマト / EMS" value={carrierLabel} onChange={e => setCarrierLabel(e.target.value)} /></label>
                    <label className="text-xs text-mist">追跡番号<input className="mt-1 block w-52 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-ink" value={tracking} onChange={e => setTracking(e.target.value)} /></label>
                    <button onClick={() => act('mark_shipped', { trackingNumber: tracking, shippingCarrierLabel: carrierLabel })} disabled={busy} className="btn-primary">出荷済みにする</button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button onClick={() => act('notify_shipped')} disabled={busy} className="btn-ghost">発送通知メールを送信</button>
                  {o.shipmentEmailedAt && <span className="text-xs text-mist">最終送信: {o.shipmentEmailedAt.slice(0, 16).replace('T', ' ')}</span>}
                </div>
              </Section>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {(o.status === 'pending_payment' || o.status === 'quoted') && o.paymentMethod === 'bank_transfer' && (
                <button onClick={() => act('confirm_payment')} disabled={busy} className="btn-primary">入金確認</button>
              )}
              {(o.status === 'paid' || o.status === 'shipped') && (
                <button onClick={downloadReceipt} disabled={busy} className="btn-ghost">領収書を発行</button>
              )}
              {o.status !== 'cancelled' && o.status !== 'shipped' && (
                <button onClick={() => act('cancel')} disabled={busy} className="btn-danger">取消・在庫解放</button>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-5">
      <h2 className="mb-bl-2 text-xs font-medium text-graphite">{title}</h2>
      {children}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-mist">{label}</dt>
      <dd className={strong ? 'font-semibold text-ink' : 'text-ink'}>{value}</dd>
    </div>
  )
}

function QuoteForm({
  defaultCarrier,
  disabled,
  onSubmit,
}: {
  defaultCarrier: string
  disabled: boolean
  onSubmit: (feeJpy: number, carrier: string) => void
}) {
  const [fee, setFee] = useState('')
  const [carrier, setCarrier] = useState(defaultCarrier)
  const valid = fee !== '' && Number(fee) >= 0

  return (
    <div className="rounded-lg border border-line bg-bone p-3">
      <p className="mb-2 text-xs font-medium text-ink">送料を確定して支払いリンクを発行（在庫を7日間ホールド）</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-mist">
          発送業者
          <select value={carrier} onChange={e => setCarrier(e.target.value)} className="field-input mt-1 block">
            <option value="ems">EMS（国際スピード郵便）</option>
            <option value="dhl">DHL</option>
            <option value="designated">御社指定業者</option>
          </select>
        </label>
        <label className="text-xs text-mist">
          送料 (円・税抜/免税)
          <input type="number" min="0" step="1" value={fee} onChange={e => setFee(e.target.value)} className="mt-1 block w-32 border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-ink" placeholder="例: 4500" />
        </label>
        <button type="button" disabled={disabled || !valid} onClick={() => onSubmit(Number(fee), carrier)} className="btn-primary">
          送料確定・リンク発行
        </button>
      </div>
    </div>
  )
}
