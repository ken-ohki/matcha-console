import { NextResponse } from 'next/server'
import { getAdminDb } from '@/lib/firebase/admin'
import type { CatalogGroup, CatalogProduct, CatalogResponse, SupportedCurrency } from '@/lib/catalog'
import { SUPPORTED_CURRENCIES } from '@/lib/catalog'
import type { StockStatus } from '@/types'

const FALLBACK_RATES: Record<SupportedCurrency, number> = {
  JPY: 1,
  EUR: 0.0059,
  USD: 0.0064,
  AUD: 0.0098,
  SGD: 0.0086,
  HKD: 0.050,
  THB: 0.22,
  PHP: 0.37,
  IDR: 105,
}

async function fetchExchangeRates(): Promise<{
  rates: Record<SupportedCurrency, number>
  source: 'live' | 'fallback'
  asOf: string
}> {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/JPY', {
      next: { revalidate: 3600 },
    })
    if (!res.ok) throw new Error(`status ${res.status}`)
    const data = (await res.json()) as { rates?: Record<string, number>; time_last_update_utc?: string }
    if (!data.rates) throw new Error('rates missing')
    const rates = { JPY: 1 } as Record<SupportedCurrency, number>
    for (const code of SUPPORTED_CURRENCIES) {
      const r = data.rates[code]
      rates[code] = typeof r === 'number' && Number.isFinite(r) ? r : FALLBACK_RATES[code]
    }
    return { rates, source: 'live', asOf: data.time_last_update_utc ?? new Date().toISOString() }
  } catch {
    return { rates: FALLBACK_RATES, source: 'fallback', asOf: new Date().toISOString() }
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLLECTIONS = {
  groups: 'inventory_groups',
  products: 'products',
  sales: 'sales',
  selfConsumptions: 'self_consumptions',
  ecSales: 'ec_sales',
  settings: 'settings',
} as const

const DEFAULT_STOCK_ALERT_RATIO = 0.2
const DEFAULT_CURRENCY = 'JPY'

type AnyRecord = Record<string, unknown>

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(item => String(item ?? '').trim()).filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function deriveArrivalDate(records: unknown): string {
  if (!Array.isArray(records)) return ''
  const dates = records
    .map(r => String((r as AnyRecord)?.arrivalDate ?? '').trim())
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a))
  return dates[0] ?? ''
}

function deriveInitialStockKg(records: unknown): number {
  if (!Array.isArray(records)) return 0
  return records.reduce((sum, r) => sum + num((r as AnyRecord)?.quantityKg), 0)
}

function deriveAdjustmentKg(records: unknown): number {
  if (!Array.isArray(records)) return 0
  return records.reduce((sum, r) => sum + num((r as AnyRecord)?.adjustmentKg), 0)
}

const LOW_STOCK_THRESHOLD_KG = 10

function getStockStatus(currentKg: number): StockStatus {
  if (currentKg <= 0) return 'out'
  if (currentKg <= LOW_STOCK_THRESHOLD_KG) return 'low'
  return 'normal'
}

function isReservedSale(status: unknown): boolean {
  return status === 'negotiating' || status === 'confirmed'
}

function assertPasscode(provided: string | null | undefined): boolean {
  const expected = process.env.CATALOG_PASSCODE
  if (!expected) return false
  if (!provided) return false
  return provided === expected
}

export async function POST(request: Request) {
  let body: { passcode?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  if (!assertPasscode(body.passcode)) {
    return NextResponse.json({ error: 'invalid_passcode' }, { status: 401 })
  }

  let db
  try {
    db = getAdminDb()
  } catch (err) {
    return NextResponse.json(
      { error: 'server_misconfigured', detail: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }

  const [groupsSnap, productsSnap, salesSnap, selfSnap, ecSnap, settingsSnap, ratesInfo] = await Promise.all([
    db.collection(COLLECTIONS.groups).get(),
    db.collection(COLLECTIONS.products).get(),
    db.collection(COLLECTIONS.sales).get(),
    db.collection(COLLECTIONS.selfConsumptions).get(),
    db.collection(COLLECTIONS.ecSales).get(),
    db.collection(COLLECTIONS.settings).doc('main').get(),
    fetchExchangeRates(),
  ])

  const settings = settingsSnap.data() as AnyRecord | undefined
  const alertRatio = num(settings?.stockAlertRatio, DEFAULT_STOCK_ALERT_RATIO)
  const currency = String(settings?.currency ?? DEFAULT_CURRENCY)

  const reservedByProduct: Record<string, number> = {}
  salesSnap.docs.forEach(doc => {
    const data = doc.data() as AnyRecord
    if (!isReservedSale(data.status)) return
    const items = Array.isArray(data.items) ? data.items : null
    if (items && items.length > 0) {
      items.forEach(raw => {
        const item = raw as AnyRecord
        const pid = String(item.productId ?? '')
        if (!pid) return
        reservedByProduct[pid] = (reservedByProduct[pid] ?? 0) + num(item.quantityKg)
      })
    } else {
      const pid = String(data.productId ?? '')
      if (pid) reservedByProduct[pid] = (reservedByProduct[pid] ?? 0) + num(data.quantityKg)
    }
  })

  const selfByProduct: Record<string, number> = {}
  selfSnap.docs.forEach(doc => {
    const data = doc.data() as AnyRecord
    const pid = String(data.productId ?? '')
    selfByProduct[pid] = (selfByProduct[pid] ?? 0) + num(data.quantityKg)
  })

  const ecByProduct: Record<string, number> = {}
  ecSnap.docs.forEach(doc => {
    const data = doc.data() as AnyRecord
    const pid = String(data.productId ?? '')
    ecByProduct[pid] = (ecByProduct[pid] ?? 0) + num(data.quantityKg)
  })

  const groups: CatalogGroup[] = groupsSnap.docs
    .map(doc => {
      const data = doc.data() as AnyRecord
      return {
        id: doc.id,
        name: String(data.name ?? ''),
        sortOrder: num(data.sortOrder),
        isActive: data.isActive !== false,
      }
    })
    .filter(g => g.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ id, name, sortOrder }) => ({ id, name, sortOrder }))

  const groupIds = new Set(groups.map(g => g.id))

  const products: CatalogProduct[] = productsSnap.docs
    .map(doc => {
      const data = doc.data() as AnyRecord
      const arrivalRecords = data.arrivalRecords
      const inventoryChecks = data.inventoryChecks
      const initialStockKg = Array.isArray(arrivalRecords)
        ? deriveInitialStockKg(arrivalRecords)
        : num(data.initialStockKg)
      const arrivalDate = Array.isArray(arrivalRecords)
        ? deriveArrivalDate(arrivalRecords)
        : String(data.arrivalDate ?? '')
      const adjustmentKg = deriveAdjustmentKg(inventoryChecks)
      const haizUsedKg = num(data.haizUsedKg)
      const reservedKg = reservedByProduct[doc.id] ?? 0
      const selfUsedKg = selfByProduct[doc.id] ?? 0
      const ecSoldKg = ecByProduct[doc.id] ?? 0
      const baseline = Math.max(initialStockKg + adjustmentKg, 0)
      const currentKg = initialStockKg + adjustmentKg - haizUsedKg - reservedKg - selfUsedKg - ecSoldKg

      const product: CatalogProduct & { isActive: boolean; showInCatalog: boolean } = {
        id: doc.id,
        sku: String(data.sku ?? ''),
        name: String(data.name ?? ''),
        inventoryGroupId: String(data.inventoryGroupId ?? ''),
        teaType: data.teaType ? String(data.teaType) : undefined,
        grade: data.grade ? String(data.grade) : undefined,
        origins: toStringArray(data.origins ?? data.region),
        cultivars: toStringArray(data.cultivars ?? data.variety),
        pluckingMethods: toStringArray(data.pluckingMethods),
        harvestSeasons: toStringArray(data.harvestSeasons),
        shadingMethods: toStringArray(data.shadingMethods),
        certifications: toStringArray(data.certifications),
        standardWholesalePrice: data.standardWholesalePrice != null
          ? num(data.standardWholesalePrice, NaN)
          : data.price != null
            ? num(data.price, NaN)
            : undefined,
        arrivalDate: arrivalDate || undefined,
        stockStatus: getStockStatus(currentKg),
        currentStockKg: Math.max(currentKg, 0),
        inquireToOrder: data.inquireToOrder === true,
        salesNote: data.salesNote ? String(data.salesNote) : undefined,
        flavorNotes: data.flavorNotes ? String(data.flavorNotes) : undefined,
        imageUrl: data.imageUrl ? String(data.imageUrl) : undefined,
        sortOrder: num(data.sortOrder),
        isActive: data.isActive !== false,
        showInCatalog: data.showInCatalog !== false,
      }
      if (Number.isNaN(product.standardWholesalePrice as number)) {
        product.standardWholesalePrice = undefined
      }
      return product
    })
    .filter(p => p.isActive && p.showInCatalog && groupIds.has(p.inventoryGroupId))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(({ isActive: _ignored, showInCatalog: _ignored2, ...rest }) => rest)

  const payload: CatalogResponse = {
    groups,
    products,
    currency,
    generatedAt: new Date().toISOString(),
    exchangeRates: ratesInfo.rates,
    ratesAsOf: ratesInfo.asOf,
    ratesSource: ratesInfo.source,
  }

  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

