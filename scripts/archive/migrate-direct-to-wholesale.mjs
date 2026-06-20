#!/usr/bin/env node
// One-time, idempotent migration of the old direct-sales system into the
// wholesale system:
//   buyers  -> wholesale_members  (id: manual:buyer:<buyerId>)
//   sales   -> wholesale_orders   (id: migrated:<saleId>)  + ec_sales ledger
// Deterministic ids => re-runnable without duplicates. NEVER deletes anything.
// The old `sales`/`buyers` collections are left intact (delete later, separately).
//
// Usage:
//   node scripts/migrate-direct-to-wholesale.mjs            # dry-run (default)
//   node scripts/migrate-direct-to-wholesale.mjs --commit   # write
//
// Run scripts/backup-collections.mjs FIRST.
import { getDb, Timestamp, toJsonSafe } from '../_firestore.mjs'

const COMMIT = process.argv.includes('--commit')
const { db, projectId, dbId } = getDb()
console.log(`Migration target: ${projectId} / ${dbId}  (${COMMIT ? 'COMMIT' : 'dry-run'})\n`)

const normalizeName = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const slug = s => normalizeName(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unknown'
const isReservedSale = st => st === 'negotiating' || st === 'confirmed'
// Accept live Firestore Timestamp (.toMillis), backup JSON {__ts}, or a date string.
const toMs = d => {
  if (d == null) return NaN
  if (typeof d === 'object') {
    if (typeof d.toMillis === 'function') return d.toMillis()
    if (typeof d.__ts === 'number') return d.__ts
    if (typeof d._seconds === 'number') return d._seconds * 1000
  }
  return Date.parse(d)
}
const tsFromDate = d => {
  const ms = toMs(d)
  return Number.isFinite(ms) ? Timestamp.fromMillis(ms) : null
}
const dateStr = (d, fallback) => {
  const ms = toMs(d)
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : (fallback ?? '')
}
const isDomestic = c => ['japan', '日本', 'jp'].includes(String(c ?? '').trim().toLowerCase())

// Tax: 0=exempt, 8=reduced(matcha), 10=standard. Fees always 10%. Floor per bucket.
function computeTax(items, feesTotal) {
  let exempt = 0, reduced = 0, standard = feesTotal
  for (const it of items) {
    const rate = it.taxRate == null ? 8 : Number(it.taxRate)
    const amt = Number(it.revenue) || 0
    if (rate === 0) exempt += amt
    else if (rate === 8) reduced += amt
    else standard += amt
  }
  const reducedTax = Math.floor(reduced * 0.08)
  const standardTax = Math.floor(standard * 0.10)
  const taxBreakdown = []
  if (exempt) taxBreakdown.push({ rate: 0, taxableJpy: exempt, taxJpy: 0 })
  if (reduced) taxBreakdown.push({ rate: 8, taxableJpy: reduced, taxJpy: reducedTax })
  if (standard) taxBreakdown.push({ rate: 10, taxableJpy: standard, taxJpy: standardTax })
  return { taxBreakdown, taxJpy: reducedTax + standardTax }
}

function mapPaymentMethod(pm) {
  const s = String(pm ?? '').toLowerCase()
  if (s.includes('振込') || s.includes('bank') || s.includes('transfer')) return 'bank_transfer'
  if (s.includes('stripe') || s.includes('card') || s.includes('カード')) return 'stripe'
  return 'bank_transfer'
}

function mapStatus(sale) {
  if (sale.status === 'cancelled') return 'cancelled'
  if (sale.status === 'negotiating') return 'pending_quote'
  if (sale.shippingStatus === 'shipped') return 'shipped'
  if (sale.paymentStatus === 'paid') return 'paid'
  return 'pending_payment' // confirmed but not yet paid/shipped
}

// ---- Load ----
const [buyersSnap, salesSnap, membersSnap] = await Promise.all([
  db.collection('buyers').get(),
  db.collection('sales').get(),
  db.collection('wholesale_members').get(),
])
const buyers = buyersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
const sales = salesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
const members = membersSnap.docs.map(d => ({ uid: d.id, ...d.data() }))

// buyerId -> existing member uid (buyers already linked from a member)
const linkedByBuyerId = new Map()
for (const m of members) if (m.buyerId) linkedByBuyerId.set(m.buyerId, m.uid)

// normalizedName -> buyer (for resolving sale contact/company details)
const buyerByNorm = new Map()
for (const b of buyers) buyerByNorm.set(b.normalizedName || normalizeName(b.name), b)

// ---- Plan members ----
// normalizedName -> memberUid (existing or to-be-created)
const memberByNorm = new Map()
for (const m of members) if (m.companyName) memberByNorm.set(normalizeName(m.companyName), m.uid)

const memberWrites = [] // { id, data }
for (const b of buyers) {
  const norm = b.normalizedName || normalizeName(b.name)
  if (linkedByBuyerId.has(b.id)) { memberByNorm.set(norm, linkedByBuyerId.get(b.id)); continue }
  if (memberByNorm.has(norm)) continue // already represented by an existing member
  const uid = `manual:buyer:${b.id}`
  memberByNorm.set(norm, uid)
  const notes = [b.notes, b.terms ? `取引条件: ${b.terms}` : ''].filter(Boolean).join('\n')
  memberWrites.push({
    id: uid,
    data: {
      email: b.email || '',
      source: 'manual',
      status: 'approved',
      companyName: b.name || '(no name)',
      contactName: b.contactPersonName || b.name || '',
      phone: b.phone || '',
      country: b.country || '',
      postalCode: b.shippingPostalCode || null,
      address: b.shippingAddress || null,
      buyerId: b.id,
      notes: notes || null,
      defaultShipping: { contactName: b.contactPersonName || '', phone: b.phone || '', country: b.country || '', postalCode: b.shippingPostalCode || '', address: b.shippingAddress || '' },
      defaultBilling: { companyName: b.billingName || b.name || '', email: b.email || '', phone: b.phone || '', country: b.country || '', postalCode: b.shippingPostalCode || '', address: b.shippingAddress || '' },
      migratedFromBuyer: b.id,
      createdAt: tsFromDate(b.createdAt) || Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
  })
}

// Fallback members for sales whose buyer is missing
const fallbackMembers = new Map() // norm -> {id,data}
function resolveMember(buyerName) {
  const norm = normalizeName(buyerName)
  if (memberByNorm.has(norm)) return memberByNorm.get(norm)
  const uid = `manual:saleBuyer:${slug(buyerName)}`
  if (!fallbackMembers.has(norm)) {
    fallbackMembers.set(norm, {
      id: uid,
      data: { email: '', source: 'manual', status: 'approved', companyName: buyerName || '(no name)', contactName: buyerName || '', phone: '', country: '', createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
    })
  }
  memberByNorm.set(norm, uid)
  return uid
}

// ---- Plan orders + ec_sales ----
const orderWrites = []
const ecWrites = []
const reservedFromSales = {} // productId -> kg (old catalog basis)
const reservedFromEc = {}    // productId -> kg (migration basis) — must match
const spendByMember = {}     // memberUid -> totalJpy (for reconciliation)

for (const s of sales) {
  const memberUid = resolveMember(s.buyerName)
  const items = (Array.isArray(s.items) && s.items.length ? s.items : [{
    productId: s.productId, productSku: s.productSku, productName: s.productName,
    quantityKg: s.quantityKg, unitPrice: s.unitPrice, costPerKg: s.costPerKg, revenue: s.revenue, costAmount: s.costAmount, grossProfit: s.grossProfit, taxRate: 8,
  }]).map(it => ({
    kind: 'wholesale', productId: String(it.productId ?? ''), productSku: String(it.productSku ?? ''), productName: String(it.productName ?? ''),
    quantityKg: Number(it.quantityKg) || 0, unitPriceJpy: Number(it.unitPrice) || 0, lineTotalJpy: Number(it.revenue) || 0,
    _taxRate: it.taxRate == null ? 8 : Number(it.taxRate),
  }))

  const subtotalJpy = items.reduce((a, it) => a + it.lineTotalJpy, 0)
  const shippingFeeJpy = Number(s.shippingFee) || 0
  const feeItems = Array.isArray(s.fees) ? s.fees : []
  const sumFees = feeItems.reduce((a, f) => a + (Number(f.quantity) || 0) * (Number(f.unitPrice) || 0), 0)
  const optionFeesJpy = sumFees + (Number(s.otherFees) || 0)
  const { taxBreakdown, taxJpy } = computeTax(items.map(it => ({ revenue: it.lineTotalJpy, taxRate: it._taxRate })), shippingFeeJpy + optionFeesJpy)
  const exTax = subtotalJpy + shippingFeeJpy + optionFeesJpy // == old invoiceAmount
  const totalJpy = exTax + taxJpy
  const domestic = isDomestic(s.country)
  const orderId = `migrated:${s.id}`
  const created = tsFromDate(s.createdAt) || Timestamp.now()
  const orderNumber = `D-${dateStr(s.orderDate || s.createdAt, '')}-${s.id.slice(0, 4)}`.replace('--', '-')
  const buyer = buyerByNorm.get(normalizeName(s.buyerName))

  const order = {
    id: orderId,
    orderNumber,
    memberUid,
    memberCompanyName: buyer?.name || s.buyerName || '',
    items: items.map(({ _taxRate, ...rest }) => rest),
    subtotalJpy,
    taxBreakdown,
    taxJpy,
    totalJpy,
    displayCurrency: 'JPY',
    displayTotal: totalJpy,
    paymentMethod: mapPaymentMethod(s.paymentMethod),
    paymentStatus: s.paymentStatus === 'paid' ? 'paid' : 'unpaid',
    status: mapStatus(s),
    isDomestic: domestic,
    shippingWeightKg: items.reduce((a, it) => a + it.quantityKg, 0),
    shippingFeeJpy,
    shippingTaxJpy: domestic ? Math.floor(shippingFeeJpy * 0.10) : 0,
    optionFeesJpy,
    optionTaxJpy: domestic ? Math.floor(optionFeesJpy * 0.10) : 0,
    shippingCountry: s.country || 'Japan',
    shippingAddress: s.shippingAddress || null,
    shippingPostalCode: s.shippingPostalCode || null,
    contactName: buyer?.contactPersonName || '',
    phone: buyer?.phone || '',
    notes: s.notes || '',
    buyerTaxId: null,
    billingSameAsShipping: true,
    ecSaleIds: [],
    trackingNumber: s.trackingNumber || null,
    shippingCarrierLabel: s.shippingMethod || null,
    shippedAt: s.shippingStatus === 'shipped' ? (dateStr(s.shippingDate) || null) : null,
    dueDate: s.dueDate || null,
    paidAt: s.paymentStatus === 'paid' ? (tsFromDate(s.paymentDate) || created) : null,
    costAmountJpy: Number(s.costAmount) || 0,
    grossProfitJpy: Number(s.grossProfit) || 0,
    paymentFeeJpy: Number(s.paymentFee) || 0,
    origin: 'direct',
    migratedFrom: s.id,
    createdAt: created,
    createdAtMs: created.toMillis(),
    updatedAt: Timestamp.now(),
  }

  if (s.status !== 'cancelled') spendByMember[memberUid] = (spendByMember[memberUid] || 0) + totalJpy

  // ec_sales ledger only for reserved sales (mirror catalog's reservation rule)
  if (isReservedSale(s.status)) {
    items.forEach((it, i) => {
      if (!it.productId) return
      const ecId = `migrated:${s.id}:${i}`
      order.ecSaleIds.push(ecId)
      ecWrites.push({ id: ecId, data: {
        productId: it.productId, productSku: it.productSku, productName: it.productName, quantityKg: it.quantityKg,
        channel: 'Wholesale', status: 'active', wholesaleOrderId: orderId, orderNumber,
        soldOn: dateStr(s.orderDate || s.createdAt, ''), unitPrice: it.unitPriceJpy, revenue: it.lineTotalJpy,
        createdAt: created, updatedAt: Timestamp.now(),
      } })
      reservedFromEc[it.productId] = (reservedFromEc[it.productId] || 0) + it.quantityKg
    })
    items.forEach(it => { if (it.productId) reservedFromSales[it.productId] = (reservedFromSales[it.productId] || 0) + it.quantityKg })
  }
  orderWrites.push({ id: orderId, data: order })
}

const allMemberWrites = [...memberWrites, ...fallbackMembers.values()]

// ---- Report ----
console.log(`Buyers: ${buyers.length} → new members: ${memberWrites.length} (linked/skipped: ${buyers.length - memberWrites.length})`)
console.log(`Fallback members (orphan sales): ${fallbackMembers.size}`)
console.log(`Sales: ${sales.length} → orders: ${orderWrites.length}`)
console.log(`ec_sales ledger docs (active reservations): ${ecWrites.length}\n`)

// Stock-neutrality proof: reserved-from-sales must equal reserved-from-ec per product
let mismatch = 0
const pids = new Set([...Object.keys(reservedFromSales), ...Object.keys(reservedFromEc)])
for (const pid of pids) {
  const a = reservedFromSales[pid] || 0, b = reservedFromEc[pid] || 0
  if (a !== b) { mismatch++; console.log(`  STOCK MISMATCH ${pid}: sales=${a} ec=${b}`) }
}
console.log(mismatch === 0 ? '✓ Stock neutral: migrated ec_sales == old sales reservations.' : `✗ ${mismatch} stock mismatches!`)
console.log('\nSpend by member (active orders):')
for (const [uid, total] of Object.entries(spendByMember)) console.log(`  ${uid.padEnd(32)} ¥${total.toLocaleString()}`)

if (!COMMIT) {
  console.log('\nDry-run only. Sample order:')
  console.log(JSON.stringify(toJsonSafe(orderWrites[0]?.data), null, 1).slice(0, 1400))
  console.log('\nRe-run with --commit to write.')
  process.exit(0)
}

// ---- Write ----
async function writeAll(col, rows, label) {
  let batch = db.batch(), n = 0
  for (const r of rows) {
    batch.set(db.collection(col).doc(r.id), r.data, { merge: true })
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch() }
  }
  if (n % 400 !== 0) await batch.commit()
  console.log(`  wrote ${n} ${label}`)
}
console.log('\nWriting…')
await writeAll('wholesale_members', allMemberWrites, 'members')
await writeAll('wholesale_orders', orderWrites, 'orders')
await writeAll('ec_sales', ecWrites, 'ec_sales')
console.log('Done.')
process.exit(0)
