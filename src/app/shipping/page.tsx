'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { getServices } from '@/lib/services'
import type { Buyer, MasterEntry, SaleRecord, ShippingStatus } from '@/types'
import { translateValue } from '@/lib/masters'
import { Box, ChevronRight, FileText, Package, PackageCheck, Search, Send, Truck } from 'lucide-react'
import { formatKg, todayIso } from '@/lib/format'

const SHIPPING_LABELS: Record<ShippingStatus, string> = {
  ordering: '発注中',
  producing: '製造中',
  ready_to_ship: '発送準備中',
  shipped: '発送完了',
}
const SHIPPING_COLORS: Record<ShippingStatus, string> = {
  ordering: 'bg-bone text-graphite',
  producing: 'bg-bone text-graphite',
  ready_to_ship: 'bg-bone text-[#a87b1e]',
  shipped: 'bg-bone text-matcha',
}

function ShippingBadge({ status }: { status: ShippingStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${SHIPPING_COLORS[status]}`}>
      {SHIPPING_LABELS[status]}
    </span>
  )
}

type FilterChip = 'all' | 'ordering' | 'producing' | 'ready_to_ship' | 'shipped' | 'overdue'
type View = 'list' | 'history' | 'slips'

export default function ShippingPage() {
  const router = useRouter()
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [masters, setMasters] = useState<MasterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterChip, setFilterChip] = useState<FilterChip>('all')
  const [view, setView] = useState<View>('list')

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const [nextSales, nextBuyers, nextMasters] = await Promise.all([
      services.sales.getSaleRecords(),
      services.sales.getBuyers(),
      services.masters.listMasters(),
    ])
    setSales(nextSales)
    setBuyers(nextBuyers)
    setMasters(nextMasters)
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

  const openDetail = (id: string) => router.push(`/shipping/${id}`)
  const methodLabel = (value?: string) => value ? translateValue(masters, 'shipping_method', value) : '（未設定）'

  // Only confirmed sales need shipping
  const targetSales = useMemo(() => sales.filter(s => s.status === 'confirmed'), [sales])

  const kpis = useMemo(() => {
    const byStatus: Record<ShippingStatus, number> = { ordering: 0, producing: 0, ready_to_ship: 0, shipped: 0 }
    targetSales.forEach(s => { byStatus[s.shippingStatus] = (byStatus[s.shippingStatus] ?? 0) + 1 })
    const today = todayIso()
    const overdue = targetSales.filter(s => s.shippingStatus !== 'shipped' && s.dueDate && s.dueDate < today).length
    return { ...byStatus, overdue }
  }, [targetSales])

  const matchesSearch = (s: SaleRecord) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      s.buyerName.toLowerCase().includes(q) ||
      s.country.toLowerCase().includes(q) ||
      s.items.some(i => i.productName.toLowerCase().includes(q) || i.productSku.toLowerCase().includes(q)) ||
      (s.trackingNumber ?? '').toLowerCase().includes(q) ||
      methodLabel(s.shippingMethod).toLowerCase().includes(q)
    )
  }

  const filtered = useMemo(() => {
    const today = todayIso()
    let list = targetSales
    if (filterChip === 'overdue') {
      list = list.filter(s => s.shippingStatus !== 'shipped' && s.dueDate && s.dueDate < today)
    } else if (filterChip !== 'all') {
      list = list.filter(s => s.shippingStatus === filterChip)
    }
    list = list.filter(matchesSearch)
    return [...list].sort((a, b) => {
      const aShipped = a.shippingStatus === 'shipped'
      const bShipped = b.shippingStatus === 'shipped'
      if (aShipped !== bShipped) return aShipped ? 1 : -1
      if (!aShipped) return (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31')
      return (b.shippingDate ?? '').localeCompare(a.shippingDate ?? '')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSales, filterChip, search, masters])

  // 発送方法ごとの発送履歴（発送完了のみ）
  const historyGroups = useMemo(() => {
    const shipped = targetSales.filter(s => s.shippingStatus === 'shipped').filter(matchesSearch)
    const map = new Map<string, SaleRecord[]>()
    for (const s of shipped) {
      const key = s.shippingMethod?.trim() || ''
      map.set(key, [...(map.get(key) ?? []), s])
    }
    return [...map.entries()]
      .map(([key, items]) => ({
        key,
        label: methodLabel(key || undefined),
        items: items.sort((a, b) => (b.shippingDate ?? '').localeCompare(a.shippingDate ?? '')),
        totalKg: items.reduce((sum, s) => sum + s.quantityKg, 0),
      }))
      .sort((a, b) => b.items.length - a.items.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSales, search, masters])

  // 伝票一覧: 発送伝票が添付された案件を集約
  const slipList = useMemo(() => {
    return targetSales
      .filter(s => s.shippingSlip)
      .filter(matchesSearch)
      .sort((a, b) => (b.shippingSlip?.uploadedAt ?? '').localeCompare(a.shippingSlip?.uploadedAt ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSales, search, masters])

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#dceeff] px-3 py-1 text-sm font-medium text-[#1b4a82]">
            <Truck size={15} />
            発送管理
          </div>
          <h1 className="mt-3 text-3xl font-bold text-ink">発送管理</h1>
          <p className="mt-2 text-sm text-mist">
            確定済みの販売案件の発送状況を管理できます。行をクリックすると発送内容の確認・編集ができます。
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-5">
          <KPICard title="発注中" value={`${kpis.ordering} 件`} icon={<Package size={16} />} />
          <KPICard title="製造中" value={`${kpis.producing} 件`} icon={<Box size={16} />} />
          <KPICard title="発送準備中" value={`${kpis.ready_to_ship} 件`} icon={<Send size={16} />} color="amber" />
          <KPICard title="発送完了" value={`${kpis.shipped} 件`} icon={<PackageCheck size={16} />} color="green" />
          <KPICard title="期限超過" value={`${kpis.overdue} 件`} color={kpis.overdue > 0 ? 'red' : 'default'} />
        </div>

        {/* View tabs */}
        <div className="flex gap-1 border-b border-[#e6dfcf]">
          {([['list', '発送リスト'], ['history', '発送方法別履歴'], ['slips', '伝票一覧']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                view === key ? 'border-[#174c33] text-matchaDeep' : 'border-transparent text-mist hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-3xl border border-line bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            {view === 'list' && (
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
                        ? 'border-[#174c33] bg-ink text-paper'
                        : 'border-line bg-white text-ink hover:bg-bone'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="relative ml-auto w-full sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="販売先・商品・追跡番号・発送方法"
                className="w-full rounded-xl border border-line py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              />
            </div>
          </div>

          {view === 'list' && (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e6dfcf] text-left text-mist">
                    <th className="px-3 py-3 font-medium">ステータス</th>
                    <th className="px-3 py-3 font-medium">販売先 / 国</th>
                    <th className="px-3 py-3 font-medium">商品</th>
                    <th className="px-3 py-3 font-medium">メモ</th>
                    <th className="px-3 py-3 font-medium">納期</th>
                    <th className="px-3 py-3 font-medium">発送方法</th>
                    <th className="px-3 py-3 font-medium">発送日</th>
                    <th className="px-3 py-3 font-medium">追跡番号</th>
                    <th className="px-3 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && filtered.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-10 text-center text-sm text-mist">該当する販売案件がありません。</td></tr>
                  )}
                  {filtered.map(sale => {
                    const first = sale.items[0]
                    const rest = sale.items.length > 1 ? ` 他${sale.items.length - 1}件` : ''
                    const overdue = sale.shippingStatus !== 'shipped' && sale.dueDate && sale.dueDate < todayIso()
                    return (
                      <tr
                        key={sale.id}
                        onClick={() => openDetail(sale.id)}
                        className={`cursor-pointer border-b border-[#f0ebdf] transition ${overdue ? 'bg-alert/5/50 hover:bg-alert/5' : 'hover:bg-bone'}`}
                      >
                        <td className="whitespace-nowrap px-3 py-3"><ShippingBadge status={sale.shippingStatus} /></td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-ink">{sale.buyerName}</div>
                          <div className="text-[11px] text-mist">{sale.country || '-'}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="font-medium">{first?.productName ?? '-'}</div>
                          <div className="text-[11px] text-mist">{first?.productSku}{rest} ／ {formatKg(sale.quantityKg)}</div>
                        </td>
                        <td className="px-3 py-3">
                          {sale.shippingNote
                            ? <span className="rounded-full bg-bone px-2 py-0.5 text-[10px] font-medium text-[#a87b1e]">メモ有</span>
                            : <span className="text-[11px] text-mist">-</span>}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-3 ${overdue ? 'font-medium text-alert' : 'text-mist'}`}>{sale.dueDate || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-3">{sale.shippingMethod ? methodLabel(sale.shippingMethod) : <span className="text-mist">-</span>}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-mist">{sale.shippingDate || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-mist">{sale.trackingNumber || '-'}</td>
                        <td className="px-3 py-3 text-right text-gray-400"><ChevronRight size={16} className="inline" /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {view === 'history' && (
            <div className="mt-4 space-y-5">
              {!loading && historyGroups.length === 0 && (
                <p className="py-10 text-center text-sm text-mist">発送完了の履歴がありません。</p>
              )}
              {historyGroups.map(group => (
                <div key={group.key || '(none)'} className="overflow-hidden rounded-2xl border border-[#e6dfcf]">
                  <div className="flex items-center justify-between bg-bone px-4 py-2.5">
                    <span className="text-sm font-semibold text-ink">{group.label}</span>
                    <span className="text-xs text-mist">{group.items.length}件 ／ {formatKg(group.totalKg)}</span>
                  </div>
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-[11px] uppercase tracking-wider text-mist">
                      <tr className="border-b border-[#f0ebdf]">
                        <th className="px-4 py-2 font-medium">発送日</th>
                        <th className="px-4 py-2 font-medium">販売先 / 国</th>
                        <th className="px-4 py-2 font-medium">商品</th>
                        <th className="px-4 py-2 font-medium">追跡番号</th>
                        <th className="px-4 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map(sale => {
                        const first = sale.items[0]
                        const rest = sale.items.length > 1 ? ` 他${sale.items.length - 1}件` : ''
                        return (
                          <tr key={sale.id} onClick={() => openDetail(sale.id)} className="cursor-pointer border-b border-[#f0ebdf] last:border-b-0 transition hover:bg-bone">
                            <td className="whitespace-nowrap px-4 py-2.5 text-mist">{sale.shippingDate || '-'}</td>
                            <td className="px-4 py-2.5">
                              <div className="font-medium text-ink">{sale.buyerName}</div>
                              <div className="text-[11px] text-mist">{sale.country || '-'}</div>
                            </td>
                            <td className="px-4 py-2.5">
                              <div>{first?.productName ?? '-'}{rest}</div>
                              <div className="text-[11px] text-mist">{formatKg(sale.quantityKg)}</div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-mist">{sale.trackingNumber || '-'}</td>
                            <td className="px-4 py-2.5 text-right text-gray-400"><ChevronRight size={15} className="inline" /></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {view === 'slips' && (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e6dfcf] text-left text-mist">
                    <th className="px-3 py-3 font-medium">添付日</th>
                    <th className="px-3 py-3 font-medium">販売先 / 国</th>
                    <th className="px-3 py-3 font-medium">商品</th>
                    <th className="px-3 py-3 font-medium">発送方法</th>
                    <th className="px-3 py-3 font-medium">発送日</th>
                    <th className="px-3 py-3 font-medium">伝票</th>
                    <th className="px-3 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && slipList.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-mist">発送伝票が添付された案件がありません。</td></tr>
                  )}
                  {slipList.map(sale => {
                    const first = sale.items[0]
                    const rest = sale.items.length > 1 ? ` 他${sale.items.length - 1}件` : ''
                    return (
                      <tr key={sale.id} onClick={() => openDetail(sale.id)} className="cursor-pointer border-b border-[#f0ebdf] transition hover:bg-bone">
                        <td className="whitespace-nowrap px-3 py-3 text-mist">{sale.shippingSlip?.uploadedAt || '-'}</td>
                        <td className="px-3 py-3">
                          <div className="font-medium text-ink">{sale.buyerName}</div>
                          <div className="text-[11px] text-mist">{sale.country || '-'}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div>{first?.productName ?? '-'}{rest}</div>
                          <div className="text-[11px] text-mist">{formatKg(sale.quantityKg)}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">{sale.shippingMethod ? methodLabel(sale.shippingMethod) : <span className="text-mist">-</span>}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-mist">{sale.shippingDate || '-'}</td>
                        <td className="px-3 py-3">
                          {sale.shippingSlip && (
                            <a
                              href={sale.shippingSlip.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-1 rounded-lg bg-bone px-2 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb]"
                              title={sale.shippingSlip.name}
                            >
                              <FileText size={12} /> 開く
                            </a>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right text-gray-400"><ChevronRight size={16} className="inline" /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="text-xs text-mist">
          ※発送方法は「
          <Link href="/settings/masters" className="underline">設定 → マスター管理 → 発送方法</Link>
          」で登録できます。
        </div>
      </div>
    </AppLayout>
  )
}
