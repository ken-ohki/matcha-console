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

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
}
const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'matcha-console'
const db = getFirestore(databaseId)

const TARGET_ORDER = ['Specialty', 'Premium', 'Barista', 'Culinary']

const snap = await db.collection('masters').where('type', '==', 'grade').get()
console.log(`Found ${snap.size} grade entries`)

const byEnglish = new Map()
for (const doc of snap.docs) {
  byEnglish.set(doc.data().englishName, doc)
}

const batch = db.batch()
TARGET_ORDER.forEach((name, index) => {
  const doc = byEnglish.get(name)
  if (!doc) {
    console.warn(`! Missing grade master: "${name}"`)
    return
  }
  batch.update(doc.ref, { sortOrder: index, updatedAt: new Date() })
  console.log(`  ${index}: ${name}`)
})

// Push any extra grades to the end
let extraIdx = TARGET_ORDER.length
for (const [name, doc] of byEnglish) {
  if (TARGET_ORDER.includes(name)) continue
  batch.update(doc.ref, { sortOrder: extraIdx, updatedAt: new Date() })
  console.log(`  ${extraIdx}: ${name} (extra)`)
  extraIdx++
}

await batch.commit()
console.log('Done.')
