'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { SalesStatusBadge } from '@/components/ui/StatusBadge'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type { Buyer, MasterEntry, ProductWithInventory, SaleRecord, SaleRecordInput } from '@/types'
import { ArrowLeft, FileText, Trash2 } from 'lucide-react'
import { computeSaleTaxIncluded } from '@/lib/cashflow'
import { optionsForType } from '@/lib/masters'
import { formatCurrency, formatKg } from '@/lib/format'
import {
  buildSaleForm,
  computeSaleDerived,
  validateSaleForm,
  PaymentBadge,
  ShippingBadge,
  SaleBasicSection,
  SaleItemsSection,
  SaleFeesSection,
  SaleTermsSection,
  SaleChargesSection,
  SalePaymentSection,
  SaleShippingSection,
  SaleSummarySection,
} from '@/components/sales/SaleFormSections'

type Tab = 'overview' | 'items' | 'payment' | 'shipping' | 'documents'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '概要' },
  { key: 'items', label: '商品・金額' },
  { key: 'payment', label: '請求・入金' },
  { key: 'shipping', label: '発送' },
  { key: 'documents', label: '帳票' },
]

export default function SaleDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const canEdit = user?.role === 'admin'

  const [record, setRecord] = useState<SaleRecord | null>(null)
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [masters, setMasters] = useState<MasterEntry[]>([])
  const [form, setForm] = useState<SaleRecordInput | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploadingSlip, setUploadingSlip] = useState(false)
  const [slipError, setSlipError] = useState('')

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      const services = await getServices()
      const [sales, nextBuyers, nextProducts, nextMasters] = await Promise.all([
        services.sales.getSaleRecords(),
        services.sales.getBuyers(),
        services.inventory.getProductsWithInventory(),
        services.masters.listMasters(),
      ])
      if (!active) return
      const found = sales.find(s => s.id === params.id) ?? null
      setRecord(found)
      setBuyers(nextBuyers)
      setProducts(nextProducts)
      setMasters(nextMasters)
      if (found) setForm(buildSaleForm(found, nextProducts))
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [params.id])

  const reload = async () => {
    const services = await getServices()
    const sales = await services.sales.getSaleRecords()
    const found = sales.find(s => s.id === params.id) ?? null
    setRecord(found)
    if (found) setForm(buildSaleForm(found, products))
  }

  const handleSave = async () => {
    if (!form || !record) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      validateSaleForm(form)
      const services = await getServices()
      await services.sales.updateSaleRecord(record.id, form)
      await reload()
      setMessage('保存しました')
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!record) return
    if (!confirm(`販売案件「${record.buyerName}」を削除しますか？`)) return
    const services = await getServices()
    await services.sales.deleteSaleRecord(record.id)
    router.push('/sales')
  }

  const handleUploadSlip = async (file: File) => {
    if (!record) return
    setSlipError('')
    if (file.size > 30 * 1024 * 1024) { setSlipError('30MBを超えるファイルはアップロードできません'); return }
    setUploadingSlip(true)
    try {
      const { uploadShippingSlip } = await import('@/lib/firebase/storage')
      const url = await uploadShippingSlip(file, record.id)
      if (!url) throw new Error('アップロードURLの取得に失敗しました')
      const services = await getServices()
      const updated = await services.sales.updateShippingSlip(record.id, { name: file.name, url, uploadedAt: new Date().toISOString().slice(0, 10), size: file.size })
      setRecord(updated)
    } catch (err) {
      setSlipError(err instanceof Error ? err.message : 'アップロードに失敗しました')
    } finally {
      setUploadingSlip(false)
    }
  }

  const handleRemoveSlip = async () => {
    if (!record?.shippingSlip) return
    if (!confirm('発送伝票を削除しますか？')) return
    setUploadingSlip(true)
    setSlipError('')
    try {
      const { deleteStorageObjectByUrl } = await import('@/lib/firebase/storage')
      if (record.shippingSlip.url) await deleteStorageObjectByUrl(record.shippingSlip.url)
      const services = await getServices()
      const updated = await services.sales.updateShippingSlip(record.id, null)
      setRecord(updated)
    } catch (err) {
      setSlipError(err instanceof Error ? err.message : '削除に失敗しました')
    } finally {
      setUploadingSlip(false)
    }
  }

  const handleDeleteDocument = async (docId: string) => {
    if (!record) return
    if (!confirm('この発行履歴（PDF）を削除しますか？')) return
    const services = await getServices()
    const next = await services.sales.deleteSaleDocument(record.id, docId)
    setRecord({ ...record, issuedDocuments: next })
  }

  if (loading) {
    return (
      <AppLayout>
        <div className="py-20 text-center text-sm text-[#68756c]">読み込み中…</div>
      </AppLayout>
    )
  }

  if (!record || !form) {
    return (
      <AppLayout>
        <div className="space-y-4 py-20 text-center">
          <p className="text-sm text-[#68756c]">販売案件が見つかりませんでした。</p>
          <Link href="/sales" className="inline-flex items-center gap-2 text-sm font-medium text-[#174c33] hover:underline">
            <ArrowLeft size={14} /> 販売管理へ戻る
          </Link>
        </div>
      </AppLayout>
    )
  }

  const derived = computeSaleDerived(form, products, record)
  const taxIncl = computeSaleTaxIncluded(record)
  const buyerShippingAddress = buyers.find(b => b.name === record.buyerName)?.shippingAddress ?? ''
  const setFormTyped = setForm as React.Dispatch<React.SetStateAction<SaleRecordInput>>

  return (
    <AppLayout>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col gap-3">
          <Link href="/sales" className="inline-flex w-fit items-center gap-1.5 text-sm text-[#68756c] hover:text-[#173c2a]">
            <ArrowLeft size={14} /> 販売管理
          </Link>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <SalesStatusBadge status={record.status} />
              <PaymentBadge status={record.paymentStatus} />
              <ShippingBadge status={record.shippingStatus} />
              <h1 className="text-2xl font-bold text-[#173c2a]">{record.buyerName}</h1>
            </div>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                >
                  <Trash2 size={14} /> 削除
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#174c33] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#123723] disabled:bg-[#4f7c65]"
                >
                  {saving ? '保存中…' : '保存'}
                </button>
              </div>
            )}
          </div>
        </div>

        {message && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto border-b border-[#e6dfcf]">
          {TABS.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`-mb-px shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                tab === t.key ? 'border-[#174c33] text-[#174c33]' : 'border-transparent text-[#68756c] hover:text-[#173c2a]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <OverviewCard label="販売先" value={record.buyerName} />
              <OverviewCard label="国" value={record.country || '-'} />
              <OverviewCard label="納期" value={record.dueDate || '-'} />
              <OverviewCard label="取引条件" value={record.terms || '-'} />
              <OverviewCard label="請求額（税込）" value={formatCurrency(taxIncl)} strong />
              <OverviewCard label="請求額（税抜）" value={formatCurrency(record.invoiceAmount || record.revenue)} />
              <OverviewCard label="原価" value={formatCurrency(record.costAmount)} />
              <OverviewCard label="粗利" value={<span className={record.grossProfit >= 0 ? 'text-emerald-700' : 'text-red-700'}>{formatCurrency(record.grossProfit)}</span>} strong />
              <OverviewCard label="作成日" value={record.createdAt.toLocaleDateString('ja-JP')} />
            </div>
            <div className="overflow-hidden rounded-2xl border border-[#e6dfcf] bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-[#faf8f1] text-left text-[11px] uppercase tracking-wider text-[#68756c]">
                  <tr>
                    <th className="px-4 py-2 font-medium">商品</th>
                    <th className="px-4 py-2 font-medium">SKU</th>
                    <th className="px-4 py-2 font-medium text-right">数量</th>
                    <th className="px-4 py-2 font-medium text-right">単価</th>
                    <th className="px-4 py-2 font-medium text-right">小計</th>
                  </tr>
                </thead>
                <tbody>
                  {record.items.map((item, i) => (
                    <tr key={i} className="border-t border-[#f0ebdf] text-[#173c2a]">
                      <td className="px-4 py-2">{item.productName}</td>
                      <td className="px-4 py-2 text-[#68756c]">{item.productSku}</td>
                      <td className="px-4 py-2 text-right">{formatKg(item.quantityKg)}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                      <td className="px-4 py-2 text-right font-medium">{formatCurrency(item.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {((record.shippingFee || 0) > 0 || (record.fees ?? []).length > 0) && (
              <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4 text-sm text-[#173c2a]">
                {(record.shippingFee || 0) > 0 && <span className="mr-3">送料 {formatCurrency(record.shippingFee)}</span>}
                {(record.fees ?? []).map((f, i) => (
                  <span key={i} className="mr-3">{f.name || '諸費用'} {formatCurrency((Number(f.quantity) || 0) * (Number(f.unitPrice) || 0))}（{f.taxRate === 0 ? '免税' : `${f.taxRate}%`}）</span>
                ))}
              </div>
            )}
            {record.notes && (
              <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4">
                <p className="text-[11px] uppercase tracking-wider text-[#68756c]">メモ</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-[#173c2a]">{record.notes}</p>
              </div>
            )}
          </div>
        )}

        {tab === 'items' && (
          <fieldset disabled={!canEdit} className="space-y-5">
            <SaleBasicSection form={form} setForm={setFormTyped} buyers={buyers} />
            <SaleItemsSection form={form} setForm={setFormTyped} products={products} initial={record} />
            <SaleFeesSection form={form} setForm={setFormTyped} />
            <SaleTermsSection form={form} setForm={setFormTyped} masters={masters} />
            <SaleChargesSection form={form} setForm={setFormTyped} derived={derived} readOnly />
            <SaleSummarySection derived={derived} />
          </fieldset>
        )}

        {tab === 'payment' && (
          <fieldset disabled={!canEdit} className="space-y-4">
            <SalePaymentSection form={form} setForm={setFormTyped} />
            <div className="grid gap-3 rounded-2xl border border-[#d9d1be] bg-[#f7f5ee] p-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-[#68756c]">請求額（税抜）</p>
                <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(record.invoiceAmount || record.revenue)}</p>
              </div>
              <div>
                <p className="text-xs text-[#68756c]">請求額（税込）</p>
                <p className="mt-1 text-lg font-semibold text-[#173c2a]">{formatCurrency(taxIncl)}</p>
              </div>
            </div>
            <p className="text-xs text-[#68756c]">※ 変更したら上部の「保存」を押してください。入金管理（/receivables）の一覧にも反映されます。</p>
          </fieldset>
        )}

        {tab === 'shipping' && (
          <div className="space-y-4">
            <fieldset disabled={!canEdit} className="space-y-4">
              <SaleShippingSection form={form} setForm={setFormTyped} buyerShippingAddress={buyerShippingAddress} shippingMethods={optionsForType(masters, 'shipping_method')} />
              <p className="text-xs text-[#68756c]">※ 変更したら上部の「保存」を押してください。発送管理（/shipping）の一覧にも反映されます。</p>
            </fieldset>

            {/* 発送伝票 */}
            <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[#68756c]">発送伝票（送り状など）</p>
              {record.shippingSlip ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#e6dfcf] bg-[#faf8f1] px-3 py-2 text-sm">
                  <FileText size={15} className="text-[#174c33]" />
                  <a href={record.shippingSlip.url} target="_blank" rel="noopener noreferrer" className="flex-1 truncate text-[#173c2a] hover:underline">{record.shippingSlip.name}</a>
                  {record.shippingSlip.uploadedAt && <span className="text-[10px] text-[#a59f8c]">{record.shippingSlip.uploadedAt}</span>}
                  {canEdit && (
                    <button type="button" onClick={handleRemoveSlip} disabled={uploadingSlip} className="rounded-lg p-1.5 text-red-500 hover:bg-red-50" aria-label="削除"><Trash2 size={14} /></button>
                  )}
                </div>
              ) : canEdit ? (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[#d9d1be] bg-white px-4 py-3 text-sm font-medium text-[#174c33] transition hover:bg-[#eef3eb]">
                  <FileText size={14} />
                  {uploadingSlip ? 'アップロード中…' : '発送伝票をアップロード（PDF / 画像）'}
                  <input type="file" accept="application/pdf,image/*" className="hidden" disabled={uploadingSlip}
                    onChange={async e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) await handleUploadSlip(f) }} />
                </label>
              ) : (
                <span className="text-sm text-[#a59f8c]">未添付</span>
              )}
              {slipError && <p className="mt-2 text-xs text-red-600">{slipError}</p>}
            </div>
          </div>
        )}

        {tab === 'documents' && (
          <div className="space-y-4 rounded-2xl border border-[#ece5d7] bg-[#faf8f2] p-5">
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[#68756c]">日本語</p>
              <div className="flex flex-wrap gap-2">
                <DocLink href={`/sales/${record.id}/document?type=invoice&lang=ja`} primary>請求書を発行</DocLink>
                <DocLink href={`/sales/${record.id}/document?type=delivery&lang=ja`}>納品書を発行</DocLink>
                <DocLink href={`/sales/${record.id}/document?type=quotation&lang=ja`}>見積書を発行</DocLink>
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[#68756c]">English</p>
              <div className="flex flex-wrap gap-2">
                <DocLink href={`/sales/${record.id}/document?type=invoice&lang=en`} primary>Issue Invoice</DocLink>
                <DocLink href={`/sales/${record.id}/document?type=delivery&lang=en`}>Issue Delivery Note</DocLink>
                <DocLink href={`/sales/${record.id}/document?type=quotation&lang=en`}>Issue Quotation</DocLink>
              </div>
            </div>
            <p className="text-xs text-[#68756c]">帳票は販売案件の内容から自動生成されます。各「発行」ボタンを押すと帳票画面が開き、「PDFを発行」で保存すると下の発行履歴に記録されます。</p>

            <div className="border-t border-[#ece5d7] pt-4">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-[#68756c]">発行履歴</p>
              {(record.issuedDocuments ?? []).length === 0 ? (
                <p className="text-xs text-[#9aa39a]">まだ発行されたPDFはありません。</p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-[#ece8db] bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-[#faf8f1] text-left text-[11px] uppercase tracking-wider text-[#68756c]">
                      <tr>
                        <th className="px-3 py-2 font-medium">種類</th>
                        <th className="px-3 py-2 font-medium">言語</th>
                        <th className="px-3 py-2 font-medium">発行日時</th>
                        <th className="px-3 py-2 font-medium text-right">金額(税込)</th>
                        <th className="px-3 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...(record.issuedDocuments ?? [])].sort((a, b) => b.issuedAt.localeCompare(a.issuedAt)).map(d => (
                        <tr key={d.id} className="border-t border-[#f0ebdf] text-[#173c2a]">
                          <td className="px-3 py-2">{DOC_TYPE_LABELS[d.type]}</td>
                          <td className="px-3 py-2 text-[#68756c]">{d.language === 'en' ? 'English' : '日本語'}</td>
                          <td className="px-3 py-2 text-[#68756c]">{d.issuedAt ? new Date(d.issuedAt).toLocaleString('ja-JP') : '-'}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(d.total)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center justify-end gap-2">
                              <a href={d.url} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-[#f7f5ee] px-2 py-1 text-[11px] text-[#174c33] hover:bg-[#eef3eb]">開く</a>
                              {canEdit && (
                                <button type="button" onClick={() => handleDeleteDocument(d.id)} className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="削除">
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

const DOC_TYPE_LABELS: Record<'invoice' | 'delivery' | 'quotation', string> = {
  invoice: '請求書',
  delivery: '納品書',
  quotation: '見積書',
}

function OverviewCard({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="rounded-2xl border border-[#e6dfcf] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-[#68756c]">{label}</p>
      <div className={`mt-1.5 ${strong ? 'text-lg font-semibold text-[#173c2a]' : 'text-sm text-[#173c2a]'}`}>{value}</div>
    </div>
  )
}

function DocLink({ href, primary, children }: { href: string; primary?: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium transition ${
        primary
          ? 'bg-[#174c33] text-white shadow hover:bg-[#205f43]'
          : 'border border-[#174c33] bg-white text-[#174c33] hover:bg-[#ece8db]'
      }`}
    >
      <FileText size={14} /> {children}
    </a>
  )
}
