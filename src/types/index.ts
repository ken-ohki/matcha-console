export type UserRole = 'admin' | 'viewer'
export type StockStatus = 'normal' | 'low' | 'out'
export type SaleStatus = 'negotiating' | 'confirmed' | 'cancelled'
export type SelfConsumptionUsageType = 'retail' | 'sample_free' | 'sample_paid'

export interface InventoryGroup {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ArrivalRecord {
  id: string
  arrivalDate: string
  quantityKg: number
}

export interface InventoryCheckRecord {
  id: string
  checkedDate: string
  countedQuantityKg: number
  expectedQuantityKg: number
  adjustmentKg: number
}

export interface Product {
  id: string
  sku: string
  name: string
  purchaseProductName?: string
  supplier?: string
  teaType?: string
  grade?: string
  origins: string[]
  cultivars: string[]
  pluckingMethods: string[]
  harvestSeasons: string[]
  shadingMethods: string[]
  certifications: string[]
  arrivalRecords: ArrivalRecord[]
  inventoryChecks: InventoryCheckRecord[]
  arrivalDate: string
  inventoryGroupId: string
  initialStockKg: number
  haizUsedKg: number
  standardWholesalePrice?: number
  purchaseUnitPrice?: number
  adminNote?: string
  salesNote?: string
  sortOrder: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ProductWithInventory extends Product {
  currentStockKg: number
  salesAllocatedKg: number
  selfConsumedKg: number
  inventoryAdjustmentKg: number
  latestInventoryCheck?: InventoryCheckRecord
  stockStatus: StockStatus
}

export interface SaleRecord {
  id: string
  status: SaleStatus
  buyerName: string
  productId: string
  productSku: string
  productName: string
  quantityKg: number
  unitPrice: number
  costPerKg: number
  revenue: number
  costAmount: number
  grossProfit: number
  country: string
  dueDate?: string
  terms?: string
  notes?: string
  createdAt: Date
  updatedAt: Date
}

export interface Buyer {
  id: string
  name: string
  normalizedName: string
  country?: string
  terms?: string
  notes?: string
  saleCount: number
  lastSoldAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface SelfConsumptionRecord {
  id: string
  productId: string
  productSku: string
  productName: string
  quantityKg: number
  usedOn: string
  usageType: SelfConsumptionUsageType
  notes?: string
  createdAt: Date
  updatedAt: Date
}

export interface ProductInput {
  sku: string
  name: string
  purchaseProductName?: string
  supplier?: string
  teaType?: string
  grade?: string
  origins: string[]
  cultivars: string[]
  pluckingMethods: string[]
  harvestSeasons: string[]
  shadingMethods: string[]
  certifications: string[]
  arrivalRecords: ArrivalRecord[]
  inventoryChecks: InventoryCheckRecord[]
  arrivalDate: string
  inventoryGroupId: string
  initialStockKg: number
  haizUsedKg: number
  standardWholesalePrice?: number
  purchaseUnitPrice?: number
  adminNote?: string
  salesNote?: string
}

export interface InventoryGroupInput {
  name: string
}

export interface SaleRecordInput {
  status: SaleStatus
  buyerName: string
  productId: string
  quantityKg: number
  unitPrice: number
  country: string
  dueDate?: string
  terms?: string
  notes?: string
}

export interface SelfConsumptionRecordInput {
  productId: string
  quantityKg: number
  usedOn: string
  usageType: SelfConsumptionUsageType
  notes?: string
}

export interface Settings {
  appName: string
  currency: string
  stockAlertRatio: number
}

export interface AuthUser {
  uid: string
  email: string
  role: UserRole
}
