import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getAdminApp } from './admin'

let adminAuth: Auth | null = null

export function getAdminAuth(): Auth {
  if (adminAuth) return adminAuth
  adminAuth = getAuth(getAdminApp())
  return adminAuth
}

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function requireAdmin(request: Request): Promise<{ uid: string; email: string }> {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer (.+)$/i)
  if (!match) throw new AuthError(401, 'missing_token')
  const token = match[1]

  let decoded
  try {
    decoded = await getAdminAuth().verifyIdToken(token)
  } catch {
    throw new AuthError(401, 'invalid_token')
  }

  const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'chaflow'
  const db = getFirestore(getAdminApp(), databaseId)
  const userSnap = await db.collection('users').doc(decoded.uid).get()
  if (!userSnap.exists) throw new AuthError(403, 'user_not_found')
  const role = userSnap.data()?.role
  if (role !== 'admin') throw new AuthError(403, 'not_admin')

  return { uid: decoded.uid, email: decoded.email ?? '' }
}
