'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { AppLayout } from '@/components/layout/AppLayout'
import { InvoiceForm } from '@/components/purchase-invoices/InvoiceForm'

function NewInvoiceInner() {
  const router = useRouter()
  const params = useSearchParams()

  const supplier = params.get('supplier') ?? undefined
  const poId = params.get('poId') ?? undefined
  const lineId = params.get('lineId') ?? undefined
  const initialPoLine = poId && lineId ? { poId, lineId } : undefined

  return (
    <InvoiceForm
      initialSupplier={supplier}
      initialPoLine={initialPoLine}
      onSaved={inv => router.push(`/purchase-invoices/${inv.id}`)}
    />
  )
}

export default function NewPurchaseInvoicePage() {
  return (
    <AppLayout>
      <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href="/payables"
              className="mb-1 inline-flex items-center gap-1 text-xs text-mist hover:text-ink"
            >
              <ArrowLeft size={13} /> 支払管理へ戻る
            </Link>
            <h1 className="text-2xl font-semibold text-ink">請求書を登録</h1>
            <p className="text-sm text-mist">受領した請求書を登録し、発注の消し込みを行います。</p>
          </div>
        </div>

        <Suspense fallback={<p className="text-sm text-mist">読み込み中…</p>}>
          <NewInvoiceInner />
        </Suspense>
      </main>
    </AppLayout>
  )
}
