'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { Megaphone, Plus, Trash2, Pencil } from 'lucide-react'

interface Announcement {
  id: string
  title: string
  titleEn?: string | null
  category?: string | null
  body: string
  bodyEn?: string | null
  imageUrl?: string | null
  audience: 'public' | 'members'
  published: boolean
  publishedAt?: string | null
  createdAtMs?: number
}

type Draft = {
  id?: string
  title: string
  titleEn: string
  category: string
  body: string
  bodyEn: string
  imageUrl: string
  audience: 'public' | 'members'
  published: boolean
}

const EMPTY: Draft = { title: '', titleEn: '', category: '', body: '', bodyEn: '', imageUrl: '', audience: 'public', published: false }

async function token(): Promise<string> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

const fmt = (ms?: number) => (ms ? new Date(ms).toLocaleDateString('ja-JP') : '—')

export default function AnnouncementsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' // 閲覧は全ロール、作成/編集/削除は admin 限定
  const [items, setItems] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/announcements', { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' })
      const data = (await res.json()) as { items?: Announcement[] }
      setItems(data.items ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const edit = (a: Announcement) =>
    setDraft({ id: a.id, title: a.title, titleEn: a.titleEn ?? '', category: a.category ?? '', body: a.body ?? '', bodyEn: a.bodyEn ?? '', imageUrl: a.imageUrl ?? '', audience: a.audience, published: a.published })

  const save = async () => {
    if (!draft) return
    if (!draft.title.trim()) { setError('タイトルを入力してください'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/announcements', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify(draft),
      })
      if (!res.ok) { setError('保存に失敗しました'); return }
      setDraft(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a: Announcement) => {
    if (!window.confirm(`「${a.title}」を削除しますか？`)) return
    setBusy(true)
    try {
      await fetch(`/api/announcements?id=${encodeURIComponent(a.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await token()}` } })
      if (draft?.id === a.id) setDraft(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-end justify-between border-b border-ink pb-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#eff8f0] px-3 py-1 text-sm font-medium text-matchaDeep"><Megaphone size={15} /> お知らせ</div>
            <h1 className="mt-3 text-2xl font-bold text-ink">お知らせ管理</h1>
            <p className="mt-1 text-sm text-mist">商品情報・重要なお知らせをブログ形式で掲載します（Markdown対応）。</p>
          </div>
          {isAdmin && !draft && <button onClick={() => setDraft({ ...EMPTY })} className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-paper hover:opacity-90"><Plus size={15} /> 新規作成</button>}
        </div>

        {error && <p className="rounded-lg border border-alert/40 bg-alert/5 px-4 py-2 text-sm text-alert">{error}</p>}

        {isAdmin && draft && (
          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">{draft.id ? 'お知らせを編集' : '新しいお知らせ'}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-[11px] text-mist">カテゴリ（任意）<input className="field-input mt-1" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} placeholder="例: 商品情報 / 重要" /></label>
              <label className="text-[11px] text-mist">画像URL（任意）<input className="field-input mt-1" value={draft.imageUrl} onChange={e => setDraft({ ...draft, imageUrl: e.target.value })} /></label>

              {/* 日本語 */}
              <label className="text-[11px] text-mist sm:col-span-2">タイトル（日本語）<input className="field-input mt-1" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
              <label className="text-[11px] text-mist sm:col-span-2">本文（日本語・Markdown）
                <textarea rows={10} className="field-input mt-1 font-mono" value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} placeholder={'## 見出し\n\n本文。**太字**・リンク [text](https://...)・- リスト などが使えます。'} />
              </label>

              {/* English (optional — falls back to Japanese if empty) */}
              <label className="text-[11px] text-mist sm:col-span-2">Title (English)<input className="field-input mt-1" value={draft.titleEn} onChange={e => setDraft({ ...draft, titleEn: e.target.value })} placeholder="未入力なら日本語を表示" /></label>
              <label className="text-[11px] text-mist sm:col-span-2">Body (English · Markdown)
                <textarea rows={10} className="field-input mt-1 font-mono" value={draft.bodyEn} onChange={e => setDraft({ ...draft, bodyEn: e.target.value })} placeholder="Leave blank to show the Japanese body to English visitors." />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-graphite">
              <span className="text-[11px] text-mist">公開範囲:</span>
              <label className="flex cursor-pointer items-center gap-2"><input type="radio" name="aud" checked={draft.audience === 'public'} onChange={() => setDraft({ ...draft, audience: 'public' })} className="h-4 w-4 accent-[#174c33]" /> 一般公開</label>
              <label className="flex cursor-pointer items-center gap-2"><input type="radio" name="aud" checked={draft.audience === 'members'} onChange={() => setDraft({ ...draft, audience: 'members' })} className="h-4 w-4 accent-[#174c33]" /> 会員限定</label>
              <label className="ml-auto flex cursor-pointer items-center gap-2"><input type="checkbox" checked={draft.published} onChange={e => setDraft({ ...draft, published: e.target.checked })} className="h-4 w-4 accent-[#174c33]" /> 公開する</label>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={save} disabled={busy} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">保存</button>
              <button onClick={() => setDraft(null)} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-bone">キャンセル</button>
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-line bg-white p-2">
          {loading ? (
            <p className="py-10 text-center text-sm text-mist">読み込み中…</p>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-mist">お知らせはまだありません。</p>
          ) : (
            <ul className="divide-y divide-line">
              {items.map(a => (
                <li key={a.id} className="flex items-center gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{a.title}</span>
                      {a.category && <span className="rounded-full bg-bone px-2 py-0.5 text-[10px] text-graphite">{a.category}</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${a.audience === 'members' ? 'bg-[#fff3df] text-[#a87b1e]' : 'bg-[#eff8f0] text-matchaDeep'}`}>{a.audience === 'members' ? '会員限定' : '一般公開'}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${a.published ? 'border-matcha text-matcha' : 'border-line text-mist'}`}>{a.published ? '公開中' : '下書き'}</span>
                    </div>
                    <p className="text-[11px] text-mist">作成: {fmt(a.createdAtMs)}{a.publishedAt ? ` ／ 公開: ${a.publishedAt.slice(0, 10)}` : ''}</p>
                  </div>
                  {isAdmin && (
                    <>
                      <button onClick={() => edit(a)} className="rounded-lg p-2 text-mist hover:bg-bone hover:text-graphite" aria-label="編集"><Pencil size={16} /></button>
                      <button onClick={() => remove(a)} className="rounded-lg p-2 text-alert hover:bg-alert/5" aria-label="削除"><Trash2 size={16} /></button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppLayout>
  )
}
