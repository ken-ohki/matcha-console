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
  createSaleRecord(input: SaleRecordInput): Promise<SaleRecord>
  updateSaleRecord(id: string, input: Partial<SaleRecordInput>): Promise<SaleRecord>
  deleteSaleRecord(id: string): Promise<void>
}

export interface ISettingsService {
  getSettings(): Promise<Settings>
  updateSettings(input: Partial<Settings>): Promise<Settings>
}

export interface IAuthService {
  login(email: string, password: string): Promise<AuthUser>
  logout(): Promise<void>
  getCurrentUser(): Promise<AuthUser | null>
  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void
}

export interface IServices {
  inventory: IInventoryService
  sales: ISalesService
  settings: ISettingsService
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
