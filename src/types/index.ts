export type UserRole = 'admin' | 'viewer'
export type StockStatus = 'normal' | 'low' | 'out'
export type SaleStatus = 'negotiating' | 'confirmed' | 'cancelled'
export type PaymentStatus = 'uninvoiced' | 'invoiced' | 'paid'
export type ShippingStatus = 'ordering' | 'producing' | 'ready_to_ship' | 'shipped'
export type SelfConsumptionUsageType = 'ingredient' | 'retail' | 'sample'

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
  flavorNotes?: string
  sortOrder: number
  isActive: boolean
  showInCatalog: boolean
  inquireToOrder: boolean
  createdAt: Date
  updatedAt: Date
}

export interface ProductWithInventory extends Product {
  currentStockKg: number
  salesAllocatedKg: number
  selfConsumedKg: number
  ecSoldKg: number
  inventoryAdjustmentKg: number
  latestInventoryCheck?: InventoryCheckRecord
  stockStatus: StockStatus
}

export interface SaleLineItem {
  productId: string
  productSku: string
  productName: string
  quantityKg: number
  unitPrice: number
  costPerKg: number
  revenue: number
  costAmount: number
  grossProfit: number
}

export interface SaleLineInput {
  productId: string
  quantityKg: number
  unitPrice: number
}

export interface SaleRecord {
  id: string
  status: SaleStatus
  paymentStatus: PaymentStatus
  shippingStatus: ShippingStatus
  buyerName: string
  items: SaleLineItem[]
  productId: string
  productSku: string
  productName: string
  quantityKg: number
  unitPrice: number
  costPerKg: number
  revenue: number
  costAmount: number
  grossProfit: number
  shippingFee: number
  otherFees: number
  otherFeesNote?: string
  paymentFee: number
  invoiceAmount: number
  country: string
  dueDate?: string
  terms?: string
  notes?: string
  paymentMethod?: string
  paymentDate?: string
  shippingMethod?: string
  shippingDate?: string
  trackingNumber?: string
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
  email?: string
  website?: string
  phone?: string
  shippingAddress?: string
  shippingPostalCode?: string
  contactPersonName?: string
  saleCount: number
  lastSoldAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface BuyerDetailsInput {
  email?: string
  website?: string
  phone?: string
  shippingAddress?: string
  shippingPostalCode?: string
  contactPersonName?: string
  notes?: string
  country?: string
  terms?: string
}

export interface EcSaleRecord {
  id: string
  productId: string
  productSku: string
  productName: string
  quantityKg: number
  soldOn: string
  orderNumber?: string
  unitPrice?: number
  revenue?: number
  channel?: string
  notes?: string
  createdAt: Date
  updatedAt: Date
}

export interface EcSaleRecordInput {
  productId: string
  quantityKg: number
  soldOn: string
  orderNumber?: string
  unitPrice?: number
  channel?: string
  notes?: string
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
  flavorNotes?: string
  showInCatalog?: boolean
  inquireToOrder?: boolean
}

export interface InventoryGroupInput {
  name: string
}

export interface SaleRecordInput {
  status: SaleStatus
  paymentStatus: PaymentStatus
  shippingStatus: ShippingStatus
  buyerName: string
  items: SaleLineInput[]
  shippingFee?: number
  otherFees?: number
  otherFeesNote?: string
  paymentFee?: number
  country: string
  dueDate?: string
  terms?: string
  notes?: string
  paymentMethod?: string
  paymentDate?: string
  shippingMethod?: string
  shippingDate?: string
  trackingNumber?: string
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

export type MasterType =
  | 'tea_type'
  | 'grade'
  | 'origin'
  | 'cultivar'
  | 'plucking'
  | 'harvest'
  | 'shading'
  | 'certification'
  | 'terms'

export interface MasterEntry {
  id: string
  type: MasterType
  englishName: string
  japaneseName: string
  sortOrder: number
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface MasterEntryInput {
  type: MasterType
  englishName: string
  japaneseName: string
  sortOrder?: number
}

export interface AuthUser {
  uid: string
  email: string
  role: UserRole
}
