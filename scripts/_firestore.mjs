// Shared Firestore bootstrap + Timestamp-safe (de)serialization for the
// direct-sales → wholesale migration scripts. Loads creds from .env.local / .env.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = resolve(__dirname, '..')

for (const file of ['.env.local', '.env']) {
  try {
    const text = readFileSync(resolve(PROJECT_ROOT, file), 'utf-8')
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (!m) continue
      if (!(m[1] in process.env)) process.env[m[1]] = m[2]
    }
  } catch {}
}

export function getDb() {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
  const dbId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'matcha-console'
  const app = getApps()[0] ?? initializeApp({ credential: cert(sa), projectId: sa.project_id })
  const db = getFirestore(app, dbId)
  return { db, projectId: sa.project_id, dbId }
}

export { Timestamp, FieldValue }

// Convert Firestore values to JSON-safe form (Timestamps -> {__ts: ms}).
export function toJsonSafe(value) {
  if (value instanceof Timestamp) return { __ts: value.toMillis() }
  if (Array.isArray(value)) return value.map(toJsonSafe)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = toJsonSafe(v)
    return out
  }
  return value
}

// Inverse of toJsonSafe ({__ts: ms} -> Timestamp).
export function fromJsonSafe(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value.__ts === 'number') {
    return Timestamp.fromMillis(value.__ts)
  }
  if (Array.isArray(value)) return value.map(fromJsonSafe)
  if (value && typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = fromJsonSafe(v)
    return out
  }
  return value
}
