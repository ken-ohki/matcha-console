'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Plus, Printer, Trash2 } from 'lucide-react'
import { getServices } from '@/lib/services'
import type { IssuerInfo } from '@/lib/services'
import type { PurchaseOrder, Supplier } from '@/types'
import {
  createBlankLine,
  formatYen,
  ISSUER,
  todayString,
  type DocumentLine,
  computeTotals,
} from '@/lib/invoice'

interface PoDocumentData {
  recipientName: string
  recipientHonorific: string
  recipientAddress: string
  recipientContact: string
  issueDate: string
  orderDate: string
  deliveryDate: string
  deliveryPlace: string
  paymentTerms: string
  lines: DocumentLine[]
  notes: string
}

function buildInitialDocument(order: PurchaseOrder, supplier: Supplier | undefined): PoDocumentData {
  const lines: DocumentLine[] = order.items.map(item => createBlankLine({
    description: item.productName,
    isReducedRate: (item.taxRate ?? 8) === 8,
    taxExempt: (item.taxRate ?? 8) === 0,
    quantity: item.quantityKg,
    unit: 'kg',
    unitPrice: item.unitPrice,
  }))
  if (order.shippingFee > 0) {
    lines.push(createBlankLine({
      description: '送料',
      isReducedRate: false,
      quantity: 1,
      unit: '式',
      unitPrice: order.shippingFee,
    }))
  }
  if (order.otherFees > 0) {
    lines.push(createBlankLine({
      description: order.otherFeesNote ? `諸経費（${order.otherFeesNote}）` : '諸経費',
      isReducedRate: false,
      quantity: 1,
      unit: '式',
      unitPrice: order.otherFees,
    }))
  }
  const recipientAddress = [supplier?.postalCode, supplier?.address].filter(Boolean).join(' ')
  const recipientContact = [
    supplier?.contactPersonName,
    supplier?.phone ? `TEL: ${supplier.phone}` : '',
    supplier?.email,
  ].filter(Boolean).join(' / ')

  return {
    recipientName: order.supplierName,
    recipientHonorific: '御中',
    recipientAddress,
    recipientContact,
    issueDate: todayString(),
    orderDate: order.orderDate || todayString(),
    deliveryDate: order.expectedDeliveryDate || '',
    deliveryPlace: ISSUER.address,
    paymentTerms: '月末締め翌月末払い',
    lines,
    notes: order.notes || '',
  }
}

function poTotal(lines: DocumentLine[]): number {
  return lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0), 0)
}

function effectiveIssuer(stored: IssuerInfo | null): { company: string; postalCode: string; address: string; tel: string; email: string; registrationNumber: string } {
  return {
    company: stored?.company || ISSUER.company,
    postalCode: stored?.postalCode || ISSUER.postalCode,
    address: stored?.address || ISSUER.address,
    tel: stored?.tel || ISSUER.tel,
    email: stored?.email || ISSUER.email,
    registrationNumber: stored?.registrationNumber || ISSUER.registrationNumber,
  }
}

export default function PurchaseOrderDocumentPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<PurchaseOrder | null>(null)
  const [doc, setDoc] = useState<PoDocumentData | null>(null)
  const [issuer, setIssuer] = useState<IssuerInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const services = await getServices()
        const [orders, suppliers, issuerInfo] = await Promise.all([
          services.purchaseOrders.getPurchaseOrders(),
          services.suppliers.getSuppliers(),
          services.settings.getIssuer(),
        ])
        if (cancelled) return
        const target = orders.find(o => o.id === params.id)
        if (!target) {
          setError('発注が見つかりません')
          return
        }
        const matched = suppliers.find(s => s.name === target.supplierName)
        setOrder(target)
        setIssuer(issuerInfo)
        setDoc(buildInitialDocument(target, matched))
      } catch (err) {
        setError(err instanceof Error ? err.message : '読み込みに失敗しました')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [params.id])

  const totals = useMemo(() => doc ? poTotal(doc.lines) : 0, [doc])
  const taxTotals = useMemo(() => doc ? computeTotals(doc.lines) : null, [doc])
  const issuerInfo = useMemo(() => effectiveIssuer(issuer), [issuer])

  if (loading) {
    return <div className="min-h-screen bg-bone p-8 text-center text-sm text-mist">読み込み中…</div>
  }
  if (error || !order || !doc) {
    return (
      <div className="min-h-screen bg-bone p-8">
        <p className="text-sm text-alert">{error || 'ドキュメントを生成できません'}</p>
        <button type="button" onClick={() => router.back()} className="mt-4 underline text-sm text-matchaDeep">戻る</button>
      </div>
    )
  }

  const updateField = <K extends keyof PoDocumentData>(key: K, value: PoDocumentData[K]) => {
    setDoc(prev => prev ? { ...prev, [key]: value } : prev)
  }
  const updateLine = (id: string, patch: Partial<DocumentLine>) => {
    setDoc(prev => prev ? { ...prev, lines: prev.lines.map(l => l.id === id ? { ...l, ...patch } : l) } : prev)
  }
  const addLine = () => {
    setDoc(prev => prev ? { ...prev, lines: [...prev.lines, createBlankLine()] } : prev)
  }
  const removeLine = (id: string) => {
    setDoc(prev => prev ? { ...prev, lines: prev.lines.filter(l => l.id !== id) } : prev)
  }

  return (
    <div className="min-h-screen bg-bone">
      <div className="no-print sticky top-0 z-20 border-b border-line bg-white shadow-sm">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <Link href="/purchase-orders" className="inline-flex items-center gap-1 text-sm text-mist hover:text-ink">
            <ArrowLeft size={14} />
            発注管理に戻る
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-sm font-medium text-paper shadow transition hover:bg-[#205f43]"
          >
            <Printer size={14} />
            印刷 / PDF
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-4 py-6 print:p-0 print:max-w-none">
        <div className="rounded-lg border border-line bg-white p-8 shadow-sm print:border-0 print:shadow-none print:rounded-none">
          <h1 className="text-center text-3xl font-semibold tracking-[0.4em] text-ink">発　注　書</h1>

          <div className="mt-8 grid grid-cols-[1fr_auto] gap-8">
            <div>
              <div className="flex items-baseline gap-2 border-b-2 border-ink pb-1">
                <EditableInput
                  className="flex-1 text-xl font-medium text-ink"
                  value={doc.recipientName}
                  onChange={v => updateField('recipientName', v)}
                  placeholder="仕入先名"
                />
                <EditableInput
                  className="w-16 text-base font-medium text-ink"
                  value={doc.recipientHonorific}
                  onChange={v => updateField('recipientHonorific', v)}
                />
              </div>
              <textarea
                rows={2}
                value={doc.recipientAddress}
                onChange={e => updateField('recipientAddress', e.target.value)}
                placeholder="〒住所"
                className="mt-3 w-full resize-none bg-transparent border-0 outline-none focus:bg-bone text-xs text-mist"
              />
              <input
                type="text"
                value={doc.recipientContact}
                onChange={e => updateField('recipientContact', e.target.value)}
                placeholder="ご担当 / TEL / Email"
                className="w-full bg-transparent border-0 outline-none focus:bg-bone text-xs text-mist"
              />
              <p className="mt-6 text-sm">下記の通り発注いたします。</p>
            </div>
            <div className="text-sm space-y-1">
              <div className="flex gap-2 justify-end">
                <span className="text-mist">発行日：</span>
                <EditableInput
                  type="date"
                  className="text-right"
                  value={doc.issueDate}
                  onChange={v => updateField('issueDate', v)}
                />
              </div>
              <div className="mt-3 text-right">
                <p className="font-medium text-ink">{issuerInfo.company}</p>
                <p className="text-xs text-mist">{issuerInfo.postalCode}</p>
                <p className="text-xs text-mist">{issuerInfo.address}</p>
                <p className="text-xs text-mist">TEL：{issuerInfo.tel}</p>
                <p className="text-xs text-mist">E-Mail：{issuerInfo.email}</p>
                <p className="text-xs text-mist">登録番号：{issuerInfo.registrationNumber}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-sm">
            <MetaRow label="発注日" value={doc.orderDate} onChange={v => updateField('orderDate', v)} type="date" />
            <MetaRow label="納品予定日" value={doc.deliveryDate} onChange={v => updateField('deliveryDate', v)} type="date" />
            <MetaRow label="納品場所" value={doc.deliveryPlace} onChange={v => updateField('deliveryPlace', v)} multiline />
            <MetaRow label="支払条件" value={doc.paymentTerms} onChange={v => updateField('paymentTerms', v)} />
          </div>

          <div className="mt-6 grid grid-cols-[140px_1fr_80px] items-center gap-2 border-y-2 border-double border-ink py-3">
            <span className="text-sm font-medium text-ink">発注金額合計</span>
            <span className="text-right text-3xl font-semibold text-ink">¥ {formatYen(totals)}</span>
            <span className="text-xs text-mist">（税抜）</span>
          </div>

          <div className="mt-6 overflow-hidden rounded border border-line">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-bone text-ink">
                  <th className="border-b border-r border-line px-2 py-2 text-left">明細</th>
                  <th className="w-16 border-b border-r border-line px-2 py-2 text-right">数量</th>
                  <th className="w-14 border-b border-r border-line px-2 py-2 text-center">単位</th>
                  <th className="w-24 border-b border-r border-line px-2 py-2 text-right">単価</th>
                  <th className="w-16 border-b border-r border-line px-2 py-2 text-center">税率</th>
                  <th className="w-28 border-b border-line px-2 py-2 text-right">金額</th>
                  <th className="w-8 border-b border-line px-1 py-2 no-print"></th>
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
                      <td className="border-r border-b border-line px-2 py-1">
                        <EditableInput
                          type="number"
                          value={String(line.quantity)}
                          onChange={v => updateLine(line.id, { quantity: Number(v) || 0 })}
                          className="w-full text-right"
                        />
                      </td>
                      <td className="border-r border-b border-line px-2 py-1">
                        <EditableInput value={line.unit} onChange={v => updateLine(line.id, { unit: v })} className="w-full text-center" />
                      </td>
                      <td className="border-r border-b border-line px-2 py-1">
                        <EditableInput
                          type="number"
                          value={String(line.unitPrice)}
                          onChange={v => updateLine(line.id, { unitPrice: Number(v) || 0 })}
                          className="w-full text-right"
                        />
                      </td>
                      <td className="border-r border-b border-line px-2 py-1 text-center">
                        <select
                          value={line.isReducedRate ? 8 : 10}
                          onChange={e => updateLine(line.id, { isReducedRate: Number(e.target.value) === 8 })}
                          className="w-full bg-transparent text-xs focus:outline-none"
                        >
                          <option value={8}>8%</option>
                          <option value={10}>10%</option>
                        </select>
                      </td>
                      <td className="border-b border-line px-2 py-1 text-right">¥{formatYen(amount)}</td>
                      <td className="border-b border-line px-1 py-1 no-print">
                        <button
                          type="button"
                          onClick={() => removeLine(line.id)}
                          aria-label="行を削除"
                          className="rounded p-1 text-alert hover:bg-alert/5"
                        >
                          <Trash2 size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="border-t border-line bg-bone px-2 py-2 no-print">
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs text-matchaDeep hover:bg-[#ece8db]"
              >
                <Plus size={12} />
                行を追加
              </button>
            </div>
          </div>

          {taxTotals && (
            <div className="mt-4 ml-auto w-full max-w-sm rounded border border-line text-sm">
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                <span className="text-mist">10%対象 小計</span>
                <span>¥{formatYen(taxTotals.standardSubtotal)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                <span className="text-mist">10% 消費税</span>
                <span>¥{formatYen(taxTotals.standardTax)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                <span className="text-mist">8%対象 小計</span>
                <span>¥{formatYen(taxTotals.reducedSubtotal)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                <span className="text-mist">8% 消費税</span>
                <span>¥{formatYen(taxTotals.reducedTax)}</span>
              </div>
              <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
                <span className="text-mist">税抜合計</span>
                <span>¥{formatYen(taxTotals.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between bg-bone px-3 py-2 font-semibold text-ink">
                <span>税込合計</span>
                <span>¥{formatYen(taxTotals.total)}</span>
              </div>
            </div>
          )}

          <div className="mt-6">
            <p className="mb-1 text-xs font-medium text-mist">備考</p>
            <textarea
              rows={3}
              value={doc.notes}
              onChange={e => updateField('notes', e.target.value)}
              className="w-full rounded border border-line px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-matcha print:border-0 print:ring-0"
            />
          </div>

          <p className="mt-10 text-center text-xs text-mist">※PDF を原本とする</p>
        </div>
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
          main > div { page-break-inside: avoid; }
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
          .bg-bone, .focus\\:bg-bone { background: transparent !important; }
          table .no-print { display: none !important; }
          .shadow, .shadow-sm, .shadow-2xl { box-shadow: none !important; }
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
      className={`bg-transparent border-0 outline-none focus:bg-bone focus:ring-0 ${className}`}
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
      <div className="flex items-center justify-center bg-bone px-2 py-1 text-center text-xs font-medium text-ink">{label}</div>
      <div className="border-b border-line px-2 py-1">
        {multiline ? (
          <textarea
            rows={rows}
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full resize-none bg-transparent border-0 outline-none focus:bg-bone text-sm"
          />
        ) : (
          <input
            type={type ?? 'text'}
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full bg-transparent border-0 outline-none focus:bg-bone text-sm"
          />
        )}
      </div>
    </>
  )
}
