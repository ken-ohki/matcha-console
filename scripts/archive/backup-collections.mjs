#!/usr/bin/env node
// Backup Firestore collections to timestamped JSON before the direct-sales →
// wholesale migration, so everything can be restored at any time.
//
// Usage:
//   node scripts/backup-collections.mjs                 # backs up the default set
//   node scripts/backup-collections.mjs sales buyers    # specific collections
//
// Output: scripts/backups/<ISO>/<collection>.json  (each: [{ id, data }] Timestamp-safe)
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getDb, toJsonSafe, PROJECT_ROOT } from '../_firestore.mjs'

const DEFAULT_COLLECTIONS = ['sales', 'buyers', 'ec_sales', 'wholesale_orders', 'wholesale_members']
const collections = process.argv.slice(2).filter(a => !a.startsWith('--'))
const targets = collections.length ? collections : DEFAULT_COLLECTIONS

const { db, projectId, dbId } = getDb()
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outDir = resolve(PROJECT_ROOT, 'scripts', 'backups', stamp)
mkdirSync(outDir, { recursive: true })

console.log(`Backup target: ${projectId} / ${dbId}`)
console.log(`Output: ${outDir}\n`)

let grand = 0
for (const col of targets) {
  const snap = await db.collection(col).get()
  const rows = snap.docs.map(d => ({ id: d.id, data: toJsonSafe(d.data()) }))
  writeFileSync(resolve(outDir, `${col}.json`), JSON.stringify(rows, null, 2))
  console.log(`  ${col.padEnd(20)} ${String(rows.length).padStart(6)} docs`)
  grand += rows.length
}
console.log(`\nDone. ${grand} docs across ${targets.length} collections.`)
console.log(`Restore with: node scripts/restore-collections.mjs ${outDir} --dry-run`)
process.exit(0)
