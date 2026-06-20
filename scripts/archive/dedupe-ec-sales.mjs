#!/usr/bin/env node
// One-off cleanup: remove duplicate ACTIVE Shopify EC sales caused by the old
// webhook race (random ids appended on concurrent orders/create + orders/paid).
// Groups active ec_sales by (shopifyOrderId, productSku, quantityKg) and keeps
// the OLDEST doc in each group, deleting the rest. Cancelled docs are untouched.
//
// Usage:
//   node scripts/dedupe-ec-sales.mjs            (dry-run: lists duplicates)
//   node scripts/dedupe-ec-sales.mjs --apply    (actually deletes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')
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

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
const DB_ID = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'matcha-console'
const app = initializeApp({ credential: cert(sa), projectId: sa.project_id })
const db = getFirestore(app, DB_ID)

console.log(`Target: ${sa.project_id} / ${DB_ID}  (${APPLY ? 'APPLY' : 'dry-run'})`)

const snap = await db.collection('ec_sales').where('channel', '==', 'Shopify').get()
const groups = new Map() // key -> [{id, createdAtMillis}]
for (const doc of snap.docs) {
  const d = doc.data()
  if (d.status === 'cancelled') continue
  if (!d.shopifyOrderId) continue
  const key = `${d.shopifyOrderId}::${d.productSku ?? ''}::${d.quantityKg ?? ''}`
  const createdAtMillis = d.createdAt?.toMillis?.() ?? 0
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push({ id: doc.id, ref: doc.ref, createdAtMillis, order: d.orderNumber })
}

let dupGroups = 0
let toDelete = 0
const batchRefs = []
for (const [key, docs] of groups) {
  if (docs.length <= 1) continue
  dupGroups++
  // Keep the oldest (smallest createdAt; ties → lexicographically smallest id).
  docs.sort((a, b) => a.createdAtMillis - b.createdAtMillis || a.id.localeCompare(b.id))
  const [keep, ...rest] = docs
  console.log(`  ${key} (${docs[0].order}): keep ${keep.id}, remove ${rest.length}`)
  for (const r of rest) { batchRefs.push(r.ref); toDelete++ }
}

console.log(`\nDuplicate groups: ${dupGroups}, docs to delete: ${toDelete}`)

if (APPLY && toDelete > 0) {
  for (let i = 0; i < batchRefs.length; i += 400) {
    const batch = db.batch()
    batchRefs.slice(i, i + 400).forEach(ref => batch.delete(ref))
    await batch.commit()
  }
  console.log(`Deleted ${toDelete} duplicate EC sales.`)
} else if (!APPLY) {
  console.log('Dry-run only. Re-run with --apply to delete.')
}

process.exit(0)
