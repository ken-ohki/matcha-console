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
  standardWholesalePrice?: number
  purchaseUnitPrice?: number
  adminNote?: string
  salesNote?: string
  flavorNotes?: string
  imageUrl?: string
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

export type TaxRate = 8 | 10

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
  taxRate: TaxRate
}

export interface SaleLineInput {
  productId: string
  quantityKg: number
  unitPrice: number
  taxRate?: TaxRate
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
  shippingAddress?: string
  shippingPostalCode?: string
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
  shopifyOrderId?: string
  status?: 'active' | 'cancelled'
  cancelledAt?: string
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
  shopifyOrderId?: string
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
  standardWholesalePrice?: number
  purchaseUnitPrice?: number
  adminNote?: string
  salesNote?: string
  flavorNotes?: string
  imageUrl?: string
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
  shippingAddress?: string
  shippingPostalCode?: string
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

export type PurchaseOrderStatus = 'placed' | 'shipped' | 'received' | 'cancelled'
export type PurchaseOrderPaymentStatus = 'uninvoiced' | 'unpaid' | 'paid'

export interface PurchaseOrderInvoice {
  name: string
  url: string
  uploadedAt: string
  size?: number
}

export interface PurchaseOrderLineItem {
  productId: string        // empty = unlisted/new product not yet in inventory
  productSku: string
  productName: string
  quantityKg: number
  unitPrice: number
  lineTotal: number
  receivedKg: number       // cumulative quantity received so far
  taxRate: TaxRate
}

export interface PurchaseOrderLineInput {
  productId?: string       // omit for a new/unlisted product
  productName?: string     // required when productId is empty (free text)
  quantityKg: number
  unitPrice: number
  receivedKg?: number
  taxRate?: TaxRate
}

export interface PurchaseOrder {
  id: string
  supplierName: string
  items: PurchaseOrderLineItem[]
  totalQuantityKg: number
  totalAmount: number
  orderDate: string
  expectedDeliveryDate?: string
  actualDeliveryDate?: string
  status: PurchaseOrderStatus
  paymentStatus: PurchaseOrderPaymentStatus
  paymentDueDate?: string
  paidDate?: string
  invoice?: PurchaseOrderInvoice
  notes?: string
  createdAt: Date
  updatedAt: Date
}

export interface PurchaseOrderInput {
  supplierName: string
  items: PurchaseOrderLineInput[]
  orderDate: string
  expectedDeliveryDate?: string
  actualDeliveryDate?: string
  paymentStatus?: PurchaseOrderPaymentStatus
  paymentDueDate?: string
  paidDate?: string
  invoice?: PurchaseOrderInvoice | null
  status: PurchaseOrderStatus
  notes?: string
}

export interface SupplierAttachment {
  id: string
  name: string
  url: string
  uploadedAt: string
  size?: number
}

export interface Supplier {
  id: string
  name: string
  normalizedName: string
  contactPersonName?: string
  email?: string
  phone?: string
  website?: string
  address?: string
  postalCode?: string
  country?: string
  notes?: string
  attachments: SupplierAttachment[]
  orderCount: number
  lastOrderedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface SupplierDetailsInput {
  contactPersonName?: string
  email?: string
  phone?: string
  website?: string
  address?: string
  postalCode?: string
  country?: string
  notes?: string
  attachments?: SupplierAttachment[]
}
