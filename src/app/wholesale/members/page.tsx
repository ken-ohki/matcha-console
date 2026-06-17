'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { Check, X, Ban, RefreshCw, Search } from 'lucide-react'

interface Member {
  uid: string
  email?: string
  status?: string
  companyName?: string
  contactName?: string
  phone?: string
  country?: string
  website?: string
  businessType?: string
  socialMedia?: string
  businessStage?: string
  annualVolumeEstimate?: string
  rank?: string
  buyerId?: string
  createdAtMs?: number
}

const STATUS_LABEL: Record<string, string> = { pending: '承認待ち', approved: '承認済み', rejected: '却下', suspended: '停止' }
const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700',
  suspended: 'bg-gray-200 text-gray-700',
}
const VOLUME_LABEL: Record<string, string> = {
  undecided: '未定', under_10kg: '10kg未満', '10_50kg': '10〜50kg', '50_100kg': '50〜100kg', over_100kg: '100kg以上',
}

async function token(): Promise<string> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

function fmtDate(ms?: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString('ja-JP', { year: '2-digit', month: '2-digit', day: '2-digit' })
}

const FILTERS: { key: string; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'pending', label: '承認待ち' },
  { key: 'approved', label: '承認済み' },
  { key: 'rejected', label: '却下' },
  { key: 'suspended', label: '停止' },
]

export default function WholesaleMembersPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/wholesale/members', { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' })
      const data = (await res.json()) as { members?: Member[] }
      setMembers(data.members ?? [])
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const act = async (uid: string, action: 'approve' | 'reject' | 'suspend') => {
    setBusy(uid)
    setError(null)
    try {
      const reason = action === 'reject' ? window.prompt('却下理由（任意）') ?? undefined : undefined
      const res = await fetch(`/api/wholesale/members/${uid}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ action, reason }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setError(d.error === 'staff_account_conflict' ? 'このUIDはスタッフ用アカウントです' : '操作に失敗しました')
        return
      }
      await load()
    } finally {
      setBusy(null)
    }
  }

  const pendingCount = members.filter(m => m.status === 'pending').length

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members
      .filter(m => (filter === 'all' ? true : m.status === filter))
      .filter(m => {
        if (!q) return true
        return [m.companyName, m.contactName, m.email, m.country].filter(Boolean).join(' ').toLowerCase().includes(q)
      })
      .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
  }, [members, filter, search])

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#173c2a]">卸売会員管理</h1>
            <p className="mt-1 text-sm text-[#68756c]">登録会員を審査・承認・管理します。社名をクリックで顧客情報と購入履歴を表示。{pendingCount > 0 && <span className="ml-1 text-amber-700">承認待ち {pendingCount} 件</span>}</p>
          </div>
          <button onClick={load} className="flex items-center gap-1 rounded-xl border border-[#d9d1be] px-3 py-2 text-sm text-[#173c2a] hover:bg-[#f4f2ea]">
            <RefreshCw size={15} /> 更新
          </button>
        </div>

        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1.5 text-sm transition ${filter === f.key ? 'bg-[#174c33] text-white' : 'border border-[#d9d1be] text-[#173c2a] hover:bg-[#f4f2ea]'}`}
              >
                {f.label}
                {f.key === 'pending' && pendingCount > 0 && <span className="ml-1 text-xs">({pendingCount})</span>}
              </button>
            ))}
          </div>
          <div className="relative ml-auto min-w-[220px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a59f8c]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="社名・担当者・メールで検索"
              className="w-full rounded-xl border border-gray-300 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-[#68756c]">読み込み中…</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#d9d1be] bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-max min-w-full text-sm">
                <thead className="bg-[#f7f5ee]">
                  <tr className="whitespace-nowrap text-left text-[#68756c]">
                    <th className="px-4 py-3 font-medium">会社名 / 屋号</th>
                    <th className="px-4 py-3 font-medium">ご担当者</th>
                    <th className="px-4 py-3 font-medium">メール</th>
                    <th className="px-4 py-3 font-medium">国</th>
                    <th className="px-4 py-3 font-medium">業種</th>
                    <th className="px-4 py-3 font-medium">年間見込</th>
                    <th className="px-4 py-3 font-medium">ランク</th>
                    <th className="px-4 py-3 font-medium">登録日</th>
                    <th className="px-4 py-3 font-medium">状態</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.uid} className={`whitespace-nowrap border-t border-[#ece5d7] hover:bg-[#faf8f2] ${busy === m.uid ? 'pointer-events-none opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <Link href={`/wholesale/members/${m.uid}`} className="font-medium text-[#173c2a] hover:text-[#174c33] hover:underline">
                          {m.companyName ?? '(社名未設定)'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{m.contactName ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{m.email ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{m.country ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{m.businessType ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-700">{m.annualVolumeEstimate ? VOLUME_LABEL[m.annualVolumeEstimate] ?? m.annualVolumeEstimate : '—'}</td>
                      <td className="px-4 py-3 capitalize text-gray-700">{m.rank ?? 'standard'}</td>
                      <td className="px-4 py-3 text-gray-700">{fmtDate(m.createdAtMs)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs ${STATUS_STYLE[m.status ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                          {STATUS_LABEL[m.status ?? ''] ?? m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {m.status === 'pending' && (
                            <>
                              <button onClick={() => act(m.uid, 'approve')} className="flex items-center gap-1 rounded-lg bg-[#174c33] px-2.5 py-1.5 text-xs text-white hover:opacity-90">
                                <Check size={13} /> 承認
                              </button>
                              <button onClick={() => act(m.uid, 'reject')} className="flex items-center gap-1 rounded-lg border border-[#d9d1be] px-2.5 py-1.5 text-xs text-[#9d3d28] hover:bg-[#fff0ec]">
                                <X size={13} /> 却下
                              </button>
                            </>
                          )}
                          {m.status === 'approved' && (
                            <button onClick={() => act(m.uid, 'suspend')} className="flex items-center gap-1 rounded-lg border border-[#d9d1be] px-2.5 py-1.5 text-xs text-[#8d5b08] hover:bg-[#fff6e5]">
                              <Ban size={13} /> 停止
                            </button>
                          )}
                          {(m.status === 'rejected' || m.status === 'suspended') && (
                            <button onClick={() => act(m.uid, 'approve')} className="flex items-center gap-1 rounded-lg bg-[#174c33] px-2.5 py-1.5 text-xs text-white hover:opacity-90">
                              <Check size={13} /> 承認
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-12 text-center text-[#68756c]">該当する会員がいません。</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  )
}
