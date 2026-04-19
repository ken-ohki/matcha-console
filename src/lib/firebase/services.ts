import {
  addDoc,
  collection,
  deleteDoc,
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
  onAuthStateChanged as firebaseOnAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import type {
  ArrivalRecord,
  AuthUser,
  Buyer,
  InventoryCheckRecord,
  InventoryGroup,
  InventoryGroupInput,
  Product,
  ProductInput,
  ProductWithInventory,
  SaleRecord,
  SaleRecordInput,
  SelfConsumptionRecord,
  SelfConsumptionRecordInput,
  SelfConsumptionUsageType,
  Settings,
  StockStatus,
} from '@/types'
import type {
  IAuthService,
  IInventoryService,
  ISelfConsumptionService,
  ISalesService,
  ISettingsService,
  IServices,
} from '../services'
import { getFirebaseAuthInstance, getFirebaseDb } from './config'

const COLLECTIONS = {
  groups: 'inventory_groups',
  products: 'products',
  sales: 'sales',
  buyers: 'buyers',
  selfConsumptions: 'self_consumptions',
  settings: 'settings',
  users: 'users',
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

function normalizeArrivalRecords(records: ArrivalRecord[]): ArrivalRecord[] {
  return records
    .map(record => ({
      id: String(record.id ?? '').trim(),
      arrivalDate: String(record.arrivalDate ?? '').trim(),
      quantityKg: Number(record.quantityKg ?? 0),
    }))
    .filter(record => record.arrivalDate || record.quantityKg > 0)
}

function normalizeInventoryChecks(records: InventoryCheckRecord[]): InventoryCheckRecord[] {
  return records
    .map(record => ({
      id: String(record.id ?? '').trim(),
      checkedDate: String(record.checkedDate ?? '').trim(),
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
  })
}

function getStockStatus(currentKg: number, initialKg: number, alertRatio: number): StockStatus {
  if (currentKg <= 0) return 'out'
  if (currentKg <= initialKg * alertRatio) return 'low'
  return 'normal'
}

function getDefaultSettings(): Settings {
  return {
    appName: 'ChaFlow',
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
    haizUsedKg: Number(data.haizUsedKg ?? 0),
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
    sortOrder: Number(data.sortOrder ?? 0),
    isActive: data.isActive !== false,
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

function mapSale(id: string, data: DocumentData): SaleRecord {
  return {
    id,
    status: data.status,
    buyerName: String(data.buyerName ?? ''),
    productId: String(data.productId ?? ''),
    productSku: String(data.productSku ?? ''),
    productName: String(data.productName ?? ''),
    quantityKg: Number(data.quantityKg ?? 0),
    unitPrice: Number(data.unitPrice ?? 0),
    costPerKg: Number(data.costPerKg ?? 0),
    revenue: Number(data.revenue ?? 0),
    costAmount: Number(data.costAmount ?? 0),
    grossProfit: Number(data.grossProfit ?? 0),
    country: String(data.country ?? ''),
    dueDate: data.dueDate ? String(data.dueDate) : undefined,
    terms: data.terms ? String(data.terms) : undefined,
    notes: data.notes ? String(data.notes) : undefined,
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
    saleCount: Number(data.saleCount ?? 0),
    lastSoldAt: data.lastSoldAt ? toDate(data.lastSoldAt) : undefined,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  }
}

function normalizeSelfConsumptionUsageType(value: unknown): SelfConsumptionUsageType {
  if (value === 'sample_free' || value === 'sample_paid') return value
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
  settings: Settings,
): ProductWithInventory[] {
  const reservedByProduct = sales.reduce<Record<string, number>>((acc, sale) => {
    if (!isReservedSale(sale.status)) return acc
    acc[sale.productId] = (acc[sale.productId] ?? 0) + sale.quantityKg
    return acc
  }, {})
  const selfConsumedByProduct = selfConsumptions.reduce<Record<string, number>>((acc, record) => {
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
      const effectiveInitialKg = product.initialStockKg + inventoryAdjustmentKg
      const currentStockKg = effectiveInitialKg - product.haizUsedKg - salesAllocatedKg - selfConsumedKg
      return {
        ...product,
        salesAllocatedKg,
        selfConsumedKg,
        inventoryAdjustmentKg,
        latestInventoryCheck: getLatestInventoryCheck(product.inventoryChecks),
        currentStockKg,
        stockStatus: getStockStatus(currentStockKg, Math.max(effectiveInitialKg, 0), settings.stockAlertRatio),
      }
    })
}

async function assertSufficientStock(
  nextSale: SaleRecordInput,
  options?: { excludeSaleId?: string },
): Promise<{ product: Product; currentProductSales: SaleRecord[] }> {
  const [products, sales, selfConsumptions] = await Promise.all([
    getAllProducts(),
    getAllSales(),
    getAllSelfConsumptions(),
  ])
  const product = products.find(item => item.id === nextSale.productId && item.isActive)
  if (!product) throw new Error('商品が見つかりません')

  const currentProductSales = sales.filter(sale => (
    sale.productId === nextSale.productId &&
    sale.id !== options?.excludeSaleId &&
    isReservedSale(sale.status)
  ))
  const reservedKg = currentProductSales.reduce((sum, sale) => sum + sale.quantityKg, 0)
  const selfConsumedKg = selfConsumptions
    .filter(record => record.productId === nextSale.productId)
    .reduce((sum, record) => sum + record.quantityKg, 0)
  const availableKg = product.initialStockKg
    + deriveInventoryAdjustmentKg(product.inventoryChecks)
    - product.haizUsedKg
    - reservedKg
    - selfConsumedKg

  if (isReservedSale(nextSale.status) && nextSale.quantityKg > availableKg) {
    throw new Error(`在庫が不足しています。残り ${availableKg.toFixed(1)}kg まで登録できます`)
  }

  return { product, currentProductSales }
}

async function assertSufficientSelfConsumptionStock(
  input: SelfConsumptionRecordInput,
  options?: { excludeSelfConsumptionId?: string },
): Promise<Product> {
  const [products, sales, selfConsumptions] = await Promise.all([
    getAllProducts(),
    getAllSales(),
    getAllSelfConsumptions(),
  ])
  const product = products.find(item => item.id === input.productId && item.isActive)
  if (!product) throw new Error('商品が見つかりません')

  const reservedKg = sales
    .filter(sale => sale.productId === input.productId && isReservedSale(sale.status))
    .reduce((sum, sale) => sum + sale.quantityKg, 0)
  const selfConsumedKg = selfConsumptions
    .filter(record => record.productId === input.productId && record.id !== options?.excludeSelfConsumptionId)
    .reduce((sum, record) => sum + record.quantityKg, 0)
  const availableKg = product.initialStockKg
    + deriveInventoryAdjustmentKg(product.inventoryChecks)
    - product.haizUsedKg
    - reservedKg
    - selfConsumedKg

  if (input.quantityKg > availableKg) {
    throw new Error(`在庫が不足しています。残り ${availableKg.toFixed(1)}kg まで登録できます`)
  }

  return product
}

async function upsertRelatedSalesFromProduct(product: Product): Promise<void> {
  const db = getFirebaseDb()
  const sales = await getAllSales()
  const related = sales.filter(sale => sale.productId === product.id)
  if (related.length === 0) return

  const batch = writeBatch(db)
  related.forEach(sale => {
    const costPerKg = product.purchaseUnitPrice ?? 0
    const costAmount = sale.quantityKg * costPerKg
    batch.update(doc(db, COLLECTIONS.sales, sale.id), {
      productSku: product.sku,
      productName: product.name,
      costPerKg,
      costAmount,
      grossProfit: sale.revenue - costAmount,
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
      const [products, sales, selfConsumptions, settings] = await Promise.all([
        getAllProducts(),
        getAllSales(),
        getAllSelfConsumptions(),
        getSettings(),
      ])
      return computeInventory(products, sales, selfConsumptions, settings)
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
        haizUsedKg: input.haizUsedKg ?? current.haizUsedKg,
        standardWholesalePrice: input.standardWholesalePrice ?? current.standardWholesalePrice,
        purchaseUnitPrice: input.purchaseUnitPrice ?? current.purchaseUnitPrice,
        adminNote: input.adminNote ?? current.adminNote,
        salesNote: input.salesNote ?? current.salesNote,
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
      if (sales.some(sale => sale.productId === id && isReservedSale(sale.status))) {
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

    async createSaleRecord(input) {
      const { product } = await assertSufficientStock(input)

      const costPerKg = product.purchaseUnitPrice ?? 0
      const revenue = input.quantityKg * input.unitPrice
      const costAmount = input.quantityKg * costPerKg
      const payload = sanitizeRecord({
        ...input,
        buyerName: input.buyerName.trim(),
        country: input.country.trim(),
        dueDate: input.dueDate?.trim() || undefined,
        terms: input.terms?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        productSku: product.sku,
        productName: product.name,
        costPerKg,
        revenue,
        costAmount,
        grossProfit: revenue - costAmount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })

      const ref = await addDoc(collection(db, COLLECTIONS.sales), payload)
      await syncBuyersCollection()
      return {
        id: ref.id,
        ...input,
        productSku: product.sku,
        productName: product.name,
        costPerKg,
        revenue,
        costAmount,
        grossProfit: revenue - costAmount,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    },

    async updateSaleRecord(id, input) {
      const snap = await getDoc(doc(db, COLLECTIONS.sales, id))
      if (!snap.exists()) throw new Error('販売案件が見つかりません')
      const current = mapSale(snap.id, snap.data() ?? {})

      const merged: SaleRecordInput = {
        status: input.status ?? current.status,
        buyerName: input.buyerName ?? current.buyerName,
        productId: input.productId ?? current.productId,
        quantityKg: input.quantityKg ?? current.quantityKg,
        unitPrice: input.unitPrice ?? current.unitPrice,
        country: input.country ?? current.country,
        dueDate: input.dueDate ?? current.dueDate,
        terms: input.terms ?? current.terms,
        notes: input.notes ?? current.notes,
      }

      const { product } = await assertSufficientStock(merged, { excludeSaleId: id })
      const costPerKg = product.purchaseUnitPrice ?? 0
      const revenue = merged.quantityKg * merged.unitPrice
      const costAmount = merged.quantityKg * costPerKg

      await updateDoc(doc(db, COLLECTIONS.sales, id), sanitizeRecord({
        ...merged,
        buyerName: merged.buyerName.trim(),
        country: merged.country.trim(),
        dueDate: merged.dueDate?.trim() || undefined,
        terms: merged.terms?.trim() || undefined,
        notes: merged.notes?.trim() || undefined,
        productSku: product.sku,
        productName: product.name,
        costPerKg,
        revenue,
        costAmount,
        grossProfit: revenue - costAmount,
        updatedAt: serverTimestamp(),
      }))
      await syncBuyersCollection()

      return {
        id,
        ...merged,
        productSku: product.sku,
        productName: product.name,
        costPerKg,
        revenue,
        costAmount,
        grossProfit: revenue - costAmount,
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
  }

  const authService: IAuthService = {
    async login(email, password) {
      const credential = await signInWithEmailAndPassword(auth, email, password)
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
  }

  return {
    inventory: inventoryService,
    sales: salesService,
    selfConsumption: selfConsumptionService,
    settings: settingsService,
    auth: authService,
  }
}
