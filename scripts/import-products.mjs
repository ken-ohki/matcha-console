#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..')

// Load .env.local manually (no dotenv dep)
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

const args = new Set(process.argv.slice(2))
const APPLY = args.has('--apply')

const dataPath = resolve(__dirname, 'import-data.json')
const data = JSON.parse(readFileSync(dataPath, 'utf-8'))

if (!process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  console.error('FIREBASE_SERVICE_ACCOUNT_KEY が未設定です')
  process.exit(1)
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
}
const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'chaflow'
const db = getFirestore(databaseId)

const COL = {
  groups: 'inventory_groups',
  products: 'products',
}

const today = new Date().toISOString().slice(0, 10)

async function ensureGroups(groupNames) {
  const snap = await db.collection(COL.groups).get()
  const existing = new Map(
    snap.docs.map(d => [String(d.data().name ?? ''), { id: d.id, data: d.data() }]),
  )
  const groupIdByName = new Map()
  const created = []
  const reactivated = []

  let nextSortOrder = snap.docs.reduce((max, d) => Math.max(max, Number(d.data().sortOrder ?? -1)), -1) + 1

  for (const name of groupNames) {
    const hit = existing.get(name)
    if (hit) {
      groupIdByName.set(name, hit.id)
      if (hit.data.isActive === false) {
        reactivated.push(name)
        if (APPLY) {
          await db.collection(COL.groups).doc(hit.id).update({
            isActive: true,
            updatedAt: FieldValue.serverTimestamp(),
          })
        }
      }
      continue
    }
    if (APPLY) {
      const ref = await db.collection(COL.groups).add({
        name,
        sortOrder: nextSortOrder,
        isActive: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      groupIdByName.set(name, ref.id)
    } else {
      groupIdByName.set(name, `__NEW__${name}`)
    }
    created.push(name)
    nextSortOrder += 1
  }

  return { groupIdByName, created, reactivated }
}

async function deleteExistingProducts() {
  const snap = await db.collection(COL.products).get()
  const ids = snap.docs.map(d => d.id)
  if (!APPLY || ids.length === 0) return ids
  const BATCH = 400
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = db.batch()
    for (const id of ids.slice(i, i + BATCH)) {
      batch.delete(db.collection(COL.products).doc(id))
    }
    await batch.commit()
  }
  return ids
}

function buildPayload(input, groupId, sortOrder) {
  const arrivalRecords = []
  if (input.currentStockKg != null && input.currentStockKg > 0) {
    arrivalRecords.push({
      id: `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      arrivalDate: today,
      quantityKg: Number(input.currentStockKg),
    })
  }
  const payload = {
    sku: input.sku,
    name: input.name,
    inventoryGroupId: groupId,
    teaType: input.teaType || undefined,
    grade: input.grade || undefined,
    origins: input.origins ?? [],
    cultivars: input.cultivars ?? [],
    pluckingMethods: input.pluckingMethods ?? [],
    harvestSeasons: input.harvestSeasons ?? [],
    shadingMethods: input.shadingMethods ?? [],
    certifications: input.certifications ?? [],
    arrivalRecords,
    inventoryChecks: [],
    arrivalDate: arrivalRecords[0]?.arrivalDate ?? '',
    initialStockKg: arrivalRecords.reduce((s, r) => s + r.quantityKg, 0),
    standardWholesalePrice: input.standardWholesalePrice ?? undefined,
    salesNote: input.salesNote || undefined,
    sortOrder,
    isActive: true,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
  // strip undefined
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined))
}

async function importProducts(products, groupIdByName) {
  // sortOrder per group, sequential
  const counterByGroup = new Map()
  const skippedByMissingGroup = []
  const targets = []
  for (const p of products) {
    const gid = groupIdByName.get(p.group)
    if (!gid) {
      skippedByMissingGroup.push(p.sku)
      continue
    }
    const order = counterByGroup.get(gid) ?? 0
    counterByGroup.set(gid, order + 1)
    targets.push({ p, gid, order })
  }
  if (!APPLY) return { created: targets.length, skippedByMissingGroup }

  const BATCH = 400
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = db.batch()
    for (const { p, gid, order } of targets.slice(i, i + BATCH)) {
      const ref = db.collection(COL.products).doc()
      batch.set(ref, buildPayload(p, gid, order))
    }
    await batch.commit()
  }
  return { created: targets.length, skippedByMissingGroup }
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (writes to Firestore)' : 'DRY RUN'}`)
  console.log(`Database: ${databaseId}`)
  console.log(`Project: ${serviceAccount.project_id}`)
  console.log()

  const { groupIdByName, created: createdGroups, reactivated } = await ensureGroups(data.groups)
  console.log(`Groups -> ensured ${groupIdByName.size}, new: [${createdGroups.join(', ') || '(none)'}], reactivated: [${reactivated.join(', ') || '(none)'}]`)

  const deleted = await deleteExistingProducts()
  console.log(`Existing products to DELETE: ${deleted.length}`)

  const { created, skippedByMissingGroup } = await importProducts(data.products, groupIdByName)
  console.log(`New products to create: ${created}`)
  if (skippedByMissingGroup.length > 0) {
    console.log(`Skipped (no matching group): ${skippedByMissingGroup.join(', ')}`)
  }
  console.log()
  if (!APPLY) {
    console.log('-- This was a DRY RUN. No changes were written. --')
    console.log('Run with --apply to commit:')
    console.log('  node scripts/import-products.mjs --apply')
  } else {
    console.log('Import complete.')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
