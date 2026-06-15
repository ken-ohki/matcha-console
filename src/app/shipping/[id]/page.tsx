'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type { Buyer, MasterEntry, SaleRecord, ShippingStatus } from '@/types'
import { optionsForType } from '@/lib/masters'
import { formatKg, todayIso } from '@/lib/format'
import { ArrowLeft, FileText, PackageCheck, Trash2 } from 'lucide-react'

const SHIPPING_LABELS: Record<ShippingStatus, string> = {
  ordering: '発注中',
  producing: '製造中',
  ready_to_ship: '発送準備中',
  shipped: '発送完了',
}
const SHIPPING_COLORS: Record<ShippingStatus, string> = {
  ordering: 'bg-slate-100 text-slate-700',
  producing: 'bg-blue-100 text-blue-800',
  ready_to_ship: 'bg-amber-100 text-amber-800',
  shipped: 'bg-emerald-100 text-emerald-800',
}
const STATUS_OPTIONS: ShippingStatus[] = ['ordering', 'producing', 'ready_to_ship', 'shipped']

type ShipForm = {
  shippingStatus: ShippingStatus
  shippingMethod: string
  shippingDate: string
  trackingNumber: string
  shippingPostalCode: string
  shippingAddress: string
}

const fieldCls = 'w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600'

export default function ShippingDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const canEdit = user?.role === 'admin'

  const [sale, setSale] = useState<SaleRecord | null>(null)
  const [buyer, setBuyer] = useState<Buyer | undefined>(undefined)
  const [masters, setMasters] = useState<MasterEntry[]>([])
  const [form, setForm] = useState<ShipForm | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploadingSlip, setUploadingSlip] = useState(false)
  const [slipError, setSlipError] = useState('')

  const buildForm = (s: SaleRecord, b?: Buyer): ShipForm => ({
    shippingStatus: s.shippingStatus,
    shippingMethod: s.shippingMethod ?? '',
    shippingDate: s.shippingDate ?? '',
    trackingNumber: s.trackingNumber ?? '',
    shippingPostalCode: s.shippingPostalCode ?? b?.shippingPostalCode ?? '',
    shippingAddress: s.shippingAddress ?? b?.shippingAddress ?? '',
  })

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      const services = await getServices()
      const [sales, buyers, nextMasters] = await Promise.all([
        services.sales.getSaleRecords(),
        services.sales.getBuyers(),
        services.masters.listMasters(),
      ])
      if (!active) return
      const found = sales.find(s => s.id === params.id) ?? null
      const matchedBuyer = found ? buyers.find(b => b.name === found.buyerName) : undefined
      setSale(found)
      setBuyer(matchedBuyer)
      setMasters(nextMasters)
      if (found) setForm(buildForm(found, matchedBuyer))
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [params.id])

  const methodOptions = useMemo(() => optionsForType(masters, 'shipping_method'), [masters])

  const persist = async (patch: Partial<ShipForm>) => {
    if (!sale || !form) return
    const next = { ...form, ...patch }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const services = await getServices()
      const updated = await services.sales.updateSaleRecord(sale.id, {
        shippingStatus: next.shippingStatus,
        shippingMethod: next.shippingMethod.trim() || undefined,
        shippingDate: next.shippingDate || undefined,
        trackingNumber: next.trackingNumber.trim() || undefined,
        shippingPostalCode: next.shippingPostalCode.trim() || undefined,
        shippingAddress: next.shippingAddress.trim() || undefined,
      })
      setSale(updated)
      setForm(buildForm(updated, buyer))
      setMessage('保存しました')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleUploadSlip = async (file: File) => {
    if (!sale) return
    setSlipError('')
    if (file.size > 30 * 1024 * 1024) { setSlipError('30MBを超えるファイルはアップロードできません'); return }
    setUploadingSlip(true)
    try {
      const { uploadShippingSlip } = await import('@/lib/firebase/storage')
      const url = await uploadShippingSlip(file, sale.id)
      if (!url) throw new Error('アップロードURLの取得に失敗しました')
      const services = await getServices()
      const updated = await services.sales.updateShippingSlip(sale.id, { name: file.name, url, uploadedAt: todayIso(), size: file.size })
      setSale(updated)
    } catch (err) {
      setSlipError(err instanceof Error ? err.message : 'アップロードに失敗しました')
    } finally {
      setUploadingSlip(false)
    }
  }

  const handleRemoveSlip = async () => {
    if (!sale?.shippingSlip) return
    if (!confirm('発送伝票を削除しますか？')) return
    setUploadingSlip(true)
    setSlipError('')
    try {
      const { deleteStorageObjectByUrl } = await import('@/lib/firebase/storage')
      if (sale.shippingSlip.url) await deleteStorageObjectByUrl(sale.shippingSlip.url)
      const services = await getServices()
      const updated = await services.sales.updateShippingSlip(sale.id, null)
      setSale(updated)
    } catch (err) {
      setSlipError(err instanceof Error ? err.message : '削除に失敗しました')
    } finally {
      setUploadingSlip(false)
    }
  }

  if (loading) {
    return <AppLayout><div className="py-20 text-center text-sm text-[#68756c]">読み込み中…</div></AppLayout>
  }
  if (!sale || !form) {
    return (
      <AppLayout>
        <div className="space-y-4 py-20 text-center">
          <p className="text-sm text-[#68756c]">発送案件が見つかりませんでした。</p>
          <Link href="/shipping" className="inline-flex items-center gap-2 text-sm font-medium text-[#174c33] hover:underline">
            <ArrowLeft size={14} /> 発送管理へ戻る
          </Link>
        </div>
      </AppLayout>
    )
  }

  const overdue = form.shippingStatus !== 'shipped' && sale.dueDate && sale.dueDate < todayIso()

  return (
    <AppLayout>
      <div className="space-y-5">
        <div className="flex flex-col gap-3">
          <Link href="/shipping" className="inline-flex w-fit items-center gap-1.5 text-sm text-[#68756c] hover:text-[#173c2a]">
            <ArrowLeft size={14} /> 発送管理
          </Link>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${SHIPPING_COLORS[form.shippingStatus]}`}>{SHIPPING_LABELS[form.shippingStatus]}</span>
              <h1 className="text-2xl font-bold text-[#173c2a]">{sale.buyerName}</h1>
              <span className="text-sm text-[#68756c]">{sale.country || '-'}</span>
              {overdue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">期限超過</span>}
            </div>
            {canEdit && form.shippingStatus !== 'shipped' && (
              <button
                type="button"
                onClick={() => persist({ shippingStatus: 'shipped', shippingDate: form.shippingDate || todayIso() })}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#174c33] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#123723] disabled:bg-[#4f7c65]"
              >
                <PackageCheck size={15} /> 発送完了にする
              </button>
            )}
          </div>
        </div>

        {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {/* 発送内容 */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#68756c]">発送する商品</p>
            <div className="overflow-hidden rounded-xl border border-[#ece8db]">
              <table className="min-w-full text-sm">
                <thead className="bg-[#faf8f1] text-left text-[11px] uppercase tracking-wider text-[#68756c]">
                  <tr>
                    <th className="px-3 py-2 font-medium">商品</th>
                    <th className="px-3 py-2 font-medium">SKU</th>
                    <th className="px-3 py-2 font-medium text-right">数量</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((item, i) => (
                    <tr key={i} className="border-t border-[#f0ebdf] text-[#173c2a]">
                      <td className="px-3 py-2">{item.productName}</td>
                      <td className="px-3 py-2 text-[#68756c]">{item.productSku}</td>
                      <td className="px-3 py-2 text-right">{formatKg(item.quantityKg)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-xs text-[#68756c]">合計数量 {formatKg(sale.quantityKg)} ／ 納期 {sale.dueDate || '-'}</div>
            {sale.shippingNote ? (
              <div className="mt-3">
                <p className="mb-1 text-[11px] uppercase tracking-wider text-[#68756c]">発送担当者へのメモ</p>
                <div className="whitespace-pre-wrap rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{sale.shippingNote}</div>
              </div>
            ) : null}
            <div className="mt-3 text-xs">
              <Link href={`/sales/${sale.id}`} className="font-medium text-[#174c33] hover:underline">販売案件の詳細を開く →</Link>
            </div>
          </div>

          {/* 発送情報（編集） */}
          <fieldset disabled={!canEdit || saving} className="rounded-2xl border border-[#e6dfcf] bg-white p-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#68756c]">発送情報</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">発送ステータス</label>
                <select value={form.shippingStatus} onChange={e => setForm({ ...form, shippingStatus: e.target.value as ShippingStatus })} className={fieldCls}>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{SHIPPING_LABELS[s]}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">発送方法</label>
                <select value={form.shippingMethod} onChange={e => setForm({ ...form, shippingMethod: e.target.value })} className={fieldCls}>
                  <option value="">未設定</option>
                  {methodOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  {form.shippingMethod && !methodOptions.some(o => o.value === form.shippingMethod) && (
                    <option value={form.shippingMethod}>{form.shippingMethod}（未登録）</option>
                  )}
                </select>
                {methodOptions.length === 0 && (
                  <p className="mt-1 text-[11px] text-amber-700">設定 → マスター管理 → 発送方法 で登録できます</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">発送日</label>
                <input type="date" value={form.shippingDate} onChange={e => setForm({ ...form, shippingDate: e.target.value })} className={fieldCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">追跡番号</label>
                <input value={form.trackingNumber} onChange={e => setForm({ ...form, trackingNumber: e.target.value })} className={fieldCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">郵便番号</label>
                <input value={form.shippingPostalCode} onChange={e => setForm({ ...form, shippingPostalCode: e.target.value })} placeholder={buyer?.shippingPostalCode || '〒'} className={fieldCls} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-700">発送先住所</label>
                <textarea rows={2} value={form.shippingAddress} onChange={e => setForm({ ...form, shippingAddress: e.target.value })} placeholder={buyer?.shippingAddress || '住所'} className={fieldCls} />
              </div>
            </div>
            {canEdit && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => persist({})}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#174c33] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#123723] disabled:bg-[#4f7c65]"
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            )}
          </fieldset>
        </div>

        {/* 発送伝票 */}
        <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#68756c]">発送伝票（送り状など）</p>
          {sale.shippingSlip ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e6dfcf] bg-[#faf8f1] px-3 py-2 text-sm">
              <FileText size={15} className="text-[#174c33]" />
              <a href={sale.shippingSlip.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-[#173c2a] hover:underline">
                {sale.shippingSlip.name}
              </a>
              {sale.shippingSlip.uploadedAt && <span className="text-[10px] text-[#a59f8c]">{sale.shippingSlip.uploadedAt}</span>}
              {canEdit && (
                <button type="button" onClick={handleRemoveSlip} disabled={uploadingSlip} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50" aria-label="削除">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ) : canEdit ? (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[#d9d1be] bg-white px-4 py-3 text-sm font-medium text-[#174c33] transition hover:bg-[#eef3eb]">
              <FileText size={14} />
              {uploadingSlip ? 'アップロード中…' : '発送伝票をアップロード（PDF / 画像）'}
              <input
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                disabled={uploadingSlip}
                onChange={async e => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) await handleUploadSlip(file)
                }}
              />
            </label>
          ) : (
            <span className="text-sm text-[#a59f8c]">未添付</span>
          )}
          {slipError && <p className="mt-2 text-xs text-red-600">{slipError}</p>}
        </div>
      </div>
    </AppLayout>
  )
}
