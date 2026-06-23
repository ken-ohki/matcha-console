'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileText, Save, Upload } from 'lucide-react'
import type {
  PurchaseInvoice,
  PurchaseInvoiceInput,
  PurchaseInvoiceLineInput,
  PurchaseOrderInvoice,
  Supplier,
  TaxRate,
  UnbilledPoLine,
} from '@/types'
import { getServices } from '@/lib/services'
import { computeInvoiceTotals } from '@/lib/cashflow'
import { uploadPurchaseInvoiceFile } from '@/lib/firebase/storage'
import { formatCurrency, todayIso } from '@/lib/format'
import { PoLinePicker, type PoLineDraft, draftFromCandidate } from './PoLinePicker'
import { AdhocLineEditor, type AdhocDraft } from './AdhocLineEditor'

const fieldCls =
  'rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-matcha'

function poRowsFromInvoice(inv: PurchaseInvoice): PoLineDraft[] {
  return inv.lines
    .filter(l => l.kind === 'po')
    .map((l, i) => ({
      key: `po-existing-${l.id ?? i}`,
      purchaseOrderId: l.purchaseOrderId ?? '',
      poLineId: l.poLineId ?? '',
      productName: l.productName,
      quantity: l.quantity,
      unit: l.unit ?? 'kg',
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
    }))
}

function adhocRowsFromInvoice(inv: PurchaseInvoice): AdhocDraft[] {
  return inv.lines
    .filter(l => l.kind === 'adhoc')
    .map((l, i) => ({
      key: `adhoc-existing-${l.id ?? i}`,
      productName: l.productName,
      category: l.category ?? '',
      quantity: l.quantity,
      unit: l.unit ?? '',
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
      note: l.note ?? '',
    }))
}

export function InvoiceForm({
  invoice,
  onSaved,
  initialSupplier,
  initialPoLine,
}: {
  invoice?: PurchaseInvoice
  onSaved: (inv: PurchaseInvoice) => void
  /** Prefill supplier on a fresh form (deep-link from payables). */
  initialSupplier?: string
  /** Pre-add this single PO candidate on a fresh form. */
  initialPoLine?: { poId: string; lineId: string }
}) {
  const isEdit = !!invoice

  // --- Header fields ---
  const [supplierName, setSupplierName] = useState(invoice?.supplierName ?? initialSupplier ?? '')
  const [invoiceNumber, setInvoiceNumber] = useState(invoice?.invoiceNumber ?? '')
  const [invoiceDate, setInvoiceDate] = useState(invoice?.invoiceDate ?? todayIso())
  const [receivedDate, setReceivedDate] = useState(invoice?.receivedDate ?? todayIso())
  const [paymentDueDate, setPaymentDueDate] = useState(invoice?.paymentDueDate ?? '')
  const [notes, setNotes] = useState(invoice?.notes ?? '')

  // Paper total → totalOverride. Empty string = unset (null).
  const [paperTotal, setPaperTotal] = useState<number | ''>(
    invoice?.totalOverride ?? '',
  )

  // --- Lines ---
  const [poRows, setPoRows] = useState<PoLineDraft[]>(invoice ? poRowsFromInvoice(invoice) : [])
  const [adhocRows, setAdhocRows] = useState<AdhocDraft[]>(invoice ? adhocRowsFromInvoice(invoice) : [])

  // --- Data ---
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [candidates, setCandidates] = useState<UnbilledPoLine[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(true)

  // --- File ---
  const [file, setFile] = useState<PurchaseOrderInvoice | null>(invoice?.file ?? null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- Save ---
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const didPrefillPoLine = useRef(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const svc = await getServices()
        const [sup, unbilled] = await Promise.all([
          svc.suppliers.getSuppliers(),
          svc.purchaseInvoices.getUnbilledReceivedPoLines(),
        ])
        if (!alive) return
        setSuppliers(sup)
        setCandidates(unbilled)
        // Pre-add the deep-linked PO candidate once, on a fresh form.
        if (!invoice && initialPoLine && !didPrefillPoLine.current) {
          const match = unbilled.find(
            c => c.poId === initialPoLine.poId && c.lineId === initialPoLine.lineId,
          )
          if (match) {
            didPrefillPoLine.current = true
            setPoRows(prev =>
              prev.some(r => r.purchaseOrderId === match.poId && r.poLineId === match.lineId)
                ? prev
                : [...prev, draftFromCandidate(match)],
            )
            if (!supplierName.trim()) setSupplierName(match.supplierName)
          }
        }
      } finally {
        if (alive) setCandidatesLoading(false)
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Totals from lines ---
  const lineTotals = useMemo(() => {
    const lines = [
      ...poRows.map(r => ({ quantity: r.quantity, unitPrice: r.unitPrice, taxRate: r.taxRate as TaxRate })),
      ...adhocRows.map(r => ({ quantity: r.quantity, unitPrice: r.unitPrice, taxRate: r.taxRate as TaxRate })),
    ]
    return computeInvoiceTotals(lines)
  }, [poRows, adhocRows])

  const paper = paperTotal === '' ? null : Number(paperTotal)
  const delta = paper === null ? 0 : paper - lineTotals.total
  const totalsMatch = paper !== null && Math.abs(delta) < 1

  const handleFile = async (f: File) => {
    setUploading(true)
    setError(null)
    try {
      const url = await uploadPurchaseInvoiceFile(f, invoice?.id || 'new')
      setFile({ name: f.name, url, uploadedAt: new Date().toISOString(), size: f.size })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'PDFのアップロードに失敗しました')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const buildLines = (): PurchaseInvoiceLineInput[] => {
    const po: PurchaseInvoiceLineInput[] = poRows.map(r => ({
      kind: 'po',
      purchaseOrderId: r.purchaseOrderId,
      poLineId: r.poLineId,
      productName: r.productName,
      quantity: Number(r.quantity) || 0,
      unit: r.unit || 'kg',
      unitPrice: Number(r.unitPrice) || 0,
      taxRate: r.taxRate,
    }))
    const adhoc: PurchaseInvoiceLineInput[] = adhocRows.map(r => ({
      kind: 'adhoc',
      productName: r.productName,
      category: r.category || undefined,
      quantity: Number(r.quantity) || 0,
      unit: r.unit || undefined,
      unitPrice: Number(r.unitPrice) || 0,
      taxRate: r.taxRate,
      note: r.note || undefined,
    }))
    return [...po, ...adhoc]
  }

  const validate = (): string | null => {
    if (!supplierName.trim()) return '仕入先を入力してください。'
    if (!invoiceDate) return '請求日を入力してください。'
    if (poRows.length === 0 && adhocRows.length === 0) return '明細を1件以上追加してください。'
    if (adhocRows.some(r => !r.productName.trim())) return '一時商品の品目名は必須です。'
    return null
  }

  const submit = async () => {
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setSaving(true)
    setError(null)

    const base: PurchaseInvoiceInput = {
      supplierName: supplierName.trim(),
      invoiceNumber: invoiceNumber.trim() || undefined,
      invoiceDate,
      receivedDate: receivedDate || undefined,
      paymentDueDate: paymentDueDate || undefined,
      lines: buildLines(),
      totalOverride: paper,
      file,
      notes: notes.trim() || undefined,
    }

    const persist = async (input: PurchaseInvoiceInput): Promise<PurchaseInvoice> => {
      const svc = await getServices()
      return invoice
        ? svc.purchaseInvoices.updatePurchaseInvoice(invoice.id, input)
        : svc.purchaseInvoices.createPurchaseInvoice(input)
    }

    try {
      let result: PurchaseInvoice
      try {
        result = await persist(base)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (msg.includes('超過')) {
          if (!confirm(`${msg}\n\nこのまま請求を登録しますか？`)) {
            setSaving(false)
            return
          }
          result = await persist({ ...base, allowOverBill: true })
        } else {
          throw e
        }
      }
      onSaved(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">請求書情報</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-xs text-mist">
            <span className="mb-1 block">仕入先 *</span>
            <input
              list="invoice-supplier-list"
              value={supplierName}
              onChange={e => setSupplierName(e.target.value)}
              placeholder="仕入先名"
              className={`${fieldCls} w-full`}
            />
            <datalist id="invoice-supplier-list">
              {suppliers.map(s => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </label>
          <label className="text-xs text-mist">
            <span className="mb-1 block">請求書番号</span>
            <input
              value={invoiceNumber}
              onChange={e => setInvoiceNumber(e.target.value)}
              className={`${fieldCls} w-full`}
            />
          </label>
          <label className="text-xs text-mist">
            <span className="mb-1 block">支払期日</span>
            <input
              type="date"
              value={paymentDueDate}
              onChange={e => setPaymentDueDate(e.target.value)}
              className={`${fieldCls} w-full`}
            />
          </label>
          <label className="text-xs text-mist">
            <span className="mb-1 block">請求日 *</span>
            <input
              type="date"
              value={invoiceDate}
              onChange={e => setInvoiceDate(e.target.value)}
              className={`${fieldCls} w-full`}
            />
          </label>
          <label className="text-xs text-mist">
            <span className="mb-1 block">受領日</span>
            <input
              type="date"
              value={receivedDate}
              onChange={e => setReceivedDate(e.target.value)}
              className={`${fieldCls} w-full`}
            />
          </label>
        </div>
      </section>

      {/* Paper total + live comparison */}
      <section className="rounded-2xl border-2 border-[#cfe0d3] bg-[#f3f7f1] p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-mist">
            <span className="mb-1 block font-semibold text-ink">請求書の税込合計（紙の金額）</span>
            <input
              type="number"
              step="1"
              value={paperTotal}
              onChange={e => setPaperTotal(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="紙に印字された税込合計"
              className={`${fieldCls} w-full text-lg font-semibold`}
            />
          </label>
          <div className="flex flex-col justify-center gap-1 rounded-xl border border-white/70 bg-white/70 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-mist">明細合計（税抜）</span>
              <span className="font-medium text-ink">{formatCurrency(lineTotals.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-mist">消費税</span>
              <span className="font-medium text-ink">{formatCurrency(lineTotals.tax)}</span>
            </div>
            <div className="flex justify-between border-t border-[#e6dfcf] pt-1">
              <span className="text-mist">明細合計（税込）</span>
              <span className="font-semibold text-ink">{formatCurrency(lineTotals.total)}</span>
            </div>
            {paper !== null && (
              totalsMatch ? (
                <div className="mt-1 flex items-center justify-end gap-1 text-matchaDeep">
                  <CheckCircle2 size={15} />
                  <span className="text-xs font-medium">紙の金額と一致</span>
                </div>
              ) : (
                <div className="mt-1 flex items-center justify-between text-alert">
                  <span className="text-xs font-medium">紙との差</span>
                  <span className="font-semibold">
                    {delta > 0 ? '+' : ''}
                    {formatCurrency(delta)} 差
                  </span>
                </div>
              )
            )}
          </div>
        </div>
      </section>

      {/* PO line picker */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <PoLinePicker
          supplierName={supplierName}
          candidates={candidates}
          rows={poRows}
          onChange={setPoRows}
          loading={candidatesLoading}
        />
      </section>

      {/* Adhoc lines */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <AdhocLineEditor rows={adhocRows} onChange={setAdhocRows} />
      </section>

      {/* Running totals */}
      <section className="rounded-2xl border border-line bg-bone p-4">
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 text-sm">
          <span className="text-mist">
            明細 {poRows.length + adhocRows.length}件
          </span>
          <span className="text-mist">
            税抜 <span className="font-semibold text-ink">{formatCurrency(lineTotals.subtotal)}</span>
          </span>
          <span className="text-mist">
            税 <span className="font-semibold text-ink">{formatCurrency(lineTotals.tax)}</span>
          </span>
          <span className="text-mist">
            税込 <span className="text-base font-semibold text-ink">{formatCurrency(lineTotals.total)}</span>
          </span>
        </div>
      </section>

      {/* PDF + notes */}
      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">PDF・メモ</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-matchaDeep hover:bg-[#eef3eb] disabled:opacity-60"
          >
            <Upload size={14} /> {uploading ? 'アップロード中…' : '請求書PDFをアップロード'}
          </button>
          {file ? (
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-matchaDeep hover:underline"
            >
              <FileText size={13} /> {file.name}
            </a>
          ) : (
            <span className="text-xs text-mist">未添付</span>
          )}
        </div>
        <label className="mt-3 block text-xs text-mist">
          <span className="mb-1 block">メモ</span>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className={`${fieldCls} w-full`}
          />
        </label>
      </section>

      {error && (
        <p className="rounded-xl border border-alert/40 bg-alert/5 px-3 py-2 text-sm text-alert">{error}</p>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper shadow hover:bg-[#205f43] disabled:opacity-60"
        >
          <Save size={15} /> {saving ? '保存中…' : isEdit ? '更新する' : '請求書を登録'}
        </button>
      </div>
    </div>
  )
}
