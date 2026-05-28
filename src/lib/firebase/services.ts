import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
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
  Buyer,
  EcSaleRecord,
  EcSaleRecordInput,
  InventoryCheckRecord,
  InventoryGroup,
  InventoryGroupInput,
  MasterEntry,
  MasterType,
  Product,
  ProductInput,
  ProductWithInventory,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderLineItem,
  PurchaseOrderStatus,
  SaleLineItem,
  SaleRecord,
  SaleRecordInput,
  SelfConsumptionRecord,
  SelfConsumptionRecordInput,
  SelfConsumptionUsageType,
  Settings,
  StockStatus,
  Supplier,
  SupplierDetailsInput,
} from '@/types'
import type {
  IAuthService,
  IEcSalesService,
  IInventoryService,
  IMastersService,
  IPurchaseOrdersService,
  ISelfConsumptionService,
  ISalesService,
  ISettingsService,
  ISuppliersService,
  IServices,
  UserProfile,
} from '../services'
import { getFirebaseAuthInstance, getFirebaseDb } from './config'
import { ISSUER } from '../invoice'

const COLLECTIONS = {
  groups: 'inventory_groups',
  products: 'products',
  sales: 'sales',
  buyers: 'buyers',
  selfConsumptions: 'self_consumptions',
  ecSales: 'ec_sales',
  settings: 'settings',
  users: 'users',
  masters: 'masters',
  purchaseOrders: 'purchase_orders',
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
  }
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
    showInCatalog: data.showInCatalog !== false,
    inquireToOrder: data.inquireToOrder === true,
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

function normalizeSaleItem(raw: unknown): SaleLineItem | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const productId = String(obj.productId ?? '')
  if (!productId) return null
  const quantityKg = Number(obj.quantityKg ?? 0)
  const unitPrice = Number(obj.unitPrice ?? 0)
  const costPerKg = Number(obj.costPerKg ?? 0)
  const revenue = obj.revenue != null ? Number(obj.revenue) : quantityKg * unitPrice
  const costAmount = obj.costAmount != null ? Number(obj.costAmount) : quantityKg * costPerKg
  const grossProfit = obj.grossProfit != null ? Number(obj.grossProfit) : revenue - costAmount
  return {
    productId,
    productSku: String(obj.productSku ?? ''),
    productName: String(obj.productName ?? ''),
    quantityKg,
    unitPrice,
    costPerKg,
    revenue,
    costAmount,
    grossProfit,
  }
}

function aggregateItems(items: SaleLineItem[]): {
  productId: string
  productSku: string
  productName: string
  quantityKg: number
  unitPrice: number
  costPerKg: number
  revenue: number
  costAmount: number
  grossProfit: number
} {
  const first = items[0]
  const quantityKg = items.reduce((s, i) => s + i.quantityKg, 0)
  const revenue = items.reduce((s, i) => s + i.revenue, 0)
  const costAmount = items.reduce((s, i) => s + i.costAmount, 0)
  const grossProfit = revenue - costAmount
  const unitPrice = quantityKg > 0 ? revenue / quantityKg : 0
  const costPerKg = quantityKg > 0 ? costAmount / quantityKg : 0
  return {
    productId: first?.productId ?? '',
    productSku: first?.productSku ?? '',
    productName: first?.productName ?? '',
    quantityKg,
    unitPrice,
    costPerKg,
    revenue,
    costAmount,
    grossProfit,
  }
}

function mapSale(id: string, data: DocumentData): SaleRecord {
  const rawItems = Array.isArray(data.items) ? data.items : []
  let items: SaleLineItem[] = rawItems
    .map(normalizeSaleItem)
    .filter((item): item is SaleLineItem => item !== null)
  if (items.length === 0) {
    const legacyProductId = String(data.productId ?? '')
    if (legacyProductId) {
      const quantityKg = Number(data.quantityKg ?? 0)
      const unitPrice = Number(data.unitPrice ?? 0)
      const costPerKg = Number(data.costPerKg ?? 0)
      const revenue = data.revenue != null ? Number(data.revenue) : quantityKg * unitPrice
      const costAmount = data.costAmount != null ? Number(data.costAmount) : quantityKg * costPerKg
      items = [{
        productId: legacyProductId,
        productSku: String(data.productSku ?? ''),
        productName: String(data.productName ?? ''),
        quantityKg,
        unitPrice,
        costPerKg,
        revenue,
        costAmount,
        grossProfit: data.grossProfit != null ? Number(data.grossProfit) : revenue - costAmount,
      }]
    }
  }
  const agg = aggregateItems(items)
  const shippingFee = Number(data.shippingFee ?? 0)
  const otherFees = Number(data.otherFees ?? 0)
  const paymentFee = Number(data.paymentFee ?? 0)
  const otherFeesNote = data.otherFeesNote ? String(data.otherFeesNote) : undefined
  const invoiceAmount = agg.revenue + shippingFee + otherFees
  const grossProfit = agg.revenue - agg.costAmount - paymentFee
  return {
    id,
    status: data.status,
    paymentStatus: (data.paymentStatus === 'invoiced' || data.paymentStatus === 'paid')
      ? data.paymentStatus
      : 'uninvoiced',
    shippingStatus: (data.shippingStatus === 'producing' || data.shippingStatus === 'ready_to_ship' || data.shippingStatus === 'shipped')
      ? data.shippingStatus
      : 'ordering',
    buyerName: String(data.buyerName ?? ''),
    items,
    productId: agg.productId,
    productSku: agg.productSku,
    productName: agg.productName,
    quantityKg: agg.quantityKg,
    unitPrice: agg.unitPrice,
    costPerKg: agg.costPerKg,
    revenue: agg.revenue,
    costAmount: agg.costAmount,
    grossProfit,
    shippingFee,
    otherFees,
    otherFeesNote,
    paymentFee,
    invoiceAmount,
    country: String(data.country ?? ''),
    dueDate: data.dueDate ? String(data.dueDate) : undefined,
    terms: data.terms ? String(data.terms) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    paymentMethod: data.paymentMethod ? String(data.paymentMethod) : undefined,
    paymentDate: data.paymentDate ? String(data.paymentDate) : undefined,
    shippingAddress: data.shippingAddress ? String(data.shippingAddress) : undefined,
    shippingPostalCode: data.shippingPostalCode ? String(data.shippingPostalCode) : undefined,
    shippingMethod: data.shippingMethod ? String(data.shippingMethod) : undefined,
    shippingDate: data.shippingDate ? String(data.shippingDate) : undefined,
    trackingNumber: data.trackingNumber ? String(data.trackingNumber) : undefined,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

function mapBuyer(id: string, data: DocumentData): Buyer {
  return {
    id,
    name: String(data.name ?? ''),
    normalizedName: String(data.normalizedName ?? ''),
    country: data.country ? String(data.country) : undefined,
    terms: data.terms ? String(data.terms) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
    email: data.email ? String(data.email) : undefined,
    website: data.website ? String(data.website) : undefined,
    phone: data.phone ? String(data.phone) : undefined,
    shippingAddress: data.shippingAddress ? String(data.shippingAddress) : undefined,
    shippingPostalCode: data.shippingPostalCode ? String(data.shippingPostalCode) : undefined,
    contactPersonName: data.contactPersonName ? String(data.contactPersonName) : undefined,
    saleCount: Number(data.saleCount ?? 0),
    lastSoldAt: data.lastSoldAt ? toDate(data.lastSoldAt) : undefined,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

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
    status: data.status === 'cancelled' ? 'cancelled' : 'active',
    cancelledAt: data.cancelledAt ? String(data.cancelledAt) : undefined,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
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

function mapSettings(data?: DocumentData): Settings {
  const defaults = getDefaultSettings()
  if (!data) return defaults
  return {
    appName: String(data.appName ?? defaults.appName),
    currency: String(data.currency ?? defaults.currency),
    stockAlertRatio: Number(data.stockAlertRatio ?? defaults.stockAlertRatio),
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

async function getAllSales(): Promise<SaleRecord[]> {
  const db = getFirebaseDb()
  const snap = await getDocs(collection(db, COLLECTIONS.sales))
  return snap.docs.map(document => mapSale(document.id, document.data()))
}

async function getAllBuyers(): Promise<Buyer[]> {
  const db = getFirebaseDb()
  const snap = await getDocs(collection(db, COLLECTIONS.buyers))
  return snap.docs.map(document => mapBuyer(document.id, document.data()))
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

function isReservedSale(status: SaleRecord['status']): boolean {
  return status === 'negotiating' || status === 'confirmed'
}

function computeInventory(
  products: Product[],
  sales: SaleRecord[],
  selfConsumptions: SelfConsumptionRecord[],
  ecSales: EcSaleRecord[],
  settings: Settings,
): ProductWithInventory[] {
  const reservedByProduct = sales.reduce<Record<string, number>>((acc, sale) => {
    if (!isReservedSale(sale.status)) return acc
    for (const item of sale.items) {
      acc[item.productId] = (acc[item.productId] ?? 0) + item.quantityKg
    }
    return acc
  }, {})
  const selfConsumedByProduct = selfConsumptions.reduce<Record<string, number>>((acc, record) => {
    acc[record.productId] = (acc[record.productId] ?? 0) + record.quantityKg
    return acc
  }, {})
  const ecSoldByProduct = ecSales.reduce<Record<string, number>>((acc, record) => {
    if (record.status === 'cancelled') return acc
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

async function assertSufficientStock(
  nextSale: SaleRecordInput,
  options?: { excludeSaleId?: string },
): Promise<{ productMap: Map<string, Product> }> {
  if (!Array.isArray(nextSale.items) || nextSale.items.length === 0) {
    throw new Error('商品を1つ以上指定してください')
  }
  const [products, sales, selfConsumptions, ecSales] = await Promise.all([
    getAllProducts(),
    getAllSales(),
    getAllSelfConsumptions(),
    getAllEcSales(),
  ])

  // Sum quantity per productId within this sale (handles duplicate productIds)
  const requestedByProduct = nextSale.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.productId] = (acc[item.productId] ?? 0) + Number(item.quantityKg ?? 0)
    return acc
  }, {})

  const productMap = new Map<string, Product>()
  for (const productId of Object.keys(requestedByProduct)) {
    const product = products.find(item => item.id === productId && item.isActive)
    if (!product) throw new Error('商品が見つかりません')
    productMap.set(productId, product)
  }

  const shouldValidate = isReservedSale(nextSale.status)
  if (!shouldValidate) {
    return { productMap }
  }

  for (const [productId, requestedKg] of Object.entries(requestedByProduct)) {
    const product = productMap.get(productId)!
    const reservedKg = sales
      .filter(sale => sale.id !== options?.excludeSaleId && isReservedSale(sale.status))
      .reduce((sum, sale) => sum + sale.items
        .filter(item => item.productId === productId)
        .reduce((s, item) => s + item.quantityKg, 0), 0)
    const selfConsumedKg = selfConsumptions
      .filter(record => record.productId === productId)
      .reduce((sum, record) => sum + record.quantityKg, 0)
    const ecSoldKg = ecSales
      .filter(record => record.productId === productId && record.status !== 'cancelled')
      .reduce((sum, record) => sum + record.quantityKg, 0)
    const availableKg = product.initialStockKg
      + deriveInventoryAdjustmentKg(product.inventoryChecks)
      - reservedKg
      - selfConsumedKg
      - ecSoldKg
    if (requestedKg > availableKg) {
      throw new Error(`「${product.name}」の在庫が不足しています。残り ${availableKg.toFixed(1)}kg まで登録できます`)
    }
  }

  return { productMap }
}

async function assertSufficientSelfConsumptionStock(
  input: SelfConsumptionRecordInput,
  options?: { excludeSelfConsumptionId?: string },
): Promise<Product> {
  const [products, sales, selfConsumptions, ecSales] = await Promise.all([
    getAllProducts(),
    getAllSales(),
    getAllSelfConsumptions(),
    getAllEcSales(),
  ])
  const product = products.find(item => item.id === input.productId && item.isActive)
  if (!product) throw new Error('商品が見つかりません')

  const reservedKg = sales
    .filter(sale => isReservedSale(sale.status))
    .reduce((sum, sale) => sum + sale.items
      .filter(item => item.productId === input.productId)
      .reduce((s, item) => s + item.quantityKg, 0), 0)
  const selfConsumedKg = selfConsumptions
    .filter(record => record.productId === input.productId && record.id !== options?.excludeSelfConsumptionId)
    .reduce((sum, record) => sum + record.quantityKg, 0)
  const ecSoldKg = ecSales
    .filter(record => record.productId === input.productId && record.status !== 'cancelled')
    .reduce((sum, record) => sum + record.quantityKg, 0)
  const availableKg = product.initialStockKg
    + deriveInventoryAdjustmentKg(product.inventoryChecks)
    - reservedKg
    - selfConsumedKg
    - ecSoldKg

  if (input.quantityKg > availableKg) {
    throw new Error(`在庫が不足しています。残り ${availableKg.toFixed(1)}kg まで登録できます`)
  }

  return product
}

async function assertSufficientEcSaleStock(
  input: EcSaleRecordInput,
  options?: { excludeEcSaleId?: string },
): Promise<Product> {
  const [products, sales, selfConsumptions, ecSales] = await Promise.all([
    getAllProducts(),
    getAllSales(),
    getAllSelfConsumptions(),
    getAllEcSales(),
  ])
  const product = products.find(item => item.id === input.productId && item.isActive)
  if (!product) throw new Error('商品が見つかりません')

  const reservedKg = sales
    .filter(sale => isReservedSale(sale.status))
    .reduce((sum, sale) => sum + sale.items
      .filter(item => item.productId === input.productId)
      .reduce((s, item) => s + item.quantityKg, 0), 0)
  const selfConsumedKg = selfConsumptions
    .filter(record => record.productId === input.productId)
    .reduce((sum, record) => sum + record.quantityKg, 0)
  const ecSoldKg = ecSales
    .filter(record => record.productId === input.productId && record.id !== options?.excludeEcSaleId && record.status !== 'cancelled')
    .reduce((sum, record) => sum + record.quantityKg, 0)
  const availableKg = product.initialStockKg
    + deriveInventoryAdjustmentKg(product.inventoryChecks)
    - reservedKg
    - selfConsumedKg
    - ecSoldKg

  if (input.quantityKg > availableKg) {
    throw new Error(`在庫が不足しています。残り ${availableKg.toFixed(1)}kg まで登録できます`)
  }

  return product
}

async function upsertRelatedSalesFromProduct(product: Product): Promise<void> {
  const db = getFirebaseDb()
  const sales = await getAllSales()
  const related = sales.filter(sale => sale.items.some(item => item.productId === product.id))
  if (related.length === 0) return

  const batch = writeBatch(db)
  const newCostPerKg = product.purchaseUnitPrice ?? 0
  related.forEach(sale => {
    const newItems: SaleLineItem[] = sale.items.map(item => {
      if (item.productId !== product.id) return item
      const costAmount = item.quantityKg * newCostPerKg
      return {
        ...item,
        productSku: product.sku,
        productName: product.name,
        costPerKg: newCostPerKg,
        costAmount,
        grossProfit: item.revenue - costAmount,
      }
    })
    const agg = aggregateItems(newItems)
    const grossProfit = agg.revenue - agg.costAmount - (sale.paymentFee || 0)
    const invoiceAmount = agg.revenue + (sale.shippingFee || 0) + (sale.otherFees || 0)
    batch.update(doc(db, COLLECTIONS.sales, sale.id), {
      items: newItems,
      productId: agg.productId,
      productSku: agg.productSku,
      productName: agg.productName,
      quantityKg: agg.quantityKg,
      unitPrice: agg.unitPrice,
      costPerKg: agg.costPerKg,
      revenue: agg.revenue,
      costAmount: agg.costAmount,
      grossProfit,
      invoiceAmount,
      updatedAt: serverTimestamp(),
    })
  })
  await batch.commit()
}

async function syncBuyersCollection(): Promise<void> {
  const db = getFirebaseDb()
  const sales = await getAllSales()
  const buyers = await getAllBuyers()
  const grouped = sales.reduce<Record<string, SaleRecord[]>>((acc, sale) => {
    const normalizedName = normalizeBuyerName(sale.buyerName)
    if (!normalizedName) return acc
    acc[normalizedName] = [...(acc[normalizedName] ?? []), sale]
    return acc
  }, {})

  const existingByNormalized = new Map(buyers.map(buyer => [buyer.normalizedName, buyer]))
  const batch = writeBatch(db)

  Object.entries(grouped).forEach(([normalizedName, records]) => {
    const sorted = [...records].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    const latest = sorted[0]
    const existing = existingByNormalized.get(normalizedName)
    const ref = existing
      ? doc(db, COLLECTIONS.buyers, existing.id)
      : doc(collection(db, COLLECTIONS.buyers))

    batch.set(ref, sanitizeRecord({
      name: latest.buyerName.trim(),
      normalizedName,
      country: latest.country.trim() || undefined,
      terms: latest.terms?.trim() || undefined,
      notes: latest.notes?.trim() || undefined,
      saleCount: records.length,
      lastSoldAt: latest.updatedAt,
      createdAt: existing?.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    }), { merge: true })

    existingByNormalized.delete(normalizedName)
  })

  existingByNormalized.forEach(existing => {
    batch.delete(doc(db, COLLECTIONS.buyers, existing.id))
  })

  await batch.commit()
}

function normalizePurchaseOrderItem(raw: unknown): PurchaseOrderLineItem | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const productId = String(obj.productId ?? '')
  if (!productId) return null
  const quantityKg = Number(obj.quantityKg ?? 0)
  const unitPrice = Number(obj.unitPrice ?? 0)
  const lineTotal = obj.lineTotal != null ? Number(obj.lineTotal) : quantityKg * unitPrice
  return {
    productId,
    productSku: String(obj.productSku ?? ''),
    productName: String(obj.productName ?? ''),
    quantityKg,
    unitPrice,
    lineTotal,
  }
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
  const paymentStatus = (data.paymentStatus === 'unpaid' || data.paymentStatus === 'paid')
    ? data.paymentStatus
    : 'uninvoiced'
  const invoiceRaw = data.invoice as Record<string, unknown> | undefined
  const invoice = invoiceRaw && invoiceRaw.url
    ? {
        name: String(invoiceRaw.name ?? '請求書'),
        url: String(invoiceRaw.url),
        uploadedAt: String(invoiceRaw.uploadedAt ?? ''),
        size: invoiceRaw.size != null ? Number(invoiceRaw.size) : undefined,
      }
    : undefined
  return {
    id,
    supplierName: String(data.supplierName ?? ''),
    items,
    totalQuantityKg,
    totalAmount,
    orderDate: String(data.orderDate ?? ''),
    expectedDeliveryDate: data.expectedDeliveryDate ? String(data.expectedDeliveryDate) : undefined,
    actualDeliveryDate: data.actualDeliveryDate ? String(data.actualDeliveryDate) : undefined,
    status,
    paymentStatus,
    paymentDueDate: data.paymentDueDate ? String(data.paymentDueDate) : undefined,
    paidDate: data.paidDate ? String(data.paidDate) : undefined,
    invoice,
    notes: data.notes ? String(data.notes) : undefined,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
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

async function applyPurchaseOrderArrivalEffects(
  orderId: string,
  prevStatus: PurchaseOrderStatus | null,
  nextStatus: PurchaseOrderStatus,
  items: PurchaseOrderLineItem[],
  arrivalDate: string,
): Promise<void> {
  const wasReceived = prevStatus === 'received'
  const isReceived = nextStatus === 'received'

  if (wasReceived === isReceived) {
    if (isReceived) {
      await stripPurchaseOrderArrivalsFromProducts(orderId)
      await appendPurchaseOrderArrivalsToProducts(orderId, items, arrivalDate)
    }
    return
  }

  if (isReceived) {
    await appendPurchaseOrderArrivalsToProducts(orderId, items, arrivalDate)
  } else {
    await stripPurchaseOrderArrivalsFromProducts(orderId)
  }
}

async function appendPurchaseOrderArrivalsToProducts(
  orderId: string,
  items: PurchaseOrderLineItem[],
  arrivalDate: string,
): Promise<void> {
  if (items.length === 0) return
  const db = getFirebaseDb()
  const batch = writeBatch(db)
  const productIds = Array.from(new Set(items.map(item => item.productId)))
  const productSnaps = await Promise.all(
    productIds.map(pid => getDoc(doc(db, COLLECTIONS.products, pid))),
  )
  const productMap = new Map<string, ArrivalRecord[]>()
  productSnaps.forEach(snap => {
    if (!snap.exists()) return
    const data = snap.data()
    const existing = Array.isArray(data.arrivalRecords)
      ? normalizeArrivalRecords(data.arrivalRecords as ArrivalRecord[])
      : []
    productMap.set(snap.id, existing)
  })

  items.forEach((item, idx) => {
    const existing = productMap.get(item.productId)
    if (!existing) return
    const newRecord: ArrivalRecord = {
      id: `po:${orderId}:${idx}`,
      arrivalDate: toIsoDate(arrivalDate),
      quantityKg: item.quantityKg,
    }
    const next = [...existing.filter(r => r.id !== newRecord.id), newRecord]
    productMap.set(item.productId, next)
  })

  productMap.forEach((records, productId) => {
    batch.update(doc(db, COLLECTIONS.products, productId), {
      arrivalRecords: records,
      arrivalDate: deriveArrivalDate(records),
      initialStockKg: deriveInitialStockKg(records),
      updatedAt: serverTimestamp(),
    })
  })

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
      const [products, sales, selfConsumptions, ecSales, settings] = await Promise.all([
        getAllProducts(),
        getAllSales(),
        getAllSelfConsumptions(),
        getAllEcSales(),
        getSettings(),
      ])
      return computeInventory(products, sales, selfConsumptions, ecSales, settings)
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
      }

      const payload = {
        ...buildProductPayload(mergedInput),
        updatedAt: serverTimestamp(),
      }
      await updateDoc(doc(db, COLLECTIONS.products, id), payload)

      const merged = { ...current, ...buildProductPayload(mergedInput), updatedAt: new Date() }
      await upsertRelatedSalesFromProduct(merged)
      return merged
    },

    async deleteProduct(id) {
      const sales = await getAllSales()
      if (sales.some(sale => isReservedSale(sale.status) && sale.items.some(item => item.productId === id))) {
        throw new Error('有効な販売案件が残っている商品は削除できません')
      }

      await updateDoc(doc(db, COLLECTIONS.products, id), {
        isActive: false,
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
  }

  const salesService: ISalesService = {
    async getSaleRecords() {
      const sales = await getAllSales()
      return sales.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    },

    async getBuyers() {
      const buyers = await getAllBuyers()
      return buyers.sort((a, b) => {
        const left = a.lastSoldAt?.getTime() ?? a.updatedAt.getTime()
        const right = b.lastSoldAt?.getTime() ?? b.updatedAt.getTime()
        return right - left
      })
    },

    async updateBuyer(id, input) {
      const ref = doc(db, COLLECTIONS.buyers, id)
      const cleaned: Record<string, unknown> = {}
      const optionalKeys = [
        'email',
        'website',
        'phone',
        'shippingAddress',
        'shippingPostalCode',
        'contactPersonName',
        'notes',
        'country',
        'terms',
      ] as const
      for (const key of optionalKeys) {
        const value = input[key]
        if (value === undefined) continue
        const trimmed = typeof value === 'string' ? value.trim() : value
        cleaned[key] = trimmed ? trimmed : deleteField()
      }
      cleaned.updatedAt = serverTimestamp()
      await updateDoc(ref, cleaned)
      const snap = await getDoc(ref)
      if (!snap.exists()) throw new Error('販売先が見つかりません')
      return mapBuyer(snap.id, snap.data() ?? {})
    },

    async createSaleRecord(input) {
      const { productMap } = await assertSufficientStock(input)

      const items: SaleLineItem[] = input.items.map(line => {
        const product = productMap.get(line.productId)!
        const quantityKg = Number(line.quantityKg) || 0
        const unitPrice = Number(line.unitPrice) || 0
        const costPerKg = product.purchaseUnitPrice ?? 0
        const revenue = quantityKg * unitPrice
        const costAmount = quantityKg * costPerKg
        return {
          productId: product.id,
          productSku: product.sku,
          productName: product.name,
          quantityKg,
          unitPrice,
          costPerKg,
          revenue,
          costAmount,
          grossProfit: revenue - costAmount,
        }
      })
      const agg = aggregateItems(items)
      const shippingFee = Number(input.shippingFee) || 0
      const otherFees = Number(input.otherFees) || 0
      const paymentFee = Number(input.paymentFee) || 0
      const otherFeesNote = input.otherFeesNote?.trim() || undefined
      const invoiceAmount = agg.revenue + shippingFee + otherFees
      const grossProfit = agg.revenue - agg.costAmount - paymentFee

      const { items: _ignoreItems, ...rest } = input
      void _ignoreItems
      const payload = sanitizeRecord({
        ...rest,
        buyerName: input.buyerName.trim(),
        country: input.country.trim(),
        dueDate: input.dueDate?.trim() || undefined,
        terms: input.terms?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        items,
        productId: agg.productId,
        productSku: agg.productSku,
        productName: agg.productName,
        quantityKg: agg.quantityKg,
        unitPrice: agg.unitPrice,
        costPerKg: agg.costPerKg,
        revenue: agg.revenue,
        costAmount: agg.costAmount,
        grossProfit,
        shippingFee,
        otherFees,
        otherFeesNote,
        paymentFee,
        invoiceAmount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      const ref = await addDoc(collection(db, COLLECTIONS.sales), payload)
      await syncBuyersCollection()
      return {
        id: ref.id,
        status: input.status,
        paymentStatus: input.paymentStatus,
        shippingStatus: input.shippingStatus,
        buyerName: input.buyerName.trim(),
        items,
        productId: agg.productId,
        productSku: agg.productSku,
        productName: agg.productName,
        quantityKg: agg.quantityKg,
        unitPrice: agg.unitPrice,
        costPerKg: agg.costPerKg,
        revenue: agg.revenue,
        costAmount: agg.costAmount,
        grossProfit,
        shippingFee,
        otherFees,
        otherFeesNote,
        paymentFee,
        invoiceAmount,
        country: input.country.trim(),
        dueDate: input.dueDate,
        terms: input.terms,
        notes: input.notes,
        paymentMethod: input.paymentMethod,
        paymentDate: input.paymentDate,
        shippingAddress: input.shippingAddress,
        shippingPostalCode: input.shippingPostalCode,
        shippingMethod: input.shippingMethod,
        shippingDate: input.shippingDate,
        trackingNumber: input.trackingNumber,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    },

    async updateSaleRecord(id, input) {
      const snap = await getDoc(doc(db, COLLECTIONS.sales, id))
      if (!snap.exists()) throw new Error('販売案件が見つかりません')
      const current = mapSale(snap.id, snap.data() ?? {})

      const mergedItems = input.items ?? current.items.map(item => ({
        productId: item.productId,
        quantityKg: item.quantityKg,
        unitPrice: item.unitPrice,
      }))

      const merged: SaleRecordInput = {
        status: input.status ?? current.status,
        paymentStatus: input.paymentStatus ?? current.paymentStatus,
        shippingStatus: input.shippingStatus ?? current.shippingStatus,
        buyerName: input.buyerName ?? current.buyerName,
        items: mergedItems,
        shippingFee: input.shippingFee ?? current.shippingFee,
        otherFees: input.otherFees ?? current.otherFees,
        otherFeesNote: input.otherFeesNote ?? current.otherFeesNote,
        paymentFee: input.paymentFee ?? current.paymentFee,
        country: input.country ?? current.country,
        dueDate: input.dueDate ?? current.dueDate,
        terms: input.terms ?? current.terms,
        notes: input.notes ?? current.notes,
        paymentMethod: input.paymentMethod ?? current.paymentMethod,
        paymentDate: input.paymentDate ?? current.paymentDate,
        shippingAddress: input.shippingAddress ?? current.shippingAddress,
        shippingPostalCode: input.shippingPostalCode ?? current.shippingPostalCode,
        shippingMethod: input.shippingMethod ?? current.shippingMethod,
        shippingDate: input.shippingDate ?? current.shippingDate,
        trackingNumber: input.trackingNumber ?? current.trackingNumber,
      }

      const { productMap } = await assertSufficientStock(merged, { excludeSaleId: id })
      const items: SaleLineItem[] = merged.items.map(line => {
        const product = productMap.get(line.productId)!
        const quantityKg = Number(line.quantityKg) || 0
        const unitPrice = Number(line.unitPrice) || 0
        const costPerKg = product.purchaseUnitPrice ?? 0
        const revenue = quantityKg * unitPrice
        const costAmount = quantityKg * costPerKg
        return {
          productId: product.id,
          productSku: product.sku,
          productName: product.name,
          quantityKg,
          unitPrice,
          costPerKg,
          revenue,
          costAmount,
          grossProfit: revenue - costAmount,
        }
      })
      const agg = aggregateItems(items)
      const shippingFee = Number(merged.shippingFee) || 0
      const otherFees = Number(merged.otherFees) || 0
      const paymentFee = Number(merged.paymentFee) || 0
      const otherFeesNote = merged.otherFeesNote?.trim() || undefined
      const invoiceAmount = agg.revenue + shippingFee + otherFees
      const grossProfit = agg.revenue - agg.costAmount - paymentFee

      const { items: _ignoreItems, ...rest } = merged
      void _ignoreItems
      await updateDoc(doc(db, COLLECTIONS.sales, id), sanitizeRecord({
        ...rest,
        buyerName: merged.buyerName.trim(),
        country: merged.country.trim(),
        dueDate: merged.dueDate?.trim() || undefined,
        terms: merged.terms?.trim() || undefined,
        notes: merged.notes?.trim() || undefined,
        items,
        productId: agg.productId,
        productSku: agg.productSku,
        productName: agg.productName,
        quantityKg: agg.quantityKg,
        unitPrice: agg.unitPrice,
        costPerKg: agg.costPerKg,
        revenue: agg.revenue,
        costAmount: agg.costAmount,
        grossProfit,
        shippingFee,
        otherFees,
        otherFeesNote,
        paymentFee,
        invoiceAmount,
        updatedAt: serverTimestamp(),
      }))
      await syncBuyersCollection()

      return {
        id,
        status: merged.status,
        paymentStatus: merged.paymentStatus,
        shippingStatus: merged.shippingStatus,
        buyerName: merged.buyerName.trim(),
        items,
        productId: agg.productId,
        productSku: agg.productSku,
        productName: agg.productName,
        quantityKg: agg.quantityKg,
        unitPrice: agg.unitPrice,
        costPerKg: agg.costPerKg,
        revenue: agg.revenue,
        costAmount: agg.costAmount,
        grossProfit,
        shippingFee,
        otherFees,
        otherFeesNote,
        paymentFee,
        invoiceAmount,
        country: merged.country.trim(),
        dueDate: merged.dueDate,
        terms: merged.terms,
        notes: merged.notes,
        paymentMethod: merged.paymentMethod,
        paymentDate: merged.paymentDate,
        shippingAddress: merged.shippingAddress,
        shippingPostalCode: merged.shippingPostalCode,
        shippingMethod: merged.shippingMethod,
        shippingDate: merged.shippingDate,
        trackingNumber: merged.trackingNumber,
        createdAt: current.createdAt,
        updatedAt: new Date(),
      }
    },

    async deleteSaleRecord(id) {
      await deleteDoc(doc(db, COLLECTIONS.sales, id))
      await syncBuyersCollection()
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

    async createEcSaleRecord(input) {
      const product = await assertSufficientEcSaleStock(input)
      const revenue = input.unitPrice != null ? input.quantityKg * input.unitPrice : undefined
      const payload = sanitizeRecord({
        ...input,
        soldOn: input.soldOn.trim(),
        orderNumber: input.orderNumber?.trim() || undefined,
        channel: input.channel?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        productSku: product.sku,
        productName: product.name,
        revenue,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      const ref = await addDoc(collection(db, COLLECTIONS.ecSales), payload)

      return {
        id: ref.id,
        productId: input.productId,
        quantityKg: input.quantityKg,
        soldOn: input.soldOn.trim(),
        orderNumber: input.orderNumber?.trim() || undefined,
        unitPrice: input.unitPrice,
        channel: input.channel?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        shopifyOrderId: input.shopifyOrderId || undefined,
        productSku: product.sku,
        productName: product.name,
        revenue,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    },

    async updateEcSaleRecord(id, input) {
      const snap = await getDoc(doc(db, COLLECTIONS.ecSales, id))
      if (!snap.exists()) throw new Error('EC販売の記録が見つかりません')
      const current = mapEcSale(snap.id, snap.data() ?? {})

      const merged: EcSaleRecordInput = {
        productId: input.productId ?? current.productId,
        quantityKg: input.quantityKg ?? current.quantityKg,
        soldOn: input.soldOn ?? current.soldOn,
        orderNumber: input.orderNumber ?? current.orderNumber,
        unitPrice: input.unitPrice ?? current.unitPrice,
        channel: input.channel ?? current.channel,
        notes: input.notes ?? current.notes,
      }

      const product = await assertSufficientEcSaleStock(merged, { excludeEcSaleId: id })
      const revenue = merged.unitPrice != null ? merged.quantityKg * merged.unitPrice : undefined

      await updateDoc(doc(db, COLLECTIONS.ecSales, id), sanitizeRecord({
        ...merged,
        soldOn: merged.soldOn.trim(),
        orderNumber: merged.orderNumber?.trim() || undefined,
        channel: merged.channel?.trim() || undefined,
        notes: merged.notes?.trim() || undefined,
        productSku: product.sku,
        productName: product.name,
        revenue,
        updatedAt: serverTimestamp(),
      }))

      return {
        id,
        ...merged,
        soldOn: merged.soldOn.trim(),
        orderNumber: merged.orderNumber?.trim() || undefined,
        channel: merged.channel?.trim() || undefined,
        notes: merged.notes?.trim() || undefined,
        productSku: product.sku,
        productName: product.name,
        revenue,
        createdAt: current.createdAt,
        updatedAt: new Date(),
      }
    },

    async deleteEcSaleRecord(id) {
      await deleteDoc(doc(db, COLLECTIONS.ecSales, id))
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
      const items: PurchaseOrderLineItem[] = input.items.map(line => {
        const product = products.find(p => p.id === line.productId && p.isActive)
        if (!product) throw new Error('商品が見つかりません')
        const quantityKg = Number(line.quantityKg) || 0
        const unitPrice = Number(line.unitPrice) || 0
        return {
          productId: product.id,
          productSku: product.sku,
          productName: product.purchaseProductName || product.name,
          quantityKg,
          unitPrice,
          lineTotal: quantityKg * unitPrice,
        }
      })
      const totalQuantityKg = items.reduce((s, i) => s + i.quantityKg, 0)
      const totalAmount = items.reduce((s, i) => s + i.lineTotal, 0)

      const paymentStatus = input.paymentStatus ?? 'uninvoiced'
      const invoice = input.invoice && input.invoice.url ? input.invoice : undefined

      const payload = sanitizeRecord({
        supplierName: input.supplierName.trim(),
        items,
        totalQuantityKg,
        totalAmount,
        orderDate: input.orderDate.trim(),
        expectedDeliveryDate: input.expectedDeliveryDate?.trim() || undefined,
        actualDeliveryDate: input.actualDeliveryDate?.trim() || undefined,
        status: input.status,
        paymentStatus,
        paymentDueDate: input.paymentDueDate?.trim() || undefined,
        paidDate: input.paidDate?.trim() || undefined,
        invoice,
        notes: input.notes?.trim() || undefined,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      const ref = await addDoc(collection(db, COLLECTIONS.purchaseOrders), payload)

      const arrivalDate = input.actualDeliveryDate?.trim() || input.orderDate.trim() || new Date().toISOString().slice(0, 10)
      await applyPurchaseOrderArrivalEffects(ref.id, null, input.status, items, arrivalDate)
      await syncSuppliersCollection()

      return {
        id: ref.id,
        supplierName: input.supplierName.trim(),
        items,
        totalQuantityKg,
        totalAmount,
        orderDate: input.orderDate.trim(),
        expectedDeliveryDate: input.expectedDeliveryDate?.trim() || undefined,
        actualDeliveryDate: input.actualDeliveryDate?.trim() || undefined,
        status: input.status,
        paymentStatus,
        paymentDueDate: input.paymentDueDate?.trim() || undefined,
        paidDate: input.paidDate?.trim() || undefined,
        invoice,
        notes: input.notes?.trim() || undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    },

    async updatePurchaseOrder(id, input) {
      const ref = doc(db, COLLECTIONS.purchaseOrders, id)
      const snap = await getDoc(ref)
      if (!snap.exists()) throw new Error('発注が見つかりません')
      const current = mapPurchaseOrder(snap.id, snap.data() ?? {})

      const mergedInputItems = input.items ?? current.items.map(item => ({
        productId: item.productId,
        quantityKg: item.quantityKg,
        unitPrice: item.unitPrice,
      }))

      const merged: PurchaseOrderInput = {
        supplierName: input.supplierName ?? current.supplierName,
        items: mergedInputItems,
        orderDate: input.orderDate ?? current.orderDate,
        expectedDeliveryDate: input.expectedDeliveryDate ?? current.expectedDeliveryDate,
        actualDeliveryDate: input.actualDeliveryDate ?? current.actualDeliveryDate,
        status: input.status ?? current.status,
        paymentStatus: input.paymentStatus ?? current.paymentStatus,
        paymentDueDate: input.paymentDueDate ?? current.paymentDueDate,
        paidDate: input.paidDate ?? current.paidDate,
        invoice: input.invoice === null ? null : (input.invoice ?? current.invoice),
        notes: input.notes ?? current.notes,
      }

      if (!merged.items || merged.items.length === 0) {
        throw new Error('商品を1つ以上指定してください')
      }

      const products = await getAllProducts()
      const items: PurchaseOrderLineItem[] = merged.items.map(line => {
        const product = products.find(p => p.id === line.productId && p.isActive)
        if (!product) throw new Error('商品が見つかりません')
        const quantityKg = Number(line.quantityKg) || 0
        const unitPrice = Number(line.unitPrice) || 0
        return {
          productId: product.id,
          productSku: product.sku,
          productName: product.purchaseProductName || product.name,
          quantityKg,
          unitPrice,
          lineTotal: quantityKg * unitPrice,
        }
      })
      const totalQuantityKg = items.reduce((s, i) => s + i.quantityKg, 0)
      const totalAmount = items.reduce((s, i) => s + i.lineTotal, 0)

      const invoiceToWrite = merged.invoice === null
        ? deleteField()
        : (merged.invoice && merged.invoice.url ? merged.invoice : undefined)

      await updateDoc(ref, sanitizeRecord({
        supplierName: merged.supplierName.trim(),
        items,
        totalQuantityKg,
        totalAmount,
        orderDate: merged.orderDate.trim(),
        expectedDeliveryDate: merged.expectedDeliveryDate?.trim() || undefined,
        actualDeliveryDate: merged.actualDeliveryDate?.trim() || undefined,
        status: merged.status,
        paymentStatus: merged.paymentStatus ?? 'uninvoiced',
        paymentDueDate: merged.paymentDueDate?.trim() || undefined,
        paidDate: merged.paidDate?.trim() || undefined,
        invoice: invoiceToWrite,
        notes: merged.notes?.trim() || undefined,
        updatedAt: serverTimestamp(),
      }))

      const arrivalDate = merged.actualDeliveryDate?.trim() || merged.orderDate.trim() || new Date().toISOString().slice(0, 10)
      await applyPurchaseOrderArrivalEffects(id, current.status, merged.status, items, arrivalDate)
      await syncSuppliersCollection()

      return {
        id,
        supplierName: merged.supplierName.trim(),
        items,
        totalQuantityKg,
        totalAmount,
        orderDate: merged.orderDate.trim(),
        expectedDeliveryDate: merged.expectedDeliveryDate?.trim() || undefined,
        actualDeliveryDate: merged.actualDeliveryDate?.trim() || undefined,
        status: merged.status,
        paymentStatus: merged.paymentStatus ?? 'uninvoiced',
        paymentDueDate: merged.paymentDueDate?.trim() || undefined,
        paidDate: merged.paidDate?.trim() || undefined,
        invoice: merged.invoice === null ? undefined : merged.invoice,
        notes: merged.notes?.trim() || undefined,
        createdAt: current.createdAt,
        updatedAt: new Date(),
      }
    },

    async deletePurchaseOrder(id) {
      const ref = doc(db, COLLECTIONS.purchaseOrders, id)
      const snap = await getDoc(ref)
      if (snap.exists()) {
        const current = mapPurchaseOrder(snap.id, snap.data() ?? {})
        if (current.status === 'received') {
          await stripPurchaseOrderArrivalsFromProducts(id)
        }
      }
      await deleteDoc(ref)
      await syncSuppliersCollection()
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
    sales: salesService,
    selfConsumption: selfConsumptionService,
    ecSales: ecSalesService,
    purchaseOrders: purchaseOrdersService,
    suppliers: suppliersService,
    settings: settingsService,
    masters: mastersService,
    auth: authService,
  }
}
