#!/usr/bin/env node
// Migrate Storage files from source bucket to destination bucket.
// Usage:
//   node scripts/migrate/migrate-storage.mjs            (dry-run)
//   node scripts/migrate/migrate-storage.mjs --apply    (copy files)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getStorage } from 'firebase-admin/storage'

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

const srcSa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
const destSa = JSON.parse(readFileSync(resolve(PROJECT_ROOT, '.dest-sa-key.json'), 'utf-8'))

const SRC_BUCKET = 'import-9b3ff.firebasestorage.app'
const DEST_BUCKET = 'sabo-matcha-1767687963419.firebasestorage.app'

const srcApp = initializeApp({ credential: cert(srcSa), projectId: srcSa.project_id, storageBucket: SRC_BUCKET }, 'src')
const destApp = initializeApp({ credential: cert(destSa), projectId: destSa.project_id, storageBucket: DEST_BUCKET }, 'dest')

const srcBucket = getStorage(srcApp).bucket()
const destBucket = getStorage(destApp).bucket()

console.log(`Source bucket:      ${SRC_BUCKET}`)
console.log(`Destination bucket: ${DEST_BUCKET}`)
console.log(`Mode:               ${APPLY ? 'APPLY (copying)' : 'DRY-RUN (listing)'}`)
console.log('---')

const [files] = await srcBucket.getFiles()
console.log(`Found ${files.length} files in source`)

let copied = 0
let skipped = 0
let errors = 0
for (const file of files) {
  const path = file.name
  if (!APPLY) {
    console.log(`  [dry-run] ${path}`)
    continue
  }
  try {
    // Check if already exists in destination
    const destFile = destBucket.file(path)
    const [exists] = await destFile.exists()
    if (exists) {
      skipped++
      continue
    }
    // Download and upload (cross-bucket copy via stream)
    const [buffer] = await file.download()
    const metadata = file.metadata
    await destFile.save(buffer, {
      contentType: metadata.contentType,
      metadata: { cacheControl: metadata.cacheControl },
    })
    copied++
    if (copied % 5 === 0) process.stdout.write(`. ${copied} `)
  } catch (err) {
    errors++
    console.log(`\n  ✗ ${path}: ${err.message}`)
  }
}

console.log('\n---')
console.log(`Copied: ${copied}, Skipped (already exists): ${skipped}, Errors: ${errors}`)
if (!APPLY) console.log('\nRe-run with --apply to actually copy.')
