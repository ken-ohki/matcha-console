'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { getServices } from '@/lib/services'
import type { Buyer } from '@/types'
import { Building2, Search } from 'lucide-react'

function formatDate(date?: Date): string {
  if (!date) return '-'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export default function BuyersPage() {
  const [buyers, setBuyers] = useState<Buyer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    getServices().then(async services => {
      setBuyers(await services.sales.getBuyers())
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    if (!search) return buyers
    const query = search.toLowerCase()
    return buyers.filter(buyer => (
      buyer.name.toLowerCase().includes(query) ||
      (buyer.country ?? '').toLowerCase().includes(query) ||
      (buyer.terms ?? '').toLowerCase().includes(query)
    ))
  }, [buyers, search])

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-3 py-1 text-sm font-medium text-[#5e44a8]">
              <Building2 size={15} />
              販売先マスター
            </div>
            <h1 className="mt-3 text-3xl font-bold text-[#173c2a]">登録済みの販売先一覧</h1>
            <p className="mt-2 text-sm text-[#68756c]">販売案件の登録時に一度使った販売先をここで再参照できます。</p>
          </div>
          <Link
            href="/sales"
            className="inline-flex items-center gap-2 self-start rounded-xl bg-[#174c33] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#123723]"
          >
            販売管理へ戻る
          </Link>
        </div>

        <div className="rounded-3xl border border-[#d9d1be] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h2 className="text-lg font-semibold text-[#173c2a]">販売先一覧</h2>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="販売先名・国・条件で検索"
                className="w-full rounded-xl border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 sm:w-64"
              />
            </div>
          </div>

          <div className="mt-5 space-y-3 md:hidden">
            {!loading && filtered.length === 0 && (
              <div className="rounded-2xl border border-dashed border-[#d9d1be] px-4 py-10 text-center text-sm text-[#68756c]">
                登録済みの販売先はありません。
              </div>
            )}
            {filtered.map(buyer => (
              <div key={buyer.id} className="rounded-2xl border border-[#ece5d7] bg-[#faf8f2] p-4">
                <div className="font-medium text-[#173c2a]">{buyer.name}</div>
                <div className="mt-1 text-xs text-[#68756c]">{buyer.country || '国未設定'}</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl bg-white p-3 text-xs text-[#68756c]">
                    <div>利用回数 {buyer.saleCount}件</div>
                    <div className="mt-1">最終利用日 {formatDate(buyer.lastSoldAt)}</div>
                  </div>
                  <div className="rounded-xl bg-white p-3 text-xs text-[#68756c]">
                    <div>直近条件 {buyer.terms || '-'}</div>
                    <div className="mt-1">メモ {buyer.notes || '-'}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 hidden overflow-x-auto md:block">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[#e6dfcf] text-left text-[#68756c]">
                  <th className="px-3 py-3 font-medium">販売先</th>
                  <th className="px-3 py-3 font-medium">国</th>
                  <th className="px-3 py-3 font-medium">利用回数</th>
                  <th className="px-3 py-3 font-medium">直近条件</th>
                  <th className="px-3 py-3 font-medium">最終利用日</th>
                  <th className="px-3 py-3 font-medium">メモ</th>
                </tr>
              </thead>
              <tbody>
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-10 text-center text-sm text-[#68756c]">
                      登録済みの販売先はありません。
                    </td>
                  </tr>
                )}
                {filtered.map(buyer => (
                  <tr key={buyer.id} className="border-b border-[#f0ebdf] text-[#173c2a]">
                    <td className="px-3 py-4 font-medium">{buyer.name}</td>
                    <td className="px-3 py-4">{buyer.country || '-'}</td>
                    <td className="px-3 py-4">{buyer.saleCount}</td>
                    <td className="px-3 py-4">{buyer.terms || '-'}</td>
                    <td className="px-3 py-4">{formatDate(buyer.lastSoldAt)}</td>
                    <td className="px-3 py-4">{buyer.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
