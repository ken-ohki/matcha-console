'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, FileDown, Printer, X } from 'lucide-react'
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
  const feeLines: DocumentLine[] = (sale.fees ?? [])
    .filter(f => f.name || (Number(f.quantity) || 0) * (Number(f.unitPrice) || 0) !== 0)
    .map(f => createBlankLine({
      description: f.name || (isJa ? '諸費用' : 'Other fee'),
      isReducedRate: f.taxRate === 8,
      taxExempt: f.taxRate === 0,
      quantity: Number(f.quantity) || 0,
      unit: f.unit || (isJa ? '式' : 'lot'),
      unitPrice: f.unitPrice,
    }))
  const lines: DocumentLine[] = [
    ...sale.items.map(item => createBlankLine({
      description: item.productName + (item.productSku ? ` (${item.productSku})` : ''),
      isReducedRate: (item.taxRate ?? 8) === 8,
      taxExempt: (item.taxRate ?? 8) === 0,
      quantity: item.quantityKg,
      unit: 'kg',
      unitPrice: item.unitPrice,
    })),
    shippingLine,
    ...feeLines,
  ]

  return {
    type,
    language,
    // 請求用の名前があれば優先（請求書・見積書には正式名称を表示）。
    recipientName: buyer?.billingName?.trim() || sale.buyerName,
    recipientHonorific: isJa ? '御中' : '',
    recipientAddress: sale.shippingAddress?.trim() || buyer?.shippingAddress || '',
    recipientPostalCode: sale.shippingPostalCode?.trim() || buyer?.shippingPostalCode || '',
    issueDate: todayString(),
    projectName: projectLabel,
    // 輸出 default follows the data, not the language: a sale whose lines are
    // all 免税 is an export; otherwise tax applies (English domestic included).
    taxExempt: sale.items.length > 0 && sale.items.every(item => (item.taxRate ?? 8) === 0),
    validUntil: isJa ? '発行日より2ヶ月間' : 'Valid for 2 months from issue date',
    terms: sale.terms ?? '',
    deliveryDate: sale.dueDate ?? '',
    deliveryPlace: buyer?.shippingAddress ?? '',
    paymentDueDate: isJa ? '発行日より2ヶ月' : 'Due upon receipt',
    paymentDestination: (overrideBankInfo && overrideBankInfo.trim()) || (isJa ? ISSUER.bankInfo : ISSUER.bankInfoEn),
    paymentTerms: isJa ? '' : DEFAULT_EN_PAYMENT_TERMS,
    lines,
    notes: sale.notes?.trim()
      || (type === 'invoice'
        ? (isJa ? '・振込手数料は御社ご負担にてお願いいたします。' : 'Please note that any bank transfer fees are to be borne by the Buyer.')
        : ''),
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

  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)
  const [generating, setGenerating] = useState(false)
  const [savingPdf, setSavingPdf] = useState(false)
  const [pdfSaved, setPdfSaved] = useState(false)
  const [pdfError, setPdfError] = useState('')

  const handleGeneratePdf = async () => {
    if (!doc || !totals) return
    setGenerating(true)
    setPdfError('')
    setPdfSaved(false)
    try {
      const [{ pdf }, { SaleDocumentPdf }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('@/components/sales/SaleDocumentPdf'),
      ])
      const blob = await pdf(
        <SaleDocumentPdf doc={doc} totals={totals} issuer={issuer} isJa={isJa} labels={labels} type={type} includeTerms={includeTerms} terms={terms} />,
      ).toBlob()
      setPdfBlob(blob)
      setPdfUrl(prev => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'PDFの生成に失敗しました')
    } finally {
      setGenerating(false)
    }
  }

  const closePdfPreview = () => {
    setPdfUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null })
    setPdfBlob(null)
    setPdfSaved(false)
    setPdfError('')
  }

  const documentBaseName = `${type}_${language}_${doc?.issueDate ?? ''}.pdf`

  const handleSavePdf = async () => {
    if (!pdfBlob || !sale || !doc || !totals) return
    setSavingPdf(true)
    setPdfError('')
    try {
      const { uploadSaleDocumentPdf } = await import('@/lib/firebase/storage')
      const url = await uploadSaleDocumentPdf(pdfBlob, sale.id, documentBaseName)
      const issued = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        language,
        issuedAt: new Date().toISOString(),
        total: doc.taxExempt ? totals.subtotal : totals.total,
        name: `${labels.title.replace(/　/g, '')}（${isJa ? '日本語' : 'English'}）`,
        url,
      }
      const services = await getServices()
      await services.sales.recordSaleDocument(sale.id, issued)
      setPdfSaved(true)
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSavingPdf(false)
    }
  }

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
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#174c33] bg-white px-3 py-2 text-sm font-medium text-[#174c33] transition hover:bg-[#ece8db]"
            >
              <Printer size={14} />
              {isJa ? '印刷' : 'Print'}
            </button>
            <button
              type="button"
              onClick={handleGeneratePdf}
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#174c33] px-3 py-2 text-sm font-medium text-white shadow transition hover:bg-[#205f43] disabled:opacity-60"
            >
              <FileDown size={14} />
              {generating ? (isJa ? '生成中…' : 'Generating…') : (isJa ? 'PDFを発行' : 'Issue PDF')}
            </button>
          </div>
        </div>
      </div>

      {/* PDF preview modal */}
      {pdfUrl && (
        <div className="no-print fixed inset-0 z-50 flex flex-col bg-black/60">
          <div className="flex flex-wrap items-center gap-2 border-b border-[#d9d1be] bg-white px-4 py-2.5">
            <span className="text-sm font-medium text-[#173c2a]">{isJa ? 'PDFプレビュー' : 'PDF Preview'}</span>
            {pdfSaved && <span className="text-xs font-medium text-emerald-700">{isJa ? '✓ 発行履歴に保存しました' : '✓ Saved to history'}</span>}
            {pdfError && <span className="text-xs text-red-600">{pdfError}</span>}
            <div className="ml-auto flex items-center gap-2">
              <a
                href={pdfUrl}
                download={documentBaseName}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#d9d1be] bg-white px-3 py-1.5 text-xs font-medium text-[#173c2a] hover:bg-[#f7f5ee]"
              >
                {isJa ? 'ダウンロード' : 'Download'}
              </a>
              <button
                type="button"
                onClick={handleSavePdf}
                disabled={savingPdf || pdfSaved}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#174c33] px-3 py-1.5 text-xs font-medium text-white shadow transition hover:bg-[#205f43] disabled:opacity-60"
              >
                {savingPdf ? (isJa ? '保存中…' : 'Saving…') : pdfSaved ? (isJa ? '保存済み' : 'Saved') : (isJa ? '発行（履歴に保存）' : 'Issue (save)')}
              </button>
              <button
                type="button"
                onClick={closePdfPreview}
                className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                aria-label={isJa ? '閉じる' : 'Close'}
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <iframe src={pdfUrl} title="PDF" className="flex-1 bg-white" />
        </div>
      )}

      {/* Document */}
      <main className="mx-auto max-w-4xl px-4 py-6 print:p-0 print:max-w-none">
        <div className="rounded-lg border border-gray-300 bg-white p-8 shadow-sm print:border-0 print:shadow-none print:rounded-none">
          <h1 className="text-center text-3xl font-semibold tracking-[0.4em] text-[#173c2a]">{labels.title}</h1>

          <div className="mt-8 grid grid-cols-[1fr_auto] gap-8">
            <div>
              <div className="flex items-baseline gap-2 border-b-2 border-[#173c2a] pb-1">
                {!isJa && <span className="text-base text-[#173c2a]">To:</span>}
                <span className="flex-1 text-xl font-medium text-[#173c2a]">{doc.recipientName}</span>
                {isJa && doc.recipientHonorific && (
                  <span className="w-16 text-base font-medium text-[#173c2a]">{doc.recipientHonorific}</span>
                )}
              </div>
              {isJa && doc.recipientPostalCode && (
                <p className="mt-2 text-xs text-[#68756c]">{doc.recipientPostalCode}</p>
              )}
              {doc.recipientAddress && (
                <p className="whitespace-pre-wrap text-xs text-[#68756c]">{doc.recipientAddress}</p>
              )}
              <p className="mt-6 text-sm">{labels.intro}</p>
            </div>
            <div className="text-sm space-y-1">
              <div className="flex gap-2 justify-end">
                <span className="text-[#68756c]">{isJa ? '発行日：' : 'Issue Date:'}</span>
                <span className="text-right">{doc.issueDate}</span>
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
            <MetaRow label={isJa ? '案件' : EN_META_LABELS.project} value={doc.projectName} />
            {type === 'quotation' && (
              <>
                <MetaRow label={isJa ? '有効期限' : EN_META_LABELS.validUntil} value={doc.validUntil ?? ''} />
                <MetaRow label={isJa ? '条件' : EN_META_LABELS.terms} value={doc.terms ?? ''} />
              </>
            )}
            {type === 'delivery' && (
              <>
                <MetaRow label={isJa ? '納品日' : EN_META_LABELS.deliveryDate} value={doc.deliveryDate ?? ''} />
                <MetaRow label={isJa ? '納品場所' : EN_META_LABELS.deliveryPlace} value={doc.deliveryPlace ?? ''} multiline />
              </>
            )}
            {type === 'invoice' && (
              <>
                <MetaRow label={isJa ? '支払期限' : EN_META_LABELS.paymentDueDate} value={doc.paymentDueDate ?? ''} />
                <MetaRow label={isJa ? '振込先' : EN_META_LABELS.paymentDestination} value={doc.paymentDestination ?? ''} multiline rows={isJa ? 2 : 4} />
                {!isJa && (
                  <MetaRow label={EN_META_LABELS.paymentTerms} value={doc.paymentTerms ?? ''} multiline rows={2} />
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
                </tr>
              </thead>
              <tbody>
                {doc.lines.map(line => {
                  const amount = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0)
                  return (
                    <tr key={line.id}>
                      <td className="border-r border-b border-gray-200 px-2 py-1">
                        <span className="w-full">{line.description}</span>
                      </td>
                      {!doc.taxExempt && (
                        <td className="border-r border-b border-gray-200 px-2 py-1 text-center">{line.isReducedRate ? '✓' : ''}</td>
                      )}
                      <td className="border-r border-b border-gray-200 px-2 py-1 text-right">{line.quantity}</td>
                      <td className="border-r border-b border-gray-200 px-2 py-1 text-center">{line.unit}</td>
                      <td className="border-r border-b border-gray-200 px-2 py-1 text-right">¥{formatYen(Number(line.unitPrice) || 0)}</td>
                      <td className="border-b border-gray-200 px-2 py-1 text-right">¥{formatYen(amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
          {doc.notes && (
            <div className="mt-6">
              <p className="mb-1 text-xs font-medium text-[#68756c]">{isJa ? '備考' : EN_META_LABELS.notes}</p>
              <p className="whitespace-pre-wrap text-sm">{doc.notes}</p>
            </div>
          )}

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

        <p className="mt-3 text-center text-xs text-[#68756c] no-print">※ この帳票は販売管理の内容から自動生成されます。修正は販売管理画面で行ってください。</p>
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

// Read-only display (documents are auto-generated from the sale; edit the sale
// in 販売管理 to change content).
function MetaRow({
  label,
  value,
  multiline,
}: {
  label: string
  value: string
  multiline?: boolean
  rows?: number
}) {
  return (
    <>
      <div className="flex items-center justify-center bg-[#f7f5ee] px-2 py-1 text-center text-xs font-medium text-[#173c2a]">{label}</div>
      <div className={`border-b border-gray-200 px-2 py-1 text-sm ${multiline ? 'whitespace-pre-wrap' : ''}`}>{value || '-'}</div>
    </>
  )
}
