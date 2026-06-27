'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { getServices } from '@/lib/services'
import type { PurchaseInvoice, PurchaseInvoicePaymentStatus, PurchaseOrderPayment } from '@/types'
import { InvoiceForm } from '@/components/purchase-invoices/InvoiceForm'
import { PaymentsEditor } from '@/components/PaymentsEditor'
import { formatCurrency } from '@/lib/format'

const PAY_LABELS: Record<PurchaseInvoicePaymentStatus, string> = {
  unpaid: '未払',
  partial: '一部支払',
  paid: '支払済',
}

const PAY_BADGE: Record<PurchaseInvoicePaymentStatus, string> = {
  unpaid: 'bg-bone text-mist',
  partial: 'bg-amber-100 text-amber-800',
  paid: 'bg-[#dcebe0] text-matchaDeep',
}

export default function PurchaseInvoiceDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params.id

  const [invoice, setInvoice] = useState<PurchaseInvoice | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const svc = await getServices()
      const inv = await svc.purchaseInvoices.getPurchaseInvoice(id)
      if (!inv) setNotFound(true)
      else setInvoice(inv)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const savePayments = async (next: PurchaseOrderPayment[]) => {
    setError(null)
    try {
      const svc = await getServices()
      const updated = await svc.purchaseInvoices.updateInvoicePayments(id, next)
      setInvoice(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : '支払の更新に失敗しました')
    }
  }

  const handleDelete = async () => {
    if (!confirm('この請求書を削除しますか？')) return
    setDeleting(true)
    setError(null)
    try {
      const svc = await getServices()
      await svc.purchaseInvoices.deletePurchaseInvoice(id)
      router.push('/payables')
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました')
      setDeleting(false)
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Link
              href="/payables"
              className="mb-1 inline-flex items-center gap-1 text-xs text-mist hover:text-ink"
            >
              <ArrowLeft size={13} /> 支払管理へ戻る
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-ink">
              請求書詳細
              {invoice && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${PAY_BADGE[invoice.paymentStatus]}`}
                >
                  {PAY_LABELS[invoice.paymentStatus]}
                </span>
              )}
            </h1>
            {invoice && (
              <p className="text-sm text-mist">
                {invoice.supplierName}
                {invoice.invoiceNumber ? ` / ${invoice.invoiceNumber}` : ''}
              </p>
            )}
          </div>
          {invoice && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 rounded-lg border border-alert/40 bg-white px-3 py-1.5 text-xs text-alert hover:bg-alert/5 disabled:opacity-60"
            >
              <Trash2 size={14} /> {deleting ? '削除中…' : '削除'}
            </button>
          )}
        </div>

        {error && (
          <p className="rounded-xl border border-alert/40 bg-alert/5 px-3 py-2 text-sm text-alert">{error}</p>
        )}

        {loading && <p className="text-sm text-mist">読み込み中…</p>}
        {!loading && notFound && (
          <p className="rounded-2xl border border-line bg-white p-6 text-center text-sm text-mist">
            請求書が見つかりませんでした。
          </p>
        )}

        {invoice && (
          <>
            {/* Linked POs */}
            {invoice.linkedPoIds.length > 0 && (
              <section className="rounded-2xl border border-line bg-white p-4">
                <h2 className="mb-2 text-sm font-semibold text-ink">紐付けされた発注</h2>
                <div className="flex flex-wrap gap-2">
                  {invoice.linkedPoIds.map(poId => (
                    <Link
                      key={poId}
                      href={`/purchase-orders/${poId}`}
                      className="rounded-full border border-line bg-white px-3 py-1 text-xs text-matchaDeep hover:bg-[#eef3eb]"
                    >
                      発注 {poId} →
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {/* Edit form */}
            <InvoiceForm invoice={invoice} onSaved={() => void load()} />

            {/* Payments / 消し込み */}
            <section className="rounded-2xl border border-line bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-ink">支払（消し込み）</h2>
                <span className="text-xs text-mist">
                  請求額（税込） <span className="font-semibold text-ink">{formatCurrency(invoice.totalAmount)}</span>
                </span>
              </div>
              <PaymentsEditor
                payments={invoice.payments}
                totalIncl={invoice.totalAmount}
                onChange={next => void savePayments(next)}
              />
            </section>
          </>
        )}
      </div>
    </AppLayout>
  )
}
