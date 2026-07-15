'use client'

import { useCallback, useEffect, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { uploadResourceAsset, uploadResourceThumbnail } from '@/lib/firebase/storage'
import { BookOpen, Plus, Trash2, Pencil } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'

// Resource Center（会員限定）の管理画面。お知らせ管理(announcements)と同じ形。
// 公開側は wholesale の /resources が読む。素材の原本は storagePath だけを保持し、
// 会員への配信は wholesale 側の署名付きURLで行う（公開URLは発行しない）。

type ResourceKind = 'recipe' | 'asset'

interface ResourceRow {
  id: string
  kind: ResourceKind
  title: string
  titleEn?: string | null
  category?: string | null
  body: string
  bodyEn?: string | null
  thumbnailUrl?: string | null
  storagePath?: string | null
  fileName?: string | null
  contentType?: string | null
  sizeBytes?: number | null
  sortOrder?: number
  published: boolean
  publishedAt?: string | null
  createdAtMs?: number
}

type Draft = {
  id?: string
  /** Storage のパスに使う安定キー（新規は UUID、既存は id）。 */
  key: string
  kind: ResourceKind
  title: string
  titleEn: string
  category: string
  body: string
  bodyEn: string
  thumbnailUrl: string
  storagePath: string
  fileName: string
  contentType: string
  sizeBytes: number
  sortOrder: string
  published: boolean
}

const emptyDraft = (): Draft => ({
  key: crypto.randomUUID(),
  kind: 'recipe',
  title: '', titleEn: '', category: '', body: '', bodyEn: '',
  thumbnailUrl: '', storagePath: '', fileName: '', contentType: '', sizeBytes: 0,
  sortOrder: '0', published: false,
})

async function token(): Promise<string> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

const fmt = (ms?: number) => (ms ? new Date(ms).toLocaleDateString('ja-JP') : '—')
const fmtBytes = (n?: number | null) => {
  if (!n) return '—'
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function ResourcesPage() {
  const { user } = useAuth()
  const { confirm } = useConfirm()
  const isAdmin = user?.role === 'admin' // 閲覧は全ロール、作成/編集/削除は admin 限定
  const [items, setItems] = useState<ResourceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState<'thumb' | 'asset' | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/resources', { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' })
      const data = (await res.json()) as { items?: ResourceRow[] }
      setItems(data.items ?? [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const edit = (r: ResourceRow) =>
    setDraft({
      id: r.id, key: r.id, kind: r.kind,
      title: r.title, titleEn: r.titleEn ?? '', category: r.category ?? '',
      body: r.body ?? '', bodyEn: r.bodyEn ?? '',
      thumbnailUrl: r.thumbnailUrl ?? '',
      storagePath: r.storagePath ?? '', fileName: r.fileName ?? '',
      contentType: r.contentType ?? '', sizeBytes: r.sizeBytes ?? 0,
      sortOrder: String(r.sortOrder ?? 0), published: r.published,
    })

  const onThumb = async (file: File) => {
    if (!draft) return
    setUploading('thumb')
    setError(null)
    try {
      const url = await uploadResourceThumbnail(file, draft.key)
      setDraft(d => (d ? { ...d, thumbnailUrl: url } : d))
    } catch {
      setError('サムネイルのアップロードに失敗しました')
    } finally {
      setUploading(null)
    }
  }

  const onAsset = async (file: File) => {
    if (!draft) return
    setUploading('asset')
    setError(null)
    try {
      const r = await uploadResourceAsset(file, draft.key)
      setDraft(d => (d ? { ...d, storagePath: r.storagePath, fileName: r.fileName, contentType: r.contentType, sizeBytes: r.sizeBytes } : d))
    } catch {
      setError('素材ファイルのアップロードに失敗しました')
    } finally {
      setUploading(null)
    }
  }

  const save = async () => {
    if (!draft) return
    if (!draft.title.trim()) { setError('タイトルを入力してください'); return }
    if (draft.kind === 'asset' && !draft.storagePath) { setError('素材ファイルをアップロードしてください'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ ...draft, sortOrder: Number(draft.sortOrder) || 0 }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setError(d.error === 'missing_asset_file' ? '素材ファイルをアップロードしてください' : '保存に失敗しました')
        return
      }
      setDraft(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (r: ResourceRow) => {
    if (!(await confirm({ message: `「${r.title}」を削除しますか？${r.storagePath ? '\n\nアップロードした素材ファイルも削除されます。' : ''}`, danger: true, confirmLabel: '削除する' }))) return
    setBusy(true)
    try {
      await fetch(`/api/resources?id=${encodeURIComponent(r.id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${await token()}` } })
      if (draft?.id === r.id) setDraft(null)
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
            <div className="inline-flex items-center gap-2 rounded-full bg-[#eff8f0] px-3 py-1 text-sm font-medium text-matchaDeep"><BookOpen size={15} /> Resource Center</div>
            <h1 className="mt-3 text-2xl font-bold text-ink">Resource Center 管理</h1>
            <p className="mt-1 text-sm text-mist">会員限定のレシピ・農園素材を掲載します。非会員にはタイトルとぼかしたサムネイルのみ表示され、会員登録を促します。</p>
          </div>
          {isAdmin && !draft && <button onClick={() => setDraft(emptyDraft())} className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-2 text-sm font-medium text-paper hover:opacity-90"><Plus size={15} /> 新規作成</button>}
        </div>

        {error && <p className="rounded-lg border border-alert/40 bg-alert/5 px-4 py-2 text-sm text-alert">{error}</p>}

        {isAdmin && draft && (
          <section className="rounded-2xl border border-line bg-white p-5">
            <h2 className="mb-3 text-sm font-semibold text-ink">{draft.id ? 'コンテンツを編集' : '新しいコンテンツ'}</h2>

            {/* 種別 */}
            <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-graphite">
              <span className="text-[11px] text-mist">種別:</span>
              <label className="flex cursor-pointer items-center gap-2"><input type="radio" name="kind" checked={draft.kind === 'recipe'} onChange={() => setDraft({ ...draft, kind: 'recipe' })} className="h-4 w-4 accent-[#174c33]" /> レシピ</label>
              <label className="flex cursor-pointer items-center gap-2"><input type="radio" name="kind" checked={draft.kind === 'asset'} onChange={() => setDraft({ ...draft, kind: 'asset' })} className="h-4 w-4 accent-[#174c33]" /> 素材（写真・動画）</label>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-[11px] text-mist">カテゴリ（任意）<input className="field-input mt-1" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} placeholder={draft.kind === 'recipe' ? '例: ドリンク / 菓子' : '例: 写真 / 動画'} /></label>
              <label className="text-[11px] text-mist">並び順（小さいほど上）<input type="number" className="field-input mt-1" value={draft.sortOrder} onChange={e => setDraft({ ...draft, sortOrder: e.target.value })} /></label>

              {/* サムネイル — 非会員にはぼかして見せるティザー */}
              <div className="text-[11px] text-mist sm:col-span-2">
                サムネイル画像（非会員にはぼかして表示されます）
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  {draft.thumbnailUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={draft.thumbnailUrl} alt="" className="h-16 w-16 rounded object-cover" />
                  )}
                  <label className="cursor-pointer rounded-lg border border-line px-3 py-2 text-sm text-ink hover:bg-bone">
                    {uploading === 'thumb' ? 'アップロード中…' : draft.thumbnailUrl ? '差し替え' : 'ファイルを選択'}
                    <input type="file" accept="image/*" className="hidden" disabled={uploading !== null} onChange={e => { const f = e.target.files?.[0]; if (f) void onThumb(f); e.target.value = '' }} />
                  </label>
                  {draft.thumbnailUrl && <button onClick={() => setDraft({ ...draft, thumbnailUrl: '' })} className="text-xs text-alert underline">削除</button>}
                </div>
              </div>

              {/* 素材ファイル — 会員のみDL可（署名付きURL） */}
              {draft.kind === 'asset' && (
                <div className="text-[11px] text-mist sm:col-span-2">
                  素材ファイル（原本・会員のみダウンロード可）
                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <label className="cursor-pointer rounded-lg border border-line px-3 py-2 text-sm text-ink hover:bg-bone">
                      {uploading === 'asset' ? 'アップロード中…' : draft.storagePath ? '差し替え' : 'ファイルを選択'}
                      <input type="file" accept="image/*,video/*" className="hidden" disabled={uploading !== null} onChange={e => { const f = e.target.files?.[0]; if (f) void onAsset(f); e.target.value = '' }} />
                    </label>
                    {draft.storagePath
                      ? <span className="text-xs text-graphite">{draft.fileName}（{fmtBytes(draft.sizeBytes)}）</span>
                      : <span className="text-xs text-alert">未アップロード</span>}
                  </div>
                  <p className="mt-1 text-[11px] text-mist">※原本は公開URLを発行しません。会員が押した時だけ5分間有効なリンクを発行して配信します。</p>
                </div>
              )}

              {/* 日本語 */}
              <label className="text-[11px] text-mist sm:col-span-2">タイトル（日本語）<input className="field-input mt-1" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
              <label className="text-[11px] text-mist sm:col-span-2">{draft.kind === 'recipe' ? '作り方（日本語・Markdown）' : '説明（日本語・Markdown）'}
                <textarea rows={draft.kind === 'recipe' ? 10 : 4} className="field-input mt-1 font-mono" value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} placeholder={draft.kind === 'recipe' ? '## 材料\n\n- 抹茶 2g\n- 牛乳 200ml\n\n## 作り方\n\n1. …' : '素材の説明・利用条件など'} />
              </label>

              {/* English（未入力なら日本語にフォールバック） */}
              <label className="text-[11px] text-mist sm:col-span-2">Title (English)<input className="field-input mt-1" value={draft.titleEn} onChange={e => setDraft({ ...draft, titleEn: e.target.value })} placeholder="未入力なら日本語を表示" /></label>
              <label className="text-[11px] text-mist sm:col-span-2">Body (English · Markdown)
                <textarea rows={draft.kind === 'recipe' ? 10 : 4} className="field-input mt-1 font-mono" value={draft.bodyEn} onChange={e => setDraft({ ...draft, bodyEn: e.target.value })} placeholder="Leave blank to show the Japanese text to English visitors." />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-graphite">
              <label className="ml-auto flex cursor-pointer items-center gap-2"><input type="checkbox" checked={draft.published} onChange={e => setDraft({ ...draft, published: e.target.checked })} className="h-4 w-4 accent-[#174c33]" /> 公開する</label>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={save} disabled={busy || uploading !== null} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper hover:opacity-90 disabled:opacity-50">保存</button>
              <button onClick={() => setDraft(null)} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm text-ink hover:bg-bone">キャンセル</button>
            </div>
          </section>
        )}

        <section className="rounded-2xl border border-line bg-white p-2">
          {loading ? (
            <p className="py-10 text-center text-sm text-mist">読み込み中…</p>
          ) : items.length === 0 ? (
            <EmptyState message="コンテンツはまだありません。" />
          ) : (
            <ul className="divide-y divide-line">
              {items.map(r => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-3">
                  {r.thumbnailUrl
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={r.thumbnailUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                    : <div className="h-10 w-10 shrink-0 rounded bg-bone" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{r.title}</span>
                      <span className="rounded-full bg-bone px-2 py-0.5 text-[10px] text-graphite">{r.kind === 'asset' ? '素材' : 'レシピ'}</span>
                      {r.category && <span className="rounded-full bg-bone px-2 py-0.5 text-[10px] text-graphite">{r.category}</span>}
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${r.published ? 'border-matcha text-matcha' : 'border-line text-mist'}`}>{r.published ? '公開中' : '下書き'}</span>
                    </div>
                    <p className="text-[11px] text-mist">
                      作成: {fmt(r.createdAtMs)}
                      {r.publishedAt ? ` ／ 公開: ${r.publishedAt.slice(0, 10)}` : ''}
                      {r.kind === 'asset' ? ` ／ ${r.fileName ?? '—'}（${fmtBytes(r.sizeBytes)}）` : ''}
                    </p>
                  </div>
                  {isAdmin && (
                    <>
                      <button onClick={() => edit(r)} className="rounded-lg p-2 text-mist hover:bg-bone hover:text-graphite" aria-label="編集"><Pencil size={16} /></button>
                      <button onClick={() => remove(r)} className="rounded-lg p-2 text-alert hover:bg-alert/5" aria-label="削除"><Trash2 size={16} /></button>
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
