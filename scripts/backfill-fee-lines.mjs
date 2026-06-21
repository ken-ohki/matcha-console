// Backfill `feeLines` (named 諸費用 breakdown) onto migrated direct-sale orders.
//
// The direct-sales → wholesale migration collapsed each old sale's `fees` array
// (named 諸費用 like 包装代・通関手数料) into a single anonymous `optionFeesJpy`
// number, so the console showed "オプション料 ¥X" with no detail. This reads the
// pre-migration backup and writes each order's original fee items back as
// `feeLines` (display only — does NOT change any totals or tax).
//
// Usage:
//   node scripts/backfill-fee-lines.mjs                 # dry-run (no writes)
//   node scripts/backfill-fee-lines.mjs --commit        # apply
//
// Source: scripts/backups/<latest>/sales.json (or pass a path as the 2nd arg).
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { getDb, PROJECT_ROOT } from './_firestore.mjs'

const COMMIT = process.argv.includes('--commit')
const explicitPath = process.argv.find(a => a.endsWith('.json'))

function latestBackupSales() {
  const dir = resolve(PROJECT_ROOT, 'scripts', 'backups')
  const stamps = readdirSync(dir).filter(d => !d.startsWith('.')).sort()
  if (stamps.length === 0) throw new Error('no backup found under scripts/backups/')
  return resolve(dir, stamps[stamps.length - 1], 'sales.json')
}

function loadSales(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  const arr = Array.isArray(raw) ? raw : raw.docs || []
  // Support both [{id,data}] and flat [{id,...}] shapes.
  return arr.map(d => (d && d.data ? { id: d.id, ...d.data } : d))
}

const path = explicitPath ? resolve(explicitPath) : latestBackupSales()
console.log(`source: ${path}`)
console.log(COMMIT ? 'MODE: COMMIT (writing)' : 'MODE: dry-run (no writes)')

const sales = loadSales(path)
const { db } = getDb()

let scanned = 0, updated = 0, skipped = 0
for (const s of sales) {
  const fees = Array.isArray(s.fees) ? s.fees : []
  if (fees.length === 0) continue
  scanned++
  const feeLines = fees.map(f => {
    const quantity = Number(f.quantity) || 0
    const unitPriceJpy = Number(f.unitPrice) || 0
    return {
      name: String(f.name ?? '諸費用'),
      quantity,
      unit: f.unit ? String(f.unit) : undefined,
      unitPriceJpy,
      amountJpy: Math.round(quantity * unitPriceJpy),
      taxRate: f.taxRate != null ? Number(f.taxRate) : undefined,
    }
  })

  const orderId = `migrated:${s.id}`
  const ref = db.collection('wholesale_orders').doc(orderId)
  const snap = await ref.get()
  if (!snap.exists) { skipped++; continue }

  const total = feeLines.reduce((a, f) => a + f.amountJpy, 0)
  console.log(`  ${orderId}  feeLines=${feeLines.length}  ¥${total}  [${feeLines.map(f => f.name).join(', ')}]`)
  if (COMMIT) {
    await ref.set({ feeLines, updatedAt: new Date().toISOString() }, { merge: true })
    updated++
  }
}

console.log(`\ndone. sales-with-fees scanned=${scanned}, orders ${COMMIT ? 'updated' : 'to update'}=${COMMIT ? updated : scanned}, skipped(no order)=${skipped}`)
process.exit(0)
