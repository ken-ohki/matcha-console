'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Printer, Trash2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type { Buyer, SaleRecord } from '@/types'
import type { IssuerInfo } from '@/lib/services'
import {
  computeTotals,
  createBlankLine,
  DEFAULT_EN_PAYMENT_TERMS,
  DOCUMENT_LABELS,
  formatYen,
  ISSUER,
  TERMS_AND_CONDITIONS_EN,
  todayString,
  type DocumentData,
  type DocumentLanguage,
  type DocumentLine,
  type DocumentType,
} from '@/lib/invoice'

function parseType(value: string | null): DocumentType {
  if (value === 'invoice' || value === 'delivery' || value === 'quotation') return value
  return 'invoice'
}

function parseLang(value: string | null): DocumentLanguage {
  return value === 'en' ? 'en' : 'ja'
}

const EN_LABELS = {
  invoice: { title: 'INVOICE', intro: 'We are pleased to invoice you for the items below.', amountLabel: 'Total Amount' },
  delivery: { title: 'DELIVERY NOTE', intro: 'We confirm delivery of the items below.', amountLabel: 'Total Amount' },
  quotation: { title: 'QUOTATION', intro: 'We are pleased to quote you for the items below.', amountLabel: 'Quoted Amount' },
} as const

const EN_META_LABELS = {
  project: 'Project',
  validUntil: 'Valid Until',
  terms: 'Terms',
  deliveryDate: 'Delivery Date',
  deliveryPlace: 'Delivery Place',
  paymentDueDate: 'Payment Due',
  paymentDestination: 'Bank Information',
  paymentTerms: 'Terms & Conditions',
  issueDate: 'Issue Date',
  description: 'Description',
  qty: 'Qty',
  unit: 'Unit',
  unitPrice: 'Unit Price',
  amount: 'Amount',
  subtotal: 'Subtotal',
  tax: 'Tax',
  taxExempt: 'Tax exempt (export)',
  notes: 'Notes',
  taxNote: '* Reduced-rate item',
} as const

function buildInitialDocument(type: DocumentType, language: DocumentLanguage, sale: SaleRecord, buyer: Buyer | undefined, overrideBankInfo?: string): DocumentData {
  const isJa = language === 'ja'
  const projectLabel = (() => {
    const d = sale.createdAt
    if (isJa) return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日発注分`
    const m = d.toLocaleString('en-US', { month: 'short' })
    return `Order placed on ${m} ${d.getDate()}, ${d.getFullYear()}`
  })()
  const shippingLine = createBlankLine({
    description: isJa ? '送料' : 'Shipping',
    isReducedRate: false,
    quantity: 1,
    unit: isJa ? '式' : 'lot',
    unitPrice: sale.shippingFee || 0,
  })
  const otherFeesLine = (sale.otherFees || 0) > 0
    ? createBlankLine({
        description: sale.otherFeesNote
          ? (isJa ? `諸費用（${sale.otherFeesNote}）` : `Other fees (${sale.otherFeesNote})`)
          : (isJa ? '諸費用' : 'Other fees'),
        isReducedRate: false,
        quantity: 1,
        unit: isJa ? '式' : 'lot',
        unitPrice: sale.otherFees || 0,
      })
    : null
  const lines: DocumentLine[] = [
    ...sale.items.map(item => createBlankLine({
      description: item.productName + (item.productSku ? ` (${item.productSku})` : ''),
      isReducedRate: isJa,
      quantity: item.quantityKg,
      unit: 'kg',
      unitPrice: item.unitPrice,
    })),
    shippingLine,
    ...(otherFeesLine ? [otherFeesLine] : []),
  ]

  return {
    type,
    language,
    recipientName: sale.buyerName,
    recipientHonorific: isJa ? '御中' : '',
    recipientAddress: buyer?.shippingAddress ?? '',
    recipientPostalCode: buyer?.shippingPostalCode ?? '',
    issueDate: todayString(),
    projectName: projectLabel,
    taxExempt: !isJa, // English version defaults to tax-exempt (export)
    validUntil: isJa ? '発行日より2ヶ月間' : 'Valid for 2 months from issue date',
    terms: sale.terms ?? '',
    deliveryDate: sale.dueDate ?? '',
    deliveryPlace: buyer?.shippingAddress ?? '',
    paymentDueDate: isJa ? '発行日より2ヶ月' : 'Due upon receipt',
    paymentDestination: (overrideBankInfo && overrideBankInfo.trim()) || (isJa ? ISSUER.bankInfo : ISSUER.bankInfoEn),
    paymentTerms: isJa ? '' : DEFAULT_EN_PAYMENT_TERMS,
    lines,
    notes:
      type === 'invoice'
        ? (isJa ? '・振込手数料は御社ご負担にてお願いいたします。' : 'Please note that any bank transfer fees are to be borne by the Buyer.')
        : '',
  }
}

export default function DocumentPage() {
  const params = useParams<{ id: string }>()
  const search = useSearchParams()
  const router = useRouter()
  const type = parseType(search.get('type'))
  const language = parseLang(search.get('lang'))
  const labels = language === 'en' ? EN_LABELS[type] : DOCUMENT_LABELS[type]
  const isJa = language === 'ja'
  const [sale, setSale] = useState<SaleRecord | null>(null)
  const [buyer, setBuyer] = useState<Buyer | undefined>(undefined)
  const [doc, setDoc] = useState<DocumentData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [includeTerms, setIncludeTerms] = useState(true)
  const [terms, setTerms] = useState<{ heading: string; body: string }[]>([])
  const [issuer, setIssuer] = useState<IssuerInfo>(ISSUER)
  const { user } = useAuth()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const services = await getServices()
        const [sales, buyers, storedTerms, bankAccounts, storedIssuer] = await Promise.all([
          services.sales.getSaleRecords(),
          services.sales.getBuyers(),
          services.settings.getDocumentTermsEn(),
          services.settings.getBankAccounts(),
          services.settings.getIssuer(),
        ])
        setTerms(storedTerms.length > 0 ? storedTerms : TERMS_AND_CONDITIONS_EN.map(s => ({ heading: s.heading, body: s.body })))
        setIssuer(storedIssuer)
        if (cancelled) return
        if (cancelled) return
        const target = sales.find(s => s.id === params.id)
        if (!target) {
          setError('販売案件が見つかりません')
          return
        }
        const matchedBuyer = buyers.find(b => b.name === target.buyerName)
        const overrideBank = language === 'ja' ? bankAccounts.ja : bankAccounts.en
        setSale(target)
        setBuyer(matchedBuyer)
        setDoc(buildInitialDocument(type, language, target, matchedBuyer, overrideBank))
      } catch (err) {
        setError(err instanceof Error ? err.message : '読み込みに失敗しました')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [params.id, type, language])

  const totals = useMemo(() => doc ? computeTotals(doc.lines) : null, [doc])

  if (loading) {
    return <div className="min-h-screen bg-[#f4f2ea] p-8 text-center text-sm text-[#68756c]">読み込み中…</div>
  }
  if (error || !sale || !doc || !totals) {
    return (
      <div className="min-h-screen bg-[#f4f2ea] p-8">
        <p className="text-sm text-red-600">{error || 'ドキュメントを生成できません'}</p>
        <button type="button" onClick={() => router.back()} className="mt-4 underline text-sm text-[#174c33]">戻る</button>
      </div>
    )
  }

  const updateField = <K extends keyof DocumentData>(key: K, value: DocumentData[K]) => {
    setDoc(prev => prev ? { ...prev, [key]: value } : prev)
  }
  const updateLine = (id: string, patch: Partial<DocumentLine>) => {
    setDoc(prev => prev ? {
      ...prev,
      lines: prev.lines.map(l => l.id === id ? { ...l, ...patch } : l),
    } : prev)
  }
  const addLine = () => {
    setDoc(prev => prev ? { ...prev, lines: [...prev.lines, createBlankLine()] } : prev)
  }
  const removeLine = (id: string) => {
    setDoc(prev => prev ? { ...prev, lines: prev.lines.filter(l => l.id !== id) } : prev)
  }
  const handleTypeChange = (next: DocumentType) => {
    router.replace(`/sales/${params.id}/document?type=${next}&lang=${language}`)
  }
  const handleLangChange = (next: DocumentLanguage) => {
    router.replace(`/sales/${params.id}/document?type=${type}&lang=${next}`)
  }

  return (
    <div className="min-h-screen bg-[#f4f2ea]">
      {/* Toolbar */}
      <div className="no-print sticky top-0 z-20 border-b border-[#d9d1be] bg-white shadow-sm">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/sales" className="inline-flex items-center gap-1 text-sm text-[#68756c] hover:text-[#173c2a]">
            <ArrowLeft size={14} />
            販売管理に戻る
          </Link>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-[#d9d1be] bg-white p-0.5">
              {(['invoice', 'delivery', 'quotation'] as DocumentType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTypeChange(t)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    type === t ? 'bg-[#174c33] text-white' : 'text-[#68756c] hover:text-[#173c2a]'
                  }`}
                >
                  {DOCUMENT_LABELS[t].title.replace(/　/g, '')}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-lg border border-[#d9d1be] bg-white p-0.5">
              <button
                type="button"
                onClick={() => handleLangChange('ja')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  language === 'ja' ? 'bg-[#174c33] text-white' : 'text-[#68756c] hover:text-[#173c2a]'
                }`}
              >
                日本語
              </button>
              <button
                type="button"
                onClick={() => handleLangChange('en')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  language === 'en' ? 'bg-[#174c33] text-white' : 'text-[#68756c] hover:text-[#173c2a]'
                }`}
              >
                English
              </button>
            </div>
            {!isJa && (type === 'invoice' || type === 'quotation') && (
              <label className="inline-flex items-center gap-1 text-xs text-[#68756c]">
                <input
                  type="checkbox"
                  checked={includeTerms}
                  onChange={e => setIncludeTerms(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                Attach T&C
              </label>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#174c33] px-3 py-2 text-sm font-medium text-white shadow transition hover:bg-[#205f43]"
            >
              <Printer size={14} />
              {isJa ? '印刷 / PDF' : 'Print / PDF'}
            </button>
          </div>
        </div>
      </div>

      {/* Document */}
      <main className="mx-auto max-w-4xl px-4 py-6 print:p-0 print:max-w-none">
        <div className="rounded-lg border border-gray-300 bg-white p-8 shadow-sm print:border-0 print:shadow-none print:rounded-none">
          <h1 className="text-center text-3xl font-semibold tracking-[0.4em] text-[#173c2a]">{labels.title}</h1>

          <div className="mt-8 grid grid-cols-[1fr_auto] gap-8">
            <div>
              <div className="flex items-baseline gap-2 border-b-2 border-[#173c2a] pb-1">
                {!isJa && <span className="text-base text-[#173c2a]">To:</span>}
                <EditableInput
                  className="flex-1 text-xl font-medium text-[#173c2a]"
                  value={doc.recipientName}
                  onChange={v => updateField('recipientName', v)}
                  placeholder={isJa ? 'お客様名' : 'Customer Name'}
                />
                {isJa && (
                  <EditableInput
                    className="w-16 text-base font-medium text-[#173c2a]"
                    value={doc.recipientHonorific}
                    onChange={v => updateField('recipientHonorific', v)}
                  />
                )}
              </div>
              <input
                type="text"
                value={doc.recipientPostalCode}
                onChange={e => updateField('recipientPostalCode', e.target.value)}
                placeholder={isJa ? '〒郵便番号' : 'Postal code'}
                className="mt-2 w-full bg-transparent border-0 outline-none focus:bg-yellow-50 text-xs text-[#68756c]"
              />
              <textarea
                rows={2}
                value={doc.recipientAddress}
                onChange={e => updateField('recipientAddress', e.target.value)}
                placeholder={isJa ? '住所' : 'Address'}
                className="w-full resize-none bg-transparent border-0 outline-none focus:bg-yellow-50 text-xs text-[#68756c]"
              />
              <p className="mt-6 text-sm">{labels.intro}</p>
            </div>
            <div className="text-sm space-y-1">
              <div className="flex gap-2 justify-end">
                <span className="text-[#68756c]">{isJa ? '発行日：' : 'Issue Date:'}</span>
                <EditableInput
                  type="date"
                  className="text-right"
                  value={doc.issueDate}
                  onChange={v => updateField('issueDate', v)}
                />
              </div>
              <div className="mt-3 text-right">
                <p className="font-medium text-[#173c2a]">{isJa ? issuer.company : issuer.companyEn}</p>
                <p className="text-xs text-[#68756c]">{isJa ? issuer.postalCode : ''}</p>
                <p className="text-xs text-[#68756c]">{isJa ? issuer.address : issuer.addressEn}</p>
                <p className="text-xs text-[#68756c]">{isJa ? 'TEL：' : 'TEL: '}{issuer.tel}</p>
                <p className="text-xs text-[#68756c]">{isJa ? 'E-Mail：' : 'Email: '}{issuer.email}</p>
                {isJa && (
                  <p className="text-xs text-[#68756c]">登録番号：{issuer.registrationNumber}</p>
                )}
              </div>
            </div>
          </div>

          {/* Meta rows */}
          <div className="mt-6 grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-sm">
            <MetaRow label={isJa ? '案件' : EN_META_LABELS.project} value={doc.projectName} onChange={v => updateField('projectName', v)} />
            {type === 'quotation' && (
              <>
                <MetaRow label={isJa ? '有効期限' : EN_META_LABELS.validUntil} value={doc.validUntil ?? ''} onChange={v => updateField('validUntil', v)} />
                <MetaRow label={isJa ? '条件' : EN_META_LABELS.terms} value={doc.terms ?? ''} onChange={v => updateField('terms', v)} />
              </>
            )}
            {type === 'delivery' && (
              <>
                <MetaRow label={isJa ? '納品日' : EN_META_LABELS.deliveryDate} value={doc.deliveryDate ?? ''} onChange={v => updateField('deliveryDate', v)} type="date" />
                <MetaRow label={isJa ? '納品場所' : EN_META_LABELS.deliveryPlace} value={doc.deliveryPlace ?? ''} onChange={v => updateField('deliveryPlace', v)} multiline />
              </>
            )}
            {type === 'invoice' && (
              <>
                <MetaRow label={isJa ? '支払期限' : EN_META_LABELS.paymentDueDate} value={doc.paymentDueDate ?? ''} onChange={v => updateField('paymentDueDate', v)} />
                <MetaRow label={isJa ? '振込先' : EN_META_LABELS.paymentDestination} value={doc.paymentDestination ?? ''} onChange={v => updateField('paymentDestination', v)} multiline rows={isJa ? 2 : 4} />
                {!isJa && (
                  <MetaRow label={EN_META_LABELS.paymentTerms} value={doc.paymentTerms ?? ''} onChange={v => updateField('paymentTerms', v)} multiline rows={2} />
                )}
              </>
            )}
          </div>

          {/* Total */}
          <div className="mt-6 grid grid-cols-[140px_1fr_80px] items-center gap-2 border-y-2 border-double border-[#173c2a] py-3">
            <span className="text-sm font-medium text-[#173c2a]">{labels.amountLabel}</span>
            <span className="text-right text-3xl font-semibold text-[#173c2a]">
              ¥ {formatYen(doc.taxExempt ? totals.subtotal : totals.total)}
            </span>
            <span className="text-xs text-[#68756c]">{isJa ? '（税込）' : doc.taxExempt ? '(tax exempt)' : '(tax incl.)'}</span>
          </div>

          {/* Lines */}
          <div className="mt-6 overflow-hidden rounded border border-gray-300">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-[#f7f5ee] text-[#173c2a]">
                  <th className="border-b border-r border-gray-300 px-2 py-2 text-left">{isJa ? '明細' : EN_META_LABELS.description}</th>
                  {!doc.taxExempt && (
                    <th className="w-16 border-b border-r border-gray-300 px-2 py-2 text-center">{isJa ? '8%対象' : '8% rate'}</th>
                  )}
                  <th className="w-16 border-b border-r border-gray-300 px-2 py-2 text-right">{isJa ? '数量' : EN_META_LABELS.qty}</th>
                  <th className="w-14 border-b border-r border-gray-300 px-2 py-2 text-center">{isJa ? '単位' : EN_META_LABELS.unit}</th>
                  <th className="w-24 border-b border-r border-gray-300 px-2 py-2 text-right">{isJa ? '単価' : EN_META_LABELS.unitPrice}</th>
                  <th className="w-28 border-b border-gray-300 px-2 py-2 text-right">{isJa ? '金額' : EN_META_LABELS.amount}</th>
                  <th className="w-8 border-b border-gray-300 px-1 py-2 no-print"></th>
                </tr>
              </thead>
              <tbody>
                {doc.lines.map(line => {
                  const amount = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0)
                  return (
                    <tr key={line.id}>
                      <td className="border-r border-b border-gray-200 px-2 py-1">
                        <EditableInput value={line.description} onChange={v => updateLine(line.id, { description: v })} className="w-full" />
                      </td>
                      {!doc.taxExempt && (
                        <td className="border-r border-b border-gray-200 px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={line.isReducedRate}
                            onChange={e => updateLine(line.id, { isReducedRate: e.target.checked })}
                            className="h-4 w-4"
                          />
                        </td>
                      )}
                      <td className="border-r border-b border-gray-200 px-2 py-1">
                        <EditableInput
                          type="number"
                          value={String(line.quantity)}
                          onChange={v => updateLine(line.id, { quantity: Number(v) || 0 })}
                          className="w-full text-right"
                        />
                      </td>
                      <td className="border-r border-b border-gray-200 px-2 py-1">
                        <EditableInput value={line.unit} onChange={v => updateLine(line.id, { unit: v })} className="w-full text-center" />
                      </td>
                      <td className="border-r border-b border-gray-200 px-2 py-1">
                        <EditableInput
                          type="number"
                          value={String(line.unitPrice)}
                          onChange={v => updateLine(line.id, { unitPrice: Number(v) || 0 })}
                          className="w-full text-right"
                        />
                      </td>
                      <td className="border-b border-gray-200 px-2 py-1 text-right">¥{formatYen(amount)}</td>
                      <td className="border-b border-gray-200 px-1 py-1 no-print">
                        <button
                          type="button"
                          onClick={() => removeLine(line.id)}
                          aria-label="行を削除"
                          className="rounded p-1 text-red-500 hover:bg-red-50"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="border-t border-gray-300 bg-[#faf8f1] px-2 py-2 no-print">
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-[#174c33] hover:bg-[#ece8db]"
              >
                <Plus size={12} />
                行を追加
              </button>
            </div>
          </div>

          {/* Tax exempt toggle (for EN; visible in admin UI but hidden on print) */}
          <div className="mt-2 flex items-center gap-2 text-xs no-print">
            <label className="inline-flex items-center gap-1 text-[#68756c]">
              <input
                type="checkbox"
                checked={doc.taxExempt}
                onChange={e => updateField('taxExempt', e.target.checked)}
                className="h-3.5 w-3.5"
              />
              {isJa ? '税額表示なし（輸出など）' : EN_META_LABELS.taxExempt}
            </label>
          </div>

          {/* Tax summary */}
          {!doc.taxExempt && (
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-6 text-sm">
              <p className="text-xs text-[#68756c]">{isJa ? '*軽減税率対象商品' : EN_META_LABELS.taxNote}</p>
              <table className="text-sm">
                <tbody>
                  <tr>
                    <td className="px-2 text-[#68756c]">{isJa ? '10%対象' : '10% rate'}</td>
                    <td className="px-2 text-right">{isJa ? '対象額（税抜）' : 'Pre-tax'}</td>
                    <td className="px-2 text-right font-medium">¥{formatYen(totals.standardSubtotal)}</td>
                    <td className="px-2 text-[#68756c]">{isJa ? '消費税' : EN_META_LABELS.tax}</td>
                    <td className="px-2 text-right font-medium">¥{formatYen(totals.standardTax)}</td>
                  </tr>
                  <tr>
                    <td className="px-2 text-[#68756c]">{isJa ? '8%対象' : '8% rate'}</td>
                    <td className="px-2 text-right">{isJa ? '対象額（税抜）' : 'Pre-tax'}</td>
                    <td className="px-2 text-right font-medium">¥{formatYen(totals.reducedSubtotal)}</td>
                    <td className="px-2 text-[#68756c]">{isJa ? '消費税' : EN_META_LABELS.tax}</td>
                    <td className="px-2 text-right font-medium">¥{formatYen(totals.reducedTax)}</td>
                  </tr>
                  <tr className="border-t border-gray-300">
                    <td className="px-2 font-medium">{isJa ? '小計' : EN_META_LABELS.subtotal}</td>
                    <td className="px-2 text-right"></td>
                    <td className="px-2 text-right font-semibold">¥{formatYen(totals.subtotal)}</td>
                    <td className="px-2 text-[#68756c]">{isJa ? '消費税' : EN_META_LABELS.tax}</td>
                    <td className="px-2 text-right font-semibold">¥{formatYen(totals.tax)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Notes */}
          <div className="mt-6">
            <p className="mb-1 text-xs font-medium text-[#68756c]">{isJa ? '備考' : EN_META_LABELS.notes}</p>
            <textarea
              rows={3}
              value={doc.notes}
              onChange={e => updateField('notes', e.target.value)}
              className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 print:border-0 print:ring-0"
            />
          </div>

          <p className="mt-10 text-center text-xs text-[#68756c]">{isJa ? '※PDF を原本とする' : '* PDF serves as the official document.'}</p>
        </div>

        {/* English Terms & Conditions (appears as additional pages in print) */}
        {!isJa && (type === 'invoice' || type === 'quotation') && includeTerms && (
          <div className="terms-page mt-6 rounded-lg border border-gray-300 bg-white p-8 shadow-sm print:border-0 print:shadow-none print:rounded-none print:mt-0">
            <h2 className="text-center text-2xl font-semibold tracking-[0.2em] text-[#173c2a]">TERMS &amp; CONDITIONS OF SALE</h2>
            <p className="mt-2 text-center text-xs text-[#68756c]">{issuer.companyEn}　·　{issuer.addressEn}</p>

            <div className="mt-8 space-y-4 text-sm leading-relaxed text-[#1f2a23]">
              {terms.map((section, i) => (
                <div key={i}>
                  <h3 className="font-semibold text-[#173c2a]">{section.heading}</h3>
                  <p className="mt-1 whitespace-pre-wrap">{section.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
              <div>
                <p className="text-[#68756c]">Seller</p>
                <p className="mt-1 font-medium text-[#173c2a]">{issuer.companyEn}</p>
                <p className="text-xs text-[#68756c]">{issuer.addressEn}</p>
              </div>
              <div>
                <p className="text-[#68756c]">{type === 'quotation' ? 'Buyer (acknowledged upon order)' : 'Buyer (acknowledged by payment)'}</p>
                <p className="mt-1 font-medium text-[#173c2a]">{doc.recipientName}</p>
              </div>
            </div>

            <p className="mt-12 text-center text-xs text-[#68756c]">
              {type === 'quotation'
                ? 'By placing an order based on this quotation, the Buyer acknowledges and agrees to these Terms & Conditions of Sale.'
                : 'By making payment, the Buyer acknowledges and agrees to these Terms & Conditions of Sale.'}
            </p>
          </div>
        )}

        {user?.role !== 'admin' && (
          <p className="mt-3 text-center text-xs text-[#68756c] no-print">※ 編集内容は保存されません。印刷時のみ反映されます。</p>
        )}
      </main>

      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 14mm 12mm; }
          html, body {
            background: white !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            color: #000 !important;
          }
          .no-print { display: none !important; }
          .terms-page { page-break-before: always; break-before: page; }
          /* Avoid splitting the document container across pages awkwardly */
          main > div { page-break-inside: avoid; }
          /* Inputs become flat text in print */
          input, textarea, select {
            border: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
            outline: 0 !important;
            -webkit-appearance: none !important;
            appearance: none !important;
            padding: 0 !important;
            resize: none !important;
            color: inherit !important;
          }
          input:focus, textarea:focus { background: transparent !important; }
          /* Remove background hover/focus tints */
          .bg-yellow-50, .focus\\:bg-yellow-50 { background: transparent !important; }
          /* Hide the row-delete trash buttons cleanly */
          table .no-print { display: none !important; }
          /* Borders should be clear in print */
          .shadow, .shadow-sm, .shadow-2xl { box-shadow: none !important; }
          /* Tables: avoid orphan rows */
          tr, td, th { page-break-inside: avoid !important; }
          thead { display: table-header-group; }
          tfoot { display: table-footer-group; }
        }
        input[type="date"] { color-scheme: light; }
      `}</style>
    </div>
  )
}

function EditableInput({
  value,
  onChange,
  type,
  className = '',
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  type?: string
  className?: string
  placeholder?: string
}) {
  return (
    <input
      type={type ?? 'text'}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`bg-transparent border-0 outline-none focus:bg-yellow-50 focus:ring-0 ${className}`}
    />
  )
}

function MetaRow({
  label,
  value,
  onChange,
  multiline,
  type,
  rows = 2,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  type?: string
  rows?: number
}) {
  return (
    <>
      <div className="flex items-center justify-center bg-[#f7f5ee] px-2 py-1 text-center text-xs font-medium text-[#173c2a]">{label}</div>
      <div className="border-b border-gray-200 px-2 py-1">
        {multiline ? (
          <textarea
            rows={rows}
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full resize-none bg-transparent border-0 outline-none focus:bg-yellow-50 text-sm"
          />
        ) : (
          <input
            type={type ?? 'text'}
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full bg-transparent border-0 outline-none focus:bg-yellow-50 text-sm"
          />
        )}
      </div>
    </>
  )
}
