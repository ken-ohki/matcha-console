import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const ADMIN_APP_NAME = 'matcha-console-admin'

let adminApp: App | null = null
let adminDb: Firestore | null = null

function tryLoadServiceAccount(): Record<string, unknown> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY
  if (!raw || !raw.trim()) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON')
  }
}

export function getAdminApp(): App {
  if (adminApp) return adminApp
  const existing = getApps().find(app => app.name === ADMIN_APP_NAME)
  if (existing) {
    adminApp = existing
    return existing
  }

  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID

  const serviceAccount = tryLoadServiceAccount()
  if (serviceAccount) {
    adminApp = initializeApp(
      { credential: cert(serviceAccount as Parameters<typeof cert>[0]), projectId },
      ADMIN_APP_NAME,
    )
    return adminApp
  }

  // Fallback: Application Default Credentials (gcloud auth application-default login)
  try {
    adminApp = initializeApp(
      { credential: applicationDefault(), projectId },
      ADMIN_APP_NAME,
    )
    return adminApp
  } catch (err) {
    throw new Error(
      `Firebase Admin の認証情報が見つかりません。FIREBASE_SERVICE_ACCOUNT_KEY を設定するか、'gcloud auth application-default login' を実行してください。詳細: ${err instanceof Error ? err.message : 'unknown'}`,
    )
  }
}

export function getAdminDb(): Firestore {
  if (adminDb) return adminDb
  const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'matcha-console'
  adminDb = getFirestore(getAdminApp(), databaseId)
  return adminDb
}
