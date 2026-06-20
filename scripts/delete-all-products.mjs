#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')

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

const APPLY = process.argv.includes('--apply')

if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  console.error('FIREBASE_SERVICE_ACCOUNT_KEY が未設定です')
  process.exit(1)
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
}
const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'matcha-console'
const db = getFirestore(databaseId)

const snap = await db.collection('products').get()
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)
console.log(`Database: ${databaseId}`)
console.log(`Products found: ${snap.size}`)

if (!APPLY) {
  console.log('-- DRY RUN. Run with --apply to delete all products. --')
  process.exit(0)
}

const BATCH = 400
const ids = snap.docs.map(d => d.id)
for (let i = 0; i < ids.length; i += BATCH) {
  const batch = db.batch()
  for (const id of ids.slice(i, i + BATCH)) {
    batch.delete(db.collection('products').doc(id))
  }
  await batch.commit()
}
console.log(`Deleted ${ids.length} products.`)
