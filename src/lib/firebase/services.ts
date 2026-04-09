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
  AuthUser,
  InventoryGroup,
  InventoryGroupInput,
  Product,
  ProductInput,
  ProductWithInventory,
  SaleRecord,
  SaleRecordInput,
  Settings,
  StockStatus,
} from '@/types'
import type {
  IAuthService,
  IInventoryService,
  ISalesService,
  ISettingsService,
  IServices,
} from '../services'
import { getFirebaseAuthInstance, getFirebaseDb } from './config'

const COLLECTIONS = {
  groups: 'inventory_groups',
  products: 'products',
  sales: 'sales',
  settings: 'settings',
  users: 'users',
} as const

function toDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return value
  return new Date(0)
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
  return {
    id,
    sku: String(data.sku ?? ''),
    name: String(data.name ?? ''),
    arrivalDate: String(data.arrivalDate ?? ''),
    inventoryGroupId: String(data.inventoryGroupId ?? ''),
    initialStockKg: Number(data.initialStockKg ?? 0),
    haizUsedKg: Number(data.haizUsedKg ?? 0),
    variety: data.variety ? String(data.variety) : undefined,
    process: data.process ? String(data.process) : undefined,
    producer: data.producer ? String(data.producer) : undefined,
    farm: data.farm ? String(data.farm) : undefined,
    altitude: data.altitude ? String(data.altitude) : undefined,
    region: data.region ? String(data.region) : undefined,
    price: data.price != null ? Number(data.price) : undefined,
    cost: data.cost != null ? Number(data.cost) : undefined,
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

async function getSettings(): Promise<Settings> {
  const db = getFirebaseDb()
  const snap = await getDoc(doc(db, COLLECTIONS.settings, 'main'))
  return mapSettings(snap.data())
}

function isReservedSale(status: SaleRecord['status']): boolean {
  return status === 'negotiating' || status === 'confirmed'
}

function computeInventory(products: Product[], sales: SaleRecord[], settings: Settings): ProductWithInventory[] {
  const reservedByProduct = sales.reduce<Record<string, number>>((acc, sale) => {
    if (!isReservedSale(sale.status)) return acc
    acc[sale.productId] = (acc[sale.productId] ?? 0) + sale.quantityKg
    return acc
  }, {})

  return products
    .filter(product => product.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(product => {
      const salesAllocatedKg = reservedByProduct[product.id] ?? 0
      const currentStockKg = product.initialStockKg - product.haizUsedKg - salesAllocatedKg
      return {
        ...product,
        salesAllocatedKg,
        currentStockKg,
        stockStatus: getStockStatus(currentStockKg, product.initialStockKg, settings.stockAlertRatio),
      }
    })
}

async function assertSufficientStock(
  nextSale: SaleRecordInput,
  options?: { excludeSaleId?: string },
): Promise<{ product: Product; currentProductSales: SaleRecord[] }> {
  const [products, sales] = await Promise.all([getAllProducts(), getAllSales()])
  const product = products.find(item => item.id === nextSale.productId && item.isActive)
  if (!product) throw new Error('商品が見つかりません')

  const currentProductSales = sales.filter(sale => (
    sale.productId === nextSale.productId &&
    sale.id !== options?.excludeSaleId &&
    isReservedSale(sale.status)
  ))
  const reservedKg = currentProductSales.reduce((sum, sale) => sum + sale.quantityKg, 0)
  const availableKg = product.initialStockKg - product.haizUsedKg - reservedKg

  if (isReservedSale(nextSale.status) && nextSale.quantityKg > availableKg) {
    throw new Error(`在庫が不足しています。残り ${availableKg.toFixed(1)}kg まで登録できます`)
  }

  return { product, currentProductSales }
}

async function upsertRelatedSalesFromProduct(product: Product): Promise<void> {
  const db = getFirebaseDb()
  const sales = await getAllSales()
  const related = sales.filter(sale => sale.productId === product.id)
  if (related.length === 0) return

  const batch = writeBatch(db)
  related.forEach(sale => {
    const costPerKg = product.cost ?? 0
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
      const [products, sales, settings] = await Promise.all([getAllProducts(), getAllSales(), getSettings()])
      return computeInventory(products, sales, settings)
    },

    async createProduct(input) {
      const products = await getAllProducts()
      if (products.some(product => product.sku === input.sku && product.isActive)) {
        throw new Error(`SKU "${input.sku}" は既に登録されています`)
      }

      const sortOrder = products
        .filter(product => product.inventoryGroupId === input.inventoryGroupId && product.isActive)
        .reduce((max, product) => Math.max(max, product.sortOrder), -1) + 1

      const payload = sanitizeRecord({
        ...input,
        sortOrder,
        isActive: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      const ref = await addDoc(collection(db, COLLECTIONS.products), payload)

      return {
        id: ref.id,
        ...input,
        sortOrder,
        isActive: true,
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

      const payload = sanitizeRecord({
        ...input,
        updatedAt: serverTimestamp(),
      })
      await updateDoc(doc(db, COLLECTIONS.products, id), payload)

      const merged = { ...current, ...input, updatedAt: new Date() }
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

    async createSaleRecord(input) {
      const { product } = await assertSufficientStock(input)

      const costPerKg = product.cost ?? 0
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
      const costPerKg = product.cost ?? 0
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
    settings: settingsService,
    auth: authService,
  }
}
