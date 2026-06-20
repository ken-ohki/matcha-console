'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { getServices } from '@/lib/services'
import type { ProductWithInventory } from '@/types'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'

interface Member {
  uid: string
  companyName?: string
  contactName?: string
  email?: string
  country?: string
  source?: string
}
interface Line {
  productId: string
  quantityKg: string
  unitPriceOverrideJpy: string
}

async function token(): Promise<string> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`

export default function NewWholesaleOrderPage() {
  const router = useRouter()
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [memberUid, setMemberUid] = useState('')
  const [newMember, setNewMember] = useState({ companyName: '', email: '', contactName: '', phone: '', country: 'JP', rank: 'standard' })
  const [lines, setLines] = useState<Line[]>([{ productId: '', quantityKg: '', unitPriceOverrideJpy: '' }])
  const [ship, setShip] = useState({ country: 'JP', postalCode: '', address: '', contactName: '', phone: '', overseasCarrier: 'ems' })
  const [shippingFeeJpy, setShippingFeeJpy] = useState('')
  const [markPaid, setMarkPaid] = useState(true)
  const [suppressEmail, setSuppressEmail] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const svc = await getServices()
    const [prods, mRes] = await Promise.all([
      svc.inventory.getProductsWithInventory(),
      fetch('/api/wholesale/members', { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' }),
    ])
    setProducts(prods.filter(p => p.isActive !== false))
    const mData = (await mRes.json().catch(() => ({}))) as { members?: Member[] }
    setMembers((mData.members ?? []).filter(m => (m as { status?: string }).status === 'approved'))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const priceOf = (pid: string) => {
    const p = products.find(x => x.id === pid)
    return (p?.standardWholesalePrice ?? 0) as number
  }
  const setLine = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  const addLine = () => setLines(ls => [...ls, { productId: '', quantityKg: '', unitPriceOverrideJpy: '' }])
  const removeLine = (i: number) => setLines(ls => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))

  const estTotal = useMemo(() => {
    const goods = lines.reduce((s, l) => {
      const kg = Number(l.quantityKg) || 0
      const unit = l.unitPriceOverrideJpy !== '' ? Number(l.unitPriceOverrideJpy) : priceOf(l.productId)
      return s + kg * (unit || 0)
    }, 0)
    return goods + (Number(shippingFeeJpy) || 0)
  }, [lines, shippingFeeJpy, products])

  const submit = async () => {
    setError('')
    const items = lines
      .filter(l => l.productId && Number(l.quantityKg) > 0)
      .map(l => ({
        productId: l.productId,
        kind: 'wholesale' as const,
        quantityKg: Number(l.quantityKg),
        ...(l.unitPriceOverrideJpy !== '' ? { unitPriceOverrideJpy: Number(l.unitPriceOverrideJpy) } : {}),
      }))
    if (items.length === 0) {
      setError('商品を1つ以上入力してください。')
      return
    }
    setBusy(true)
    try {
      const auth = `Bearer ${await token()}`
      // 1) Resolve member (create manual member if needed)
      let uid = memberUid
      if (mode === 'new') {
        if (!newMember.companyName.trim()) {
          setError('新規取引先の会社名を入力してください。')
          setBusy(false)
          return
        }
        const mr = await fetch('/api/wholesale/members', {
          method: 'POST',
          headers: { 'content-type': 'application/json', Authorization: auth },
          body: JSON.stringify(newMember),
        })
        const md = (await mr.json().catch(() => ({}))) as { member?: { uid: string }; error?: string }
        if (!mr.ok || !md.member) {
          setError(`取引先の作成に失敗しました（${md.error ?? 'error'}）`)
          setBusy(false)
          return
        }
        uid = md.member.uid
      }
      if (!uid) {
        setError('取引先を選択してください。')
        setBusy(false)
        return
      }
      // 2) Create the order
      const res = await fetch('/api/wholesale/orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: auth },
        body: JSON.stringify({
          memberUid: uid,
          items,
          shippingCountry: ship.country,
          shippingPostalCode: ship.postalCode || undefined,
          shippingAddress: ship.address || undefined,
          contactName: ship.contactName || undefined,
          phone: ship.phone || undefined,
          overseasCarrier: ship.overseasCarrier,
          shippingFeeJpy: shippingFeeJpy !== '' ? Number(shippingFeeJpy) : undefined,
          markPaid,
          suppressEmail,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { orderId?: string; error?: string; detail?: unknown }
      if (!res.ok || !data.orderId) {
        setError(`注文の作成に失敗しました（${data.error ?? 'error'}${data.detail ? ': ' + JSON.stringify(data.detail) : ''}）`)
        return
      }
      router.push(`/wholesale/orders/${data.orderId}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl">
        <div className="mb-bl-6 border-b border-ink pb-bl-3">
          <Link href="/wholesale/orders" className="mb-bl flex items-center gap-1 text-sm text-mist hover:text-ink">
            <ArrowLeft size={15} /> 卸売注文一覧へ
          </Link>
          <p className="kicker mb-bl">SABO WHOLESALE</p>
          <h1 className="display-2 text-2xl text-ink">直接注文を入力</h1>
          <p className="mt-bl text-sm text-mist">営業・複雑案件の注文を直接入力します。在庫・税・請求は通常注文と共通（wholesale_orders）。</p>
        </div>

        {error && <p className="mb-bl-2 rounded-lg border border-alert/40 bg-alert/5 px-4 py-2 text-sm text-alert">{error}</p>}

        <div className={`space-y-5 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          {/* Member */}
          <section className="panel p-5">
            <h2 className="mb-bl-2 text-xs font-medium text-graphite">取引先</h2>
            <div className="mb-3 flex gap-2">
              <button onClick={() => setMode('existing')} className={`rounded-lg border px-3 py-1.5 text-sm ${mode === 'existing' ? 'border-ink bg-ink text-paper' : 'border-line text-graphite hover:bg-bone'}`}>既存会員</button>
              <button onClick={() => setMode('new')} className={`rounded-lg border px-3 py-1.5 text-sm ${mode === 'new' ? 'border-ink bg-ink text-paper' : 'border-line text-graphite hover:bg-bone'}`}>新規取引先を作成</button>
            </div>
            {mode === 'existing' ? (
              <select value={memberUid} onChange={e => setMemberUid(e.target.value)} className="field-input">
                <option value="">— 会員を選択 —</option>
                {members.map(m => (
                  <option key={m.uid} value={m.uid}>{m.companyName ?? '(社名未設定)'}{m.source === 'manual' ? '（手動）' : ''}{m.email ? ` · ${m.email}` : ''}</option>
                ))}
              </select>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <L label="会社名 / 屋号"><input className="field-input" value={newMember.companyName} onChange={e => setNewMember({ ...newMember, companyName: e.target.value })} /></L>
                <L label="メール（任意）"><input className="field-input" value={newMember.email} onChange={e => setNewMember({ ...newMember, email: e.target.value })} /></L>
                <L label="ご担当者（任意）"><input className="field-input" value={newMember.contactName} onChange={e => setNewMember({ ...newMember, contactName: e.target.value })} /></L>
                <L label="電話（任意）"><input className="field-input" value={newMember.phone} onChange={e => setNewMember({ ...newMember, phone: e.target.value })} /></L>
                <L label="国（ISO/JP）"><input className="field-input" value={newMember.country} onChange={e => setNewMember({ ...newMember, country: e.target.value })} /></L>
                <L label="ランク">
                  <select className="field-input" value={newMember.rank} onChange={e => setNewMember({ ...newMember, rank: e.target.value })}>
                    <option value="standard">standard</option>
                    <option value="premium">premium</option>
                    <option value="exclusive">exclusive</option>
                  </select>
                </L>
              </div>
            )}
          </section>

          {/* Items */}
          <section className="panel p-5">
            <h2 className="mb-bl-2 text-xs font-medium text-graphite">商品</h2>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <L label="商品" className="min-w-[200px] flex-1">
                    <select className="field-input" value={l.productId} onChange={e => setLine(i, { productId: e.target.value })}>
                      <option value="">— 選択 —</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''} · 残{p.currentStockKg.toFixed(1)}kg</option>
                      ))}
                    </select>
                  </L>
                  <L label="数量(kg)" className="w-24"><input type="number" min="0" step="1" className="field-input" value={l.quantityKg} onChange={e => setLine(i, { quantityKg: e.target.value })} /></L>
                  <L label={`単価(¥/kg) 既定${l.productId ? yen(priceOf(l.productId)) : '—'}`} className="w-40"><input type="number" min="0" step="1" placeholder={l.productId ? String(priceOf(l.productId)) : ''} className="field-input" value={l.unitPriceOverrideJpy} onChange={e => setLine(i, { unitPriceOverrideJpy: e.target.value })} /></L>
                  <button onClick={() => removeLine(i)} className="mb-1 p-2 text-mist hover:text-alert" aria-label="削除"><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <button onClick={addLine} className="mt-2 flex items-center gap-1 text-sm text-matchaDeep hover:underline"><Plus size={14} /> 行を追加</button>
          </section>

          {/* Shipping & payment */}
          <section className="panel p-5">
            <h2 className="mb-bl-2 text-xs font-medium text-graphite">発送・支払い</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <L label="国（JP=国内）"><input className="field-input" value={ship.country} onChange={e => setShip({ ...ship, country: e.target.value })} /></L>
              <L label="郵便番号（任意）"><input className="field-input" value={ship.postalCode} onChange={e => setShip({ ...ship, postalCode: e.target.value })} /></L>
              <L label="住所（任意）" className="sm:col-span-2"><input className="field-input" value={ship.address} onChange={e => setShip({ ...ship, address: e.target.value })} /></L>
              <L label="お届け先名（任意）"><input className="field-input" value={ship.contactName} onChange={e => setShip({ ...ship, contactName: e.target.value })} /></L>
              <L label="電話（任意）"><input className="field-input" value={ship.phone} onChange={e => setShip({ ...ship, phone: e.target.value })} /></L>
              <L label="海外発送業者"><select className="field-input" value={ship.overseasCarrier} onChange={e => setShip({ ...ship, overseasCarrier: e.target.value })}><option value="ems">EMS</option><option value="dhl">DHL</option><option value="designated">御社指定業者</option></select></L>
              <L label="送料(¥・税抜) 空欄=自動/0"><input type="number" min="0" step="1" className="field-input" value={shippingFeeJpy} onChange={e => setShippingFeeJpy(e.target.value)} /></L>
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-graphite">
              <label className="flex items-center gap-2"><input type="checkbox" checked={markPaid} onChange={e => setMarkPaid(e.target.checked)} /> 入金済みにする（請求書/既払い）</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={suppressEmail} onChange={e => setSuppressEmail(e.target.checked)} /> 顧客へのメールを送らない</label>
            </div>
          </section>

          <div className="flex items-center justify-between">
            <p className="text-sm text-mist">概算合計（税抜＋送料）: <span className="font-semibold text-ink">{yen(estTotal)}</span></p>
            <button onClick={submit} disabled={busy} className="btn-primary">注文を作成</button>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

function L({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1 block text-[11px] text-mist">{label}</span>
      {children}
    </label>
  )
}
