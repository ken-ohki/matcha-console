'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { RefreshCw } from 'lucide-react'

interface InquiryItem {
  productName?: string
  productSku?: string
  quantityKg: number
}
interface Inquiry {
  id: string
  memberCompanyName?: string
  items?: InquiryItem[]
  reason?: string
  message?: string
  shippingCountry?: string
  status?: string
  staffNote?: string
}

async function token(): Promise<string> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

const STATUSES = ['open', 'in_progress', 'quoted', 'closed', 'cancelled'] as const
const STATUS_LABEL: Record<string, string> = {
  open: '新規',
  in_progress: '対応中',
  quoted: '見積提示',
  closed: '完了',
  cancelled: '取消',
}
const REASON_LABEL: Record<string, string> = {
  over_threshold: '規定量以上',
  over_stock: '在庫超過',
  inquire_to_order: '受注生産',
  international_large: '海外大口',
  manual: 'その他',
}

export default function WholesaleInquiriesPage() {
  const [inquiries, setInquiries] = useState<Inquiry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/wholesale/inquiries', { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' })
      const data = (await res.json()) as { inquiries?: Inquiry[] }
      setInquiries(data.inquiries ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const setStatus = async (id: string, status: string) => {
    setBusy(id)
    try {
      await fetch('/api/wholesale/inquiries', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ id, status }),
      })
      await load()
    } finally {
      setBusy(null)
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#173c2a]">卸売の問い合わせ</h1>
            <p className="mt-1 text-sm text-[#68756c]">規定量以上・在庫超過・受注生産などの問い合わせ。成約時は販売管理から売上(sales)を作成してください。</p>
          </div>
          <button onClick={load} className="flex items-center gap-1 rounded-xl border border-[#d9d1be] px-3 py-2 text-sm text-[#173c2a] hover:bg-[#f4f2ea]">
            <RefreshCw size={15} /> 更新
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-[#68756c]">読み込み中…</p>
        ) : inquiries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#d9d1be] px-4 py-8 text-center text-sm text-[#a59f8c]">問い合わせはありません。</p>
        ) : (
          <div className="space-y-3">
            {inquiries.map(q => (
              <div key={q.id} className={`rounded-2xl border border-[#d9d1be] bg-white p-4 ${busy === q.id ? 'opacity-50' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-[#173c2a]">{q.memberCompanyName}</p>
                    <p className="mt-0.5 text-xs text-[#a59f8c]">{REASON_LABEL[q.reason ?? ''] ?? q.reason} · {q.shippingCountry}</p>
                    <ul className="mt-2 text-xs text-[#68756c]">
                      {(q.items ?? []).map((i, idx) => (
                        <li key={idx}>{i.productName ?? i.productSku ?? i.productSku} — {i.quantityKg}kg</li>
                      ))}
                    </ul>
                    {q.message && <p className="mt-2 whitespace-pre-wrap text-sm text-[#173c2a]">{q.message}</p>}
                  </div>
                  <select
                    value={q.status ?? 'open'}
                    onChange={e => setStatus(q.id, e.target.value)}
                    className="rounded-lg border border-[#d9d1be] bg-white px-2 py-1 text-sm text-[#173c2a]"
                  >
                    {STATUSES.map(s => (
                      <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
