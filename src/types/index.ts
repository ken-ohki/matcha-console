export type UserRole = 'admin' | 'viewer'
export type StockStatus = 'normal' | 'low' | 'out'
export type SaleStatus = 'negotiating' | 'confirmed' | 'cancelled'

export interface InventoryGroup {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface Product {
  id: string
  sku: string
  name: string
  arrivalDate: string
  inventoryGroupId: string
  initialStockKg: number
  haizUsedKg: number
  variety?: string
  process?: string
  producer?: string
  farm?: string
  altitude?: string
  region?: string
  price?: number
  cost?: number
  sortOrder: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ProductWithInventory extends Product {
  currentStockKg: number
  salesAllocatedKg: number
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

export interface ProductInput {
  sku: string
  name: string
  arrivalDate: string
  inventoryGroupId: string
  initialStockKg: number
  haizUsedKg: number
  variety?: string
  process?: string
  producer?: string
  farm?: string
  altitude?: string
  region?: string
  price?: number
  cost?: number
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
