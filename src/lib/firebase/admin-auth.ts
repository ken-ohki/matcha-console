import { getAuth, type Auth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import type { UserRole } from '@/types'
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

export interface AuthedUser {
  uid: string
  email: string
  role: UserRole
}

function normalizeRole(r: unknown): UserRole {
  return r === 'admin' || r === 'finance' ? r : 'viewer'
}

/** Verify the Bearer ID token and load the caller's console role. Any authenticated
 *  user with a `users/{uid}` profile passes (read access); callers gate on `.role`. */
export async function requireUser(request: Request): Promise<AuthedUser> {
  const header = request.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer (.+)$/i)
  if (!match) throw new AuthError(401, 'missing_token')

  let decoded
  try {
    decoded = await getAdminAuth().verifyIdToken(match[1])
  } catch {
    throw new AuthError(401, 'invalid_token')
  }

  const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'matcha-console'
  const db = getFirestore(getAdminApp(), databaseId)
  const userSnap = await db.collection('users').doc(decoded.uid).get()
  if (!userSnap.exists) throw new AuthError(403, 'user_not_found')

  return { uid: decoded.uid, email: decoded.email ?? '', role: normalizeRole(userSnap.data()?.role) }
}

/** Require the caller's role to be one of `roles`, else 403. */
export async function requireRole(request: Request, roles: UserRole[]): Promise<AuthedUser> {
  const user = await requireUser(request)
  if (!roles.includes(user.role)) throw new AuthError(403, 'forbidden')
  return user
}

export async function requireAdmin(request: Request): Promise<AuthedUser> {
  const user = await requireUser(request)
  if (user.role !== 'admin') throw new AuthError(403, 'not_admin')
  return user
}
