'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { PageTabs, SALES_TABS } from '@/components/layout/PageTabs'
import { useAuth } from '@/contexts/AuthContext'
import { SalesStatusBadge } from '@/components/ui/StatusBadge'
import { getServices } from '@/lib/services'
import type { Buyer, BuyerDetailsInput, MasterEntry, SaleRecord } from '@/types'
import { optionsForType } from '@/lib/masters'
import { Building2, ExternalLink, FileText, Mail, MapPin, Phone, Save, Search, User2, X } from 'lucide-react'
import { COUNTRY_OPTIONS } from '@/lib/countries'
import { formatCurrency } from '@/lib/format'

function formatDate(date?: Date): string {
  if (!date) return '-'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export default function BuyersPage() {
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [sales, setSales] = useState<SaleRecord[]>([])
  const [masters, setMasters] = useState<MasterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedBuyerId, setSelectedBuyerId] = useState<string | null>(null)
  const { user } = useAuth()

  const load = async () => {
    const services = await getServices()
    const [nextBuyers, nextSales, nextMasters] = await Promise.all([
      services.sales.getBuyers(),
      services.sales.getSaleRecords(),
      services.masters.listMasters(),
    ])
    setBuyers(nextBuyers)
    setSales(nextSales)
    setMasters(nextMasters)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const handler = () => {
      if (selectedBuyerId) return
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', handler)
    window.addEventListener('focus', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBuyerId])

  const filtered = useMemo(() => {
    if (!search) return buyers
    const query = search.toLowerCase()
    return buyers.filter(buyer => (
      buyer.name.toLowerCase().includes(query) ||
      (buyer.country ?? '').toLowerCase().includes(query) ||
      (buyer.terms ?? '').toLowerCase().includes(query)
    ))
  }, [buyers, search])

  const selectedBuyer = useMemo(
    () => buyers.find(b => b.id === selectedBuyerId) ?? null,
    [buyers, selectedBuyerId],
  )

  const selectedBuyerSales = useMemo(() => {
    if (!selectedBuyer) return []
    const target = selectedBuyer.normalizedName || normalizeName(selectedBuyer.name)
    return sales
      .filter(sale => normalizeName(sale.buyerName) === target)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }, [sales, selectedBuyer])

  const handleSaveBuyer = async (input: BuyerDetailsInput) => {
    if (!selectedBuyer) return
    const services = await getServices()
    const updated = await services.sales.updateBuyer(selectedBuyer.id, input)
    setBuyers(prev => prev.map(b => (b.id === updated.id ? updated : b)))
  }

  const handleRenameBuyer = async (name: string) => {
    if (!selectedBuyer) return
    const services = await getServices()
    const renamed = await services.sales.renameBuyer(selectedBuyer.id, name)
    // The buyer doc (and its id) may have changed; reload and reselect it.
    const [nextBuyers, nextSales] = await Promise.all([
      services.sales.getBuyers(),
      services.sales.getSaleRecords(),
    ])
    setBuyers(nextBuyers)
    setSales(nextSales)
    setSelectedBuyerId(renamed.id)
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageTabs tabs={SALES_TABS} />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-3 py-1 text-sm font-medium text-[#5e44a8]">
              <Building2 size={15} />
              販売先マスター
            </div>
            <h1 className="mt-3 text-3xl font-bold text-[#173c2a]">登録済みの販売先一覧</h1>
            <p className="mt-2 text-sm text-[#68756c]">行をクリックすると詳細情報と過去の注文が確認できます。</p>
          </div>
          <Link
            href="/sales"
            className="inline-flex items-center gap-2 self-start rounded-xl bg-[#174c33] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#123723]"
          >
            販売管理へ戻る
          </Link>
        </div>

        <div className="rounded-3xl border border-[#d9d1be] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-lg font-semibold text-[#173c2a]">販売先一覧</h2>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="販売先名・国・条件で検索"
                className="w-full rounded-xl border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 sm:w-64"
              />
            </div>
          </div>

          <div className="mt-5 space-y-3 md:hidden">
            {!loading && filtered.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#d9d1be] px-4 py-10 text-center text-sm text-[#68756c]">
                登録済みの販売先はありません。
              </div>
            )}
            {filtered.map(buyer => (
              <button
                key={buyer.id}
                type="button"
                onClick={() => setSelectedBuyerId(buyer.id)}
                className="w-full rounded-2xl border border-[#ece5d7] bg-[#faf8f2] p-4 text-left transition hover:border-[#bcb39a]"
              >
                <div className="font-medium text-[#173c2a]">{buyer.name}</div>
                <div className="mt-1 text-xs text-[#68756c]">{buyer.country || '国未設定'}</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-white p-3 text-xs text-[#68756c]">
                    <div>利用回数 {buyer.saleCount}件</div>
                    <div className="mt-1">最終利用日 {formatDate(buyer.lastSoldAt)}</div>
                  </div>
                  <div className="rounded-xl bg-white p-3 text-xs text-[#68756c]">
                    <div>直近条件 {buyer.terms || '-'}</div>
                    <div className="mt-1">メモ {buyer.notes || '-'}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-5 hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[#e6dfcf] text-left text-[#68756c]">
                  <th className="px-3 py-3 font-medium">販売先</th>
                  <th className="px-3 py-3 font-medium">国</th>
                  <th className="px-3 py-3 font-medium">利用回数</th>
                  <th className="px-3 py-3 font-medium">直近条件</th>
                  <th className="px-3 py-3 font-medium">最終利用日</th>
                  <th className="px-3 py-3 font-medium">メモ</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-[#68756c]">
                      登録済みの販売先はありません。
                    </td>
                  </tr>
                )}
                {filtered.map(buyer => (
                  <tr
                    key={buyer.id}
                    onClick={() => setSelectedBuyerId(buyer.id)}
                    className="cursor-pointer border-b border-[#f0ebdf] text-[#173c2a] transition hover:bg-[#faf8f2]"
                  >
                    <td className="px-3 py-4 font-medium">{buyer.name}</td>
                    <td className="px-3 py-4">{buyer.country || '-'}</td>
                    <td className="px-3 py-4">{buyer.saleCount}</td>
                    <td className="px-3 py-4">{buyer.terms || '-'}</td>
                    <td className="px-3 py-4">{formatDate(buyer.lastSoldAt)}</td>
                    <td className="px-3 py-4 max-w-xs truncate">{buyer.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedBuyer && (
        <BuyerDetailModal
          key={selectedBuyer.id}
          buyer={selectedBuyer}
          sales={selectedBuyerSales}
          masters={masters}
          canEdit={user?.role === 'admin'}
          onClose={() => setSelectedBuyerId(null)}
          onSave={handleSaveBuyer}
          onRename={handleRenameBuyer}
        />
      )}
    </AppLayout>
  )
}

function BuyerDetailModal({
  buyer,
  sales,
  masters,
  canEdit,
  onClose,
  onSave,
  onRename,
}: {
  buyer: Buyer
  sales: SaleRecord[]
  masters: MasterEntry[]
  canEdit: boolean
  onClose: () => void
  onSave: (input: BuyerDetailsInput) => Promise<void>
  onRename: (name: string) => Promise<void>
}) {
  const termsOptions = useMemo(() => optionsForType(masters, 'terms'), [masters])
  const [name, setName] = useState(buyer.name)
  const [form, setForm] = useState<BuyerDetailsInput>({
    billingName: buyer.billingName ?? '',
    email: buyer.email ?? '',
    website: buyer.website ?? '',
    phone: buyer.phone ?? '',
    shippingAddress: buyer.shippingAddress ?? '',
    shippingPostalCode: buyer.shippingPostalCode ?? '',
    contactPersonName: buyer.contactPersonName ?? '',
    notes: buyer.notes ?? '',
    country: buyer.country ?? '',
    terms: buyer.terms ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const totalRevenue = sales.reduce((sum, sale) => sum + sale.revenue, 0)
  const totalQuantity = sales.reduce((sum, sale) => sum + sale.quantityKg, 0)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setFeedback({ tone: 'error', message: '管理用の名前を入力してください' })
      return
    }
    setSaving(true)
    setFeedback(null)
    try {
      await onSave(form)
      // Rename last: it cascades to sales and replaces the buyer doc, so the
      // detail save above must target the existing doc first.
      if (trimmedName !== buyer.name) {
        await onRename(trimmedName)
      }
      setFeedback({ tone: 'success', message: '販売先情報を更新しました' })
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : '保存に失敗しました',
      })
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="absolute right-3 top-3 rounded-full p-1.5 text-[#68756c] transition hover:bg-[#f4f2ea] hover:text-[#173c2a]"
        >
          <X size={18} />
        </button>
        <div className="border-b border-[#ece8db] px-6 pb-4 pt-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-2.5 py-0.5 text-xs font-medium text-[#5e44a8]">
            <Building2 size={12} />
            販売先
          </div>
          <h2 className="mt-2 text-xl font-semibold text-[#173c2a]">{buyer.name}</h2>
          <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-[#68756c]">
            <div>利用回数 <span className="font-semibold text-[#173c2a]">{buyer.saleCount}</span> 件</div>
            <div>累計数量 <span className="font-semibold text-[#173c2a]">{totalQuantity.toFixed(1)} kg</span></div>
            <div>累計売上 <span className="font-semibold text-[#173c2a]">{formatCurrency(totalRevenue)}</span></div>
          </div>
        </div>

        <div className="max-h-[calc(92vh-160px)] overflow-y-auto px-6 py-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            <section>
              <h3 className="mb-3 text-sm font-semibold text-[#173c2a]">販売先詳細</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Field icon={<Building2 size={14} />} label="管理用の名前（アプリ内・一覧で使用）">
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className={inputClass}
                      disabled={!canEdit}
                    />
                  </Field>
                  <p className="mt-1 text-[11px] text-[#9aa39a]">変更すると、この販売先の過去の販売案件すべてに反映されます。</p>
                </div>
                <div className="sm:col-span-2">
                  <Field icon={<FileText size={14} />} label="請求用の名前（請求書・見積書に表示）">
                    <input
                      type="text"
                      value={form.billingName ?? ''}
                      onChange={e => setForm(prev => ({ ...prev, billingName: e.target.value }))}
                      className={inputClass}
                      placeholder="未入力の場合は管理用の名前を表示"
                      disabled={!canEdit}
                    />
                  </Field>
                </div>
                <Field icon={<User2 size={14} />} label="担当者名">
                  <input
                    type="text"
                    value={form.contactPersonName ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, contactPersonName: e.target.value }))}
                    className={inputClass}
                    disabled={!canEdit}
                  />
                </Field>
                <Field icon={<Mail size={14} />} label="メールアドレス">
                  <input
                    type="email"
                    value={form.email ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))}
                    className={inputClass}
                    disabled={!canEdit}
                  />
                </Field>
                <Field icon={<Phone size={14} />} label="電話番号">
                  <input
                    type="tel"
                    value={form.phone ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, phone: e.target.value }))}
                    className={inputClass}
                    disabled={!canEdit}
                  />
                </Field>
                <Field icon={<ExternalLink size={14} />} label="ホームページ">
                  <input
                    type="url"
                    placeholder="https://"
                    value={form.website ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, website: e.target.value }))}
                    className={inputClass}
                    disabled={!canEdit}
                  />
                </Field>
                <Field icon={<MapPin size={14} />} label="郵便番号">
                  <input
                    type="text"
                    placeholder="例: 100-0001 / 10001"
                    value={form.shippingPostalCode ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, shippingPostalCode: e.target.value }))}
                    className={inputClass}
                    disabled={!canEdit}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field icon={<MapPin size={14} />} label="発送先住所">
                    <textarea
                      rows={3}
                      value={form.shippingAddress ?? ''}
                      onChange={e => setForm(prev => ({ ...prev, shippingAddress: e.target.value }))}
                      className={inputClass}
                      disabled={!canEdit}
                    />
                  </Field>
                </div>
                <Field label="国">
                  <select
                    value={form.country ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, country: e.target.value }))}
                    className={inputClass}
                    disabled={!canEdit}
                  >
                    <option value="">未設定</option>
                    {COUNTRY_OPTIONS.map(option => (
                      <option key={option.code} value={option.name}>
                        {option.name}
                      </option>
                    ))}
                    {form.country && !COUNTRY_OPTIONS.some(o => o.name === form.country) && (
                      <option value={form.country}>{form.country}（未登録）</option>
                    )}
                  </select>
                </Field>
                <Field label="取引条件">
                  <select
                    value={form.terms ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, terms: e.target.value }))}
                    className={inputClass}
                    disabled={!canEdit}
                  >
                    <option value="">未選択</option>
                    {termsOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label || option.value}
                      </option>
                    ))}
                    {form.terms && !termsOptions.some(o => o.value === form.terms) && (
                      <option value={form.terms}>{form.terms}（未登録）</option>
                    )}
                  </select>
                </Field>
                <div className="sm:col-span-2">
                  <Field label="メモ">
                    <textarea
                      rows={2}
                      value={form.notes ?? ''}
                      onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                      className={inputClass}
                      disabled={!canEdit}
                    />
                  </Field>
                </div>
              </div>
              {feedback && (
                <p className={`mt-3 text-sm ${feedback.tone === 'success' ? 'text-emerald-700' : 'text-red-600'}`}>
                  {feedback.message}
                </p>
              )}
              {canEdit && (
                <div className="mt-4 flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#174c33] px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-[#205f43] disabled:opacity-60"
                  >
                    <Save size={14} />
                    {saving ? '保存中…' : '販売先情報を保存'}
                  </button>
                </div>
              )}
            </section>

            <section className="border-t border-[#ece8db] pt-5">
              <h3 className="mb-3 text-sm font-semibold text-[#173c2a]">過去の注文 ({sales.length}件)</h3>
              {sales.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#d9d1be] py-6 text-center text-sm text-[#68756c]">
                  注文履歴はまだありません。
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-[#ece8db]">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[#faf8f1] text-left text-[11px] uppercase tracking-wider text-[#68756c]">
                      <tr>
                        <th className="px-3 py-2 font-medium">状態</th>
                        <th className="px-3 py-2 font-medium">更新日</th>
                        <th className="px-3 py-2 font-medium">商品</th>
                        <th className="px-3 py-2 font-medium text-right">数量</th>
                        <th className="px-3 py-2 font-medium text-right">単価</th>
                        <th className="px-3 py-2 font-medium text-right">売上</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sales.flatMap(sale => sale.items.map((item, idx) => (
                        <tr key={`${sale.id}-${idx}`} className="border-t border-[#ece8db] text-[#173c2a]">
                          <td className="px-3 py-2">{idx === 0 ? <SalesStatusBadge status={sale.status} /> : null}</td>
                          <td className="px-3 py-2 text-[#68756c]">{idx === 0 ? formatDate(sale.updatedAt) : ''}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{item.productName}</div>
                            <div className="text-[11px] text-[#68756c]">{item.productSku}</div>
                          </td>
                          <td className="px-3 py-2 text-right">{item.quantityKg.toFixed(1)} kg</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatCurrency(item.revenue)}</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </form>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  icon,
  children,
}: {
  label: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[#68756c]">
        {icon}
        {label}
      </span>
      {children}
    </label>
  )
}
