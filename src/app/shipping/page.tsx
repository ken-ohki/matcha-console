'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { getServices } from '@/lib/services'
import type { Buyer, SaleRecord, ShippingStatus } from '@/types'
import { Box, Package, PackageCheck, Search, Send, Truck } from 'lucide-react'

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
const SHIPPING_METHODS = ['ヤマト運輸', '佐川急便', '日本郵便', 'EMS', 'DHL', 'FedEx', '自社配送', '引取り']

function ShippingBadge({ status }: { status: ShippingStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${SHIPPING_COLORS[status]}`}>
      {SHIPPING_LABELS[status]}
    </span>
  )
}

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatKg(v: number): string {
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(v)} kg`
}

type FilterChip = 'all' | 'ordering' | 'producing' | 'ready_to_ship' | 'shipped' | 'overdue'

export default function ShippingPage() {
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterChip, setFilterChip] = useState<FilterChip>('all')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  // Holds the last server-saved text values so onBlur can detect real changes
  // (local `sales` state is mutated by onChange, so we cannot compare against it).
  const savedRef = useRef<Record<string, { shippingMethod: string; trackingNumber: string; shippingAddress: string; shippingPostalCode: string }>>({})

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const [nextSales, nextBuyers] = await Promise.all([
      services.sales.getSaleRecords(),
      services.sales.getBuyers(),
    ])
    const buyerMap = new Map(nextBuyers.map(b => [b.name, b]))
    const snapshot: typeof savedRef.current = {}
    nextSales.forEach(s => {
      const buyer = buyerMap.get(s.buyerName)
      snapshot[s.id] = {
        shippingMethod: s.shippingMethod ?? '',
        trackingNumber: s.trackingNumber ?? '',
        shippingAddress: s.shippingAddress ?? buyer?.shippingAddress ?? '',
        shippingPostalCode: s.shippingPostalCode ?? buyer?.shippingPostalCode ?? '',
      }
    })
    savedRef.current = snapshot
    setSales(nextSales)
    setBuyers(nextBuyers)
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', handler)
    window.addEventListener('focus', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
  }, [])

  // Only confirmed sales need shipping
  const targetSales = useMemo(() => sales.filter(s => s.status === 'confirmed'), [sales])

  const kpis = useMemo(() => {
    const byStatus: Record<ShippingStatus, number> = { ordering: 0, producing: 0, ready_to_ship: 0, shipped: 0 }
    targetSales.forEach(s => { byStatus[s.shippingStatus] = (byStatus[s.shippingStatus] ?? 0) + 1 })
    const today = todayIso()
    const overdue = targetSales.filter(s => s.shippingStatus !== 'shipped' && s.dueDate && s.dueDate < today).length
    return { ...byStatus, overdue }
  }, [targetSales])

  const filtered = useMemo(() => {
    const today = todayIso()
    let list = targetSales
    if (filterChip === 'overdue') {
      list = list.filter(s => s.shippingStatus !== 'shipped' && s.dueDate && s.dueDate < today)
    } else if (filterChip !== 'all') {
      list = list.filter(s => s.shippingStatus === filterChip)
    }
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(s =>
        s.buyerName.toLowerCase().includes(q) ||
        s.country.toLowerCase().includes(q) ||
        s.items.some(i => i.productName.toLowerCase().includes(q) || i.productSku.toLowerCase().includes(q)) ||
        (s.trackingNumber ?? '').toLowerCase().includes(q),
      )
    }
    // sort: non-shipped first by dueDate asc, then shipped by shippingDate desc
    return [...list].sort((a, b) => {
      const aShipped = a.shippingStatus === 'shipped'
      const bShipped = b.shippingStatus === 'shipped'
      if (aShipped !== bShipped) return aShipped ? 1 : -1
      if (!aShipped) {
        return (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31')
      }
      return (b.shippingDate ?? '').localeCompare(a.shippingDate ?? '')
    })
  }, [targetSales, filterChip, search])

  const handlePatch = async (id: string, patch: Partial<Pick<SaleRecord, 'shippingStatus' | 'shippingMethod' | 'shippingDate' | 'trackingNumber' | 'shippingAddress' | 'shippingPostalCode'>>) => {
    setSavingId(id)
    setFeedback(null)
    try {
      const services = await getServices()
      await services.sales.updateSaleRecord(id, patch)
      setSales(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
      // Keep the saved snapshot in sync so subsequent blurs compare correctly
      const snap = savedRef.current[id]
      if (snap) {
        if (patch.shippingMethod !== undefined) snap.shippingMethod = patch.shippingMethod ?? ''
        if (patch.trackingNumber !== undefined) snap.trackingNumber = patch.trackingNumber ?? ''
        if (patch.shippingAddress !== undefined) snap.shippingAddress = patch.shippingAddress ?? ''
        if (patch.shippingPostalCode !== undefined) snap.shippingPostalCode = patch.shippingPostalCode ?? ''
      }
      setFeedback({ tone: 'success', message: '発送情報を更新しました' })
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : '保存に失敗しました' })
    } finally {
      setSavingId(null)
    }
  }

  const buyerByName = useMemo(() => {
    const map = new Map<string, Buyer>()
    buyers.forEach(b => map.set(b.name, b))
    return map
  }, [buyers])

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#dceeff] px-3 py-1 text-sm font-medium text-[#1b4a82]">
            <Truck size={15} />
            発送管理
          </div>
          <h1 className="mt-3 text-3xl font-bold text-[#173c2a]">発送管理</h1>
          <p className="mt-2 text-sm text-[#68756c]">
            確定済みの販売案件の発送状況を一括で管理できます。ステータスを変更すると販売管理側にも即時反映されます。
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-5">
          <KPICard title="発注中" value={`${kpis.ordering} 件`} icon={<Package size={16} />} />
          <KPICard title="製造中" value={`${kpis.producing} 件`} icon={<Box size={16} />} />
          <KPICard title="発送準備中" value={`${kpis.ready_to_ship} 件`} icon={<Send size={16} />} color="amber" />
          <KPICard title="発送完了" value={`${kpis.shipped} 件`} icon={<PackageCheck size={16} />} color="green" />
          <KPICard title="期限超過" value={`${kpis.overdue} 件`} color={kpis.overdue > 0 ? 'red' : 'default'} />
        </div>

        <div className="rounded-3xl border border-[#d9d1be] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-1.5">
              {([
                ['all', `すべて (${targetSales.length})`],
                ['ordering', `発注中 (${kpis.ordering})`],
                ['producing', `製造中 (${kpis.producing})`],
                ['ready_to_ship', `発送準備中 (${kpis.ready_to_ship})`],
                ['shipped', `発送完了 (${kpis.shipped})`],
                ['overdue', `期限超過 (${kpis.overdue})`],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilterChip(key as FilterChip)}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    filterChip === key
                      ? 'border-[#174c33] bg-[#174c33] text-white'
                      : 'border-[#d9d1be] bg-white text-[#173c2a] hover:bg-[#f7f5ee]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="relative ml-auto w-full sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="販売先・商品・追跡番号"
                className="w-full rounded-xl border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>

          {feedback && (
            <p className={`mt-3 text-sm ${feedback.tone === 'success' ? 'text-emerald-700' : 'text-red-600'}`}>
              {feedback.message}
            </p>
          )}

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[#e6dfcf] text-left text-[#68756c]">
                  <th className="px-3 py-3 font-medium">ステータス</th>
                  <th className="px-3 py-3 font-medium">販売先 / 国</th>
                  <th className="px-3 py-3 font-medium">商品</th>
                  <th className="px-3 py-3 font-medium">納期</th>
                  <th className="px-3 py-3 font-medium">発送方法</th>
                  <th className="px-3 py-3 font-medium">発送日</th>
                  <th className="px-3 py-3 font-medium">追跡番号</th>
                  <th className="px-3 py-3 font-medium">郵便番号</th>
                  <th className="px-3 py-3 font-medium">発送先</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-10 text-center text-sm text-[#68756c]">該当する販売案件がありません。</td></tr>
                )}
                {filtered.map(sale => {
                  const first = sale.items[0]
                  const rest = sale.items.length > 1 ? ` 他${sale.items.length - 1}件` : ''
                  const today = todayIso()
                  const overdue = sale.shippingStatus !== 'shipped' && sale.dueDate && sale.dueDate < today
                  const buyer = buyerByName.get(sale.buyerName)
                  const buyerAddr = buyer?.shippingAddress ?? ''
                  const buyerZip = buyer?.shippingPostalCode ?? ''
                  const effectiveAddr = sale.shippingAddress ?? buyerAddr
                  const effectiveZip = sale.shippingPostalCode ?? buyerZip
                  const saving = savingId === sale.id
                  return (
                    <tr key={sale.id} className={`border-b border-[#f0ebdf] align-top ${overdue ? 'bg-red-50/50' : 'hover:bg-[#faf8f2]'}`}>
                      <td className="px-3 py-3">
                        <select
                          value={sale.shippingStatus}
                          disabled={saving}
                          onChange={e => handlePatch(sale.id, { shippingStatus: e.target.value as ShippingStatus })}
                          className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs"
                        >
                          {STATUS_OPTIONS.map(s => (
                            <option key={s} value={s}>{SHIPPING_LABELS[s]}</option>
                          ))}
                        </select>
                        <div className="mt-1"><ShippingBadge status={sale.shippingStatus} /></div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-[#173c2a]">{sale.buyerName}</div>
                        <div className="text-[11px] text-[#68756c]">{sale.country || '-'}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium">{first?.productName ?? '-'}</div>
                        <div className="text-[11px] text-[#68756c]">{first?.productSku}{rest}</div>
                        <div className="text-[11px] text-[#68756c]">{formatKg(sale.quantityKg)}</div>
                      </td>
                      <td className={`px-3 py-3 ${overdue ? 'text-red-700 font-medium' : 'text-[#68756c]'}`}>{sale.dueDate || '-'}</td>
                      <td className="px-3 py-3">
                        <input
                          type="text"
                          list="shipping-methods"
                          value={sale.shippingMethod ?? ''}
                          disabled={saving}
                          onBlur={e => {
                            const v = e.target.value.trim()
                            if (v !== (savedRef.current[sale.id]?.shippingMethod ?? '')) {
                              void handlePatch(sale.id, { shippingMethod: v || undefined })
                            }
                          }}
                          onChange={e => setSales(prev => prev.map(s => s.id === sale.id ? { ...s, shippingMethod: e.target.value } : s))}
                          placeholder="ヤマト, EMS..."
                          className="w-32 rounded-lg border border-gray-200 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="date"
                          value={sale.shippingDate ?? ''}
                          disabled={saving}
                          onChange={e => handlePatch(sale.id, { shippingDate: e.target.value || undefined })}
                          className="rounded-lg border border-gray-200 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="text"
                          value={sale.trackingNumber ?? ''}
                          disabled={saving}
                          onBlur={e => {
                            const v = e.target.value.trim()
                            if (v !== (savedRef.current[sale.id]?.trackingNumber ?? '')) {
                              void handlePatch(sale.id, { trackingNumber: v || undefined })
                            }
                          }}
                          onChange={e => setSales(prev => prev.map(s => s.id === sale.id ? { ...s, trackingNumber: e.target.value } : s))}
                          className="w-36 rounded-lg border border-gray-200 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <input
                          type="text"
                          value={effectiveZip}
                          disabled={saving}
                          onBlur={e => {
                            const v = e.target.value.trim()
                            if (v !== (savedRef.current[sale.id]?.shippingPostalCode ?? '')) {
                              void handlePatch(sale.id, { shippingPostalCode: v || undefined })
                            }
                          }}
                          onChange={e => setSales(prev => prev.map(s => s.id === sale.id ? { ...s, shippingPostalCode: e.target.value } : s))}
                          placeholder={buyerZip || '〒'}
                          className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-xs"
                        />
                      </td>
                      <td className="px-3 py-3">
                        <textarea
                          rows={2}
                          value={effectiveAddr}
                          disabled={saving}
                          onBlur={e => {
                            const v = e.target.value.trim()
                            if (v !== (savedRef.current[sale.id]?.shippingAddress ?? '')) {
                              void handlePatch(sale.id, { shippingAddress: v || undefined })
                            }
                          }}
                          onChange={e => setSales(prev => prev.map(s => s.id === sale.id ? { ...s, shippingAddress: e.target.value } : s))}
                          placeholder={buyerAddr || '住所'}
                          className="w-48 resize-none rounded-lg border border-gray-200 px-2 py-1 text-xs"
                        />
                        {buyerAddr && sale.shippingAddress && sale.shippingAddress !== buyerAddr && (
                          <button
                            type="button"
                            onClick={() => handlePatch(sale.id, { shippingAddress: buyerAddr })}
                            className="mt-1 text-[10px] text-[#174c33] underline"
                          >
                            販売先の住所を使用
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <datalist id="shipping-methods">
              {SHIPPING_METHODS.map(m => <option key={m} value={m} />)}
            </datalist>
          </div>
        </div>

        <div className="text-xs text-[#68756c]">
          ※発送情報の編集は「
          <Link href="/sales" className="underline">販売管理
          </Link>
          」では行えません。
        </div>
      </div>
    </AppLayout>
  )
}
