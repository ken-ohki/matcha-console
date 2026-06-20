import { NextResponse } from 'next/server'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getAdminApp } from '@/lib/firebase/admin'
import { getAdminAuth, requireAdmin, AuthError } from '@/lib/firebase/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function db() {
  const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'matcha-console'
  return getFirestore(getAdminApp(), databaseId)
}

function handleAuthError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status })
  }
  return NextResponse.json(
    { error: 'internal', detail: err instanceof Error ? err.message : 'unknown' },
    { status: 500 },
  )
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request)
  } catch (err) {
    return handleAuthError(err)
  }

  let body: { email?: string; password?: string; role?: 'admin' | 'viewer'; displayName?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase()
  const password = body.password
  const role = body.role === 'admin' ? 'admin' : 'viewer'
  const displayName = body.displayName?.trim()

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }
  if (!password || password.length < 6) {
    return NextResponse.json({ error: 'password_too_short' }, { status: 400 })
  }

  try {
    const adminAuth = getAdminAuth()
    const userRecord = await adminAuth.createUser({
      email,
      password,
      displayName,
      emailVerified: false,
      disabled: false,
    })

    await db().collection('users').doc(userRecord.uid).set({
      email,
      role,
      displayName: displayName || null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })

    return NextResponse.json({
      ok: true,
      user: { uid: userRecord.uid, email, role },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    const code = (err as { code?: string }).code
    if (code === 'auth/email-already-exists') {
      return NextResponse.json({ error: 'email_already_exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'create_failed', detail: message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const caller = await requireAdmin(request)
    const url = new URL(request.url)
    const uid = url.searchParams.get('uid')
    if (!uid) return NextResponse.json({ error: 'missing_uid' }, { status: 400 })
    if (uid === caller.uid) {
      return NextResponse.json({ error: 'cannot_delete_self' }, { status: 400 })
    }

    const adminAuth = getAdminAuth()
    try {
      await adminAuth.deleteUser(uid)
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code !== 'auth/user-not-found') throw err
    }
    await db().collection('users').doc(uid).delete()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleAuthError(err)
  }
}
