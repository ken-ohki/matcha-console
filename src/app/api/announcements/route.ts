import { NextResponse } from 'next/server'
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getAdminApp } from '@/lib/firebase/admin'
import { requireAdmin, AuthError } from '@/lib/firebase/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function db(): Firestore {
  return getFirestore(getAdminApp(), process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'matcha-console')
}
function handleAuthError(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status })
  return NextResponse.json({ error: 'internal' }, { status: 500 })
}

interface Body {
  id?: string
  title?: string
  titleEn?: string
  category?: string
  body?: string
  bodyEn?: string
  imageUrl?: string
  audience?: 'public' | 'members'
  published?: boolean
}

/** List all announcements (staff — includes unpublished). */
export async function GET(request: Request) {
  try { await requireAdmin(request) } catch (err) { return handleAuthError(err) }
  const snap = await db().collection('announcements').get()
  const items = snap.docs
    .map(d => {
      const data = d.data() as Record<string, unknown>
      const { updatedAt: _u, createdAt: _c, ...rest } = data
      return { ...rest, id: d.id, createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : 0 }
    })
    .sort((a, b) => (b.createdAtMs as number) - (a.createdAtMs as number))
  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Create or update an announcement. */
export async function POST(request: Request) {
  try { await requireAdmin(request) } catch (err) { return handleAuthError(err) }
  let body: Body
  try { body = (await request.json()) as Body } catch { return NextResponse.json({ error: 'invalid_body' }, { status: 400 }) }
  if (!String(body.title ?? '').trim()) return NextResponse.json({ error: 'missing_title' }, { status: 400 })

  const database = db()
  const published = body.published === true
  const audience = body.audience === 'members' ? 'members' : 'public'
  const fields: Record<string, unknown> = {
    title: String(body.title).trim(),
    titleEn: String(body.titleEn ?? '').trim() || null,
    category: String(body.category ?? '').trim() || null,
    body: String(body.body ?? ''),
    bodyEn: String(body.bodyEn ?? '') || null,
    imageUrl: String(body.imageUrl ?? '').trim() || null,
    audience,
    published,
    updatedAt: FieldValue.serverTimestamp(),
  }

  if (body.id) {
    const ref = database.collection('announcements').doc(body.id)
    const cur = await ref.get()
    if (!cur.exists) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    // Stamp publishedAt the first time it goes live.
    const had = (cur.data() as { publishedAt?: string }).publishedAt
    if (published && !had) fields.publishedAt = new Date().toISOString()
    if (!published) fields.publishedAt = had ?? null
    await ref.set(fields, { merge: true })
    return NextResponse.json({ ok: true, id: body.id })
  }

  const ref = database.collection('announcements').doc()
  await ref.set({
    ...fields,
    publishedAt: published ? new Date().toISOString() : null,
    createdAtMs: Date.now(),
    createdAt: FieldValue.serverTimestamp(),
  })
  return NextResponse.json({ ok: true, id: ref.id })
}

/** Delete an announcement. */
export async function DELETE(request: Request) {
  try { await requireAdmin(request) } catch (err) { return handleAuthError(err) }
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })
  await db().collection('announcements').doc(id).delete()
  return NextResponse.json({ ok: true })
}
