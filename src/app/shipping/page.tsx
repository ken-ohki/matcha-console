'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { KPICard } from '@/components/ui/KPICard'
import { getServices } from '@/lib/services'
import { fetchWholesaleOrders, orderToSale } from '@/lib/wholesaleAdapter'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { useStickyState } from '@/hooks/useStickyState'
import type { MasterEntry, SaleRecord } from '@/types'
import { translateValue } from '@/lib/masters'
import { ChevronRight, FileText, Package, PackageCheck, Search, Send, Truck } from 'lucide-react'
import { formatKg, todayIso } from '@/lib/format'

// Action state drives the shipping workflow. An order is "要発送" once it is paid OR
// has a 発送指示 (掛け取引: ship before payment). "入金待ち" = not yet shippable.
type ActionState = 'to_ship' | 'awaiting_payment' | 'shipped'

function actionState(s: SaleRecord): ActionState {
  if (s.shippingStatus === 'shipped') return 'shipped'
  return (s.paymentStatus === 'paid' || !!s.shipRequestedAt) ? 'to_ship' : 'awaiting_payment'
}

const ACTION_LABELS: Record<ActionState, string> = {
  to_ship: '要発送',
  awaiting_payment: '入金待ち',
  shipped: '発送完了',
}
const ACTION_COLORS: Record<ActionState, string> = {
  to_ship: 'bg-[#fff3df] text-[#a87b1e]',
  awaiting_payment: 'bg-bone text-graphite',
  shipped: 'bg-bone text-matcha',
}

function ActionBadge({ state }: { state: ActionState }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${ACTION_COLORS[state]}`}>
      {ACTION_LABELS[state]}
    </span>
  )
}

type FilterChip = 'all' | 'to_ship' | 'awaiting_payment' | 'shipped' | 'overdue'
type View = 'list' | 'history' | 'slips'

export default function ShippingPage() {
  const router = useRouter()
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [masters, setMasters] = useState<MasterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterChip, setFilterChip] = useStickyState<FilterChip>('shipping.filterChip', 'to_ship')
  const [view, setView] = useStickyState<View>('shipping.view', 'list')
  const [docLang, setDocLang] = useState<'ja' | 'en'>('ja')

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const [wOrders, nextMasters] = await Promise.all([
      fetchWholesaleOrders(),
      services.masters.listMasters(),
    ])
    // Direct sales are now wholesale_orders. Shipping doesn't need cost, so pass {}.
    setSales(wOrders.map(o => orderToSale(o, {})))
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

  const openDetail = (id: string) => router.push(`/wholesale/orders/${id}`)
  const methodLabel = (value?: string) => value ? translateValue(masters, 'shipping_method', value) : '（未設定）'

  // Issue the delivery note (納品書) PDF to enclose with the shipment.
  const openDeliveryNote = async (id: string) => {
    const current = getFirebaseAuthInstance().currentUser
    if (!current) { window.alert('未ログインです。'); return }
    const res = await fetch(`/api/wholesale/orders/${id}/delivery-note?lang=${docLang}`, {
      headers: { Authorization: `Bearer ${await current.getIdToken()}` },
    })
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
      window.alert(`納品書の発行に失敗しました。${d.detail || d.error || ''}`)
      return
    }
    window.open(URL.createObjectURL(await res.blob()), '_blank')
  }

  // Only confirmed sales need shipping
  const targetSales = useMemo(() => sales.filter(s => s.status === 'confirmed'), [sales])

  const kpis = useMemo(() => {
    const byState: Record<ActionState, number> = { to_ship: 0, awaiting_payment: 0, shipped: 0 }
    targetSales.forEach(s => { byState[actionState(s)] += 1 })
    const today = todayIso()
    const overdue = targetSales.filter(s => s.shippingStatus !== 'shipped' && s.dueDate && s.dueDate < today).length
    return { ...byState, overdue }
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
      list = list.filter(s => actionState(s) === filterChip)
    }
    list = list.filter(matchesSearch)
    // Action priority: 要発送 → 入金待ち → 発送完了; within the unshipped, soonest due first.
    const rank: Record<ActionState, number> = { to_ship: 0, awaiting_payment: 1, shipped: 2 }
    return [...list].sort((a, b) => {
      const ra = rank[actionState(a)], rb = rank[actionState(b)]
      if (ra !== rb) return ra - rb
      if (ra === 2) return (b.shippingDate ?? '').localeCompare(a.shippingDate ?? '')
      return (a.dueDate ?? '9999-12-31').localeCompare(b.dueDate ?? '9999-12-31')
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

        <div className="grid gap-3 md:grid-cols-4">
          <KPICard title="要発送（入金済・未発送）" value={`${kpis.to_ship} 件`} icon={<Send size={16} />} color={kpis.to_ship > 0 ? 'amber' : 'default'} />
          <KPICard title="入金待ち" value={`${kpis.awaiting_payment} 件`} icon={<Package size={16} />} />
          <KPICard title="発送完了" value={`${kpis.shipped} 件`} icon={<PackageCheck size={16} />} color="green" />
          <KPICard title="期限超過" value={`${kpis.overdue} 件`} color={kpis.overdue > 0 ? 'red' : 'default'} />
        </div>

        {/* View tabs */}
        <div className="flex gap-1 border-b border-[#e6dfcf]">
          {([['list', '発送リスト'], ['history', '発送業者別履歴'], ['slips', '伝票一覧']] as const).map(([key, label]) => (
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
                  ['to_ship', `要発送 (${kpis.to_ship})`],
                  ['awaiting_payment', `入金待ち (${kpis.awaiting_payment})`],
                  ['shipped', `発送完了 (${kpis.shipped})`],
                  ['overdue', `期限超過 (${kpis.overdue})`],
                  ['all', `すべて (${targetSales.length})`],
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
            <div className="ml-auto flex items-center gap-1 text-[11px] text-mist">
              <span>納品書:</span>
              <div className="inline-flex overflow-hidden rounded-lg border border-line">
                <button type="button" onClick={() => setDocLang('ja')} className={`px-2 py-1 ${docLang === 'ja' ? 'bg-ink text-paper' : 'text-ink hover:bg-bone'}`}>日本語</button>
                <button type="button" onClick={() => setDocLang('en')} className={`px-2 py-1 ${docLang === 'en' ? 'bg-ink text-paper' : 'text-ink hover:bg-bone'}`}>EN</button>
              </div>
            </div>
            <div className="relative w-full sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="販売先・商品・追跡番号・発送業者"
                className="w-full rounded-xl border border-line py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              />
            </div>
          </div>

          {view === 'list' && (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e6dfcf] text-left text-mist">
                    <th className="px-3 py-3 font-medium">対応</th>
                    <th className="px-3 py-3 font-medium">販売先 / 国</th>
                    <th className="px-3 py-3 font-medium">商品</th>
                    <th className="px-3 py-3 font-medium">メモ</th>
                    <th className="px-3 py-3 font-medium">納期</th>
                    <th className="px-3 py-3 font-medium">発送業者</th>
                    <th className="px-3 py-3 font-medium">発送日</th>
                    <th className="px-3 py-3 font-medium">追跡番号</th>
                    <th className="px-3 py-3 font-medium">納品書</th>
                    <th className="px-3 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {!loading && filtered.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-10 text-center text-sm text-mist">該当する販売案件がありません。</td></tr>
                  )}
                  {filtered.map(sale => {
                    const first = sale.items[0]
                    const rest = sale.items.length > 1 ? ` 他${sale.items.length - 1}件` : ''
                    const state = actionState(sale)
                    const overdue = sale.shippingStatus !== 'shipped' && sale.dueDate && sale.dueDate < todayIso()
                    return (
                      <tr
                        key={sale.id}
                        onClick={() => openDetail(sale.id)}
                        className={`cursor-pointer border-b border-[#f0ebdf] transition ${overdue ? 'bg-alert/5/50 hover:bg-alert/5' : state === 'to_ship' ? 'bg-[#fffaf0] hover:bg-[#fff3df]' : 'hover:bg-bone'}`}
                      >
                        <td className="whitespace-nowrap px-3 py-3">
                          <div className="flex flex-wrap items-center gap-1">
                            <ActionBadge state={state} />
                            {sale.shipRequestedAt && sale.paymentStatus !== 'paid' && sale.shippingStatus !== 'shipped' && (
                              <span className="inline-flex items-center rounded-full bg-[#e6f0e8] px-2 py-0.5 text-[10px] font-medium text-matchaDeep" title={`発送指示: ${sale.shipRequestedAt.slice(0, 16).replace('T', ' ')}`}>発送指示</span>
                            )}
                          </div>
                        </td>
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
                            ? <span className="block max-w-[220px] truncate text-[11px] text-ink" title={sale.shippingNote}>{sale.shippingNote}</span>
                            : <span className="text-[11px] text-mist">-</span>}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-3 ${overdue ? 'font-medium text-alert' : 'text-mist'}`}>{sale.dueDate || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-3">{sale.shippingMethod ? methodLabel(sale.shippingMethod) : <span className="text-mist">-</span>}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-mist">{sale.shippingDate || '-'}</td>
                        <td className="whitespace-nowrap px-3 py-3 text-mist">{sale.trackingNumber || '-'}</td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); void openDeliveryNote(sale.id) }}
                            className="inline-flex items-center gap-1 rounded-lg bg-bone px-2 py-1 text-[11px] text-matchaDeep hover:bg-[#eef3eb]"
                            title="納品書を発行（同封用）"
                          >
                            <FileText size={12} /> 発行
                          </button>
                        </td>
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
                          <tr key={sale.id} onClick={() => openDetail(sale.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(sale.id) } }} role="button" tabIndex={0} className="cursor-pointer border-b border-[#f0ebdf] last:border-b-0 transition hover:bg-bone focus:bg-bone focus:outline-none">
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
                    <th className="px-3 py-3 font-medium">発送業者</th>
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
                      <tr key={sale.id} onClick={() => openDetail(sale.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(sale.id) } }} role="button" tabIndex={0} className="cursor-pointer border-b border-[#f0ebdf] transition hover:bg-bone focus:bg-bone focus:outline-none">
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
          ※発送業者は「
          <Link href="/settings/masters" className="underline">設定 → マスター管理 → 発送業者</Link>
          」で登録できます。
        </div>
      </div>
    </AppLayout>
  )
}
