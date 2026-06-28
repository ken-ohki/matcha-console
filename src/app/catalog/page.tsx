'use client'

import { useEffect, useMemo, useState } from 'react'
import { Info, LayoutGrid, Leaf, List, Lock, Search, X } from 'lucide-react'
import type { CatalogProduct, CatalogResponse, SupportedCurrency } from '@/lib/catalog'
import { SUPPORTED_CURRENCIES } from '@/lib/catalog'
import type { StockStatus } from '@/types'
import { EmptyState } from '@/components/ui/EmptyState'

const PASSCODE_KEY = 'matcha-catalog-passcode'
const VIEW_MODE_KEY = 'matcha-catalog-view-mode'
const CURRENCY_KEY = 'matcha-catalog-currency'

const CURRENCY_LABELS: Record<SupportedCurrency, string> = {
  JPY: 'JPY (¥)',
  EUR: 'EUR (€)',
  USD: 'USD ($)',
  AUD: 'AUD (A$)',
  SGD: 'SGD (S$)',
  HKD: 'HKD (HK$)',
  THB: 'THB (฿)',
  PHP: 'PHP (₱)',
  IDR: 'IDR (Rp)',
}

function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value)
}

type ViewMode = 'card' | 'list'
type StockFilter = 'all' | 'normal' | 'low' | 'out'
type SortKey =
  | 'default'
  | 'name-asc'
  | 'name-desc'
  | 'price-asc'
  | 'price-desc'
  | 'stock-desc'
  | 'stock-asc'

const STOCK_LABELS: Record<StockStatus, string> = {
  normal: 'In stock',
  low: 'Low stock',
  out: 'Out of stock',
}

const STOCK_COLORS: Record<StockStatus, string> = {
  normal: 'bg-bone text-matcha',
  low: 'bg-bone text-[#a87b1e]',
  out: 'bg-alert/10 text-alert',
}

function CatalogStockBadge({ status, ask }: { status: StockStatus; ask: boolean }) {
  if (ask) {
    return (
      <span className="inline-flex items-center rounded-full bg-bone px-2.5 py-0.5 text-xs font-medium text-[#a87b1e]">
        ASK
      </span>
    )
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STOCK_COLORS[status]}`}>
      {STOCK_LABELS[status]}
    </span>
  )
}

function formatCurrency(value: number | undefined, currency: string): string {
  if (value == null) return '-'
  const decimals = currency === 'JPY' || currency === 'IDR' ? 0 : 2
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    }).format(value)
  } catch {
    return `${value.toLocaleString('en-US')} ${currency}`
  }
}

function convertPrice(jpy: number | undefined, rate: number | undefined): number | undefined {
  if (jpy == null || rate == null) return jpy
  return jpy * rate
}

const STOCK_DEFINITIONS: { name: string; description: string }[] = [
  {
    name: 'In stock',
    description:
      'Stock has been confirmed and we can arrange shipment immediately upon receiving your order.',
  },
  {
    name: 'ASK',
    description:
      'Made to order — quantity and lead time need to be confirmed. Typically ships in 2 weeks to 1 month, depending on quantity.',
  },
  {
    name: 'Out of stock',
    description:
      'No stock available and awaiting restock. Or this season’s harvest has been fully sold and we must wait for next year’s harvest.',
  },
]

const GRADE_DEFINITIONS: { name: string; description: string }[] = [
  {
    name: 'Specialty',
    description:
      'Cultivated under traditional canopy-style shading and harvested by hand or with extremely delicate machinery. The highest quality grade — suited to Koicha (thick tea) in traditional Japanese tea ceremony.',
  },
  {
    name: 'Premium',
    description:
      'Suitable for traditional Japanese tea ceremony. Smooth enough to be enjoyed straight, without sugar.',
  },
  {
    name: 'Barista',
    description:
      'Blended with second-flush leaves to keep the price approachable. Works well with sugar or milk, and is ideal for beverage applications such as lattes.',
  },
  {
    name: 'Culinary',
    description:
      'Not intended for drinking. Designed for confectionery, baking, and other culinary applications.',
  },
]

function formatStockKg(value: number): string {
  return `${value.toFixed(1)} kg`
}

function formatList(values: string[] | undefined): string {
  if (!values || values.length === 0) return '-'
  return values.join(', ')
}

async function fetchCatalog(passcode: string): Promise<CatalogResponse> {
  const res = await fetch('/api/catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode }),
    cache: 'no-store',
  })
  if (res.status === 401) throw new Error('Invalid passcode')
  if (res.status === 500) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || 'Server is misconfigured')
  }
  if (!res.ok) throw new Error('Failed to load catalog')
  return res.json()
}

export default function CatalogPage() {
  const [passcode, setPasscode] = useState('')
  const [data, setData] = useState<CatalogResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [activeGroupId, setActiveGroupId] = useState<string>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [originFilter, setOriginFilter] = useState<string>('all')
  const [cultivarFilter, setCultivarFilter] = useState<string>('all')
  const [gradeFilter, setGradeFilter] = useState<string>('all')
  const [stockFilter, setStockFilter] = useState<StockFilter>('all')
  const [priceMin, setPriceMin] = useState<string>('')
  const [priceMax, setPriceMax] = useState<string>('')
  const [sortKey, setSortKey] = useState<SortKey>('price-asc')
  const [displayCurrency, setDisplayCurrency] = useState<SupportedCurrency>('JPY')
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const [gradeInfoOpen, setGradeInfoOpen] = useState(false)
  const [stockInfoOpen, setStockInfoOpen] = useState(false)

  useEffect(() => {
    const stored = sessionStorage.getItem(CURRENCY_KEY)
    if (stored && isSupportedCurrency(stored)) setDisplayCurrency(stored)
  }, [])

  const handleCurrencyChange = (value: SupportedCurrency) => {
    setDisplayCurrency(value)
    sessionStorage.setItem(CURRENCY_KEY, value)
  }

  useEffect(() => {
    const stored = sessionStorage.getItem(VIEW_MODE_KEY)
    if (stored === 'card' || stored === 'list') setViewMode(stored)
  }, [])

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode)
    sessionStorage.setItem(VIEW_MODE_KEY, mode)
  }

  useEffect(() => {
    const stored = sessionStorage.getItem(PASSCODE_KEY)
    if (!stored) return
    setLoading(true)
    fetchCatalog(stored)
      .then(res => {
        setData(res)
        setPasscode(stored)
      })
      .catch(() => sessionStorage.removeItem(PASSCODE_KEY))
      .finally(() => setLoading(false))
  }, [])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setAuthError(null)
    setLoading(true)
    try {
      const res = await fetchCatalog(passcode.trim())
      sessionStorage.setItem(PASSCODE_KEY, passcode.trim())
      setData(res)
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const originOptions = useMemo(() => {
    if (!data) return []
    const set = new Set<string>()
    data.products.forEach(p => p.origins.forEach(o => set.add(o)))
    return [...set].sort()
  }, [data])

  const cultivarOptions = useMemo(() => {
    if (!data) return []
    const set = new Set<string>()
    data.products.forEach(p => p.cultivars.forEach(c => set.add(c)))
    return [...set].sort()
  }, [data])

  const gradeOptions = useMemo(() => {
    if (!data) return []
    const set = new Set<string>()
    data.products.forEach(p => { if (p.grade) set.add(p.grade) })
    return [...set].sort()
  }, [data])

  const exchangeRate = data?.exchangeRates?.[displayCurrency] ?? 1

  const filteredProducts = useMemo(() => {
    if (!data) return []
    const term = search.trim().toLowerCase()
    const minPrice = priceMin ? Number(priceMin) : null
    const maxPrice = priceMax ? Number(priceMax) : null
    const result = data.products.filter(p => {
      if (activeGroupId !== 'all' && p.inventoryGroupId !== activeGroupId) return false
      if (originFilter !== 'all' && !p.origins.includes(originFilter)) return false
      if (cultivarFilter !== 'all' && !p.cultivars.includes(cultivarFilter)) return false
      if (gradeFilter !== 'all' && p.grade !== gradeFilter) return false
      if (stockFilter !== 'all' && p.stockStatus !== stockFilter) return false
      const converted = convertPrice(p.standardWholesalePrice, exchangeRate)
      if (minPrice != null) {
        if (converted == null || converted < minPrice) return false
      }
      if (maxPrice != null) {
        if (converted == null || converted > maxPrice) return false
      }
      if (!term) return true
      const haystack = [
        p.name,
        p.sku,
        p.teaType,
        p.grade,
        ...p.origins,
        ...p.cultivars,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })

    if (sortKey === 'default') return result

    const sorted = [...result]
    const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
    const lastIfNull = (value: number | null | undefined, dir: 'asc' | 'desc') => {
      if (value == null) return dir === 'asc' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
      return value
    }
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'name-asc':
          return collator.compare(a.name, b.name)
        case 'name-desc':
          return collator.compare(b.name, a.name)
        case 'price-asc':
          return lastIfNull(a.standardWholesalePrice, 'asc') - lastIfNull(b.standardWholesalePrice, 'asc')
        case 'price-desc':
          return lastIfNull(b.standardWholesalePrice, 'desc') - lastIfNull(a.standardWholesalePrice, 'desc')
        case 'stock-desc':
          return b.currentStockKg - a.currentStockKg
        case 'stock-asc':
          return a.currentStockKg - b.currentStockKg
        default:
          return 0
      }
    })
    return sorted
  }, [data, search, activeGroupId, originFilter, cultivarFilter, gradeFilter, stockFilter, priceMin, priceMax, sortKey, exchangeRate])

  const resetFilters = () => {
    setSearch('')
    setActiveGroupId('all')
    setOriginFilter('all')
    setCultivarFilter('all')
    setGradeFilter('all')
    setStockFilter('all')
    setPriceMin('')
    setPriceMax('')
    setSortKey('price-asc')
  }

  const hasActiveFilter =
    search.trim() !== '' ||
    activeGroupId !== 'all' ||
    originFilter !== 'all' ||
    cultivarFilter !== 'all' ||
    gradeFilter !== 'all' ||
    stockFilter !== 'all' ||
    priceMin !== '' ||
    priceMax !== '' ||
    sortKey !== 'price-asc'

  if (!data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#173c2a] to-[#2a5c3e] flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 backdrop-blur rounded-2xl mb-4">
              <Lock size={28} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold text-paper">SABO WHOLESALE CATALOG</h1>
            <p className="mt-2 text-sm text-mist">Enter the passcode to continue</p>
          </div>
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-xl p-8">
            <label className="block">
              <span className="text-sm font-medium text-graphite">Passcode</span>
              <input
                type="password"
                value={passcode}
                onChange={event => setPasscode(event.target.value)}
                required
                autoFocus
                className="mt-2 w-full rounded-lg border border-line px-4 py-2.5 text-ink focus:border-[#174c33] focus:outline-none focus:ring-1 focus:ring-[#174c33]"
              />
            </label>
            {authError && (
              <p className="mt-3 text-sm text-alert">{authError}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full rounded-lg bg-ink py-2.5 text-sm font-semibold text-paper shadow transition hover:bg-[#205f43] disabled:opacity-50"
            >
              {loading ? 'Verifying…' : 'Open catalog'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  const selectClass =
    'w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink focus:border-[#174c33] focus:outline-none focus:ring-1 focus:ring-[#174c33]'
  const numberInputClass =
    'w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink focus:border-[#174c33] focus:outline-none focus:ring-1 focus:ring-[#174c33]'

  return (
    <div className="min-h-screen bg-bone">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink text-paper">
              <Leaf size={20} />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.18em] text-mist">Product Catalog</p>
              <h1 className="text-lg font-semibold text-ink">SABO WHOLESALE CATALOG</h1>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              sessionStorage.removeItem(PASSCODE_KEY)
              setData(null)
              setPasscode('')
            }}
            className="text-xs text-mist hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
            <input
              type="search"
              placeholder="Search by name, SKU, or origin"
              value={search}
              onChange={event => setSearch(event.target.value)}
              className="w-full rounded-lg border border-line bg-white py-2 pl-9 pr-3 text-sm text-ink focus:border-[#174c33] focus:outline-none focus:ring-1 focus:ring-[#174c33]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs text-mist">
              {filteredProducts.length} / {data.products.length} items
            </p>
            <label className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-mist">Currency</span>
              <select
                value={displayCurrency}
                onChange={event => handleCurrencyChange(event.target.value as SupportedCurrency)}
                className="rounded-lg border border-line bg-white px-2 py-1 text-xs text-ink focus:border-[#174c33] focus:outline-none focus:ring-1 focus:ring-[#174c33]"
              >
                {SUPPORTED_CURRENCIES.map(code => (
                  <option key={code} value={code}>{CURRENCY_LABELS[code]}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-mist">Sort</span>
              <select
                value={sortKey}
                onChange={event => setSortKey(event.target.value as SortKey)}
                className="rounded-lg border border-line bg-white px-2 py-1 text-xs text-ink focus:border-[#174c33] focus:outline-none focus:ring-1 focus:ring-[#174c33]"
              >
                <option value="default">Default</option>
                <option value="name-asc">Name (A–Z)</option>
                <option value="name-desc">Name (Z–A)</option>
                <option value="price-asc">Price (Low → High)</option>
                <option value="price-desc">Price (High → Low)</option>
                <option value="stock-desc">Stock (High → Low)</option>
                <option value="stock-asc">Stock (Low → High)</option>
              </select>
            </label>
            <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
              <button
                type="button"
                onClick={() => handleViewModeChange('card')}
                aria-label="Card view"
                aria-pressed={viewMode === 'card'}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewMode === 'card'
                    ? 'bg-ink text-paper'
                    : 'text-mist hover:text-ink'
                }`}
              >
                <LayoutGrid size={14} />
                Cards
              </button>
              <button
                type="button"
                onClick={() => handleViewModeChange('list')}
                aria-label="List view"
                aria-pressed={viewMode === 'list'}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewMode === 'list'
                    ? 'bg-ink text-paper'
                    : 'text-mist hover:text-ink'
                }`}
              >
                <List size={14} />
                List
              </button>
            </div>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveGroupId('all')}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              activeGroupId === 'all'
                ? 'bg-ink text-paper'
                : 'bg-white text-ink border border-line hover:bg-[#ece8db]'
            }`}
          >
            All
          </button>
          {data.groups.map(group => (
            <button
              key={group.id}
              type="button"
              onClick={() => setActiveGroupId(group.id)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                activeGroupId === group.id
                  ? 'bg-ink text-paper'
                  : 'bg-white text-ink border border-line hover:bg-[#ece8db]'
              }`}
            >
              {group.name}
            </button>
          ))}
        </div>

        <div className="mb-6 rounded-2xl border border-[#e2dccc] bg-white/70 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-wider text-mist">Filters</p>
            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs text-matchaDeep underline-offset-2 hover:underline"
              >
                Reset
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-mist">Origin</span>
              <select
                value={originFilter}
                onChange={event => setOriginFilter(event.target.value)}
                className={selectClass}
              >
                <option value="all">All origins</option>
                {originOptions.map(value => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-mist">Cultivar</span>
              <select
                value={cultivarFilter}
                onChange={event => setCultivarFilter(event.target.value)}
                className={selectClass}
              >
                <option value="all">All cultivars</option>
                {cultivarOptions.map(value => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <div>
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-mist">Grade</span>
                <button
                  type="button"
                  onClick={() => setGradeInfoOpen(true)}
                  aria-label="About grades"
                  className="rounded-full p-0.5 text-mist transition hover:bg-[#ece8db] hover:text-ink"
                >
                  <Info size={12} />
                </button>
              </div>
              <select
                value={gradeFilter}
                onChange={event => setGradeFilter(event.target.value)}
                className={selectClass}
              >
                <option value="all">All grades</option>
                {gradeOptions.map(value => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1.5">
                <span className="text-[11px] font-medium text-mist">Stock</span>
                <button
                  type="button"
                  onClick={() => setStockInfoOpen(true)}
                  aria-label="About stock statuses"
                  className="rounded-full p-0.5 text-mist transition hover:bg-[#ece8db] hover:text-ink"
                >
                  <Info size={12} />
                </button>
              </div>
              <select
                value={stockFilter}
                onChange={event => setStockFilter(event.target.value as StockFilter)}
                className={selectClass}
              >
                <option value="all">All</option>
                <option value="normal">In stock</option>
                <option value="low">Low stock</option>
                <option value="out">Out of stock</option>
              </select>
            </div>
            <div>
              <span className="mb-1 block text-[11px] font-medium text-mist">Price range ({displayCurrency} / kg)</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="Min"
                  value={priceMin}
                  onChange={event => setPriceMin(event.target.value)}
                  className={numberInputClass}
                />
                <span className="text-xs text-mist">–</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="Max"
                  value={priceMax}
                  onChange={event => setPriceMax(event.target.value)}
                  className={numberInputClass}
                />
              </div>
            </div>
          </div>
        </div>

        {filteredProducts.length === 0 ? (
          <EmptyState message="No products match your filters" />
        ) : viewMode === 'list' ? (
          <ProductList
            products={filteredProducts}
            groups={data.groups}
            currency={displayCurrency}
            rate={exchangeRate}
            onSelect={id => setSelectedProductId(id)}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredProducts.map(product => {
              const group = data.groups.find(g => g.id === product.inventoryGroupId)
              return (
                <article
                  key={product.id}
                  onClick={() => setSelectedProductId(product.id)}
                  className="flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border border-[#e2dccc] bg-white shadow-sm transition hover:border-[#bcb39a] hover:shadow"
                >
                  {product.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      loading="lazy"
                      decoding="async"
                      className="h-44 w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-44 w-full items-center justify-center bg-bone text-xs text-mist">
                      No image
                    </div>
                  )}
                  <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.16em] text-mist">
                        {group?.name ?? '-'} · {product.sku || '-'}
                      </p>
                      <h2 className="mt-1 text-lg font-semibold text-ink">{product.name}</h2>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <CatalogStockBadge status={product.stockStatus} ask={product.inquireToOrder} />
                      {!product.inquireToOrder && product.stockStatus !== 'out' && (
                        <span className="text-[11px] text-mist">{formatStockKg(product.currentStockKg)} available</span>
                      )}
                    </div>
                  </div>

                  <dl className="mt-4 space-y-2 text-sm text-ink">
                    <Row label="Type / Grade" value={[product.teaType, product.grade].filter(Boolean).join(' / ') || '-'} />
                    <Row label="Origin" value={formatList(product.origins)} />
                    <Row label="Cultivar" value={formatList(product.cultivars)} />
                    <Row label="Plucking" value={formatList(product.pluckingMethods)} />
                    <Row label="Harvest" value={formatList(product.harvestSeasons)} />
                    <Row label="Shading" value={formatList(product.shadingMethods)} />
                    <Row label="Certification" value={formatList(product.certifications)} />
                    {product.arrivalDate && <Row label="Latest arrival" value={product.arrivalDate} />}
                  </dl>

                  <div className="mt-5 flex items-end justify-between border-t border-[#ece8db] pt-4">
                    <span className="text-xs text-mist">Wholesale price</span>
                    <span className="text-lg font-semibold text-ink">
                      {formatCurrency(convertPrice(product.standardWholesalePrice, exchangeRate), displayCurrency)}
                      <span className="ml-1 text-xs font-normal text-mist">/ kg</span>
                    </span>
                  </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}

        <p className="mt-10 text-center text-[11px] text-mist">
          Prices and stock levels shown here are for reference. Please contact us for formal orders and quotes.
        </p>
      </main>

      {gradeInfoOpen && <GradeInfoModal onClose={() => setGradeInfoOpen(false)} />}
      {stockInfoOpen && <StockInfoModal onClose={() => setStockInfoOpen(false)} />}

      {selectedProductId && (() => {
        const product = data.products.find(p => p.id === selectedProductId)
        if (!product) return null
        const group = data.groups.find(g => g.id === product.inventoryGroupId)
        return (
          <ProductDetailModal
            product={product}
            groupName={group?.name}
            currency={displayCurrency}
            rate={exchangeRate}
            onClose={() => setSelectedProductId(null)}
          />
        )
      })()}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  if (value === '-') return null
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-xs text-mist">{label}</dt>
      <dd className="flex-1 text-sm">{value}</dd>
    </div>
  )
}

function ProductList({
  products,
  groups,
  currency,
  rate,
  onSelect,
}: {
  products: CatalogProduct[]
  groups: { id: string; name: string }[]
  currency: string
  rate: number
  onSelect: (id: string) => void
}) {
  const gridCols = 'md:grid-cols-[1.6fr_0.9fr_0.9fr_1fr_1.2fr_0.9fr_0.9fr]'
  return (
    <div className="overflow-hidden rounded-2xl border border-[#e2dccc] bg-white shadow-sm">
      <div className={`hidden gap-3 border-b border-[#ece8db] bg-[#f8f6ef] px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-mist md:grid ${gridCols}`}>
        <span>Product / SKU</span>
        <span>Type</span>
        <span>Grade</span>
        <span>Origin</span>
        <span>Cultivar</span>
        <span className="text-right">Price</span>
        <span className="text-right">Stock</span>
      </div>
      <ul className="divide-y divide-[#ece8db]">
        {products.map(product => (
          <li key={product.id}>
            <button
              type="button"
              onClick={() => onSelect(product.id)}
              className={`grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition hover:bg-bone focus:bg-bone focus:outline-none md:items-center md:gap-3 ${gridCols}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                {product.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={product.imageUrl}
                    alt={product.name}
                    loading="lazy"
                    decoding="async"
                    className="h-12 w-12 shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-bone text-[9px] text-mist">
                    No img
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{product.name}</p>
                  <p className="text-[11px] text-mist">{product.sku || '-'}</p>
                </div>
              </div>
              <div className="text-sm text-ink md:truncate">
                <span className="md:hidden text-[11px] text-mist mr-2">Type:</span>
                {product.teaType || '-'}
              </div>
              <div className="text-sm text-ink md:truncate">
                <span className="md:hidden text-[11px] text-mist mr-2">Grade:</span>
                {product.grade || '-'}
              </div>
              <div className="text-sm text-ink md:truncate">
                <span className="md:hidden text-[11px] text-mist mr-2">Origin:</span>
                {product.origins.join(', ') || '-'}
              </div>
              <div className="text-sm text-ink md:truncate">
                <span className="md:hidden text-[11px] text-mist mr-2">Cultivar:</span>
                {product.cultivars.join(', ') || '-'}
              </div>
              <div className="text-sm font-semibold text-ink md:text-right">
                <span className="md:hidden text-[11px] font-normal text-mist mr-2">Price:</span>
                {formatCurrency(convertPrice(product.standardWholesalePrice, rate), currency)}
                <span className="ml-1 text-[11px] font-normal text-mist">/ kg</span>
              </div>
              <div className="flex items-center gap-2 md:flex-col md:items-end md:gap-1">
                <CatalogStockBadge status={product.stockStatus} ask={product.inquireToOrder} />
                {!product.inquireToOrder && product.stockStatus !== 'out' && (
                  <span className="text-[11px] text-mist">{formatStockKg(product.currentStockKg)} available</span>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ProductDetailModal({
  product,
  groupName,
  currency,
  rate,
  onClose,
}: {
  product: CatalogProduct
  groupName?: string
  currency: string
  rate: number
  onClose: () => void
}) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[100vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-2xl"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 rounded-full bg-white/80 p-1.5 text-mist backdrop-blur transition hover:bg-bone hover:text-ink"
        >
          <X size={18} />
        </button>
        {product.imageUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={product.imageUrl}
            alt={product.name}
            decoding="async"
            className="h-56 w-full rounded-t-2xl object-cover"
          />
        )}
        <div className="border-b border-[#ece8db] px-6 pb-4 pt-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-mist">
            {groupName ?? '-'} · {product.sku || '-'}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-ink">{product.name}</h2>
          <div className="mt-3 flex items-center gap-3">
            <CatalogStockBadge status={product.stockStatus} ask={product.inquireToOrder} />
            {product.inquireToOrder ? (
              <span className="text-xs text-mist">Contact us for availability</span>
            ) : (
              product.stockStatus !== 'out' && (
                <span className="text-xs text-mist">{formatStockKg(product.currentStockKg)} available</span>
              )
            )}
          </div>
        </div>
        <div className="px-6 py-5 space-y-5">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DetailRow label="Type" value={product.teaType} />
            <DetailRow label="Grade" value={product.grade} />
            <DetailRow label="Origin" value={product.origins.join(', ')} />
            <DetailRow label="Cultivar" value={product.cultivars.join(', ')} />
            <DetailRow label="Plucking" value={product.pluckingMethods.join(', ')} />
            <DetailRow label="Harvest" value={product.harvestSeasons.join(', ')} />
            <DetailRow label="Shading" value={product.shadingMethods.join(', ')} />
            <DetailRow label="Certification" value={product.certifications.join(', ')} />
            <DetailRow label="Latest arrival" value={product.arrivalDate} />
          </dl>

          {product.flavorNotes && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-mist">Flavor Notes</p>
              <p className="mt-1 whitespace-pre-wrap rounded-xl border border-[#ece8db] bg-bone p-3 text-sm leading-relaxed text-ink">
                {product.flavorNotes}
              </p>
            </div>
          )}

          {product.salesNote && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-mist">Notes</p>
              <p className="mt-1 whitespace-pre-wrap rounded-xl border border-[#ece8db] bg-bone p-3 text-sm leading-relaxed text-ink">
                {product.salesNote}
              </p>
            </div>
          )}
        </div>
        <div className="border-t border-[#ece8db] bg-bone px-6 py-4 rounded-b-2xl sm:rounded-b-2xl">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-mist">Wholesale price</span>
            <span className="text-xl font-semibold text-ink">
              {formatCurrency(convertPrice(product.standardWholesalePrice, rate), currency)}
              <span className="ml-1 text-xs font-normal text-mist">/ kg</span>
            </span>
          </div>
          {product.standardWholesalePrice != null && (
            <div className="mt-3 space-y-1 border-t border-[#ece8db] pt-3 text-xs text-mist">
              <p className="mb-1 text-[10px] uppercase tracking-wider">For reference</p>
              <div className="flex items-center justify-between">
                <span>Per 30 g</span>
                <span className="font-medium text-ink">
                  {formatCurrency(convertPrice(product.standardWholesalePrice * 0.03, rate), currency)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Per 3 g (one matcha latte serving)</span>
                <span className="font-medium text-ink">
                  {formatCurrency(convertPrice(product.standardWholesalePrice * 0.003, rate), currency)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StockInfoModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[100vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-2xl"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-full p-1.5 text-mist transition hover:bg-bone hover:text-ink"
        >
          <X size={18} />
        </button>
        <div className="border-b border-[#ece8db] px-6 pb-4 pt-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-mist">Stock status</p>
          <h2 className="mt-1 text-xl font-semibold text-ink">About stock statuses</h2>
        </div>
        <div className="space-y-4 px-6 py-5">
          {STOCK_DEFINITIONS.map(item => (
            <div key={item.name}>
              <h3 className="text-sm font-semibold text-ink">{item.name}</h3>
              <p className="mt-1 text-sm leading-relaxed text-graphite">{item.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function GradeInfoModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[100vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-h-[92vh] sm:rounded-2xl"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 rounded-full p-1.5 text-mist transition hover:bg-bone hover:text-ink"
        >
          <X size={18} />
        </button>
        <div className="border-b border-[#ece8db] px-6 pb-4 pt-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-mist">Grade definitions</p>
          <h2 className="mt-1 text-xl font-semibold text-ink">About our grades</h2>
        </div>
        <div className="space-y-4 px-6 py-5">
          <div className="rounded-xl bg-bone p-4 text-sm leading-relaxed text-graphite">
            <p>
              We do not use the term <strong>&ldquo;Ceremonial Grade.&rdquo;</strong> The concept of &ldquo;Ceremonial Grade&rdquo; does not exist in Japan — it is a vague label used primarily for marketing purposes.
            </p>
            <p className="mt-2">
              Instead, we classify our matcha using our own internal evaluation criteria, defined as follows:
            </p>
          </div>
          {GRADE_DEFINITIONS.map(grade => (
            <div key={grade.name}>
              <h3 className="text-sm font-semibold text-ink">{grade.name}</h3>
              <p className="mt-1 text-sm leading-relaxed text-graphite">{grade.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  const display = value && value.trim() ? value : null
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wider text-mist">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{display ?? <span className="text-mist">-</span>}</dd>
    </div>
  )
}
