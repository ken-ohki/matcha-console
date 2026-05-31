'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { PageTabs, PURCHASING_TABS } from '@/components/layout/PageTabs'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type { PurchaseOrder, Supplier, SupplierDetailsInput } from '@/types'
import { JAPAN_PREFECTURES } from '@/lib/prefectures'
import { ExternalLink, FileText, Mail, MapPin, Phone, Save, Search, Trash2, Truck, Upload, User2, X } from 'lucide-react'
import { uploadSupplierAttachment, deleteStorageObjectByUrl } from '@/lib/firebase/storage'
import type { SupplierAttachment } from '@/types'

function formatDate(date?: Date): string {
  if (!date) return '-'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(value)
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { user } = useAuth()

  const load = async () => {
    const services = await getServices()
    const [nextSuppliers, nextOrders] = await Promise.all([
      services.suppliers.getSuppliers(),
      services.purchaseOrders.getPurchaseOrders(),
    ])
    setSuppliers(nextSuppliers)
    setOrders(nextOrders)
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

  const filtered = useMemo(() => {
    if (!search) return suppliers
    const q = search.toLowerCase()
    return suppliers.filter(s => (
      s.name.toLowerCase().includes(q) ||
      (s.country ?? '').toLowerCase().includes(q) ||
      (s.contactPersonName ?? '').toLowerCase().includes(q)
    ))
  }, [suppliers, search])

  const selectedSupplier = useMemo(
    () => suppliers.find(s => s.id === selectedId) ?? null,
    [suppliers, selectedId],
  )

  const selectedSupplierOrders = useMemo(() => {
    if (!selectedSupplier) return []
    const target = selectedSupplier.normalizedName || normalizeName(selectedSupplier.name)
    return orders
      .filter(o => normalizeName(o.supplierName) === target)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
  }, [orders, selectedSupplier])

  const handleSave = async (input: SupplierDetailsInput) => {
    if (!selectedSupplier) return
    const services = await getServices()
    const updated = await services.suppliers.updateSupplier(selectedSupplier.id, input)
    setSuppliers(prev => prev.map(s => (s.id === updated.id ? updated : s)))
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <PageTabs tabs={PURCHASING_TABS} />
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-3 py-1 text-sm font-medium text-[#5e44a8]">
              <Truck size={15} />
              仕入先マスター
            </div>
            <h1 className="mt-3 text-3xl font-bold text-[#173c2a]">登録済みの仕入先一覧</h1>
            <p className="mt-2 text-sm text-[#68756c]">行をクリックすると詳細情報と過去の発注が確認できます。</p>
          </div>
        </div>

        <div className="rounded-3xl border border-[#d9d1be] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-lg font-semibold text-[#173c2a]">仕入先一覧</h2>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="仕入先・県・担当者で検索"
                className="w-full rounded-xl border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 sm:w-64"
              />
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[#e6dfcf] text-left text-[#68756c]">
                  <th className="px-3 py-3 font-medium">仕入先</th>
                  <th className="px-3 py-3 font-medium">担当者</th>
                  <th className="px-3 py-3 font-medium">県</th>
                  <th className="px-3 py-3 font-medium">発注回数</th>
                  <th className="px-3 py-3 font-medium">最終発注日</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-10 text-center text-sm text-[#68756c]">
                      登録済みの仕入先はありません。
                    </td>
                  </tr>
                )}
                {filtered.map(s => (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className="cursor-pointer border-b border-[#f0ebdf] text-[#173c2a] transition hover:bg-[#faf8f2]"
                  >
                    <td className="px-3 py-4 font-medium">{s.name}</td>
                    <td className="px-3 py-4">{s.contactPersonName || '-'}</td>
                    <td className="px-3 py-4">{s.country || '-'}</td>
                    <td className="px-3 py-4">{s.orderCount}</td>
                    <td className="px-3 py-4">{formatDate(s.lastOrderedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selectedSupplier && (
        <SupplierDetailModal
          supplier={selectedSupplier}
          orders={selectedSupplierOrders}
          canEdit={user?.role === 'admin'}
          onClose={() => setSelectedId(null)}
          onSave={handleSave}
        />
      )}
    </AppLayout>
  )
}

function SupplierDetailModal({
  supplier,
  orders,
  canEdit,
  onClose,
  onSave,
}: {
  supplier: Supplier
  orders: PurchaseOrder[]
  canEdit: boolean
  onClose: () => void
  onSave: (input: SupplierDetailsInput) => Promise<void>
}) {
  const [form, setForm] = useState<SupplierDetailsInput>({
    contactPersonName: supplier.contactPersonName ?? '',
    email: supplier.email ?? '',
    phone: supplier.phone ?? '',
    website: supplier.website ?? '',
    address: supplier.address ?? '',
    postalCode: supplier.postalCode ?? '',
    country: supplier.country ?? '',
    notes: supplier.notes ?? '',
    attachments: supplier.attachments ?? [],
  })
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const totalAmount = orders.reduce((sum, o) => sum + o.totalAmount, 0)
  const totalQuantity = orders.reduce((sum, o) => sum + o.totalQuantityKg, 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setFeedback(null)
    try {
      await onSave(form)
      setFeedback({ tone: 'success', message: '仕入先情報を更新しました' })
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : '保存に失敗しました',
      })
    } finally {
      setSaving(false)
    }
  }

  const inputClass = 'w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
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
            <Truck size={12} />
            仕入先
          </div>
          <h2 className="mt-2 text-xl font-semibold text-[#173c2a]">{supplier.name}</h2>
          <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-[#68756c]">
            <div>発注回数 <span className="font-semibold text-[#173c2a]">{supplier.orderCount}</span> 件</div>
            <div>累計数量 <span className="font-semibold text-[#173c2a]">{totalQuantity.toFixed(1)} kg</span></div>
            <div>累計金額 <span className="font-semibold text-[#173c2a]">{formatCurrency(totalAmount)}</span></div>
          </div>
        </div>

        <div className="max-h-[calc(92vh-160px)] overflow-y-auto px-6 py-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            <section>
              <h3 className="mb-3 text-sm font-semibold text-[#173c2a]">仕入先詳細</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    value={form.postalCode ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, postalCode: e.target.value }))}
                    className={inputClass}
                    disabled={!canEdit}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <Field icon={<MapPin size={14} />} label="住所">
                    <textarea
                      rows={3}
                      value={form.address ?? ''}
                      onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))}
                      className={inputClass}
                      disabled={!canEdit}
                    />
                  </Field>
                </div>
                <Field label="県">
                  <select
                    value={form.country ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, country: e.target.value }))}
                    className={inputClass}
                    disabled={!canEdit}
                  >
                    <option value="">未設定</option>
                    {JAPAN_PREFECTURES.map(pref => (
                      <option key={pref} value={pref}>{pref}</option>
                    ))}
                    {form.country && !JAPAN_PREFECTURES.includes(form.country) && (
                      <option value={form.country}>{form.country}（未登録）</option>
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
                <div className="sm:col-span-2">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[#68756c]">料金表など添付ファイル（PDF）</p>
                  <div className="space-y-2">
                    {(form.attachments ?? []).length === 0 && (
                      <p className="text-xs text-[#a59f8c]">添付ファイルなし</p>
                    )}
                    {(form.attachments ?? []).map(att => (
                      <div key={att.id} className="flex items-center gap-2 rounded-xl border border-[#e6dfcf] bg-white px-3 py-2 text-sm">
                        <FileText size={14} className="shrink-0 text-[#174c33]" />
                        <a
                          href={att.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 truncate text-[#173c2a] hover:underline"
                          title={att.name}
                        >
                          {att.name}
                        </a>
                        {att.uploadedAt && (
                          <span className="text-[10px] text-[#a59f8c]">{att.uploadedAt}</span>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!confirm(`「${att.name}」を削除しますか？`)) return
                              await deleteStorageObjectByUrl(att.url)
                              setForm(prev => ({
                                ...prev,
                                attachments: (prev.attachments ?? []).filter(a => a.id !== att.id),
                              }))
                            }}
                            className="rounded-lg p-1 text-red-500 hover:bg-red-50"
                            aria-label="削除"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {canEdit && (
                    <div className="mt-3">
                      <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[#d9d1be] bg-white px-3 py-2 text-xs font-medium text-[#174c33] transition hover:bg-[#eef3eb]">
                        <Upload size={12} />
                        {uploading ? 'アップロード中…' : 'PDFを添付（複数可）'}
                        <input
                          type="file"
                          accept="application/pdf"
                          multiple
                          className="hidden"
                          disabled={uploading}
                          onChange={async e => {
                            const files = Array.from(e.target.files ?? [])
                            e.target.value = ''
                            if (files.length === 0) return
                            setUploadError('')
                            setUploading(true)
                            try {
                              const newAttachments: SupplierAttachment[] = []
                              for (const file of files) {
                                if (file.size > 30 * 1024 * 1024) {
                                  throw new Error(`${file.name} は 30MB を超えています`)
                                }
                                const url = await uploadSupplierAttachment(file, supplier.id)
                                newAttachments.push({
                                  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                                  name: file.name,
                                  url,
                                  uploadedAt: new Date().toISOString().slice(0, 10),
                                  size: file.size,
                                })
                              }
                              setForm(prev => ({
                                ...prev,
                                attachments: [...(prev.attachments ?? []), ...newAttachments],
                              }))
                            } catch (err) {
                              setUploadError(err instanceof Error ? err.message : 'アップロードに失敗しました')
                            } finally {
                              setUploading(false)
                            }
                          }}
                        />
                      </label>
                      {uploadError && <p className="mt-2 text-xs text-red-600">{uploadError}</p>}
                      <p className="mt-1 text-[10px] text-[#a59f8c]">アップロード後は「保存」を押して確定してください。1ファイル最大 30MB。</p>
                    </div>
                  )}
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
                    {saving ? '保存中…' : '仕入先情報を保存'}
                  </button>
                </div>
              )}
            </section>

            <section className="border-t border-[#ece8db] pt-5">
              <h3 className="mb-3 text-sm font-semibold text-[#173c2a]">過去の発注 ({orders.length}件)</h3>
              {orders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[#d9d1be] py-6 text-center text-sm text-[#68756c]">
                  発注履歴はまだありません。
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-[#ece8db]">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[#faf8f1] text-left text-[11px] uppercase tracking-wider text-[#68756c]">
                      <tr>
                        <th className="px-3 py-2 font-medium">発注日</th>
                        <th className="px-3 py-2 font-medium">商品</th>
                        <th className="px-3 py-2 font-medium text-right">数量</th>
                        <th className="px-3 py-2 font-medium text-right">単価</th>
                        <th className="px-3 py-2 font-medium text-right">小計</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.flatMap(order => order.items.map((item, idx) => (
                        <tr key={`${order.id}-${idx}`} className="border-t border-[#ece8db] text-[#173c2a]">
                          <td className="px-3 py-2 text-[#68756c]">{idx === 0 ? order.orderDate : ''}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{item.productName}</div>
                            <div className="text-[11px] text-[#68756c]">{item.productSku}</div>
                          </td>
                          <td className="px-3 py-2 text-right">{item.quantityKg.toFixed(1)} kg</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatCurrency(item.lineTotal)}</td>
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
