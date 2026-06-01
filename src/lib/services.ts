import type {
  AuthUser,
  InventoryGroup,
  InventoryGroupInput,
  MasterEntry,
  MasterEntryInput,
  Product,
  ProductInput,
  ProductWithInventory,
  Buyer,
  BuyerDetailsInput,
  EcSaleRecord,
  EcSaleRecordInput,
  PurchaseOrder,
  PurchaseOrderInput,
  SaleRecord,
  SaleRecordInput,
  SelfConsumptionRecord,
  SelfConsumptionRecordInput,
  Settings,
  Supplier,
  SupplierDetailsInput,
} from '@/types'

export interface IInventoryService {
  getInventoryGroups(): Promise<InventoryGroup[]>
  getProductsWithInventory(): Promise<ProductWithInventory[]>
  createProduct(input: ProductInput): Promise<Product>
  updateProduct(id: string, input: Partial<ProductInput>): Promise<Product>
  deleteProduct(id: string): Promise<void>
  updateProductsSortOrder(orderedIds: string[]): Promise<void>
  updateInventoryGroupsSortOrder(orderedIds: string[]): Promise<void>
  createInventoryGroup(input: InventoryGroupInput): Promise<InventoryGroup>
  updateInventoryGroup(id: string, input: Partial<InventoryGroupInput>): Promise<InventoryGroup>
  deleteInventoryGroup(id: string): Promise<void>
}

export interface ISalesService {
  getSaleRecords(): Promise<SaleRecord[]>
  getBuyers(): Promise<Buyer[]>
  updateBuyer(id: string, input: BuyerDetailsInput): Promise<Buyer>
  createSaleRecord(input: SaleRecordInput): Promise<SaleRecord>
  updateSaleRecord(id: string, input: Partial<SaleRecordInput>): Promise<SaleRecord>
  deleteSaleRecord(id: string): Promise<void>
}

export interface IEcSalesService {
  getEcSaleRecords(): Promise<EcSaleRecord[]>
  createEcSaleRecord(input: EcSaleRecordInput): Promise<EcSaleRecord>
  updateEcSaleRecord(id: string, input: Partial<EcSaleRecordInput>): Promise<EcSaleRecord>
  deleteEcSaleRecord(id: string): Promise<void>
}

export interface ISelfConsumptionService {
  getSelfConsumptionRecords(): Promise<SelfConsumptionRecord[]>
  createSelfConsumptionRecord(input: SelfConsumptionRecordInput): Promise<SelfConsumptionRecord>
  updateSelfConsumptionRecord(id: string, input: Partial<SelfConsumptionRecordInput>): Promise<SelfConsumptionRecord>
  deleteSelfConsumptionRecord(id: string): Promise<void>
}

export interface TermsSection {
  heading: string
  body: string
}

export interface BankAccounts {
  ja: string
  en: string
}

export interface IssuerInfo {
  company: string
  companyEn: string
  postalCode: string
  address: string
  addressEn: string
  tel: string
  email: string
  registrationNumber: string
}

export interface ISettingsService {
  getSettings(): Promise<Settings>
  updateSettings(input: Partial<Settings>): Promise<Settings>
  getDocumentTermsEn(): Promise<TermsSection[]>
  updateDocumentTermsEn(sections: TermsSection[]): Promise<void>
  getBankAccounts(): Promise<BankAccounts>
  updateBankAccounts(input: BankAccounts): Promise<void>
  getIssuer(): Promise<IssuerInfo>
  updateIssuer(input: IssuerInfo): Promise<void>
}

export interface IMastersService {
  listMasters(): Promise<MasterEntry[]>
  createMaster(input: MasterEntryInput): Promise<MasterEntry>
  updateMaster(id: string, input: Partial<MasterEntryInput>): Promise<MasterEntry>
  deleteMaster(id: string): Promise<void>
}

export interface UserProfile {
  uid: string
  email: string
  role: 'admin' | 'viewer'
  createdAt?: Date
  updatedAt?: Date
}

export interface IAuthService {
  login(email: string, password: string): Promise<AuthUser>
  loginWithGoogle(): Promise<AuthUser>
  logout(): Promise<void>
  getCurrentUser(): Promise<AuthUser | null>
  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void
  listUsers(): Promise<UserProfile[]>
  updateUserRole(uid: string, role: 'admin' | 'viewer'): Promise<void>
  deleteUserProfile(uid: string): Promise<void>
}

export interface IPurchaseOrdersService {
  getPurchaseOrders(): Promise<PurchaseOrder[]>
  createPurchaseOrder(input: PurchaseOrderInput): Promise<PurchaseOrder>
  updatePurchaseOrder(id: string, input: Partial<PurchaseOrderInput>): Promise<PurchaseOrder>
  deletePurchaseOrder(id: string): Promise<void>
  receivePurchaseOrderLine(
    orderId: string,
    lineIndex: number,
    opts: {
      arrivalDate: string
      mapping:
        | { kind: 'existing'; productId: string }
        | { kind: 'new'; product: ProductInput }
    },
  ): Promise<void>
  unreceivePurchaseOrderLine(orderId: string, lineIndex: number): Promise<void>
  convertOrphanArrivalToPo(
    productId: string,
    arrivalId: string,
    input: {
      supplierName: string
      unitPrice: number
      taxRate?: 8 | 10
      orderDate?: string
      notes?: string
    },
  ): Promise<PurchaseOrder>
}

export interface ISuppliersService {
  getSuppliers(): Promise<Supplier[]>
  updateSupplier(id: string, input: SupplierDetailsInput): Promise<Supplier>
}

export interface IServices {
  inventory: IInventoryService
  sales: ISalesService
  selfConsumption: ISelfConsumptionService
  ecSales: IEcSalesService
  purchaseOrders: IPurchaseOrdersService
  suppliers: ISuppliersService
  settings: ISettingsService
  masters: IMastersService
  auth: IAuthService
}

let servicesInstance: IServices | null = null

export async function getServices(): Promise<IServices> {
  if (servicesInstance) return servicesInstance
  const { createFirebaseServices } = await import('./firebase/services')
  servicesInstance = createFirebaseServices()
  return servicesInstance
}

export function resetServices() {
  servicesInstance = null
}
