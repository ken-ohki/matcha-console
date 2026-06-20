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
  // 送料が未設定（0）なら明細に出さない
  const shippingLine = (sale.shippingFee || 0) > 0
    ? createBlankLine({
        description: isJa ? '送料' : 'Shipping',
        isReducedRate: false,
        quantity: 1,
        unit: isJa ? '式' : 'lot',
        unitPrice: sale.shippingFee || 0,
      })
    : null
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
    ...(shippingLine ? [shippingLine] : []),
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

  // Non-amount fields (recipient / dates / project / terms / bank info / notes /
  // line descriptions) are editable in place. Edits are NOT persisted to the
  // sale — they only affect this print / PDF output. Quantity・単価・金額 are
  // always read-only and come from 販売管理.
  const updateField = <K extends keyof DocumentData>(key: K, value: DocumentData[K]) =>
    setDoc(prev => (prev ? { ...prev, [key]: value } : prev))
  const updateLine = (id: string, patch: Partial<DocumentLine>) =>
    setDoc(prev => (prev ? { ...prev, lines: prev.lines.map(l => (l.id === id ? { ...l, ...patch } : l)) } : prev))

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
    return <div className="min-h-screen bg-bone p-8 text-center text-sm text-mist">読み込み中…</div>
  }
  if (error || !sale || !doc || !totals) {
    return (
      <div className="min-h-screen bg-bone p-8">
        <p className="text-sm text-alert">{error || 'ドキュメントを生成できません'}</p>
        <button type="button" onClick={() => router.back()} className="mt-4 underline text-sm text-matchaDeep">戻る</button>
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
    <div className="min-h-screen bg-bone">
      {/* Toolbar */}
      <div className="no-print sticky top-0 z-20 border-b border-line bg-white shadow-sm">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3">
          <Link href="/sales" className="inline-flex items-center gap-1 text-sm text-mist hover:text-ink">
            <ArrowLeft size={14} />
            販売管理に戻る
          </Link>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
              {(['invoice', 'delivery', 'quotation'] as DocumentType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTypeChange(t)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    type === t ? 'bg-ink text-paper' : 'text-mist hover:text-ink'
                  }`}
                >
                  {DOCUMENT_LABELS[t].title.replace(/　/g, '')}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
              <button
                type="button"
                onClick={() => handleLangChange('ja')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  language === 'ja' ? 'bg-ink text-paper' : 'text-mist hover:text-ink'
                }`}
              >
                日本語
              </button>
              <button
                type="button"
                onClick={() => handleLangChange('en')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  language === 'en' ? 'bg-ink text-paper' : 'text-mist hover:text-ink'
                }`}
              >
                English
              </button>
            </div>
            {!isJa && (type === 'invoice' || type === 'quotation') && (
              <label className="inline-flex items-center gap-1 text-xs text-mist">
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
              className="inline-flex items-center gap-1.5 rounded-xl border border-[#174c33] bg-white px-3 py-2 text-sm font-medium text-matchaDeep transition hover:bg-[#ece8db]"
            >
              <Printer size={14} />
              {isJa ? '印刷' : 'Print'}
            </button>
            <button
              type="button"
              onClick={handleGeneratePdf}
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-sm font-medium text-paper shadow transition hover:bg-[#205f43] disabled:opacity-60"
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
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2.5">
            <span className="text-sm font-medium text-ink">{isJa ? 'PDFプレビュー' : 'PDF Preview'}</span>
            {pdfSaved && <span className="text-xs font-medium text-matcha">{isJa ? '✓ 発行履歴に保存しました' : '✓ Saved to history'}</span>}
            {pdfError && <span className="text-xs text-alert">{pdfError}</span>}
            <div className="ml-auto flex items-center gap-2">
              <a
                href={pdfUrl}
                download={documentBaseName}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-medium text-ink hover:bg-bone"
              >
                {isJa ? 'ダウンロード' : 'Download'}
              </a>
              <button
                type="button"
                onClick={handleSavePdf}
                disabled={savingPdf || pdfSaved}
                className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-paper shadow transition hover:bg-[#205f43] disabled:opacity-60"
              >
                {savingPdf ? (isJa ? '保存中…' : 'Saving…') : pdfSaved ? (isJa ? '保存済み' : 'Saved') : (isJa ? '発行（履歴に保存）' : 'Issue (save)')}
              </button>
              <button
                type="button"
                onClick={closePdfPreview}
                className="rounded-lg p-1.5 text-mist hover:bg-bone hover:text-graphite"
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
        <div className="rounded-lg border border-line bg-white p-8 shadow-sm print:border-0 print:shadow-none print:rounded-none">
          <h1 className="text-center text-3xl font-semibold tracking-[0.4em] text-ink">{labels.title}</h1>

          <div className="mt-8 grid grid-cols-[1fr_auto] gap-8">
            <div>
              <div className="flex items-baseline gap-2 border-b-2 border-ink pb-1">
                {!isJa && <span className="text-base text-ink">To:</span>}
                <EditableInput
                  value={doc.recipientName}
                  onChange={v => updateField('recipientName', v)}
                  placeholder={isJa ? 'お客様名' : 'Customer name'}
                  className="flex-1 text-xl font-medium text-ink"
                />
                {isJa && (
                  <EditableInput
                    value={doc.recipientHonorific}
                    onChange={v => updateField('recipientHonorific', v)}
                    placeholder="御中"
                    className="w-16 text-base font-medium text-ink"
                  />
                )}
              </div>
              {isJa && (
                <EditableInput
                  value={doc.recipientPostalCode}
                  onChange={v => updateField('recipientPostalCode', v)}
                  placeholder="〒"
                  className="mt-2 block w-full text-xs text-mist"
                />
              )}
              <EditableTextarea
                value={doc.recipientAddress}
                onChange={v => updateField('recipientAddress', v)}
                placeholder={isJa ? '住所' : 'Address'}
                rows={2}
                className="text-xs text-mist"
              />
              <p className="mt-6 text-sm">{labels.intro}</p>
            </div>
            <div className="text-sm space-y-1">
              <div className="flex gap-2 justify-end">
                <span className="text-mist">{isJa ? '発行日：' : 'Issue Date:'}</span>
                <EditableInput
                  type="date"
                  value={doc.issueDate}
                  onChange={v => updateField('issueDate', v)}
                  className="text-right"
                />
              </div>
              <div className="mt-3 text-right">
                <p className="font-medium text-ink">{isJa ? issuer.company : issuer.companyEn}</p>
                <p className="text-xs text-mist">{isJa ? issuer.postalCode : ''}</p>
                <p className="text-xs text-mist">{isJa ? issuer.address : issuer.addressEn}</p>
                <p className="text-xs text-mist">{isJa ? 'TEL：' : 'TEL: '}{issuer.tel}</p>
                <p className="text-xs text-mist">{isJa ? 'E-Mail：' : 'Email: '}{issuer.email}</p>
                {isJa && (
                  <p className="text-xs text-mist">登録番号：{issuer.registrationNumber}</p>
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
                <MetaRow label={isJa ? '納品日' : EN_META_LABELS.deliveryDate} value={doc.deliveryDate ?? ''} onChange={v => updateField('deliveryDate', v)} />
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
          <div className="mt-6 grid grid-cols-[140px_1fr_80px] items-center gap-2 border-y-2 border-double border-ink py-3">
            <span className="text-sm font-medium text-ink">{labels.amountLabel}</span>
            <span className="text-right text-3xl font-semibold text-ink">
              ¥ {formatYen(doc.taxExempt ? totals.subtotal : totals.total)}
            </span>
            <span className="text-xs text-mist">{isJa ? '（税込）' : doc.taxExempt ? '(tax exempt)' : '(tax incl.)'}</span>
          </div>

          {/* Lines */}
          <div className="mt-6 overflow-hidden rounded border border-line">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-bone text-ink">
                  <th className="border-b border-r border-line px-2 py-2 text-left">{isJa ? '明細' : EN_META_LABELS.description}</th>
                  {!doc.taxExempt && (
                    <th className="w-16 border-b border-r border-line px-2 py-2 text-center">{isJa ? '8%対象' : '8% rate'}</th>
                  )}
                  <th className="w-16 border-b border-r border-line px-2 py-2 text-right">{isJa ? '数量' : EN_META_LABELS.qty}</th>
                  <th className="w-14 border-b border-r border-line px-2 py-2 text-center">{isJa ? '単位' : EN_META_LABELS.unit}</th>
                  <th className="w-24 border-b border-r border-line px-2 py-2 text-right">{isJa ? '単価' : EN_META_LABELS.unitPrice}</th>
                  <th className="w-28 border-b border-line px-2 py-2 text-right">{isJa ? '金額' : EN_META_LABELS.amount}</th>
                </tr>
              </thead>
              <tbody>
                {doc.lines.map(line => {
                  const amount = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0)
                  return (
                    <tr key={line.id}>
                      <td className="border-r border-b border-line px-2 py-1">
                        <EditableInput value={line.description} onChange={v => updateLine(line.id, { description: v })} className="w-full" />
                      </td>
                      {!doc.taxExempt && (
                        <td className="border-r border-b border-line px-2 py-1 text-center">{line.isReducedRate ? '✓' : ''}</td>
                      )}
                      <td className="border-r border-b border-line px-2 py-1 text-right">{line.quantity}</td>
                      <td className="border-r border-b border-line px-2 py-1 text-center">{line.unit}</td>
                      <td className="border-r border-b border-line px-2 py-1 text-right">¥{formatYen(Number(line.unitPrice) || 0)}</td>
                      <td className="border-b border-line px-2 py-1 text-right">¥{formatYen(amount)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Tax summary */}
          {!doc.taxExempt && (
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-6 text-sm">
              <p className="text-xs text-mist">{isJa ? '*軽減税率対象商品' : EN_META_LABELS.taxNote}</p>
              <table className="text-sm">
                <tbody>
                  <tr>
                    <td className="px-2 text-mist">{isJa ? '10%対象' : '10% rate'}</td>
                    <td className="px-2 text-right">{isJa ? '対象額（税抜）' : 'Pre-tax'}</td>
                    <td className="px-2 text-right font-medium">¥{formatYen(totals.standardSubtotal)}</td>
                    <td className="px-2 text-mist">{isJa ? '消費税' : EN_META_LABELS.tax}</td>
                    <td className="px-2 text-right font-medium">¥{formatYen(totals.standardTax)}</td>
                  </tr>
                  <tr>
                    <td className="px-2 text-mist">{isJa ? '8%対象' : '8% rate'}</td>
                    <td className="px-2 text-right">{isJa ? '対象額（税抜）' : 'Pre-tax'}</td>
                    <td className="px-2 text-right font-medium">¥{formatYen(totals.reducedSubtotal)}</td>
                    <td className="px-2 text-mist">{isJa ? '消費税' : EN_META_LABELS.tax}</td>
                    <td className="px-2 text-right font-medium">¥{formatYen(totals.reducedTax)}</td>
                  </tr>
                  <tr className="border-t border-line">
                    <td className="px-2 font-medium">{isJa ? '小計' : EN_META_LABELS.subtotal}</td>
                    <td className="px-2 text-right"></td>
                    <td className="px-2 text-right font-semibold">¥{formatYen(totals.subtotal)}</td>
                    <td className="px-2 text-mist">{isJa ? '消費税' : EN_META_LABELS.tax}</td>
                    <td className="px-2 text-right font-semibold">¥{formatYen(totals.tax)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* Notes */}
          <div className="mt-6">
            <p className="mb-1 text-xs font-medium text-mist">{isJa ? '備考' : EN_META_LABELS.notes}</p>
            <EditableTextarea
              value={doc.notes}
              onChange={v => updateField('notes', v)}
              placeholder={isJa ? '備考を入力' : 'Notes'}
              rows={2}
              className="text-sm"
            />
          </div>

          <p className="mt-10 text-center text-xs text-mist">{isJa ? '※PDF を原本とする' : '* PDF serves as the official document.'}</p>
        </div>

        {/* English Terms & Conditions (appears as additional pages in print) */}
        {!isJa && (type === 'invoice' || type === 'quotation') && includeTerms && (
          <div className="terms-page mt-6 rounded-lg border border-line bg-white p-8 shadow-sm print:border-0 print:shadow-none print:rounded-none print:mt-0">
            <h2 className="text-center text-2xl font-semibold tracking-[0.2em] text-ink">TERMS &amp; CONDITIONS OF SALE</h2>
            <p className="mt-2 text-center text-xs text-mist">{issuer.companyEn}　·　{issuer.addressEn}</p>

            <div className="mt-8 space-y-4 text-sm leading-relaxed text-[#1f2a23]">
              {terms.map((section, i) => (
                <div key={i}>
                  <h3 className="font-semibold text-ink">{section.heading}</h3>
                  <p className="mt-1 whitespace-pre-wrap">{section.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-12 grid grid-cols-2 gap-8 text-sm">
              <div>
                <p className="text-mist">Seller</p>
                <p className="mt-1 font-medium text-ink">{issuer.companyEn}</p>
                <p className="text-xs text-mist">{issuer.addressEn}</p>
              </div>
              <div>
                <p className="text-mist">{type === 'quotation' ? 'Buyer (acknowledged upon order)' : 'Buyer (acknowledged by payment)'}</p>
                <p className="mt-1 font-medium text-ink">{doc.recipientName}</p>
              </div>
            </div>

            <p className="mt-12 text-center text-xs text-mist">
              {type === 'quotation'
                ? 'By placing an order based on this quotation, the Buyer acknowledges and agrees to these Terms & Conditions of Sale.'
                : 'By making payment, the Buyer acknowledges and agrees to these Terms & Conditions of Sale.'}
            </p>
          </div>
        )}

        <p className="mt-3 text-center text-xs text-mist no-print">※ 数量・単価・金額は販売管理から自動反映されます。その他の項目はこの画面で編集して印刷／PDF発行できます（編集内容は保存されません）。</p>
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
          .bg-bone, .focus\\:bg-bone { background: transparent !important; }
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

// Editable inline field. Looks like plain text; on hover/focus shows a subtle
// box. Prints/exports its current value (read by the print CSS / PDF builder).
// Quantity・単価・金額 do NOT use this — those stay read-only.
function EditableInput({
  value,
  onChange,
  placeholder,
  className = '',
  type = 'text',
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  className?: string
  type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`min-w-0 rounded bg-transparent px-1 outline-none transition hover:bg-[#faf7ee] focus:bg-[#fffdf5] focus:ring-1 focus:ring-[#d9d1be] print:bg-transparent print:ring-0 ${className}`}
    />
  )
}

function EditableTextarea({
  value,
  onChange,
  placeholder,
  rows = 2,
  className = '',
}: {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  rows?: number
  className?: string
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={`w-full resize-none rounded bg-transparent px-1 outline-none transition hover:bg-[#faf7ee] focus:bg-[#fffdf5] focus:ring-1 focus:ring-[#d9d1be] print:resize-none print:bg-transparent print:ring-0 ${className}`}
    />
  )
}

function MetaRow({
  label,
  value,
  onChange,
  multiline,
  rows,
}: {
  label: string
  value: string
  onChange: (next: string) => void
  multiline?: boolean
  rows?: number
}) {
  return (
    <>
      <div className="flex items-center justify-center bg-bone px-2 py-1 text-center text-xs font-medium text-ink">{label}</div>
      <div className="border-b border-line px-1 py-1 text-sm">
        {multiline
          ? <EditableTextarea value={value} onChange={onChange} rows={rows ?? 2} />
          : <EditableInput value={value} onChange={onChange} className="w-full" />}
      </div>
    </>
  )
}
