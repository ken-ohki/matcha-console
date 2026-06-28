'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { businessTypeText } from '@/lib/wholesaleBusinessTypes'
import { useStickyState } from '@/hooks/useStickyState'
import { Check, X, Ban, RefreshCw, Search } from 'lucide-react'
import { EmptyTableRow } from '@/components/ui/EmptyState'

interface Member {
  uid: string
  email?: string
  status?: string
  migratedToUid?: string
  companyName?: string
  contactName?: string
  phone?: string
  country?: string
  website?: string
  businessType?: string
  businessTypes?: string[]
  socialMedia?: string
  businessStage?: string
  annualVolumeEstimate?: string
  rank?: string
  buyerId?: string
  createdAtMs?: number
}

const STATUS_LABEL: Record<string, string> = { pending: '承認待ち', approved: '承認済み', rejected: '却下', suspended: '停止' }
const STATUS_STYLE: Record<string, string> = {
  pending: 'border-[#a87b1e] text-[#a87b1e]',
  approved: 'border-matcha text-matcha',
  rejected: 'border-alert text-alert',
  suspended: 'border-line text-mist',
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
  const { user } = useAuth()
  // 会員の審査・承認は admin 限定（viewer/finance は閲覧のみ）。
  const isAdmin = user?.role === 'admin'
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useStickyState('members.filter', 'all')
  const [countryFilter, setCountryFilter] = useStickyState('members.country', 'all')
  const [rankFilter, setRankFilter] = useStickyState('members.rank', 'all')
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

  // Filter dropdown options derived from the data (countries) + known ranks.
  const countryOptions = useMemo(
    () => [...new Set(members.map(m => (m.country ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja')),
    [members],
  )
  const rankOptions = useMemo(
    () => [...new Set(['standard', 'premium', 'exclusive', ...members.map(m => (m.rank ?? '').trim()).filter(Boolean)])],
    [members],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return members
      // Hide manual records that were migrated to a login account (avoid duplicates).
      .filter(m => !m.migratedToUid)
      .filter(m => (filter === 'all' ? true : m.status === filter))
      .filter(m => (countryFilter === 'all' ? true : (m.country ?? '').trim() === countryFilter))
      .filter(m => (rankFilter === 'all' ? true : (m.rank ?? 'standard').trim() === rankFilter))
      .filter(m => {
        if (!q) return true
        return [m.companyName, m.contactName, m.email, m.country].filter(Boolean).join(' ').toLowerCase().includes(q)
      })
      .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
  }, [members, filter, countryFilter, rankFilter, search])

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl">
        <div className="mb-bl-6 flex items-end justify-between border-b border-ink pb-bl-3">
          <div>
            <p className="kicker mb-bl">SABO WHOLESALE</p>
            <h1 className="display-2 text-2xl text-ink">卸売会員管理</h1>
            <p className="mt-bl text-sm text-mist">登録会員を審査・承認・管理します。社名をクリックで顧客情報と購入履歴を表示。{pendingCount > 0 && <span className="ml-1 text-[#a87b1e]">承認待ち {pendingCount} 件</span>}</p>
          </div>
          <button onClick={load} className="btn-ghost">
            <RefreshCw size={14} /> 更新
          </button>
        </div>

        {error && <p className="mb-bl-2 rounded-lg border border-alert/40 bg-alert/5 px-4 py-2 text-sm text-alert">{error}</p>}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded-full px-3 py-1.5 text-sm transition ${filter === f.key ? 'bg-ink text-paper' : 'border border-line text-ink hover:bg-bone'}`}
              >
                {f.label}
                {f.key === 'pending' && pendingCount > 0 && <span className="ml-1 text-xs">({pendingCount})</span>}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={countryFilter}
              onChange={e => setCountryFilter(e.target.value)}
              className="rounded-lg border border-line bg-paper py-2 pl-3 pr-7 text-sm text-ink outline-none focus:border-ink"
              aria-label="国で絞り込み"
            >
              <option value="all">国: すべて</option>
              {countryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={rankFilter}
              onChange={e => setRankFilter(e.target.value)}
              className="rounded-lg border border-line bg-paper py-2 pl-3 pr-7 text-sm capitalize text-ink outline-none focus:border-ink"
              aria-label="ランクで絞り込み"
            >
              <option value="all">ランク: すべて</option>
              {rankOptions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="relative ml-auto min-w-[220px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="社名・担当者・メールで検索"
              className="w-full rounded-lg border border-line bg-paper py-2 pl-9 pr-3 text-sm text-ink outline-none focus:border-ink"
            />
          </div>
        </div>

        {loading ? (
          <p className="py-10 text-center text-sm text-mist">読み込み中…</p>
        ) : (
          <div className="panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-max min-w-full text-sm">
                <thead className="bg-bone">
                  <tr className="whitespace-nowrap text-left text-mist">
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
                    <tr key={m.uid} className={`whitespace-nowrap border-t border-line hover:bg-bone ${busy === m.uid ? 'pointer-events-none opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <Link href={`/wholesale/members/${m.uid}`} className="font-medium text-ink hover:text-matchaDeep hover:underline">
                          {m.companyName ?? '(社名未設定)'}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-graphite">{m.contactName ?? '—'}</td>
                      <td className="px-4 py-3 text-graphite">{m.email ?? '—'}</td>
                      <td className="px-4 py-3 text-graphite">{m.country ?? '—'}</td>
                      <td className="px-4 py-3 text-graphite">{businessTypeText(m.businessTypes, m.businessType)}</td>
                      <td className="px-4 py-3 text-graphite">{m.annualVolumeEstimate ? VOLUME_LABEL[m.annualVolumeEstimate] ?? m.annualVolumeEstimate : '—'}</td>
                      <td className="px-4 py-3 capitalize text-graphite">{m.rank ?? 'standard'}</td>
                      <td className="px-4 py-3 text-graphite">{fmtDate(m.createdAtMs)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded border px-2 py-0.5 text-[11px] ${STATUS_STYLE[m.status ?? ''] ?? 'border-line text-mist'}`}>
                          {STATUS_LABEL[m.status ?? ''] ?? m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {isAdmin && m.status === 'pending' && (
                            <>
                              <button onClick={() => act(m.uid, 'approve')} className="flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1.5 text-xs text-paper hover:opacity-90">
                                <Check size={13} /> 承認
                              </button>
                              <button onClick={() => act(m.uid, 'reject')} className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-alert hover:bg-bone">
                                <X size={13} /> 却下
                              </button>
                            </>
                          )}
                          {isAdmin && m.status === 'approved' && (
                            <button onClick={() => act(m.uid, 'suspend')} className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs text-[#a87b1e] hover:bg-bone">
                              <Ban size={13} /> 停止
                            </button>
                          )}
                          {isAdmin && (m.status === 'rejected' || m.status === 'suspended') && (
                            <button onClick={() => act(m.uid, 'approve')} className="flex items-center gap-1 rounded-lg bg-ink px-2.5 py-1.5 text-xs text-paper hover:opacity-90">
                              <Check size={13} /> 承認
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <EmptyTableRow colSpan={10} message="該当する会員がいません。" />
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
