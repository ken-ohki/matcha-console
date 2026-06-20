#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

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

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
if (getApps().length === 0) initializeApp({ credential: cert(sa), projectId: sa.project_id })
const db = getFirestore(process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'matcha-console')

// Field name → master type
const FIELD_TYPE = {
  cultivars: 'cultivar',
  origins: 'origin',
  pluckingMethods: 'plucking',
  harvestSeasons: 'harvest',
  shadingMethods: 'shading',
  certifications: 'certification',
}

// Known typo / alias overrides (apply before master lookup)
const ALIASES = {
  Samemidori: 'Saemidori',
}

const mastersSnap = await db.collection('masters').get()
const jaToEn = new Map() // `${type}::${ja}` → englishName
const valid = new Map()  // `${type}::${en}` → true
mastersSnap.docs.forEach(d => {
  const x = d.data()
  if (x.englishName) valid.set(`${x.type}::${x.englishName}`, true)
  if (x.japaneseName) jaToEn.set(`${x.type}::${x.japaneseName}`, x.englishName)
})

function normalizeValue(type, raw) {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const aliased = ALIASES[trimmed] ?? trimmed
  // If already valid English, keep
  if (valid.has(`${type}::${aliased}`)) return aliased
  // Try Japanese → English
  const en = jaToEn.get(`${type}::${aliased}`)
  if (en) return en
  // Unknown — keep as-is (so admin can see and fix)
  return aliased
}

function normalizeArray(type, arr) {
  if (!Array.isArray(arr)) return { values: [], changed: false }
  const seen = new Set()
  const out = []
  for (const v of arr) {
    const n = normalizeValue(type, v)
    if (n === null) continue
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  const changed = arr.length !== out.length || arr.some((v, i) => v !== out[i])
  return { values: out, changed }
}

const productsSnap = await db.collection('products').get()
console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)
console.log(`Products: ${productsSnap.size}`)
console.log()

const updates = []
for (const doc of productsSnap.docs) {
  const data = doc.data()
  const patch = {}
  const changes = []
  for (const [field, type] of Object.entries(FIELD_TYPE)) {
    const { values, changed } = normalizeArray(type, data[field])
    if (changed) {
      patch[field] = values
      changes.push(`${field}: [${(data[field] || []).join(', ')}] → [${values.join(', ')}]`)
    }
  }
  if (changes.length > 0) {
    updates.push({ id: doc.id, sku: data.sku, name: data.name, patch, changes })
  }
}

console.log(`Products needing updates: ${updates.length}`)
for (const u of updates) {
  console.log(`\n  ${u.sku} (${u.name})`)
  u.changes.forEach(c => console.log(`    - ${c}`))
}

if (!APPLY) {
  console.log('\n-- DRY RUN. Run with --apply to commit. --')
  process.exit(0)
}

const BATCH = 400
for (let i = 0; i < updates.length; i += BATCH) {
  const batch = db.batch()
  for (const u of updates.slice(i, i + BATCH)) {
    batch.update(db.collection('products').doc(u.id), { ...u.patch, updatedAt: FieldValue.serverTimestamp() })
  }
  await batch.commit()
}
console.log(`\nUpdated ${updates.length} products.`)
