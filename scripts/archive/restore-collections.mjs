#!/usr/bin/env node
// Restore Firestore collections from a backup directory created by
// backup-collections.mjs. Restores each doc by id (full overwrite via set()).
//
// Usage:
//   node scripts/restore-collections.mjs scripts/backups/<ISO>            # dry-run
//   node scripts/restore-collections.mjs scripts/backups/<ISO> --commit   # apply
//   node scripts/restore-collections.mjs scripts/backups/<ISO> --commit sales buyers
//
// In dry-run it only reports counts. --commit writes. It NEVER deletes docs that
// are absent from the backup (use the dedicated delete script for removals).
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, basename } from 'node:path'
import { getDb, fromJsonSafe } from '../_firestore.mjs'

const args = process.argv.slice(2)
const dir = args.find(a => !a.startsWith('--'))
const COMMIT = args.includes('--commit')
const only = args.filter((a, i) => !a.startsWith('--') && a !== dir)

if (!dir) {
  console.error('Usage: node scripts/restore-collections.mjs <backupDir> [--commit] [collection...]')
  process.exit(1)
}

const { db, projectId, dbId } = getDb()
console.log(`Restore target: ${projectId} / ${dbId}  (${COMMIT ? 'COMMIT' : 'dry-run'})`)
console.log(`Source: ${dir}\n`)

const files = readdirSync(dir).filter(f => f.endsWith('.json'))
let grand = 0
for (const file of files) {
  const col = basename(file, '.json')
  if (only.length && !only.includes(col)) continue
  const rows = JSON.parse(readFileSync(resolve(dir, file), 'utf-8'))
  console.log(`  ${col.padEnd(20)} ${String(rows.length).padStart(6)} docs ${COMMIT ? '→ writing' : '(dry-run)'}`)
  if (COMMIT) {
    let batch = db.batch()
    let n = 0
    for (const row of rows) {
      batch.set(db.collection(col).doc(row.id), fromJsonSafe(row.data))
      if (++n % 400 === 0) { await batch.commit(); batch = db.batch() }
    }
    if (n % 400 !== 0) await batch.commit()
  }
  grand += rows.length
}
console.log(`\n${COMMIT ? 'Restored' : 'Would restore'} ${grand} docs.`)
process.exit(0)
