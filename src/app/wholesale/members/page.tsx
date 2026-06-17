'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { Check, X, Ban, RefreshCw, ChevronRight } from 'lucide-react'

interface Member {
  uid: string
  email?: string
  status?: string
  companyName?: string
  companyNameKana?: string
  contactName?: string
  phone?: string
  country?: string
  website?: string
  businessType?: string
  socialMedia?: string
  businessStage?: string
  annualVolumeEstimate?: string
  buyerId?: string
}

const BUSINESS_STAGE_LABEL: Record<string, string> = {
  pre_opening: '開業前',
  operating: '開業済',
}
const VOLUME_LABEL: Record<string, string> = {
  undecided: '年間見込: 未定',
  under_10kg: '年間見込: 10kg未満',
  '10_50kg': '年間見込: 10〜50kg',
  '50_100kg': '年間見込: 50〜100kg',
  over_100kg: '年間見込: 100kg以上',
}

async function token(): Promise<string> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

const STATUS_LABEL: Record<string, string> = {
  pending: '承認待ち',
  approved: '承認済み',
  rejected: '却下',
  suspended: '停止',
}

export default function WholesaleMembersPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  const pending = members.filter(m => m.status === 'pending')
  const others = members.filter(m => m.status !== 'pending')

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#173c2a]">卸売会員管理</h1>
            <p className="mt-1 text-sm text-[#68756c]">wholesale.sabo-matcha.jp の登録会員を審査・承認・管理します。社名をクリックすると顧客情報と購入履歴を確認できます。</p>
          </div>
          <button onClick={load} className="flex items-center gap-1 rounded-xl border border-[#d9d1be] px-3 py-2 text-sm text-[#173c2a] hover:bg-[#f4f2ea]">
            <RefreshCw size={15} /> 更新
          </button>
        </div>

        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
        {loading && <p className="text-sm text-[#68756c]">読み込み中…</p>}

        <Section title={`承認待ち (${pending.length})`}>
          {pending.length === 0 ? (
            <Empty>承認待ちの会員はいません。</Empty>
          ) : (
            pending.map(m => (
              <MemberCard key={m.uid} m={m} busy={busy === m.uid}>
                <button onClick={() => act(m.uid, 'approve')} className="flex items-center gap-1 rounded-lg bg-[#174c33] px-3 py-1.5 text-sm text-white hover:opacity-90">
                  <Check size={14} /> 承認
                </button>
                <button onClick={() => act(m.uid, 'reject')} className="flex items-center gap-1 rounded-lg border border-[#d9d1be] px-3 py-1.5 text-sm text-[#9d3d28] hover:bg-[#fff0ec]">
                  <X size={14} /> 却下
                </button>
              </MemberCard>
            ))
          )}
        </Section>

        <Section title={`その他 (${others.length})`}>
          {others.length === 0 ? (
            <Empty>表示する会員はいません。</Empty>
          ) : (
            others.map(m => (
              <MemberCard key={m.uid} m={m} busy={busy === m.uid}>
                <span className="rounded-full bg-[#eff8f0] px-2.5 py-0.5 text-xs text-[#174c33]">{STATUS_LABEL[m.status ?? ''] ?? m.status}</span>
                {m.status === 'approved' && (
                  <button onClick={() => act(m.uid, 'suspend')} className="flex items-center gap-1 rounded-lg border border-[#d9d1be] px-3 py-1.5 text-sm text-[#8d5b08] hover:bg-[#fff6e5]">
                    <Ban size={14} /> 停止
                  </button>
                )}
              </MemberCard>
            ))
          )}
        </Section>
      </div>
    </AppLayout>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#68756c]">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-[#d9d1be] px-4 py-6 text-center text-sm text-[#a59f8c]">{children}</p>
}

function MemberCard({ m, busy, children }: { m: Member; busy: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#d9d1be] bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link href={`/wholesale/members/${m.uid}`} className="group inline-flex items-center gap-1 font-medium text-[#173c2a] hover:text-[#174c33] hover:underline">
            {m.companyName ?? '(社名未設定)'}
            <ChevronRight size={14} className="text-[#a59f8c] transition-transform group-hover:translate-x-0.5" />
          </Link>
          <p className="text-xs text-[#68756c]">{m.contactName} · {m.email} · {m.phone}</p>
          <p className="mt-1 text-xs text-[#a59f8c]">
            {[m.country, m.businessType, m.website, m.socialMedia].filter(Boolean).join(' · ')}
          </p>
          {(m.businessStage || m.annualVolumeEstimate) && (
            <p className="mt-1 text-xs text-[#a59f8c]">
              {[
                m.businessStage ? BUSINESS_STAGE_LABEL[m.businessStage] ?? m.businessStage : null,
                m.annualVolumeEstimate ? VOLUME_LABEL[m.annualVolumeEstimate] ?? m.annualVolumeEstimate : null,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <div className={`flex shrink-0 items-center gap-2 ${busy ? 'opacity-50 pointer-events-none' : ''}`}>{children}</div>
      </div>
    </div>
  )
}
