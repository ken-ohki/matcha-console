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
  unitPrice?: number   // このロットの仕入単価（税抜・JPY/kg）。発注明細から取り込む
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
  // 卸売サイト(wholesale.sabo-matcha.jp)向け設定
  wholesaleAvailableKg?: number   // セルフ注文に開放する数量(kg)。未設定なら在庫全量。
  wholesaleThresholdKg?: number   // この数量以上はセルフ決済不可→問い合わせ。未設定ならグローバル既定。
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

export type TaxRate = 0 | 8 | 10  // 0 = 免税

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

// 諸費用（包装代・通関手数料など）。商品明細と同様に項目ごとに数量・単位・単価・
// 税区分を持ち、売上（請求額）に加算される。見積書・請求書にも明細として反映される。
export interface SaleFeeItem {
  name: string
  quantity: number
  unit: string
  unitPrice: number   // 税抜単価
  taxRate: TaxRate
}

// 発送伝票（送り状など）の添付ファイル。
export interface ShippingSlip {
  name: string
  url: string
  uploadedAt: string   // YYYY-MM-DD
  size?: number
}

// 発行履歴: 出力したPDF帳票の記録。
export interface IssuedDocument {
  id: string
  type: 'invoice' | 'delivery' | 'quotation'
  language: 'ja' | 'en'
  issuedAt: string   // ISO
  total: number      // 税込合計
  name: string       // ファイル名
  url: string        // Storage のダウンロードURL
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
  fees?: SaleFeeItem[]
  paymentFee: number
  invoiceAmount: number
  country: string
  orderDate?: string            // 発注日（顧客が発注した日）
  dueDate?: string              // 納期（納品日の基準にも使用）
  terms?: string
  notes?: string
  paymentMethod?: string
  paymentDate?: string
  paymentConfirmedAt?: string   // 入金確認ボタンを押した日時（ISO, 自動記録）
  shippingAddress?: string
  shippingPostalCode?: string
  shippingMethod?: string
  shippingDate?: string
  trackingNumber?: string
  shippingNote?: string   // 発送担当者へのメモ
  shippingSlip?: ShippingSlip   // 発送伝票（送り状など）の添付
  issuedDocuments?: IssuedDocument[]   // 発行したPDF帳票の履歴
  createdAt: Date
  updatedAt: Date
}

export interface Buyer {
  id: string
  name: string               // 管理用の名前（アプリ内・一覧で使用、受注時の販売先名）
  billingName?: string       // 請求用の名前（請求書・見積書などに表示。未設定なら name を使用）
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
  billingName?: string
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
  wholesaleAvailableKg?: number
  wholesaleThresholdKg?: number
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
  fees?: SaleFeeItem[]
  paymentFee?: number
  country: string
  orderDate?: string
  dueDate?: string
  terms?: string
  notes?: string
  paymentMethod?: string
  paymentDate?: string
  paymentConfirmedAt?: string   // 入金確認ボタンを押した日時（ISO, 自動記録）
  shippingAddress?: string
  shippingPostalCode?: string
  shippingMethod?: string
  shippingDate?: string
  trackingNumber?: string
  shippingNote?: string
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
  // 卸売サイトのセルフ決済しきい値の既定値(kg)。商品個別の wholesaleThresholdKg が優先。
  wholesaleThresholdKgDefault?: number
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
  | 'shipping_method'

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
export type PurchaseOrderPaymentStatus = 'uninvoiced' | 'unpaid' | 'partial' | 'paid'

export interface PurchaseOrderPayment {
  id: string
  amount: number      // 税込の支払額（実際に動いた現金）
  paidDate: string    // ISO YYYY-MM-DD
  method?: string
  note?: string
}

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
  newProductSku?: string        // when creating a new product at PO time
  newProductGroupId?: string    // inventory group for the new product
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
  shippingFee: number
  otherFees: number
  otherFeesNote?: string
  orderDate: string
  expectedDeliveryDate?: string
  actualDeliveryDate?: string
  status: PurchaseOrderStatus
  paymentStatus: PurchaseOrderPaymentStatus
  paymentDueDate?: string
  paidDate?: string
  payments: PurchaseOrderPayment[]   // 分割支払いの明細（空なら未払/単一払い）
  invoice?: PurchaseOrderInvoice
  notes?: string
  createdAt: Date
  updatedAt: Date
}

export interface PurchaseOrderInput {
  supplierName: string
  items: PurchaseOrderLineInput[]
  shippingFee?: number
  otherFees?: number
  otherFeesNote?: string
  orderDate: string
  expectedDeliveryDate?: string
  actualDeliveryDate?: string
  paymentStatus?: PurchaseOrderPaymentStatus
  paymentDueDate?: string
  paidDate?: string
  payments?: PurchaseOrderPayment[]
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
  bankInfo?: string
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
  bankInfo?: string
  notes?: string
  attachments?: SupplierAttachment[]
}
