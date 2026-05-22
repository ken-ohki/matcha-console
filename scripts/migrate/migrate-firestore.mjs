#!/usr/bin/env node
// Migrate Firestore data from source (import-9b3ff / chaflow db) to destination (sabo-matcha-1767687963419 / matcha-console db).
// Usage:
//   node scripts/migrate/migrate-firestore.mjs            (dry-run: lists what would be copied)
//   node scripts/migrate/migrate-firestore.mjs --apply    (actually copies)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..')
const APPLY = process.argv.includes('--apply')

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

// Source: from FIREBASE_SERVICE_ACCOUNT_KEY env var
const srcSa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
const SRC_DB_ID = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'chaflow'
// Destination: from .dest-sa-key.json
const destSa = JSON.parse(readFileSync(resolve(PROJECT_ROOT, '.dest-sa-key.json'), 'utf-8'))
const DEST_DB_ID = 'matcha-console'

const srcApp = initializeApp({ credential: cert(srcSa), projectId: srcSa.project_id }, 'src')
const destApp = initializeApp({ credential: cert(destSa), projectId: destSa.project_id }, 'dest')
const srcDb = getFirestore(srcApp, SRC_DB_ID)
const destDb = getFirestore(destApp, DEST_DB_ID)

console.log(`Source:      ${srcSa.project_id} / ${SRC_DB_ID}`)
console.log(`Destination: ${destSa.project_id} / ${DEST_DB_ID}`)
console.log(`Mode:        ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (read only)'}`)
console.log('---')

const COLLECTIONS = [
  'products',
  'inventory_groups',
  'sales',
  'buyers',
  'self_consumptions',
  'ec_sales',
  'masters',
  'settings',
  'users',
  'purchase_orders',
  'suppliers',
]

async function copyCollection(name) {
  const snap = await srcDb.collection(name).get()
  console.log(`[${name}] ${snap.size} docs`)
  if (!APPLY || snap.size === 0) return snap.size

  // Batch in groups of 400 (Firestore limit is 500 per batch)
  let batch = destDb.batch()
  let count = 0
  for (const doc of snap.docs) {
    batch.set(destDb.collection(name).doc(doc.id), doc.data())
    count++
    if (count % 400 === 0) {
      await batch.commit()
      batch = destDb.batch()
    }
  }
  if (count % 400 !== 0) await batch.commit()
  console.log(`  → wrote ${count} docs to destination`)
  return count
}

let total = 0
for (const c of COLLECTIONS) {
  total += await copyCollection(c)
}
console.log('---')
console.log(`Total: ${total} docs across ${COLLECTIONS.length} collections`)
if (!APPLY) console.log('\nRe-run with --apply to actually write.')
