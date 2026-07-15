import { NextResponse } from 'next/server'
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { getAdminApp } from '@/lib/firebase/admin'
import { requireAdmin, requireUser, AuthError } from '@/lib/firebase/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Resource Center (会員限定) の管理API。公開側は sabo-wholesale の
// /api/wholesale/resources が読む（同一 Firestore / 同一 Storage バケット）。
// 形は announcements の管理API を踏襲。

function db(): Firestore {
  return getFirestore(getAdminApp(), process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'matcha-console')
}
function handleAuthError(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status })
  return NextResponse.json({ error: 'internal' }, { status: 500 })
}

interface Body {
  id?: string
  kind?: 'recipe' | 'asset'
  title?: string
  titleEn?: string
  category?: string
  body?: string
  bodyEn?: string
  thumbnailUrl?: string
  // asset のみ（console からアップロード済みの原本を指す）
  storagePath?: string
  fileName?: string
  contentType?: string
  sizeBytes?: number
  sortOrder?: number
  published?: boolean
}

/** List all resources (staff — includes unpublished). */
export async function GET(request: Request) {
  // 閲覧は任意の認証ユーザー。作成/削除は admin 限定。
  try { await requireUser(request) } catch (err) { return handleAuthError(err) }
  const snap = await db().collection('resources').get()
  const items = snap.docs
    .map(d => {
      const data = d.data() as Record<string, unknown>
      const { updatedAt: _u, createdAt: _c, ...rest } = data
      return {
        ...rest,
        id: d.id,
        sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
        createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : 0,
      }
    })
    .sort((a, b) => (a.sortOrder as number) - (b.sortOrder as number) || (b.createdAtMs as number) - (a.createdAtMs as number))
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Create or update a resource. */
export async function POST(request: Request) {
  try { await requireAdmin(request) } catch (err) { return handleAuthError(err) }
  let body: Body
  try { body = (await request.json()) as Body } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }
  if (!String(body.title ?? '').trim()) return NextResponse.json({ error: 'missing_title' }, { status: 400 })

  const kind = body.kind === 'asset' ? 'asset' : 'recipe'
  // 素材は原本ファイルが無いとダウンロードできない＝公開する意味がないので必須。
  if (kind === 'asset' && !String(body.storagePath ?? '').trim()) {
    return NextResponse.json({ error: 'missing_asset_file' }, { status: 400 })
  }

  const database = db()
  const published = body.published === true
  const fields: Record<string, unknown> = {
    kind,
    title: String(body.title).trim(),
    titleEn: String(body.titleEn ?? '').trim() || null,
    category: String(body.category ?? '').trim() || null,
    body: String(body.body ?? ''),
    bodyEn: String(body.bodyEn ?? '') || null,
    thumbnailUrl: String(body.thumbnailUrl ?? '').trim() || null,
    storagePath: kind === 'asset' ? String(body.storagePath ?? '').trim() || null : null,
    fileName: kind === 'asset' ? String(body.fileName ?? '').trim() || null : null,
    contentType: kind === 'asset' ? String(body.contentType ?? '').trim() || null : null,
    sizeBytes: kind === 'asset' && typeof body.sizeBytes === 'number' ? body.sizeBytes : null,
    sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 0,
    published,
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (body.id) {
    const ref = database.collection('resources').doc(body.id)
    const cur = await ref.get()
    if (!cur.exists) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const prev = cur.data() as { storagePath?: string; publishedAt?: string }
    // Stamp publishedAt the first time it goes live (announcements と同じ挙動)。
    if (published && !prev.publishedAt) fields.publishedAt = new Date().toISOString()
    if (!published) fields.publishedAt = prev.publishedAt ?? null
    // 原本を差し替えたら、古いファイルは Storage から消す（孤児を残さない）。
    const nextPath = fields.storagePath as string | null
    if (prev.storagePath && prev.storagePath !== nextPath) {
      await deleteStorageObject(prev.storagePath)
    }
    await ref.set(fields, { merge: true })
    return NextResponse.json({ ok: true, id: body.id })
  }

  const ref = database.collection('resources').doc()
  await ref.set({
    ...fields,
    publishedAt: published ? new Date().toISOString() : null,
    createdAtMs: Date.now(),
    createdAt: FieldValue.serverTimestamp(),
  })
  return NextResponse.json({ ok: true, id: ref.id })
}

/** Delete a resource (and its protected original in Storage). */
export async function DELETE(request: Request) {
  try { await requireAdmin(request) } catch (err) { return handleAuthError(err) }
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })
  const ref = db().collection('resources').doc(id)
  const cur = await ref.get()
  const storagePath = (cur.data() as { storagePath?: string } | undefined)?.storagePath
  if (storagePath) await deleteStorageObject(storagePath)
  await ref.delete()
  return NextResponse.json({ ok: true })
}

/** Best-effort removal of a Storage object by path (never blocks the write). */
async function deleteStorageObject(path: string): Promise<void> {
  try {
    const bucketName = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || undefined
    await getStorage(getAdminApp()).bucket(bucketName).file(path).delete()
  } catch (err) {
    console.error('[resources] storage delete failed', path, err)
  }
}
