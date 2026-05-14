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

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount), projectId: serviceAccount.project_id })
}
const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'chaflow'
const db = getFirestore(databaseId)

const SEED = [
  // Tea types
  { type: 'tea_type', englishName: 'Matcha', japaneseName: '抹茶' },
  { type: 'tea_type', englishName: 'Gyokuro Powder', japaneseName: '玉露パウダー' },
  { type: 'tea_type', englishName: 'Hojicha Powder', japaneseName: 'ほうじ茶パウダー' },
  // Grades
  { type: 'grade', englishName: 'Specialty', japaneseName: 'スペシャリティ' },
  { type: 'grade', englishName: 'Premium', japaneseName: 'プレミアム' },
  { type: 'grade', englishName: 'Barista', japaneseName: 'バリスタ' },
  { type: 'grade', englishName: 'Culinary', japaneseName: 'カリナリー' },
  // Origins
  { type: 'origin', englishName: 'Aichi', japaneseName: '愛知' },
  { type: 'origin', englishName: 'Nishio', japaneseName: '西尾' },
  { type: 'origin', englishName: 'Kagoshima', japaneseName: '鹿児島' },
  { type: 'origin', englishName: 'Yame', japaneseName: '八女' },
  { type: 'origin', englishName: 'Shizuoka', japaneseName: '静岡' },
  { type: 'origin', englishName: 'Uji', japaneseName: '宇治' },
  { type: 'origin', englishName: 'Mie', japaneseName: '三重' },
  { type: 'origin', englishName: 'Blend', japaneseName: 'ブレンド' },
  // Cultivars
  { type: 'cultivar', englishName: 'Saemidori', japaneseName: 'さえみどり' },
  { type: 'cultivar', englishName: 'Asahi', japaneseName: 'あさひ' },
  { type: 'cultivar', englishName: 'Asatsuyu', japaneseName: 'あさつゆ' },
  { type: 'cultivar', englishName: 'Ujihikari', japaneseName: 'うじひかり' },
  { type: 'cultivar', englishName: 'Samidori', japaneseName: 'さみどり' },
  { type: 'cultivar', englishName: 'Okumidori', japaneseName: 'おくみどり' },
  { type: 'cultivar', englishName: 'Yabukita', japaneseName: 'やぶきた' },
  { type: 'cultivar', englishName: 'Tsuyuhikari', japaneseName: 'つゆひかり' },
  { type: 'cultivar', englishName: 'Kirari31', japaneseName: 'きらり31' },
  { type: 'cultivar', englishName: 'Seimei', japaneseName: 'せいめい' },
  { type: 'cultivar', englishName: 'Okuyutaka', japaneseName: 'おくゆたか' },
  { type: 'cultivar', englishName: 'Tea Master Blend', japaneseName: 'マスターブレンド' },
  // Plucking
  { type: 'plucking', englishName: 'Hand pick', japaneseName: '手摘み' },
  { type: 'plucking', englishName: 'Machine', japaneseName: '機械摘み' },
  // Harvest
  { type: 'harvest', englishName: '1st flush', japaneseName: '1番茶' },
  { type: 'harvest', englishName: '2nd flush', japaneseName: '2番茶' },
  { type: 'harvest', englishName: 'Autumn-Winter', japaneseName: '秋冬番茶' },
  { type: 'harvest', englishName: 'Blend', japaneseName: 'ブレンドオブハーベスト' },
  // Shading
  { type: 'shading', englishName: 'Canopy shading', japaneseName: '棚掛け' },
  { type: 'shading', englishName: 'Direct shading', japaneseName: '直掛け' },
  { type: 'shading', englishName: 'No shading', japaneseName: '被覆なし' },
  // Certification
  { type: 'certification', englishName: 'JAS Organic', japaneseName: '有機JAS' },
  { type: 'certification', englishName: 'FSSC 22000', japaneseName: 'FSSC22000' },
  { type: 'certification', englishName: 'USDA Organic', japaneseName: 'US有機' },
  { type: 'certification', englishName: 'EU Organic', japaneseName: 'EU有機' },
]

// Assign sortOrder per type
const counters = new Map()
for (const entry of SEED) {
  const i = counters.get(entry.type) ?? 0
  entry.sortOrder = i
  counters.set(entry.type, i + 1)
}

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`)
console.log(`Entries to seed: ${SEED.length}`)

const existing = await db.collection('masters').get()
console.log(`Existing master docs: ${existing.size}`)

if (!APPLY) {
  console.log('-- DRY RUN. Run with --apply to seed. --')
  process.exit(0)
}

// Delete existing first
if (existing.size > 0) {
  const BATCH = 400
  const ids = existing.docs.map(d => d.id)
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = db.batch()
    for (const id of ids.slice(i, i + BATCH)) batch.delete(db.collection('masters').doc(id))
    await batch.commit()
  }
  console.log(`Deleted ${ids.length} existing master entries.`)
}

const BATCH = 400
for (let i = 0; i < SEED.length; i += BATCH) {
  const batch = db.batch()
  for (const entry of SEED.slice(i, i + BATCH)) {
    const ref = db.collection('masters').doc()
    batch.set(ref, {
      ...entry,
      isActive: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()
}
console.log(`Seeded ${SEED.length} master entries.`)
