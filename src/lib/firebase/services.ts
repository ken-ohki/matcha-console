import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore'
import {
  GoogleAuthProvider,
  onAuthStateChanged as firebaseOnAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth'
import type {
  ArrivalRecord,
  AuthUser,
  EcSaleRecord,
  InventoryCheckRecord,
  InventoryGroup,
  InventoryGroupInput,
  MasterEntry,
  MasterType,
  Product,
  ProductInput,
  ProductWithInventory,
  PurchaseInvoice,
  PurchaseInvoiceInput,
  PurchaseInvoiceLine,
  PurchaseInvoiceLineInput,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderLineInput,
  PurchaseOrderLineItem,
  PurchaseOrderStatus,
  PurchaseOrderPaymentStatus,
  PurchaseOrderPayment,
  UnbilledPoLine,
  SelfConsumptionRecord,
  SelfConsumptionRecordInput,
  SelfConsumptionUsageType,
  Settings,
  ShippingTierJp,
  WholesaleCoupon,
  WholesaleOption,
  WholesaleRankDiscounts,
  StockStatus,
  Supplier,
  SupplierDetailsInput,
  TaxRate,
} from '@/types'
import type {
  IAuthService,
  IEcSalesService,
  IInventoryService,
  IMastersService,
  IPurchaseInvoicesService,
  IPurchaseOrdersService,
  ISelfConsumptionService,
  ISettingsService,
  ISuppliersService,
  IServices,
  UserProfile,
} from '../services'
import { getFirebaseAuthInstance, getFirebaseDb } from './config'
import { ISSUER } from '../invoice'
import {
  computeInvoiceTotals,
  derivePoBillingStatus,
  derivePoPaymentStatus,
  deriveInvoicePaymentStatus,
  invoicePaidTotal,
  isLegacyPayablePo,
  poLineBillableRemaining,
  poLineSubtotal,
} from '../cashflow'
import { deleteStorageObjectByUrl } from './storage'

const COLLECTIONS = {
  groups: 'inventory_groups',
  products: 'products',
  selfConsumptions: 'self_consumptions',
  ecSales: 'ec_sales',
  settings: 'settings',
  users: 'users',
  masters: 'masters',
  purchaseOrders: 'purchase_orders',
  purchaseInvoices: 'purchase_invoices',
  suppliers: 'suppliers',
} as const

function toDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return value
  return new Date(0)
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item ?? '').trim())
      .filter(Boolean)
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()]
  }
  return []
}

function toIsoDate(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  // YYYY/MM/DD or YYYY.MM.DD
  const m = trimmed.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/)
  if (m) {
    const [, y, mo, d] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  // Fallback: try Date parsing
  const dt = new Date(trimmed)
  if (!Number.isNaN(dt.getTime())) {
    const y = dt.getFullYear()
    const mo = String(dt.getMonth() + 1).padStart(2, '0')
    const da = String(dt.getDate()).padStart(2, '0')
    return `${y}-${mo}-${da}`
  }
  return trimmed
}

function normalizeArrivalRecords(records: ArrivalRecord[]): ArrivalRecord[] {
  return records
    .map(record => ({
      id: String(record.id ?? '').trim(),
      arrivalDate: toIsoDate(String(record.arrivalDate ?? '')),
      quantityKg: Number(record.quantityKg ?? 0),
      ...(record.unitPrice != null ? { unitPrice: Number(record.unitPrice) || 0 } : {}),
    }))
    .filter(record => record.arrivalDate || record.quantityKg > 0)
}

function normalizeInventoryChecks(records: InventoryCheckRecord[]): InventoryCheckRecord[] {
  return records
    .map(record => ({
      id: String(record.id ?? '').trim(),
      checkedDate: toIsoDate(String(record.checkedDate ?? '')),
      countedQuantityKg: Number(record.countedQuantityKg ?? 0),
      expectedQuantityKg: Number(record.expectedQuantityKg ?? 0),
      adjustmentKg: Number(record.adjustmentKg ?? 0),
    }))
    .filter(record => (
      record.checkedDate ||
      record.countedQuantityKg !== 0 ||
      record.expectedQuantityKg !== 0 ||
      record.adjustmentKg !== 0
    ))
}

function deriveArrivalDate(records: ArrivalRecord[]): string {
  const dated = records
    .map(record => record.arrivalDate.trim())
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))

  return dated[0] ?? ''
}

function deriveInitialStockKg(records: ArrivalRecord[]): number {
  return records.reduce((sum, record) => sum + Number(record.quantityKg ?? 0), 0)
}

function deriveInventoryAdjustmentKg(records: InventoryCheckRecord[]): number {
  return records.reduce((sum, record) => sum + Number(record.adjustmentKg ?? 0), 0)
}

function getLatestInventoryCheck(records: InventoryCheckRecord[]): InventoryCheckRecord | undefined {
  return records
    .slice()
    .sort((left, right) => right.checkedDate.localeCompare(left.checkedDate))[0]
}

function toLegacyArrivalRecord(id: string, data: DocumentData): ArrivalRecord[] {
  const arrivalDate = String(data.arrivalDate ?? '').trim()
  const quantityKg = Number(data.initialStockKg ?? 0)
  if (!arrivalDate && quantityKg <= 0) return []

  return [{
    id: `legacy-${id}`,
    arrivalDate,
    quantityKg,
  }]
}

function buildProductPayload(input: ProductInput) {
  const arrivalRecords = normalizeArrivalRecords(input.arrivalRecords)
  const inventoryChecks = normalizeInventoryChecks(input.inventoryChecks)

  return sanitizeRecord({
    ...input,
    purchaseProductName: input.purchaseProductName?.trim() || undefined,
    supplier: input.supplier?.trim() || undefined,
    teaType: input.teaType?.trim() || undefined,
    grade: input.grade?.trim() || undefined,
    origins: toStringArray(input.origins),
    cultivars: toStringArray(input.cultivars),
    pluckingMethods: toStringArray(input.pluckingMethods),
    harvestSeasons: toStringArray(input.harvestSeasons),
    shadingMethods: toStringArray(input.shadingMethods),
    certifications: toStringArray(input.certifications),
    arrivalRecords,
    inventoryChecks,
    arrivalDate: deriveArrivalDate(arrivalRecords),
    initialStockKg: deriveInitialStockKg(arrivalRecords),
    standardWholesalePrice: input.standardWholesalePrice,
    purchaseUnitPrice: input.purchaseUnitPrice,
    adminNote: input.adminNote?.trim() || undefined,
    salesNote: input.salesNote?.trim() || undefined,
    flavorNotes: input.flavorNotes?.trim() || undefined,
    imageUrl: input.imageUrl?.trim() || undefined,
    showInCatalog: input.showInCatalog ?? true,
    inquireToOrder: input.inquireToOrder ?? false,
    madeToOrder: input.madeToOrder ?? false,
  })
}

const LOW_STOCK_THRESHOLD_KG = 10

function getStockStatus(currentKg: number): StockStatus {
  if (currentKg <= 0) return 'out'
  if (currentKg <= LOW_STOCK_THRESHOLD_KG) return 'low'
  return 'normal'
}

function getDefaultSettings(): Settings {
  return {
    appName: 'Matcha Console',
    currency: 'JPY',
    stockAlertRatio: 0.2,
    wholesaleThresholdKgDefault: 10,
    shippingRatesJp: [],
    wholesaleOptions: [],
    wholesaleSampleFeeJpy: 100,
    sampleLimitWindowDays: 30,
    sampleLimitPerProduct: 2,
    paymentMethodThresholdJpy: 0,
    wholesaleRankDiscounts: { standard: 0, premium: 0, exclusive: 0 },
    wholesaleCoupons: [],
    staffEmailEvents: undefined,
    orderingPaused: false,
    orderingPausedMessage: '',
  }
}

function mapWholesaleCoupons(value: unknown): WholesaleCoupon[] {
  if (!Array.isArray(value)) return []
  return value
    .map(v => {
      const c = v as Record<string, unknown>
      return {
        id: String(c.id ?? c.code ?? ''),
        code: String(c.code ?? ''),
        name: String(c.name ?? ''),
        discountType: c.discountType === 'fixed' ? 'fixed' : 'percentage',
        discountValue: Number(c.discountValue) || 0,
        eligibleProductIds: Array.isArray(c.eligibleProductIds) ? c.eligibleProductIds.map(String) : undefined,
        expiresAt: typeof c.expiresAt === 'string' && c.expiresAt ? c.expiresAt : undefined,
        active: c.active !== false,
      } as WholesaleCoupon
    })
    .filter(c => c.code && c.name)
}

function mapShippingRatesJp(value: unknown): ShippingTierJp[] {
  if (!Array.isArray(value)) return []
  return value
    .map(v => {
      const r = v as Record<string, unknown>
      return { uptoKg: Number(r.uptoKg), feeJpy: Number(r.feeJpy) }
    })
    .filter(r => Number.isFinite(r.uptoKg) && Number.isFinite(r.feeJpy) && r.uptoKg > 0 && r.feeJpy >= 0)
    .sort((a, b) => a.uptoKg - b.uptoKg)
}

function mapProduct(id: string, data: DocumentData): Product {
  const arrivalRecords = Array.isArray(data.arrivalRecords)
    ? normalizeArrivalRecords(data.arrivalRecords as ArrivalRecord[])
    : toLegacyArrivalRecord(id, data)
  const inventoryChecks = Array.isArray(data.inventoryChecks)
    ? normalizeInventoryChecks(data.inventoryChecks as InventoryCheckRecord[])
    : []
  const initialStockKg = arrivalRecords.length > 0
    ? deriveInitialStockKg(arrivalRecords)
    : Number(data.initialStockKg ?? 0)
  const arrivalDate = arrivalRecords.length > 0
    ? deriveArrivalDate(arrivalRecords)
    : String(data.arrivalDate ?? '')

  return {
    id,
    sku: String(data.sku ?? ''),
    name: String(data.name ?? ''),
    purchaseProductName: data.purchaseProductName ? String(data.purchaseProductName) : undefined,
    supplier: data.supplier ? String(data.supplier) : data.producer ? String(data.producer) : undefined,
    teaType: data.teaType ? String(data.teaType) : undefined,
    grade: data.grade ? String(data.grade) : undefined,
    origins: toStringArray(data.origins ?? data.region),
    cultivars: toStringArray(data.cultivars ?? data.variety),
    pluckingMethods: toStringArray(data.pluckingMethods),
    harvestSeasons: toStringArray(data.harvestSeasons),
    shadingMethods: toStringArray(data.shadingMethods),
    certifications: toStringArray(data.certifications),
    arrivalRecords,
    inventoryChecks,
    arrivalDate,
    inventoryGroupId: String(data.inventoryGroupId ?? ''),
    initialStockKg,
    standardWholesalePrice: data.standardWholesalePrice != null
      ? Number(data.standardWholesalePrice)
      : data.price != null
        ? Number(data.price)
        : undefined,
    purchaseUnitPrice: data.purchaseUnitPrice != null
      ? Number(data.purchaseUnitPrice)
      : data.cost != null
        ? Number(data.cost)
        : undefined,
    adminNote: data.adminNote ? String(data.adminNote) : undefined,
    salesNote: data.salesNote ? String(data.salesNote) : undefined,
    flavorNotes: data.flavorNotes ? String(data.flavorNotes) : undefined,
    imageUrl: data.imageUrl ? String(data.imageUrl) : undefined,
    sortOrder: Number(data.sortOrder ?? 0),
    isActive: data.isActive !== false,
    archived: data.archived === true,
    showInCatalog: data.showInCatalog !== false,
    inquireToOrder: data.inquireToOrder === true,
    madeToOrder: data.madeToOrder === true,
    wholesaleAvailableKg: data.wholesaleAvailableKg != null ? Number(data.wholesaleAvailableKg) : undefined,
    standardPackageKg: data.standardPackageKg != null ? Number(data.standardPackageKg) : undefined,
    wholesaleOptions: Array.isArray(data.wholesaleOptions)
      ? (data.wholesaleOptions as Record<string, unknown>[])
          .map(o => ({ optionId: String(o.optionId ?? ''), tierIds: Array.isArray(o.tierIds) ? o.tierIds.map(String) : [] }))
          .filter(o => o.optionId)
      : undefined,
    featured: data.featured === true,
    sampleAvailable: data.sampleAvailable === true,
    samplePrice: data.samplePrice != null ? Number(data.samplePrice) : undefined,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

function mapGroup(id: string, data: DocumentData): InventoryGroup {
  return {
    id,
    name: String(data.name ?? ''),
    sortOrder: Number(data.sortOrder ?? 0),
    isActive: data.isActive !== false,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

// Coerce an arbitrary value to a valid TaxRate (0 = 免税 / 8 / 10), default 8.
function coerceTaxRate(value: unknown): TaxRate {
  const n = Number(value)
  return n === 0 ? 0 : n === 10 ? 10 : 8
}

/** Normalize 諸費用 line items; drop empty rows (no name and zero amount). */
function normalizeSelfConsumptionUsageType(value: unknown): SelfConsumptionUsageType {
  if (value === 'sample' || value === 'sample_free' || value === 'sample_paid') return 'sample'
  if (value === 'ingredient') return 'ingredient'
  return 'retail'
}

function mapSelfConsumption(id: string, data: DocumentData): SelfConsumptionRecord {
  return {
    id,
    productId: String(data.productId ?? ''),
    productSku: String(data.productSku ?? ''),
    productName: String(data.productName ?? ''),
    quantityKg: Number(data.quantityKg ?? 0),
    usedOn: String(data.usedOn ?? ''),
    usageType: normalizeSelfConsumptionUsageType(data.usageType),
    notes: data.notes ? String(data.notes) : undefined,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

function mapEcSale(id: string, data: DocumentData): EcSaleRecord {
  const quantityKg = Number(data.quantityKg ?? 0)
  const unitPrice = data.unitPrice != null ? Number(data.unitPrice) : undefined
  return {
    id,
    productId: String(data.productId ?? ''),
    productSku: String(data.productSku ?? ''),
    productName: String(data.productName ?? ''),
    quantityKg,
    soldOn: String(data.soldOn ?? ''),
    orderNumber: data.orderNumber ? String(data.orderNumber) : undefined,
    unitPrice,
    revenue: unitPrice != null ? quantityKg * unitPrice : data.revenue != null ? Number(data.revenue) : undefined,
    channel: data.channel ? String(data.channel) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    shopifyOrderId: data.shopifyOrderId ? String(data.shopifyOrderId) : undefined,
    status: data.status === 'cancelled' ? 'cancelled' : data.status === 'reserved' ? 'reserved' : 'active',
    expiresAtMs: typeof data.expiresAtMs === 'number' ? data.expiresAtMs : undefined,
    cancelledAt: data.cancelledAt ? String(data.cancelledAt) : undefined,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

/**
 * Whether an ec_sales record still consumes stock. Mirrors the wholesale app's
 * `ecConsumesStock` so both apps agree on availability: 'active' (confirmed) and
 * unexpired 'reserved' (overseas quote hold) count; 'cancelled' and expired
 * reserved holds do not.
 */
function ecRecordConsumesStock(record: { status?: string; expiresAtMs?: number }, nowMs: number): boolean {
  if (record.status === 'cancelled') return false
  if (record.status === 'reserved') {
    const exp = typeof record.expiresAtMs === 'number' ? record.expiresAtMs : 0
    if (exp && exp < nowMs) return false
  }
  return true
}

function mapMaster(id: string, data: DocumentData): MasterEntry {
  return {
    id,
    type: String(data.type ?? '') as MasterType,
    englishName: String(data.englishName ?? ''),
    japaneseName: String(data.japaneseName ?? ''),
    sortOrder: Number(data.sortOrder ?? 0),
    isActive: data.isActive !== false,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

function mapWholesaleOptions(value: unknown): WholesaleOption[] {
  if (!Array.isArray(value)) return []
  return value
    .map(v => {
      const o = v as Record<string, unknown>
      const tiers = Array.isArray(o.tiers)
        ? (o.tiers as Record<string, unknown>[])
            .map(t => ({
              id: String(t.id ?? ''),
              label: String(t.label ?? ''),
              portionKg: Number(t.portionKg),
              pricePerBagJpy: Number(t.pricePerBagJpy),
            }))
            .filter(t => t.id && t.label && Number.isFinite(t.portionKg) && t.portionKg > 0 && Number.isFinite(t.pricePerBagJpy) && t.pricePerBagJpy >= 0)
        : []
      return {
        id: String(o.id ?? ''),
        type: 'repackage' as const,
        name: String(o.name ?? ''),
        unitLabel: o.unitLabel != null ? String(o.unitLabel) : undefined,
        active: o.active !== false,
        tiers,
      }
    })
    .filter(o => o.id && o.name)
}

function mapRankDiscounts(value: unknown): WholesaleRankDiscounts {
  const v = (value ?? {}) as Record<string, unknown>
  const pct = (x: unknown) => {
    const n = Number(x)
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0
  }
  return { standard: pct(v.standard), premium: pct(v.premium), exclusive: pct(v.exclusive) }
}

function mapSettings(data?: DocumentData): Settings {
  const defaults = getDefaultSettings()
  if (!data) return defaults
  return {
    appName: String(data.appName ?? defaults.appName),
    currency: String(data.currency ?? defaults.currency),
    stockAlertRatio: Number(data.stockAlertRatio ?? defaults.stockAlertRatio),
    wholesaleThresholdKgDefault:
      data.wholesaleThresholdKgDefault != null
        ? Number(data.wholesaleThresholdKgDefault)
        : defaults.wholesaleThresholdKgDefault,
    shippingRatesJp: mapShippingRatesJp(data.shippingRatesJp),
    wholesaleOptions: mapWholesaleOptions(data.wholesaleOptions),
    wholesaleSampleFeeJpy:
      data.wholesaleSampleFeeJpy != null ? Number(data.wholesaleSampleFeeJpy) : defaults.wholesaleSampleFeeJpy,
    sampleLimitWindowDays:
      data.sampleLimitWindowDays != null ? Number(data.sampleLimitWindowDays) : defaults.sampleLimitWindowDays,
    sampleLimitPerProduct:
      data.sampleLimitPerProduct != null ? Number(data.sampleLimitPerProduct) : defaults.sampleLimitPerProduct,
    paymentMethodThresholdJpy:
      data.paymentMethodThresholdJpy != null ? Number(data.paymentMethodThresholdJpy) : defaults.paymentMethodThresholdJpy,
    wholesaleRankDiscounts: mapRankDiscounts(data.wholesaleRankDiscounts),
    wholesaleCoupons: mapWholesaleCoupons(data.wholesaleCoupons),
    staffEmailEvents: Array.isArray(data.staffEmailEvents) ? data.staffEmailEvents.map(String) : undefined,
    orderingPaused: data.orderingPaused === true,
    orderingPausedMessage: typeof data.orderingPausedMessage === 'string' ? data.orderingPausedMessage : '',
  }
}

function sanitizeRecord<T extends object>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T
}

function normalizeBuyerName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

async function getUserRole(uid: string): Promise<'admin' | 'viewer'> {
  const db = getFirebaseDb()
  const snap = await getDoc(doc(db, COLLECTIONS.users, uid))
  if (!snap.exists()) return 'viewer'
  return snap.data().role === 'admin' ? 'admin' : 'viewer'
}

async function ensureUserProfile(user: User): Promise<'admin' | 'viewer'> {
  const db = getFirebaseDb()
  const ref = doc(db, COLLECTIONS.users, user.uid)
  const existing = await getDoc(ref)

  if (existing.exists()) {
    return existing.data().role === 'admin' ? 'admin' : 'viewer'
  }

  const allUsers = await getDocs(collection(db, COLLECTIONS.users))
  const role: 'admin' | 'viewer' = allUsers.empty ? 'admin' : 'viewer'

  await setDoc(ref, {
    email: user.email ?? '',
    role,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true })

  return role
}

function toAuthUser(user: User, role: 'admin' | 'viewer'): AuthUser {
  return {
    uid: user.uid,
    email: user.email ?? '',
    role,
  }
}

async function getAllProducts(): Promise<Product[]> {
  const db = getFirebaseDb()
  const snap = await getDocs(collection(db, COLLECTIONS.products))
  return snap.docs.map(document => mapProduct(document.id, document.data()))
}

async function getAllGroups(): Promise<InventoryGroup[]> {
  const db = getFirebaseDb()
  const snap = await getDocs(collection(db, COLLECTIONS.groups))
  return snap.docs.map(document => mapGroup(document.id, document.data()))
}

async function getAllSelfConsumptions(): Promise<SelfConsumptionRecord[]> {
  const db = getFirebaseDb()
  const snap = await getDocs(collection(db, COLLECTIONS.selfConsumptions))
  return snap.docs.map(document => mapSelfConsumption(document.id, document.data()))
}

async function getAllEcSales(): Promise<EcSaleRecord[]> {
  const db = getFirebaseDb()
  const snap = await getDocs(collection(db, COLLECTIONS.ecSales))
  return snap.docs.map(document => mapEcSale(document.id, document.data()))
}

async function getSettings(): Promise<Settings> {
  const db = getFirebaseDb()
  const snap = await getDoc(doc(db, COLLECTIONS.settings, 'main'))
  return mapSettings(snap.data())
}

function isWholesaleChannel(channel?: string): boolean {
  return channel === 'Wholesale' || channel === 'WholesaleSample'
}

function computeInventory(
  products: Product[],
  selfConsumptions: SelfConsumptionRecord[],
  ecSales: EcSaleRecord[],
  settings: Settings,
): ProductWithInventory[] {
  // Reservations now come from the ec_sales ledger (Wholesale channel), not `sales`.
  // Expired reserved holds (overseas quotes) no longer consume stock — keep this
  // in lockstep with the wholesale app's ecConsumesStock.
  const nowMs = Date.now()
  const reservedByProduct = ecSales.reduce<Record<string, number>>((acc, record) => {
    // Samples are managed separately and never deduct product stock.
    if (record.channel === 'WholesaleSample') return acc
    if (!ecRecordConsumesStock(record, nowMs) || !isWholesaleChannel(record.channel)) return acc
    acc[record.productId] = (acc[record.productId] ?? 0) + record.quantityKg
    return acc
  }, {})
  const selfConsumedByProduct = selfConsumptions.reduce<Record<string, number>>((acc, record) => {
    acc[record.productId] = (acc[record.productId] ?? 0) + record.quantityKg
    return acc
  }, {})
  const ecSoldByProduct = ecSales.reduce<Record<string, number>>((acc, record) => {
    if (!ecRecordConsumesStock(record, nowMs) || isWholesaleChannel(record.channel)) return acc
    acc[record.productId] = (acc[record.productId] ?? 0) + record.quantityKg
    return acc
  }, {})

  return products
    .filter(product => product.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(product => {
      const inventoryAdjustmentKg = deriveInventoryAdjustmentKg(product.inventoryChecks)
      const salesAllocatedKg = reservedByProduct[product.id] ?? 0
      const selfConsumedKg = selfConsumedByProduct[product.id] ?? 0
      const ecSoldKg = ecSoldByProduct[product.id] ?? 0
      const effectiveInitialKg = product.initialStockKg + inventoryAdjustmentKg
      const currentStockKg = effectiveInitialKg - salesAllocatedKg - selfConsumedKg - ecSoldKg
      return {
        ...product,
        salesAllocatedKg,
        selfConsumedKg,
        ecSoldKg,
        inventoryAdjustmentKg,
        latestInventoryCheck: getLatestInventoryCheck(product.inventoryChecks),
        currentStockKg,
        stockStatus: getStockStatus(currentStockKg),
      }
    })
}

async function assertSufficientSelfConsumptionStock(
  input: SelfConsumptionRecordInput,
  options?: { excludeSelfConsumptionId?: string },
): Promise<Product> {
  const [products, selfConsumptions, ecSales] = await Promise.all([
    getAllProducts(),
    getAllSelfConsumptions(),
    getAllEcSales(),
  ])
  const product = products.find(item => item.id === input.productId && item.isActive)
  if (!product) throw new Error('商品が見つかりません')

  // Wholesale reservations live in ec_sales now, so ecSoldKg already covers them.
  const selfConsumedKg = selfConsumptions
    .filter(record => record.productId === input.productId && record.id !== options?.excludeSelfConsumptionId)
    .reduce((sum, record) => sum + record.quantityKg, 0)
  const nowMs = Date.now()
  const ecSoldKg = ecSales
    .filter(record => record.productId === input.productId && record.channel !== 'WholesaleSample' && ecRecordConsumesStock(record, nowMs))
    .reduce((sum, record) => sum + record.quantityKg, 0)
  const availableKg = product.initialStockKg
    + deriveInventoryAdjustmentKg(product.inventoryChecks)
    - selfConsumedKg
    - ecSoldKg

  if (input.quantityKg > availableKg) {
    throw new Error(`在庫が不足しています。残り ${availableKg.toFixed(1)}kg まで登録できます`)
  }

  return product
}

function normalizePoPayments(raw: PurchaseOrderPayment[] | undefined): PurchaseOrderPayment[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((p, index) => {
      // OMIT empty optional keys entirely — getFirestore has no
      // ignoreUndefinedProperties, so a nested `undefined` would reject the write.
      const method = p.method?.trim()
      const note = p.note?.trim()
      // 2段階分割払い拡張。Firestore は undefined を書けないので存在時のみスプレッド。
      const kind = p.kind === 'deposit' || p.kind === 'balance' ? p.kind : undefined
      const dueDate = p.dueDate?.trim()
      return {
        id: String(p.id ?? '').trim() || `${p.paidDate ?? ''}-${p.amount}-${index}`,
        amount: Number(p.amount) || 0,
        paidDate: (p.paidDate ?? '').trim(),
        ...(method ? { method } : {}),
        ...(note ? { note } : {}),
        ...(kind ? { kind } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(typeof p.paid === 'boolean' ? { paid: p.paid } : {}),
      }
    })
    .filter(p => p.amount > 0)
}

function normalizePurchaseOrderItem(raw: unknown): PurchaseOrderLineItem | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const productId = String(obj.productId ?? '')
  const productName = String(obj.productName ?? '')
  // Tolerate unlisted items (empty productId) as long as there is a name.
  if (!productId && !productName.trim()) return null
  const quantityKg = Number(obj.quantityKg ?? 0)
  const unitPrice = Number(obj.unitPrice ?? 0)
  const lineTotal = obj.lineTotal != null ? Number(obj.lineTotal) : quantityKg * unitPrice
  const taxRate = coerceTaxRate(obj.taxRate)
  return {
    productId,
    productSku: String(obj.productSku ?? ''),
    productName,
    quantityKg,
    unitPrice,
    lineTotal,
    receivedKg: Number(obj.receivedKg ?? 0),
    taxRate,
    // Invoice-billing ledger: preserve stable id + cumulative billed across edits.
    lineId: obj.lineId ? String(obj.lineId) : undefined,
    billedKg: obj.billedKg != null ? Number(obj.billedKg) : 0,
    billedAmount: obj.billedAmount != null ? Number(obj.billedAmount) : 0,
  }
}

/** Mint stable lineIds for any PO line missing one (preserves existing ids). */
function ensurePoLineIds(items: PurchaseOrderLineItem[]): { items: PurchaseOrderLineItem[]; minted: boolean } {
  let minted = false
  const next = items.map(it => {
    if (it.lineId) return it
    minted = true
    return { ...it, lineId: crypto.randomUUID() }
  })
  return { items: next, minted }
}

function isValidPurchaseOrderStatus(value: unknown): value is PurchaseOrderStatus {
  return value === 'placed' || value === 'shipped' || value === 'received' || value === 'cancelled'
}

function mapPurchaseOrder(id: string, data: DocumentData): PurchaseOrder {
  const rawItems = Array.isArray(data.items) ? data.items : []
  const items: PurchaseOrderLineItem[] = rawItems
    .map(normalizePurchaseOrderItem)
    .filter((item): item is PurchaseOrderLineItem => item !== null)
  const totalQuantityKg = data.totalQuantityKg != null
    ? Number(data.totalQuantityKg)
    : items.reduce((sum, item) => sum + item.quantityKg, 0)
  const totalAmount = data.totalAmount != null
    ? Number(data.totalAmount)
    : items.reduce((sum, item) => sum + item.lineTotal, 0)
  const status = isValidPurchaseOrderStatus(data.status) ? data.status : 'placed'
  const storedPaymentStatus = (data.paymentStatus === 'unpaid' || data.paymentStatus === 'partial' || data.paymentStatus === 'paid')
    ? data.paymentStatus
    : 'uninvoiced'
  const payments = Array.isArray(data.payments)
    ? data.payments
        .map((raw: unknown, index: number) => {
          const obj = (raw ?? {}) as Record<string, unknown>
          const amount = Number(obj.amount ?? 0)
          if (!(amount > 0)) return null
          const paidDate = obj.paidDate ? toIsoDate(String(obj.paidDate)) : ''
          const kind: 'deposit' | 'balance' | undefined =
            obj.kind === 'deposit' || obj.kind === 'balance' ? obj.kind : undefined
          return {
            // Deterministic fallback so the same doc maps to the same ids on
            // every read (removal-by-id depends on stability).
            id: String(obj.id ?? `${paidDate}-${amount}-${index}`),
            amount,
            paidDate,
            method: obj.method ? String(obj.method) : undefined,
            note: obj.note ? String(obj.note) : undefined,
            // 2段階分割払い拡張（前払金/残金）。旧データには無いので undefined のまま。
            kind,
            dueDate: obj.dueDate ? toIsoDate(String(obj.dueDate)) : undefined,
            paid: typeof obj.paid === 'boolean' ? obj.paid : undefined,
          }
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)
    : []
  const invoiceRaw = data.invoice as Record<string, unknown> | undefined
  const invoice = invoiceRaw && invoiceRaw.url
    ? {
        name: String(invoiceRaw.name ?? '請求書'),
        url: String(invoiceRaw.url),
        uploadedAt: String(invoiceRaw.uploadedAt ?? ''),
        size: invoiceRaw.size != null ? Number(invoiceRaw.size) : undefined,
      }
    : undefined
  const base: PurchaseOrder = {
    id,
    supplierName: String(data.supplierName ?? ''),
    items,
    totalQuantityKg,
    totalAmount,
    shippingFee: Number(data.shippingFee ?? 0),
    otherFees: Number(data.otherFees ?? 0),
    otherFeesNote: data.otherFeesNote ? String(data.otherFeesNote) : undefined,
    orderDate: String(data.orderDate ?? ''),
    expectedDeliveryDate: data.expectedDeliveryDate ? String(data.expectedDeliveryDate) : undefined,
    actualDeliveryDate: data.actualDeliveryDate ? String(data.actualDeliveryDate) : undefined,
    status,
    paymentStatus: storedPaymentStatus,
    paymentDueDate: data.paymentDueDate ? String(data.paymentDueDate) : undefined,
    paidDate: data.paidDate ? String(data.paidDate) : undefined,
    payments,
    invoice,
    notes: data.notes ? String(data.notes) : undefined,
    flowVersion: data.flowVersion === 'invoice' ? 'invoice' : data.flowVersion === 'legacy' ? 'legacy' : undefined,
    billingComplete: data.billingComplete === true ? true : undefined,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
  // Derive status from split payments when present.
  base.paymentStatus = derivePoPaymentStatus(base, storedPaymentStatus)
  base.billingStatus = derivePoBillingStatus(base)
  return base
}

function coerceInvoiceLineKind(value: unknown): PurchaseInvoiceLine['kind'] {
  return value === 'po' ? 'po' : 'adhoc'
}

function mapPurchaseInvoiceLine(raw: unknown, index: number): PurchaseInvoiceLine | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const kind = coerceInvoiceLineKind(obj.kind)
  const quantity = Number(obj.quantity ?? 0)
  const unitPrice = Number(obj.unitPrice ?? 0)
  const lineTotal = obj.lineTotal != null ? Number(obj.lineTotal) : quantity * unitPrice
  const productName = String(obj.productName ?? '')
  if (!productName.trim() && kind === 'adhoc') return null
  return {
    id: String(obj.id ?? `${kind}-${index}`),
    kind,
    purchaseOrderId: obj.purchaseOrderId ? String(obj.purchaseOrderId) : undefined,
    poLineId: obj.poLineId ? String(obj.poLineId) : undefined,
    productId: obj.productId ? String(obj.productId) : undefined,
    productName,
    category: obj.category ? String(obj.category) : undefined,
    quantity,
    unit: obj.unit ? String(obj.unit) : undefined,
    unitPrice,
    lineTotal,
    taxRate: coerceTaxRate(obj.taxRate),
    note: obj.note ? String(obj.note) : undefined,
  }
}

function mapPurchaseInvoice(id: string, data: DocumentData): PurchaseInvoice {
  const lines: PurchaseInvoiceLine[] = (Array.isArray(data.lines) ? data.lines : [])
    .map((raw: unknown, i: number) => mapPurchaseInvoiceLine(raw, i))
    .filter((l: PurchaseInvoiceLine | null): l is PurchaseInvoiceLine => l !== null)
  const totals = computeInvoiceTotals(lines)
  const totalOverride = data.totalOverride != null && Number(data.totalOverride) >= 0 ? Number(data.totalOverride) : undefined
  const totalAmount = totalOverride ?? totals.total
  const payments = normalizePoPayments(
    Array.isArray(data.payments)
      ? data.payments.map((p: Record<string, unknown>) => ({
          id: String(p?.id ?? ''),
          amount: Number(p?.amount ?? 0),
          paidDate: p?.paidDate ? toIsoDate(String(p.paidDate)) : '',
          method: p?.method ? String(p.method) : undefined,
          note: p?.note ? String(p.note) : undefined,
        }))
      : [],
  )
  const fileRaw = data.file as Record<string, unknown> | undefined
  const file = fileRaw && fileRaw.url
    ? {
        name: String(fileRaw.name ?? '請求書'),
        url: String(fileRaw.url),
        uploadedAt: String(fileRaw.uploadedAt ?? ''),
        size: fileRaw.size != null ? Number(fileRaw.size) : undefined,
      }
    : undefined
  const inv: PurchaseInvoice = {
    id,
    flowVersion: 'invoice',
    supplierName: String(data.supplierName ?? ''),
    supplierNormalizedName: data.supplierNormalizedName ? String(data.supplierNormalizedName) : undefined,
    invoiceNumber: data.invoiceNumber ? String(data.invoiceNumber) : undefined,
    invoiceDate: String(data.invoiceDate ?? ''),
    receivedDate: String(data.receivedDate ?? data.invoiceDate ?? ''),
    paymentDueDate: data.paymentDueDate ? String(data.paymentDueDate) : undefined,
    lines,
    computedSubtotal: totals.subtotal,
    computedTax: totals.tax,
    computedTotal: totals.total,
    totalOverride,
    totalAmount,
    paymentStatus: 'unpaid',
    payments,
    file,
    linkedPoIds: Array.isArray(data.linkedPoIds)
      ? Array.from(new Set(data.linkedPoIds.map((x: unknown) => String(x)).filter(Boolean)))
      : Array.from(new Set(lines.filter(l => l.kind === 'po' && l.purchaseOrderId).map(l => l.purchaseOrderId as string))),
    notes: data.notes ? String(data.notes) : undefined,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
  inv.paymentStatus = deriveInvoicePaymentStatus(inv)
  return inv
}

async function getAllPurchaseInvoices(): Promise<PurchaseInvoice[]> {
  const db = getFirebaseDb()
  const snap = await getDocs(collection(db, COLLECTIONS.purchaseInvoices))
  return snap.docs.map(d => mapPurchaseInvoice(d.id, d.data()))
}

const poLineKey = (poId: string, lineId: string) => `${poId}#${lineId}`

/** Normalize invoice-line inputs into stored lines (recompute totals, fill defaults). */
function buildInvoiceLines(
  inputLines: PurchaseInvoiceLineInput[],
  poItemIndex: Map<string, PurchaseOrderLineItem>,
): PurchaseInvoiceLine[] {
  return (inputLines ?? [])
    .map(line => {
      const kind: PurchaseInvoiceLine['kind'] = line.kind === 'po' ? 'po' : 'adhoc'
      const quantity = Number(line.quantity) || 0
      const unitPrice = Number(line.unitPrice) || 0
      if (kind === 'po') {
        if (!line.purchaseOrderId || !line.poLineId) return null
        const poItem = poItemIndex.get(poLineKey(line.purchaseOrderId, line.poLineId))
        const taxRate = coerceTaxRate(line.taxRate ?? poItem?.taxRate ?? 8)
        return {
          id: line.id || crypto.randomUUID(),
          kind,
          purchaseOrderId: line.purchaseOrderId,
          poLineId: line.poLineId,
          productId: line.productId ?? poItem?.productId ?? undefined,
          productName: (line.productName || poItem?.productName || '商品').trim(),
          quantity,
          unit: line.unit || 'kg',
          unitPrice,
          lineTotal: quantity * unitPrice,
          taxRate,
          note: line.note?.trim() || undefined,
        } as PurchaseInvoiceLine
      }
      const name = (line.productName || '').trim()
      if (!name) return null
      return {
        id: line.id || crypto.randomUUID(),
        kind,
        productName: name,
        category: line.category?.trim() || undefined,
        quantity,
        unit: line.unit?.trim() || undefined,
        unitPrice,
        lineTotal: quantity * unitPrice,
        taxRate: coerceTaxRate(line.taxRate ?? 10),
        note: line.note?.trim() || undefined,
      } as PurchaseInvoiceLine
    })
    .filter((l): l is PurchaseInvoiceLine => l !== null)
}

/** Signed (poId#lineId → {kg, amount}) delta between previous and next invoice lines. */
function billingDeltas(
  prev: PurchaseInvoiceLine[],
  next: PurchaseInvoiceLine[],
): Map<string, { poId: string; lineId: string; kg: number; amount: number }> {
  const map = new Map<string, { poId: string; lineId: string; kg: number; amount: number }>()
  const touch = (poId: string, lineId: string, kg: number, amount: number) => {
    const key = poLineKey(poId, lineId)
    const cur = map.get(key) ?? { poId, lineId, kg: 0, amount: 0 }
    cur.kg += kg
    cur.amount += amount
    map.set(key, cur)
  }
  for (const l of next) if (l.kind === 'po' && l.purchaseOrderId && l.poLineId) touch(l.purchaseOrderId, l.poLineId, l.quantity, l.lineTotal)
  for (const l of prev) if (l.kind === 'po' && l.purchaseOrderId && l.poLineId) touch(l.purchaseOrderId, l.poLineId, -l.quantity, -l.lineTotal)
  return map
}

/** Plain item objects safe to write (no nested undefined; ledger fields present). */
function serializePoItems(items: PurchaseOrderLineItem[]): Record<string, unknown>[] {
  return items.map(it => ({
    productId: it.productId ?? '',
    productSku: it.productSku ?? '',
    productName: it.productName ?? '',
    quantityKg: Number(it.quantityKg) || 0,
    unitPrice: Number(it.unitPrice) || 0,
    lineTotal: Number(it.lineTotal) || 0,
    receivedKg: Number(it.receivedKg) || 0,
    taxRate: it.taxRate,
    lineId: it.lineId || crypto.randomUUID(),
    billedKg: Number(it.billedKg) || 0,
    billedAmount: Number(it.billedAmount) || 0,
  }))
}

/** Plain invoice-line objects safe to write (no nested undefined). */
function serializeInvoiceLines(lines: PurchaseInvoiceLine[]): Record<string, unknown>[] {
  return lines.map(l => {
    const out: Record<string, unknown> = {
      id: l.id,
      kind: l.kind,
      productName: l.productName,
      quantity: Number(l.quantity) || 0,
      unitPrice: Number(l.unitPrice) || 0,
      lineTotal: Number(l.lineTotal) || 0,
      taxRate: l.taxRate,
    }
    if (l.purchaseOrderId) out.purchaseOrderId = l.purchaseOrderId
    if (l.poLineId) out.poLineId = l.poLineId
    if (l.productId) out.productId = l.productId
    if (l.category) out.category = l.category
    if (l.unit) out.unit = l.unit
    if (l.note) out.note = l.note
    return out
  })
}

const BILLING_EPSILON = 1 // yen

/**
 * Apply signed billing deltas to the referenced POs inside a transaction, then write
 * the invoice doc. All txn reads (invoice + POs) happen before any write.
 *   - billedAmount/Kg take the RAW signed delta (no max(0,…) clamp).
 *   - underflow (billedAmount < -ε) ALWAYS aborts; over-bill (> subtotal+ε) only
 *     allowed with allowOverBill.
 *   - the affected POs are stamped flowVersion='invoice' (idempotent).
 * Returns the invoice id.
 */
async function writePurchaseInvoice(
  db: ReturnType<typeof getFirebaseDb>,
  id: string | null,
  input: Partial<PurchaseInvoiceInput>,
): Promise<string> {
  // Resolve referenced POs (display defaults: productName / taxRate).
  const poIds = Array.from(
    new Set((input.lines ?? []).filter(l => l.kind === 'po' && l.purchaseOrderId).map(l => l.purchaseOrderId as string)),
  )
  const poItemIndex = new Map<string, PurchaseOrderLineItem>()
  for (const poId of poIds) {
    const snap = await getDoc(doc(db, COLLECTIONS.purchaseOrders, poId))
    if (!snap.exists()) continue
    const po = mapPurchaseOrder(snap.id, snap.data() ?? {})
    for (const it of po.items) if (it.lineId) poItemIndex.set(poLineKey(po.id, it.lineId), it)
  }
  const builtLines = buildInvoiceLines(input.lines ?? [], poItemIndex)
  const allowOverBill = input.allowOverBill === true
  const invoiceRef = id ? doc(db, COLLECTIONS.purchaseInvoices, id) : doc(collection(db, COLLECTIONS.purchaseInvoices))

  await runTransaction(db, async txn => {
    // ---- READS ----
    let prevLines: PurchaseInvoiceLine[] = []
    let prevData: DocumentData | null = null
    if (id) {
      const cur = await txn.get(invoiceRef)
      if (!cur.exists()) throw new Error('請求書が見つかりません')
      prevData = cur.data() ?? {}
      prevLines = mapPurchaseInvoice(id, prevData).lines
    }
    // A partial update without `lines` must NOT wipe the ledger — keep prev lines.
    const effectiveLines = input.lines !== undefined ? builtLines : prevLines
    const totals = computeInvoiceTotals(effectiveLines)
    // totalOverride: undefined = preserve prev; null/invalid = clear; number = set.
    const prevOverride = prevData?.totalOverride != null ? Number(prevData.totalOverride) : undefined
    const totalOverride = input.totalOverride === undefined
      ? prevOverride
      : (input.totalOverride === null || !(Number(input.totalOverride) >= 0))
        ? undefined
        : Number(input.totalOverride)
    const totalAmount = totalOverride ?? totals.total
    const deltas = billingDeltas(prevLines, effectiveLines)
    const affectedPoIds = Array.from(new Set(Array.from(deltas.values()).map(d => d.poId)))
    const poSnaps = new Map<string, { ref: ReturnType<typeof doc>; order: PurchaseOrder }>()
    for (const poId of affectedPoIds) {
      const ref = doc(db, COLLECTIONS.purchaseOrders, poId)
      const snap = await txn.get(ref)
      if (!snap.exists()) throw new Error('対象の発注が見つかりません')
      poSnaps.set(poId, { ref, order: mapPurchaseOrder(snap.id, snap.data() ?? {}) })
    }

    // ---- COMPUTE + STAGE PO WRITES ----
    const poWrites: { ref: ReturnType<typeof doc>; items: Record<string, unknown>[] }[] = []
    for (const { ref, order } of poSnaps.values()) {
      const { items } = ensurePoLineIds(order.items)
      for (const d of deltas.values()) {
        if (d.poId !== order.id) continue
        const line = items.find(it => it.lineId === d.lineId)
        if (!line) throw new Error('対象の発注明細が見つかりません')
        const nextBilled = (line.billedAmount ?? 0) + d.amount
        const subtotal = poLineSubtotal(line)
        if (nextBilled < -BILLING_EPSILON) throw new Error('請求金額が発注を下回ります（データ不整合）')
        // Only block when the delta INCREASES billing past the subtotal; a reduction
        // (edit-down / partial reverse of an over-billed line) is always allowed.
        if (d.amount > 0 && nextBilled > subtotal + BILLING_EPSILON && !allowOverBill) {
          throw new Error('請求金額が発注額を超えています。発注超過を許可する場合は確認のうえ再実行してください。')
        }
        line.billedKg = Math.max(0, (line.billedKg ?? 0) + d.kg)
        line.billedAmount = Math.max(0, nextBilled)
      }
      poWrites.push({ ref, items: serializePoItems(items) })
    }

    // ---- WRITES ----
    for (const w of poWrites) {
      txn.update(w.ref, { items: w.items, flowVersion: 'invoice', updatedAt: serverTimestamp() })
    }

    const payments = input.payments !== undefined
      ? normalizePoPayments(input.payments)
      : (prevData ? normalizePoPayments(mapPurchaseInvoice(id as string, prevData).payments) : [])
    const paidTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
    if (id && paidTotal > totalAmount + BILLING_EPSILON && !allowOverBill) {
      throw new Error('請求額を既入金額より小さくできません。')
    }
    const supplierName = (input.supplierName ?? (prevData?.supplierName as string) ?? '').trim()
    const linkedPoIds = Array.from(new Set(effectiveLines.filter(l => l.kind === 'po' && l.purchaseOrderId).map(l => l.purchaseOrderId as string)))
    const paymentStatus = deriveInvoicePaymentStatus({ totalAmount, payments })

    const fileToWrite = input.file === null
      ? deleteField()
      : input.file && input.file.url
        ? input.file
        : (prevData?.file ?? undefined)

    const scalar = sanitizeRecord({
      supplierName,
      supplierNormalizedName: supplierName ? normalizeBuyerName(supplierName) : undefined,
      invoiceNumber: (input.invoiceNumber ?? (prevData?.invoiceNumber as string) ?? '').trim() || undefined,
      invoiceDate: (input.invoiceDate ?? (prevData?.invoiceDate as string) ?? '').trim(),
      receivedDate: (input.receivedDate ?? (prevData?.receivedDate as string) ?? input.invoiceDate ?? '').trim() || undefined,
      paymentDueDate: (input.paymentDueDate ?? (prevData?.paymentDueDate as string) ?? '').trim() || undefined,
      lines: serializeInvoiceLines(effectiveLines),
      computedSubtotal: totals.subtotal,
      computedTax: totals.tax,
      computedTotal: totals.total,
      totalOverride: totalOverride,
      totalAmount,
      paymentStatus,
      payments,
      linkedPoIds,
      notes: (input.notes ?? (prevData?.notes as string) ?? '').trim() || undefined,
      flowVersion: 'invoice' as const,
      updatedAt: serverTimestamp(),
    }) as Record<string, unknown>
    scalar.file = fileToWrite
    if (totalOverride == null) scalar.totalOverride = deleteField()

    if (id) {
      txn.update(invoiceRef, scalar)
    } else {
      txn.set(invoiceRef, { ...scalar, createdAt: serverTimestamp() })
    }
  })

  return invoiceRef.id
}

/** Reverse an invoice's billing ledger and delete the doc (blocks if it has payments). */
async function deletePurchaseInvoiceTxn(
  db: ReturnType<typeof getFirebaseDb>,
  id: string,
  force: boolean,
): Promise<void> {
  const invoiceRef = doc(db, COLLECTIONS.purchaseInvoices, id)
  await runTransaction(db, async txn => {
    const cur = await txn.get(invoiceRef)
    if (!cur.exists()) return
    const inv = mapPurchaseInvoice(id, cur.data() ?? {})
    if ((inv.payments?.length ?? 0) > 0 && !force) {
      throw new Error('支払い記録があるため削除できません。先に入金を取り消してください。')
    }
    const deltas = billingDeltas(inv.lines, [])
    const affectedPoIds = Array.from(new Set(Array.from(deltas.values()).map(d => d.poId)))
    const poSnaps = new Map<string, { ref: ReturnType<typeof doc>; order: PurchaseOrder }>()
    for (const poId of affectedPoIds) {
      const ref = doc(db, COLLECTIONS.purchaseOrders, poId)
      const snap = await txn.get(ref)
      if (snap.exists()) poSnaps.set(poId, { ref, order: mapPurchaseOrder(snap.id, snap.data() ?? {}) })
    }
    const poWrites: { ref: ReturnType<typeof doc>; items: Record<string, unknown>[] }[] = []
    for (const { ref, order } of poSnaps.values()) {
      const { items } = ensurePoLineIds(order.items)
      for (const d of deltas.values()) {
        if (d.poId !== order.id) continue
        const line = items.find(it => it.lineId === d.lineId)
        if (!line) continue // line gone; nothing to reverse
        line.billedKg = Math.max(0, (line.billedKg ?? 0) + d.kg)
        line.billedAmount = Math.max(0, (line.billedAmount ?? 0) + d.amount)
      }
      poWrites.push({ ref, items: serializePoItems(items) })
    }
    for (const w of poWrites) txn.update(w.ref, { items: w.items, updatedAt: serverTimestamp() })
    txn.delete(invoiceRef)
  })
}

function mapSupplier(id: string, data: DocumentData): Supplier {
  return {
    id,
    name: String(data.name ?? ''),
    normalizedName: String(data.normalizedName ?? ''),
    contactPersonName: data.contactPersonName ? String(data.contactPersonName) : undefined,
    email: data.email ? String(data.email) : undefined,
    phone: data.phone ? String(data.phone) : undefined,
    website: data.website ? String(data.website) : undefined,
    address: data.address ? String(data.address) : undefined,
    postalCode: data.postalCode ? String(data.postalCode) : undefined,
    country: data.country ? String(data.country) : undefined,
    bankInfo: data.bankInfo ? String(data.bankInfo) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    attachments: Array.isArray(data.attachments)
      ? data.attachments
          .map(raw => {
            const obj = raw as Record<string, unknown>
            if (!obj?.url) return null
            return {
              id: String(obj.id ?? obj.url),
              name: String(obj.name ?? 'attachment'),
              url: String(obj.url),
              uploadedAt: String(obj.uploadedAt ?? ''),
              size: obj.size != null ? Number(obj.size) : undefined,
            }
          })
          .filter((a): a is NonNullable<typeof a> => a !== null)
      : [],
    orderCount: Number(data.orderCount ?? 0),
    lastOrderedAt: data.lastOrderedAt ? toDate(data.lastOrderedAt) : undefined,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

async function getAllPurchaseOrders(): Promise<PurchaseOrder[]> {
  const db = getFirebaseDb()
  const snap = await getDocs(collection(db, COLLECTIONS.purchaseOrders))
  return snap.docs.map(document => mapPurchaseOrder(document.id, document.data()))
}

async function getAllSuppliers(): Promise<Supplier[]> {
  const db = getFirebaseDb()
  const snap = await getDocs(collection(db, COLLECTIONS.suppliers))
  return snap.docs.map(document => mapSupplier(document.id, document.data()))
}

async function syncSuppliersCollection(): Promise<void> {
  const db = getFirebaseDb()
  const orders = await getAllPurchaseOrders()
  const suppliers = await getAllSuppliers()
  const grouped = orders.reduce<Record<string, PurchaseOrder[]>>((acc, order) => {
    const normalizedName = normalizeBuyerName(order.supplierName)
    if (!normalizedName) return acc
    acc[normalizedName] = [...(acc[normalizedName] ?? []), order]
    return acc
  }, {})

  const existingByNormalized = new Map(suppliers.map(s => [s.normalizedName, s]))
  const batch = writeBatch(db)

  Object.entries(grouped).forEach(([normalizedName, records]) => {
    const sorted = [...records].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    const latest = sorted[0]
    const existing = existingByNormalized.get(normalizedName)
    const ref = existing
      ? doc(db, COLLECTIONS.suppliers, existing.id)
      : doc(collection(db, COLLECTIONS.suppliers))

    batch.set(ref, sanitizeRecord({
      name: latest.supplierName.trim(),
      normalizedName,
      orderCount: records.length,
      lastOrderedAt: latest.updatedAt,
      createdAt: existing?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    }), { merge: true })

    existingByNormalized.delete(normalizedName)
  })

  // Note: do not delete suppliers with no orders — they may have manually edited details
  await batch.commit()
}

async function stripPurchaseOrderArrivalsFromProducts(orderId: string): Promise<void> {
  const db = getFirebaseDb()
  const products = await getAllProducts()
  const prefix = `po:${orderId}:`
  const affected = products.filter(p => p.arrivalRecords.some(r => r.id.startsWith(prefix)))
  if (affected.length === 0) return

  const batch = writeBatch(db)
  affected.forEach(product => {
    const next = product.arrivalRecords.filter(r => !r.id.startsWith(prefix))
    batch.update(doc(db, COLLECTIONS.products, product.id), {
      arrivalRecords: next,
      arrivalDate: deriveArrivalDate(next),
      initialStockKg: deriveInitialStockKg(next),
      updatedAt: serverTimestamp(),
    })
  })
  await batch.commit()
}

async function addArrivalRecordToProduct(productId: string, record: ArrivalRecord): Promise<void> {
  const db = getFirebaseDb()
  const ref = doc(db, COLLECTIONS.products, productId)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    throw new Error('紐付け先の商品が見つかりません')
  }
  const data = snap.data()
  const existing = Array.isArray(data.arrivalRecords)
    ? normalizeArrivalRecords(data.arrivalRecords as ArrivalRecord[])
    : []
  const next = [...existing.filter(r => r.id !== record.id), { ...record, arrivalDate: toIsoDate(record.arrivalDate) }]
  await updateDoc(ref, {
    arrivalRecords: next,
    arrivalDate: deriveArrivalDate(next),
    initialStockKg: deriveInitialStockKg(next),
    // 入荷ロットに単価があれば、最新ロット単価を商品の現行仕入単価に反映（COGSは販売時にスナップショット）。
    ...(record.unitPrice != null && record.unitPrice > 0 ? { purchaseUnitPrice: record.unitPrice } : {}),
    updatedAt: serverTimestamp(),
  })
}

async function removeArrivalRecordFromProduct(productId: string, recordId: string): Promise<void> {
  const db = getFirebaseDb()
  const ref = doc(db, COLLECTIONS.products, productId)
  const snap = await getDoc(ref)
  if (!snap.exists()) return
  const data = snap.data()
  const existing = Array.isArray(data.arrivalRecords)
    ? normalizeArrivalRecords(data.arrivalRecords as ArrivalRecord[])
    : []
  const next = existing.filter(r => r.id !== recordId)
  if (next.length === existing.length) return
  await updateDoc(ref, {
    arrivalRecords: next,
    arrivalDate: deriveArrivalDate(next),
    initialStockKg: deriveInitialStockKg(next),
    updatedAt: serverTimestamp(),
  })
}

async function createProductDoc(input: ProductInput): Promise<{ id: string; product: Product }> {
  const db = getFirebaseDb()
  const products = await getAllProducts()
  if (products.some(product => product.sku === input.sku && product.isActive)) {
    throw new Error(`SKU "${input.sku}" は既に登録されています`)
  }

  const sortOrder = products
    .filter(product => product.inventoryGroupId === input.inventoryGroupId && product.isActive)
    .reduce((max, product) => Math.max(max, product.sortOrder), -1) + 1

  const payload = {
    ...buildProductPayload(input),
    sortOrder,
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  const ref = await addDoc(collection(db, COLLECTIONS.products), payload)
  return { id: ref.id, product: mapProduct(ref.id, payload) }
}

// Build a PO line for a free-text (new) product. When the modal supplied a SKU
// and inventory group, create the product now (0 stock) so it shows in 在庫管理
// before receiving; otherwise keep it unlisted (productId empty) as before.
async function buildPoLineForNewProduct(
  line: PurchaseOrderLineInput,
  quantityKg: number,
  unitPrice: number,
  taxRate: TaxRate,
): Promise<PurchaseOrderLineItem> {
  const productName = (line.productName ?? '').trim()
  if (!productName) throw new Error('商品名を入力してください')
  const sku = (line.newProductSku ?? '').trim()
  const groupId = (line.newProductGroupId ?? '').trim()
  if (sku && groupId) {
    const created = await createProductDoc({
      sku,
      name: productName,
      purchaseProductName: productName,
      inventoryGroupId: groupId,
      origins: [], cultivars: [], pluckingMethods: [], harvestSeasons: [], shadingMethods: [], certifications: [],
      arrivalRecords: [], inventoryChecks: [], arrivalDate: '', initialStockKg: 0,
      purchaseUnitPrice: unitPrice,
      showInCatalog: false,
      inquireToOrder: true,
    })
    return {
      productId: created.id,
      productSku: created.product.sku,
      productName: created.product.purchaseProductName || created.product.name,
      quantityKg, unitPrice, lineTotal: quantityKg * unitPrice,
      receivedKg: Number(line.receivedKg ?? 0), taxRate,
    }
  }
  return {
    productId: '', productSku: '', productName,
    quantityKg, unitPrice, lineTotal: quantityKg * unitPrice,
    receivedKg: Number(line.receivedKg ?? 0), taxRate,
  }
}

export function createFirebaseServices(): IServices {
  const db = getFirebaseDb()
  const auth = getFirebaseAuthInstance()

  const inventoryService: IInventoryService = {
    async getInventoryGroups() {
      const groups = await getAllGroups()
      return groups
        .filter(group => group.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
    },

    async getProductsWithInventory() {
      const [products, selfConsumptions, ecSales, settings] = await Promise.all([
        getAllProducts(),
        getAllSelfConsumptions(),
        getAllEcSales(),
        getSettings(),
      ])
      return computeInventory(products, selfConsumptions, ecSales, settings)
    },

    async createProduct(input) {
      const products = await getAllProducts()
      if (products.some(product => product.sku === input.sku && product.isActive)) {
        throw new Error(`SKU "${input.sku}" は既に登録されています`)
      }

      const sortOrder = products
        .filter(product => product.inventoryGroupId === input.inventoryGroupId && product.isActive)
        .reduce((max, product) => Math.max(max, product.sortOrder), -1) + 1

      const payload = {
        ...buildProductPayload(input),
        sortOrder,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, COLLECTIONS.products), payload)

      return {
        ...mapProduct(ref.id, payload),
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    },

    async updateProduct(id, input) {
      const products = await getAllProducts()
      const current = products.find(product => product.id === id)
      if (!current) throw new Error('商品が見つかりません')

      if (input.sku && products.some(product => product.id !== id && product.sku === input.sku && product.isActive)) {
        throw new Error(`SKU "${input.sku}" は既に登録されています`)
      }

      const mergedInput: ProductInput = {
        sku: input.sku ?? current.sku,
        name: input.name ?? current.name,
        purchaseProductName: input.purchaseProductName ?? current.purchaseProductName,
        supplier: input.supplier ?? current.supplier,
        teaType: input.teaType ?? current.teaType,
        grade: input.grade ?? current.grade,
        origins: input.origins ?? current.origins,
        cultivars: input.cultivars ?? current.cultivars,
        pluckingMethods: input.pluckingMethods ?? current.pluckingMethods,
        harvestSeasons: input.harvestSeasons ?? current.harvestSeasons,
        shadingMethods: input.shadingMethods ?? current.shadingMethods,
        certifications: input.certifications ?? current.certifications,
        arrivalRecords: input.arrivalRecords ?? current.arrivalRecords,
        inventoryChecks: input.inventoryChecks ?? current.inventoryChecks,
        arrivalDate: current.arrivalDate,
        inventoryGroupId: input.inventoryGroupId ?? current.inventoryGroupId,
        initialStockKg: current.initialStockKg,
        standardWholesalePrice: input.standardWholesalePrice ?? current.standardWholesalePrice,
        purchaseUnitPrice: input.purchaseUnitPrice ?? current.purchaseUnitPrice,
        adminNote: input.adminNote ?? current.adminNote,
        salesNote: input.salesNote ?? current.salesNote,
        flavorNotes: input.flavorNotes ?? current.flavorNotes,
        imageUrl: input.imageUrl ?? current.imageUrl,
        showInCatalog: input.showInCatalog ?? current.showInCatalog,
        inquireToOrder: input.inquireToOrder ?? current.inquireToOrder,
        madeToOrder: input.madeToOrder ?? current.madeToOrder,
        wholesaleAvailableKg: input.wholesaleAvailableKg ?? current.wholesaleAvailableKg,
        standardPackageKg: input.standardPackageKg ?? current.standardPackageKg,
        wholesaleOptions: input.wholesaleOptions ?? current.wholesaleOptions,
        featured: input.featured ?? current.featured,
        sampleAvailable: input.sampleAvailable ?? current.sampleAvailable,
        samplePrice: input.samplePrice ?? current.samplePrice,
      }

      const payload = {
        ...buildProductPayload(mergedInput),
        updatedAt: serverTimestamp(),
      }
      await updateDoc(doc(db, COLLECTIONS.products, id), payload)

      const merged = { ...current, ...buildProductPayload(mergedInput), updatedAt: new Date() }
      return merged
    },

    async deleteProduct(id) {
      await updateDoc(doc(db, COLLECTIONS.products, id), {
        isActive: false,
        updatedAt: serverTimestamp(),
      })
    },

    async setProductArchived(id: string, archived: boolean) {
      await updateDoc(doc(db, COLLECTIONS.products, id), {
        archived,
        updatedAt: serverTimestamp(),
      })
    },

    async updateProductsSortOrder(orderedIds) {
      const batch = writeBatch(db)
      orderedIds.forEach((id, index) => {
        batch.update(doc(db, COLLECTIONS.products, id), {
          sortOrder: index,
          updatedAt: serverTimestamp(),
        })
      })
      await batch.commit()
    },

    async updateInventoryGroupsSortOrder(orderedIds) {
      const batch = writeBatch(db)
      orderedIds.forEach((id, index) => {
        batch.update(doc(db, COLLECTIONS.groups, id), {
          sortOrder: index,
          updatedAt: serverTimestamp(),
        })
      })
      await batch.commit()
    },

    async createInventoryGroup(input) {
      const groups = await getAllGroups()
      const sortOrder = groups.reduce((max, group) => Math.max(max, group.sortOrder), -1) + 1

      const ref = await addDoc(collection(db, COLLECTIONS.groups), {
        name: input.name,
        sortOrder,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      return {
        id: ref.id,
        name: input.name,
        sortOrder,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    },

    async updateInventoryGroup(id, input) {
      await updateDoc(doc(db, COLLECTIONS.groups, id), {
        ...sanitizeRecord(input),
        updatedAt: serverTimestamp(),
      })

      const snap = await getDoc(doc(db, COLLECTIONS.groups, id))
      return mapGroup(snap.id, snap.data() ?? {})
    },

    async deleteInventoryGroup(id) {
      const products = await getAllProducts()
      if (products.some(product => product.inventoryGroupId === id && product.isActive)) {
        throw new Error('商品が残っているグループは削除できません')
      }

      await updateDoc(doc(db, COLLECTIONS.groups, id), {
        isActive: false,
        updatedAt: serverTimestamp(),
      })
    },

    async deleteArrivalRecord(productId, arrivalId) {
      // Refuse to delete PO-linked arrivals — use the PO unreceive flow instead.
      if (arrivalId.startsWith('po:')) {
        throw new Error('PO に紐付いた入荷は「入荷管理」で取消してください')
      }
      await removeArrivalRecordFromProduct(productId, arrivalId)
    },
  }

  const selfConsumptionService: ISelfConsumptionService = {
    async getSelfConsumptionRecords() {
      const records = await getAllSelfConsumptions()
      return records.sort((a, b) => {
        const dateDiff = b.usedOn.localeCompare(a.usedOn)
        if (dateDiff !== 0) return dateDiff
        return b.updatedAt.getTime() - a.updatedAt.getTime()
      })
    },

    async createSelfConsumptionRecord(input) {
      const product = await assertSufficientSelfConsumptionStock(input)
      const payload = sanitizeRecord({
        ...input,
        usedOn: input.usedOn.trim(),
        notes: input.notes?.trim() || undefined,
        productSku: product.sku,
        productName: product.name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      const ref = await addDoc(collection(db, COLLECTIONS.selfConsumptions), payload)

      return {
        id: ref.id,
        ...input,
        usedOn: input.usedOn.trim(),
        notes: input.notes?.trim() || undefined,
        productSku: product.sku,
        productName: product.name,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    },

    async updateSelfConsumptionRecord(id, input) {
      const snap = await getDoc(doc(db, COLLECTIONS.selfConsumptions, id))
      if (!snap.exists()) throw new Error('自社消費の記録が見つかりません')
      const current = mapSelfConsumption(snap.id, snap.data() ?? {})

      const merged: SelfConsumptionRecordInput = {
        productId: input.productId ?? current.productId,
        quantityKg: input.quantityKg ?? current.quantityKg,
        usedOn: input.usedOn ?? current.usedOn,
        usageType: input.usageType ?? current.usageType,
        notes: input.notes ?? current.notes,
      }

      const product = await assertSufficientSelfConsumptionStock(merged, { excludeSelfConsumptionId: id })

      await updateDoc(doc(db, COLLECTIONS.selfConsumptions, id), sanitizeRecord({
        ...merged,
        usedOn: merged.usedOn.trim(),
        notes: merged.notes?.trim() || undefined,
        productSku: product.sku,
        productName: product.name,
        updatedAt: serverTimestamp(),
      }))

      return {
        id,
        ...merged,
        usedOn: merged.usedOn.trim(),
        notes: merged.notes?.trim() || undefined,
        productSku: product.sku,
        productName: product.name,
        createdAt: current.createdAt,
        updatedAt: new Date(),
      }
    },

    async deleteSelfConsumptionRecord(id) {
      await deleteDoc(doc(db, COLLECTIONS.selfConsumptions, id))
    },
  }

  const ecSalesService: IEcSalesService = {
    async getEcSaleRecords() {
      const records = await getAllEcSales()
      return records.sort((a, b) => {
        const dateDiff = b.soldOn.localeCompare(a.soldOn)
        if (dateDiff !== 0) return dateDiff
        return b.updatedAt.getTime() - a.updatedAt.getTime()
      })
    },
  }

  const purchaseOrdersService: IPurchaseOrdersService = {
    async getPurchaseOrders() {
      const orders = await getAllPurchaseOrders()
      return orders.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    },

    async createPurchaseOrder(input) {
      if (!input.items || input.items.length === 0) {
        throw new Error('商品を1つ以上指定してください')
      }
      const products = await getAllProducts()
      const items: PurchaseOrderLineItem[] = []
      for (const line of input.items) {
        const quantityKg = Number(line.quantityKg) || 0
        const unitPrice = Number(line.unitPrice) || 0
        const taxRate = coerceTaxRate(line.taxRate)
        if (line.productId) {
          const product = products.find(p => p.id === line.productId && p.isActive)
          if (!product) throw new Error('商品が見つかりません')
          items.push({
            productId: product.id,
            productSku: product.sku,
            productName: product.purchaseProductName || product.name,
            quantityKg,
            unitPrice,
            lineTotal: quantityKg * unitPrice,
            receivedKg: Number(line.receivedKg ?? 0),
            taxRate,
            lineId: line.lineId || crypto.randomUUID(),
            billedKg: 0,
            billedAmount: 0,
          })
        } else {
          items.push({ ...(await buildPoLineForNewProduct(line, quantityKg, unitPrice, taxRate)), lineId: line.lineId || crypto.randomUUID(), billedKg: 0, billedAmount: 0 })
        }
      }
      const totalQuantityKg = items.reduce((s, i) => s + i.quantityKg, 0)
      const totalAmount = items.reduce((s, i) => s + i.lineTotal, 0)

      const paymentStatus = input.paymentStatus ?? 'uninvoiced'
      const invoice = input.invoice && input.invoice.url ? input.invoice : undefined
      const payments = normalizePoPayments(input.payments)

      const shippingFee = Number(input.shippingFee) || 0
      const otherFees = Number(input.otherFees) || 0
      const otherFeesNote = input.otherFeesNote?.trim() || undefined
      const payload = sanitizeRecord({
        supplierName: input.supplierName.trim(),
        items,
        totalQuantityKg,
        totalAmount,
        shippingFee,
        otherFees,
        otherFeesNote,
        orderDate: input.orderDate.trim(),
        expectedDeliveryDate: input.expectedDeliveryDate?.trim() || undefined,
        actualDeliveryDate: input.actualDeliveryDate?.trim() || undefined,
        status: input.status,
        paymentStatus,
        paymentDueDate: input.paymentDueDate?.trim() || undefined,
        paidDate: input.paidDate?.trim() || undefined,
        payments,
        invoice,
        // New POs adopt the invoice-driven flow: they become payable only when an
        // invoice is received. Legacy POs (pre-cutover) keep flowVersion undefined.
        flowVersion: 'invoice',
        notes: input.notes?.trim() || undefined,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      const ref = await addDoc(collection(db, COLLECTIONS.purchaseOrders), payload)

      // Arrivals are reflected only via the receiving flow, not by PO status.
      await syncSuppliersCollection()

      return mapPurchaseOrder(ref.id, { ...payload, createdAt: new Date(), updatedAt: new Date() })
    },

    async updatePurchaseOrder(id, input) {
      const ref = doc(db, COLLECTIONS.purchaseOrders, id)
      const snap = await getDoc(ref)
      if (!snap.exists()) throw new Error('発注が見つかりません')
      const current = mapPurchaseOrder(snap.id, snap.data() ?? {})

      const mergedInputItems: PurchaseOrderLineInput[] = input.items ?? current.items.map(item => ({
        productId: item.productId || undefined,
        productName: item.productName,
        quantityKg: item.quantityKg,
        unitPrice: item.unitPrice,
        receivedKg: item.receivedKg,
        taxRate: item.taxRate,
        lineId: item.lineId,
      }))
      // Carry the billing ledger across edits, matched by stable lineId (NOT index).
      const ledgerByLineId = new Map<string, { billedKg: number; billedAmount: number }>()
      for (const it of current.items) {
        if (it.lineId) ledgerByLineId.set(it.lineId, { billedKg: it.billedKg ?? 0, billedAmount: it.billedAmount ?? 0 })
      }

      const merged: PurchaseOrderInput = {
        supplierName: input.supplierName ?? current.supplierName,
        items: mergedInputItems,
        shippingFee: input.shippingFee ?? current.shippingFee,
        otherFees: input.otherFees ?? current.otherFees,
        otherFeesNote: input.otherFeesNote ?? current.otherFeesNote,
        orderDate: input.orderDate ?? current.orderDate,
        expectedDeliveryDate: input.expectedDeliveryDate ?? current.expectedDeliveryDate,
        actualDeliveryDate: input.actualDeliveryDate ?? current.actualDeliveryDate,
        status: input.status ?? current.status,
        paymentStatus: input.paymentStatus ?? current.paymentStatus,
        paymentDueDate: input.paymentDueDate ?? current.paymentDueDate,
        paidDate: input.paidDate ?? current.paidDate,
        payments: input.payments ?? current.payments,
        invoice: input.invoice === null ? null : (input.invoice ?? current.invoice),
        notes: input.notes ?? current.notes,
        billingComplete: input.billingComplete ?? current.billingComplete,
      }

      if (!merged.items || merged.items.length === 0) {
        throw new Error('商品を1つ以上指定してください')
      }

      const products = await getAllProducts()
      const items: PurchaseOrderLineItem[] = []
      for (const line of merged.items) {
        const quantityKg = Number(line.quantityKg) || 0
        const unitPrice = Number(line.unitPrice) || 0
        const taxRate = coerceTaxRate(line.taxRate)
        const lineId = line.lineId || crypto.randomUUID()
        const ledger = (line.lineId && ledgerByLineId.get(line.lineId)) || { billedKg: 0, billedAmount: 0 }
        if (line.productId) {
          const product = products.find(p => p.id === line.productId && p.isActive)
          if (!product) throw new Error('商品が見つかりません')
          items.push({
            productId: product.id,
            productSku: product.sku,
            productName: product.purchaseProductName || product.name,
            quantityKg,
            unitPrice,
            lineTotal: quantityKg * unitPrice,
            receivedKg: Number(line.receivedKg ?? 0),
            taxRate,
            lineId,
            billedKg: ledger.billedKg,
            billedAmount: ledger.billedAmount,
          })
        } else {
          items.push({ ...(await buildPoLineForNewProduct(line, quantityKg, unitPrice, taxRate)), lineId, billedKg: ledger.billedKg, billedAmount: ledger.billedAmount })
        }
      }
      const totalQuantityKg = items.reduce((s, i) => s + i.quantityKg, 0)
      const totalAmount = items.reduce((s, i) => s + i.lineTotal, 0)

      const invoiceToWrite = merged.invoice === null
        ? deleteField()
        : (merged.invoice && merged.invoice.url ? merged.invoice : undefined)

      const shippingFee = Number(merged.shippingFee) || 0
      const otherFees = Number(merged.otherFees) || 0
      const otherFeesNote = merged.otherFeesNote?.trim() || undefined
      const payments = normalizePoPayments(merged.payments)

      const writePayload = {
        supplierName: merged.supplierName.trim(),
        items,
        totalQuantityKg,
        totalAmount,
        shippingFee,
        otherFees,
        otherFeesNote,
        orderDate: merged.orderDate.trim(),
        expectedDeliveryDate: merged.expectedDeliveryDate?.trim() || undefined,
        actualDeliveryDate: merged.actualDeliveryDate?.trim() || undefined,
        status: merged.status,
        paymentStatus: merged.paymentStatus ?? 'uninvoiced',
        paymentDueDate: merged.paymentDueDate?.trim() || undefined,
        paidDate: merged.paidDate?.trim() || undefined,
        payments,
        // Preserve the flow stamp (never flip on a plain edit).
        flowVersion: current.flowVersion,
        billingComplete: !!merged.billingComplete,
      }

      await updateDoc(ref, sanitizeRecord({
        ...writePayload,
        invoice: invoiceToWrite,
        notes: merged.notes?.trim() || undefined,
        updatedAt: serverTimestamp(),
      }))

      // Arrivals are managed by the receiving flow; editing a PO never touches stock.
      await syncSuppliersCollection()

      return mapPurchaseOrder(id, {
        ...writePayload,
        invoice: merged.invoice === null ? undefined : merged.invoice,
        notes: merged.notes?.trim() || undefined,
        createdAt: current.createdAt,
        updatedAt: new Date(),
      })
    },

    async deletePurchaseOrder(id) {
      const ref = doc(db, COLLECTIONS.purchaseOrders, id)
      // Arrivals can exist independent of status, so always strip them.
      await stripPurchaseOrderArrivalsFromProducts(id)
      await deleteDoc(ref)
      await syncSuppliersCollection()
    },

    async receivePurchaseOrderLine(orderId, lineIndex, opts) {
      const ref = doc(db, COLLECTIONS.purchaseOrders, orderId)
      const snapshot = await getDoc(ref)
      if (!snapshot.exists()) throw new Error('発注が見つかりません')
      const order = mapPurchaseOrder(snapshot.id, snapshot.data() ?? {})
      const line = order.items[lineIndex]
      if (!line) throw new Error('対象の明細が見つかりません')

      let targetProductId: string
      let targetSku: string
      let targetName: string

      const mapping = opts.mapping
      if (mapping.kind === 'existing') {
        const products = await getAllProducts()
        const found = products.find(p => p.id === mapping.productId)
        if (!found || !found.isActive) throw new Error('紐付け先の商品が見つかりません')
        targetProductId = found.id
        targetSku = found.sku
        targetName = found.purchaseProductName || found.name
      } else {
        // Create the product WITHOUT an arrival; the arrival is added uniformly below.
        const created = await createProductDoc({ ...mapping.product, arrivalRecords: [], initialStockKg: 0 })
        targetProductId = created.id
        targetSku = created.product.sku
        targetName = created.product.purchaseProductName || created.product.name
      }

      await addArrivalRecordToProduct(targetProductId, {
        id: `po:${orderId}:${lineIndex}`,
        arrivalDate: opts.arrivalDate,
        quantityKg: line.quantityKg,
        unitPrice: line.unitPrice,
      })

      // Transactional so a concurrent invoice consume / PO edit can't clobber the
      // shared items array (Firestore conflict detection fires on the re-read).
      await runTransaction(db, async txn => {
        const cur = await txn.get(ref)
        if (!cur.exists()) throw new Error('発注が見つかりません')
        const curOrder = mapPurchaseOrder(cur.id, cur.data() ?? {})
        const { items: withIds } = ensurePoLineIds(curOrder.items)
        const nextItems = withIds.map((item, idx) => (
          idx === lineIndex
            ? { ...item, productId: targetProductId, productSku: targetSku, productName: targetName, receivedKg: item.quantityKg }
            : item
        ))
        const allReceived = nextItems.every(item => item.receivedKg >= item.quantityKg)
        const nextStatus: PurchaseOrderStatus = allReceived && curOrder.status !== 'cancelled' ? 'received' : curOrder.status
        txn.update(ref, { items: nextItems, status: nextStatus, updatedAt: serverTimestamp() })
      })
      await syncSuppliersCollection()
    },

    async unreceivePurchaseOrderLine(orderId, lineIndex) {
      const ref = doc(db, COLLECTIONS.purchaseOrders, orderId)
      const snapshot = await getDoc(ref)
      if (!snapshot.exists()) throw new Error('発注が見つかりません')
      const order = mapPurchaseOrder(snapshot.id, snapshot.data() ?? {})
      const line = order.items[lineIndex]
      if (!line) throw new Error('対象の明細が見つかりません')

      if (line.productId) {
        await removeArrivalRecordFromProduct(line.productId, `po:${orderId}:${lineIndex}`)
      }

      await runTransaction(db, async txn => {
        const cur = await txn.get(ref)
        if (!cur.exists()) throw new Error('発注が見つかりません')
        const curOrder = mapPurchaseOrder(cur.id, cur.data() ?? {})
        const { items: withIds } = ensurePoLineIds(curOrder.items)
        const nextItems = withIds.map((item, idx) => (idx === lineIndex ? { ...item, receivedKg: 0 } : item))
        const nextStatus: PurchaseOrderStatus = curOrder.status === 'received' ? 'placed' : curOrder.status
        txn.update(ref, { items: nextItems, status: nextStatus, updatedAt: serverTimestamp() })
      })
    },

    async setPurchaseOrderBillingComplete(orderId, complete) {
      // Lightweight flag write — does NOT rebuild items / re-resolve products, so it
      // can't fail just because a product was later deactivated.
      const ref = doc(db, COLLECTIONS.purchaseOrders, orderId)
      await updateDoc(ref, { billingComplete: complete, updatedAt: serverTimestamp() })
      const snap = await getDoc(ref)
      if (!snap.exists()) throw new Error('発注が見つかりません')
      return mapPurchaseOrder(snap.id, snap.data() ?? {})
    },

    async convertOrphanArrivalToPo(productId, arrivalId, input) {
      // Find the product and its arrival record.
      const productRef = doc(db, COLLECTIONS.products, productId)
      const productSnap = await getDoc(productRef)
      if (!productSnap.exists()) throw new Error('商品が見つかりません')
      const productData = productSnap.data() ?? {}
      const arrivals: Array<{ id: string; arrivalDate: string; quantityKg: number }> =
        Array.isArray(productData.arrivalRecords) ? productData.arrivalRecords : []
      const arrival = arrivals.find(a => a.id === arrivalId)
      if (!arrival) throw new Error('入荷記録が見つかりません')

      const supplierName = input.supplierName.trim()
      if (!supplierName) throw new Error('仕入先を入力してください')
      const unitPrice = Number(input.unitPrice) || 0
      const taxRate: 8 | 10 = input.taxRate === 10 ? 10 : 8
      const orderDate = (input.orderDate || arrival.arrivalDate || '').trim()
      if (!orderDate) throw new Error('発注日を指定してください')

      const productName = String(productData.purchaseProductName || productData.name || '')
      const productSku = String(productData.sku || '')
      const quantityKg = Number(arrival.quantityKg) || 0
      const lineTotal = quantityKg * unitPrice

      const items: PurchaseOrderLineItem[] = [{
        productId,
        productSku,
        productName,
        quantityKg,
        unitPrice,
        lineTotal,
        receivedKg: quantityKg,
        taxRate,
      }]
      const totalAmount = lineTotal

      const payload = sanitizeRecord({
        supplierName,
        items,
        totalQuantityKg: quantityKg,
        totalAmount,
        shippingFee: 0,
        otherFees: 0,
        orderDate,
        actualDeliveryDate: arrival.arrivalDate,
        status: 'received' as PurchaseOrderStatus,
        paymentStatus: 'uninvoiced' as PurchaseOrderPaymentStatus,
        payments: [] as PurchaseOrderPayment[],
        notes: input.notes?.trim() || '期首在庫から自動変換',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      const newOrderRef = await addDoc(collection(db, COLLECTIONS.purchaseOrders), payload)

      // Re-key the arrival ID: remove the orphan and add a PO-linked one with the same date/quantity.
      const remaining = arrivals.filter(a => a.id !== arrivalId)
      const newArrival = {
        id: `po:${newOrderRef.id}:0`,
        arrivalDate: toIsoDate(arrival.arrivalDate),
        quantityKg,
        ...(unitPrice > 0 ? { unitPrice } : {}),
      }
      const nextArrivals = [...remaining, newArrival]
      await updateDoc(productRef, {
        arrivalRecords: nextArrivals,
        arrivalDate: deriveArrivalDate(nextArrivals),
        initialStockKg: deriveInitialStockKg(nextArrivals),
        ...(unitPrice > 0 ? { purchaseUnitPrice: unitPrice } : {}),
        updatedAt: serverTimestamp(),
      })

      await syncSuppliersCollection()

      return {
        id: newOrderRef.id,
        supplierName,
        items,
        totalQuantityKg: quantityKg,
        totalAmount,
        shippingFee: 0,
        otherFees: 0,
        otherFeesNote: undefined,
        orderDate,
        expectedDeliveryDate: undefined,
        actualDeliveryDate: arrival.arrivalDate,
        status: 'received',
        paymentStatus: 'uninvoiced',
        paymentDueDate: undefined,
        paidDate: undefined,
        payments: [],
        invoice: undefined,
        notes: input.notes?.trim() || '期首在庫から自動変換',
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    },
  }

  const suppliersService: ISuppliersService = {
    async getSuppliers() {
      const suppliers = await getAllSuppliers()
      return suppliers.sort((a, b) => {
        const left = a.lastOrderedAt?.getTime() ?? a.updatedAt.getTime()
        const right = b.lastOrderedAt?.getTime() ?? b.updatedAt.getTime()
        return right - left
      })
    },

    async updateSupplier(id, input) {
      const ref = doc(db, COLLECTIONS.suppliers, id)
      const cleaned: Record<string, unknown> = {}
      const optionalKeys = [
        'contactPersonName',
        'email',
        'phone',
        'website',
        'address',
        'postalCode',
        'country',
        'bankInfo',
        'notes',
      ] as const
      for (const key of optionalKeys) {
        const value = input[key]
        if (value === undefined) continue
        const trimmed = typeof value === 'string' ? value.trim() : value
        cleaned[key] = trimmed ? trimmed : deleteField()
      }
      if (input.attachments !== undefined) {
        cleaned.attachments = input.attachments
      }
      cleaned.updatedAt = serverTimestamp()
      await updateDoc(ref, cleaned)
      const snap = await getDoc(ref)
      if (!snap.exists()) throw new Error('仕入先が見つかりません')
      return mapSupplier(snap.id, snap.data() ?? {})
    },
  }

  const purchaseInvoicesService: IPurchaseInvoicesService = {
    async getPurchaseInvoices() {
      const invoices = await getAllPurchaseInvoices()
      return invoices.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    },

    async getPurchaseInvoice(id) {
      const snap = await getDoc(doc(db, COLLECTIONS.purchaseInvoices, id))
      if (!snap.exists()) return null
      return mapPurchaseInvoice(snap.id, snap.data() ?? {})
    },

    async getPurchaseInvoicesByPo(poId) {
      const q = query(collection(db, COLLECTIONS.purchaseInvoices), where('linkedPoIds', 'array-contains', poId))
      const snap = await getDocs(q)
      return snap.docs.map(d => mapPurchaseInvoice(d.id, d.data())).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    },

    async createPurchaseInvoice(input) {
      const id = await writePurchaseInvoice(db, null, input)
      const snap = await getDoc(doc(db, COLLECTIONS.purchaseInvoices, id))
      return mapPurchaseInvoice(id, snap.data() ?? {})
    },

    async updatePurchaseInvoice(id, input) {
      await writePurchaseInvoice(db, id, input)
      const snap = await getDoc(doc(db, COLLECTIONS.purchaseInvoices, id))
      if (!snap.exists()) throw new Error('請求書が見つかりません')
      return mapPurchaseInvoice(id, snap.data() ?? {})
    },

    async deletePurchaseInvoice(id, opts) {
      await deletePurchaseInvoiceTxn(db, id, opts?.force === true)
    },

    async updateInvoicePayments(id, payments) {
      const ref = doc(db, COLLECTIONS.purchaseInvoices, id)
      const snap = await getDoc(ref)
      if (!snap.exists()) throw new Error('請求書が見つかりません')
      const cleaned = normalizePoPayments(payments)
      const inv = mapPurchaseInvoice(id, { ...snap.data(), payments: cleaned })
      // Guard against stranding recorded cash below an edited-down payable.
      await updateDoc(ref, {
        payments: cleaned,
        paymentStatus: inv.paymentStatus,
        updatedAt: serverTimestamp(),
      })
      return mapPurchaseInvoice(id, { ...snap.data(), payments: cleaned })
    },

    async getUnbilledReceivedPoLines() {
      const orders = await getAllPurchaseOrders()
      const rows: UnbilledPoLine[] = []
      for (const po of orders) {
        if (po.status === 'cancelled') continue
        if (isLegacyPayablePo(po)) continue
        if (po.billingComplete) continue
        // Self-heal: persist minted lineIds so the picker references stable ids.
        const { items, minted } = ensurePoLineIds(po.items)
        if (minted) {
          await updateDoc(doc(db, COLLECTIONS.purchaseOrders, po.id), {
            items: serializePoItems(items),
            updatedAt: serverTimestamp(),
          }).catch(() => {})
        }
        for (const line of items) {
          if ((line.receivedKg ?? 0) <= 0) continue
          const remaining = poLineBillableRemaining(line)
          if (remaining <= 0.5) continue
          rows.push({
            poId: po.id,
            supplierName: po.supplierName,
            orderDate: po.orderDate,
            expectedDeliveryDate: po.expectedDeliveryDate,
            lineId: line.lineId as string,
            productName: line.productName,
            orderedKg: line.quantityKg,
            receivedKg: line.receivedKg,
            unitPrice: line.unitPrice,
            taxRate: line.taxRate,
            billedAmount: line.billedAmount ?? 0,
            billableRemainingAmount: remaining,
          })
        }
      }
      return rows
    },
  }

  const mastersService: IMastersService = {
    async listMasters() {
      const snap = await getDocs(collection(db, COLLECTIONS.masters))
      return snap.docs
        .map(d => mapMaster(d.id, d.data()))
        .filter(m => m.isActive)
        .sort((a, b) => {
          if (a.type !== b.type) return a.type.localeCompare(b.type)
          return a.sortOrder - b.sortOrder
        })
    },

    async createMaster(input) {
      const ref = await addDoc(collection(db, COLLECTIONS.masters), {
        type: input.type,
        englishName: input.englishName.trim(),
        japaneseName: input.japaneseName.trim(),
        sortOrder: input.sortOrder ?? 0,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      const snap = await getDoc(ref)
      return mapMaster(ref.id, snap.data() ?? {})
    },

    async updateMaster(id, input) {
      const ref = doc(db, COLLECTIONS.masters, id)
      const cleaned: Record<string, unknown> = {}
      if (input.type !== undefined) cleaned.type = input.type
      if (input.englishName !== undefined) cleaned.englishName = input.englishName.trim()
      if (input.japaneseName !== undefined) cleaned.japaneseName = input.japaneseName.trim()
      if (input.sortOrder !== undefined) cleaned.sortOrder = input.sortOrder
      cleaned.updatedAt = serverTimestamp()
      await updateDoc(ref, cleaned)
      const snap = await getDoc(ref)
      return mapMaster(snap.id, snap.data() ?? {})
    },

    async deleteMaster(id) {
      await deleteDoc(doc(db, COLLECTIONS.masters, id))
    },
  }

  const settingsService: ISettingsService = {
    async getSettings() {
      return getSettings()
    },

    async updateSettings(input) {
      const payload = sanitizeRecord({
        ...input,
        updatedAt: serverTimestamp(),
      })
      await setDoc(doc(db, COLLECTIONS.settings, 'main'), payload, { merge: true })
      return getSettings()
    },

    async getDocumentTermsEn() {
      const snap = await getDoc(doc(db, COLLECTIONS.settings, 'terms_en'))
      const data = snap.data()
      const sections = Array.isArray(data?.sections) ? data!.sections : []
      return sections
        .map((s: unknown) => {
          const obj = s as { heading?: unknown; body?: unknown }
          return { heading: String(obj?.heading ?? ''), body: String(obj?.body ?? '') }
        })
        .filter((s: { heading: string; body: string }) => s.heading || s.body)
    },

    async updateDocumentTermsEn(sections) {
      await setDoc(
        doc(db, COLLECTIONS.settings, 'terms_en'),
        { sections, updatedAt: serverTimestamp() },
        { merge: true },
      )
    },

    async getBankAccounts() {
      const snap = await getDoc(doc(db, COLLECTIONS.settings, 'bank_accounts'))
      const data = snap.data()
      return {
        ja: String(data?.ja ?? ''),
        en: String(data?.en ?? ''),
      }
    },

    async updateBankAccounts(input) {
      await setDoc(
        doc(db, COLLECTIONS.settings, 'bank_accounts'),
        { ja: input.ja, en: input.en, updatedAt: serverTimestamp() },
        { merge: true },
      )
    },

    async getIssuer() {
      const snap = await getDoc(doc(db, COLLECTIONS.settings, 'issuer'))
      const data = snap.data() ?? {}
      return {
        company: String(data.company ?? ISSUER.company),
        companyEn: String(data.companyEn ?? ISSUER.companyEn),
        postalCode: String(data.postalCode ?? ISSUER.postalCode),
        address: String(data.address ?? ISSUER.address),
        addressEn: String(data.addressEn ?? ISSUER.addressEn),
        tel: String(data.tel ?? ISSUER.tel),
        email: String(data.email ?? ISSUER.email),
        registrationNumber: String(data.registrationNumber ?? ISSUER.registrationNumber),
      }
    },

    async updateIssuer(input) {
      await setDoc(
        doc(db, COLLECTIONS.settings, 'issuer'),
        { ...input, updatedAt: serverTimestamp() },
        { merge: true },
      )
    },
  }

  const authService: IAuthService = {
    async login(email, password) {
      const credential = await signInWithEmailAndPassword(auth, email, password)
      const role = await ensureUserProfile(credential.user)
      return toAuthUser(credential.user, role)
    },

    async loginWithGoogle() {
      const provider = new GoogleAuthProvider()
      const credential = await signInWithPopup(auth, provider)
      const role = await ensureUserProfile(credential.user)
      return toAuthUser(credential.user, role)
    },

    async logout() {
      await signOut(auth)
    },

    async getCurrentUser() {
      if (!auth.currentUser) return null
      const role = await getUserRole(auth.currentUser.uid)
      return toAuthUser(auth.currentUser, role)
    },

    onAuthStateChanged(callback) {
      return firebaseOnAuthStateChanged(auth, async user => {
        if (!user) {
          callback(null)
          return
        }
        const role = await ensureUserProfile(user)
        callback(toAuthUser(user, role))
      })
    },

    async listUsers() {
      const snap = await getDocs(collection(db, COLLECTIONS.users))
      return snap.docs.map(d => {
        const data = d.data()
        return {
          uid: d.id,
          email: String(data.email ?? ''),
          role: data.role === 'admin' ? 'admin' : 'viewer',
          createdAt: data.createdAt ? toDate(data.createdAt) : undefined,
          updatedAt: data.updatedAt ? toDate(data.updatedAt) : undefined,
        } satisfies UserProfile
      }).sort((a, b) => a.email.localeCompare(b.email))
    },

    async updateUserRole(uid, role) {
      await updateDoc(doc(db, COLLECTIONS.users, uid), {
        role,
        updatedAt: serverTimestamp(),
      })
    },

    async deleteUserProfile(uid) {
      await deleteDoc(doc(db, COLLECTIONS.users, uid))
    },
  }

  return {
    inventory: inventoryService,
    selfConsumption: selfConsumptionService,
    ecSales: ecSalesService,
    purchaseOrders: purchaseOrdersService,
    suppliers: suppliersService,
    purchaseInvoices: purchaseInvoicesService,
    settings: settingsService,
    masters: mastersService,
    auth: authService,
  }
}
