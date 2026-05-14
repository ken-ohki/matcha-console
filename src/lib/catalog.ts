import type { StockStatus } from '@/types'

export interface CatalogGroup {
  id: string
  name: string
  sortOrder: number
}

export interface CatalogProduct {
  id: string
  sku: string
  name: string
  inventoryGroupId: string
  teaType?: string
  grade?: string
  origins: string[]
  cultivars: string[]
  pluckingMethods: string[]
  harvestSeasons: string[]
  shadingMethods: string[]
  certifications: string[]
  standardWholesalePrice?: number
  arrivalDate?: string
  stockStatus: StockStatus
  currentStockKg: number
  inquireToOrder: boolean
  sortOrder: number
}

export const SUPPORTED_CURRENCIES = ['JPY', 'EUR', 'USD', 'AUD', 'SGD', 'HKD', 'THB', 'PHP', 'IDR'] as const
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]

export interface CatalogResponse {
  groups: CatalogGroup[]
  products: CatalogProduct[]
  currency: string
  generatedAt: string
  exchangeRates: Record<SupportedCurrency, number>
  ratesAsOf: string
  ratesSource: 'live' | 'fallback'
}
