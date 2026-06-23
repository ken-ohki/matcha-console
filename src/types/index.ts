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
  archived?: boolean              // アーカイブ（今後使わない商品）。一覧/カタログ/受注から除外。
  showInCatalog: boolean
  inquireToOrder: boolean
  madeToOrder?: boolean           // 受注生産品。在庫を持たず注文可（在庫切れでも可）、注文は承認制。
  // 卸売サイト(wholesale.sabo-matcha.jp)向け設定
  wholesaleAvailableKg?: number   // EC即時購入可能数量(kg)。未設定なら在庫全量。
  standardPackageKg?: number      // 標準包装単位(kg)。注文はこの倍数のみ。未設定なら1kg。
  wholesaleOptions?: ProductOptionConfig[] // 有効化する注文オプション（小分け等）と許可サイズ。
  featured?: boolean              // おすすめ商品。卸売サイトで未ログインでも公開。
  sampleAvailable?: boolean       // サンプル注文の可否
  samplePrice?: number            // サンプル1個(10g)あたりの価格(JPY)
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
  isSample?: boolean // sample line — excluded from per-product stock/transaction history
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
  // 税込請求額の権威値（請求書PDFと同一）。設定時は税の再計算より優先する。
  // wholesale 注文は保存済み totalJpy をそのまま使い、丸め差や国名表記揺れを排除。
  taxIncludedTotal?: number
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
  // Stripe settlement (card orders): processing fee + net amount deposited.
  stripeFeeJpy?: number
  stripeNetJpy?: number
  // Sample sales (ex-tax) included in `revenue`/`invoiceAmount`, tracked separately so
  // they can be aggregated apart from main-product sales.
  sampleRevenue?: number
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
  status?: 'active' | 'reserved' | 'cancelled'
  /** Set only on 'reserved' holds (overseas quote). The hold stops consuming stock once expired. */
  expiresAtMs?: number
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
  madeToOrder?: boolean
  wholesaleAvailableKg?: number
  standardPackageKg?: number
  wholesaleOptions?: ProductOptionConfig[]
  featured?: boolean
  sampleAvailable?: boolean
  samplePrice?: number
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

/** 国内発送の重量別送料(税抜)。注文重量が uptoKg 以下なら feeJpy を適用。 */
export interface ShippingTierJp {
  uptoKg: number
  feeJpy: number
}

/** 注文オプション（小分けサービス等）。マスタは設定で編集、商品ごとに有効/無効。 */
export interface WholesaleOptionTier {
  id: string
  label: string          // 表示名（例: "1kg", "100g"）
  portionKg: number      // 1袋あたりの内容量(kg)。例: 0.1
  pricePerBagJpy: number // 1袋あたりの加工単価(税抜)
}
export interface WholesaleOption {
  id: string
  type: 'repackage'      // 現状は小分けサービスのみ
  name: string           // 表示名（例: 小分けサービス）
  unitLabel?: string     // 数量単位の表示（例: 袋）
  active: boolean        // マスタ全体の有効/無効
  tiers: WholesaleOptionTier[]
}

export interface Settings {
  appName: string
  currency: string
  stockAlertRatio: number
  // 卸売サイトのセルフ決済しきい値(kg)。全商品共通。この数量以上の注文は問い合わせに誘導。
  wholesaleThresholdKgDefault?: number
  // 国内発送の重量別送料テーブル(税抜・全国一律)。uptoKg 昇順。
  shippingRatesJp?: ShippingTierJp[]
  // 注文オプションのマスタ。
  wholesaleOptions?: WholesaleOption[]
  // サンプル手数料(税抜・円)。サンプル価格 = 卸売単価×0.01(10g相当) + この手数料。
  wholesaleSampleFeeJpy?: number
  // サンプル購入の期間制限。同一会員が同一商品のサンプルを直近 sampleLimitWindowDays 日で
  // sampleLimitPerProduct 個まで（複数注文に分けた買い増しを防ぐ）。未設定時は 30日 / 2個。
  sampleLimitWindowDays?: number
  sampleLimitPerProduct?: number
  // 決済手段の分岐点(税込・円)。注文金額がこの金額未満ならカード決済のみ、
  // この金額以上なら銀行振込のみ。0 または未設定で分岐なし(両方選択可)。
  paymentMethodThresholdJpy?: number
  // 顧客ランク別の割引率(%)。卸売商品価格に適用。
  wholesaleRankDiscounts?: WholesaleRankDiscounts
  // トラブル時などに卸売サイトの新規注文受付を一時停止するフラグ。
  orderingPaused?: boolean
  // 受付停止中に顧客へ表示するメッセージ（任意）。
  orderingPausedMessage?: string
  // クーポンのマスタ。チェックアウトでコード入力して適用。
  wholesaleCoupons?: WholesaleCoupon[]
  // 送信するスタッフ通知メールの種別キー一覧（未設定＝全送信）。要返金は常時送信。
  staffEmailEvents?: string[]
}

/** クーポン定義。コード入力で対象商品の小計に割引を適用（1注文1枚）。 */
export interface WholesaleCoupon {
  id: string
  code: string // 大文字小文字を無視して照合
  name: string
  discountType: 'percentage' | 'fixed'
  discountValue: number // %（percentage）または ¥（fixed）
  eligibleProductIds?: string[] // 空＝全商品が対象
  expiresAt?: string // YYYY-MM-DD（その日の終わりまで有効）
  active: boolean
}

export type WholesaleRank = 'standard' | 'premium' | 'exclusive'
export interface WholesaleRankDiscounts {
  standard: number
  premium: number
  exclusive: number
}

/** 商品ごとのオプション有効化設定。tierIds 空配列＝全サイズ許可。 */
export interface ProductOptionConfig {
  optionId: string
  tierIds: string[]
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
