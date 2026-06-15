// Single source of truth for consumption-tax math.
//
// Rounding policy: floor ONCE per rate bucket (8% / 10%), matching the
// invoice / purchase-order documents (the legal artifacts). All management
// screens delegate here so the tax-inclusive total shown anywhere matches
// the printed document to the yen.

export type TaxRate = 0 | 8 | 10  // 0 = 免税

export interface TaxLine {
  quantityKg: number
  unitPrice: number
  taxRate?: TaxRate | number
}

export interface TaxBreakdown {
  exemptSubtotal: number    // 免税対象 (税抜・非課税)
  reducedSubtotal: number   // 8%対象 (税抜)
  standardSubtotal: number  // 10%対象 (税抜)
  reducedTax: number        // 8%消費税
  standardTax: number       // 10%消費税
  subtotal: number          // 税抜合計
  tax: number               // 消費税合計
  total: number             // 税込合計
}

/** Default per-line tax rate by destination: domestic = 8% (matcha), export = 免税. */
export function defaultTaxRateForCountry(country?: string): TaxRate {
  const c = (country ?? '').trim().toLowerCase()
  const domestic = c === '' || c === '日本' || c === 'japan' || c === 'jp'
  return domestic ? 8 : 0
}

/**
 * Compute a tax breakdown from line items plus fees.
 * taxRate 0 = 免税 (no tax); missing taxRate defaults to 8 (matcha).
 * Fees (shipping / other) are always 10% standard.
 */
export function computeTaxBuckets(lines: TaxLine[], fees = 0): TaxBreakdown {
  let exempt = 0
  let reduced = 0
  let standard = 0
  for (const line of lines) {
    const amount = (Number(line.quantityKg) || 0) * (Number(line.unitPrice) || 0)
    const rate = line.taxRate == null ? 8 : Number(line.taxRate)
    if (rate === 0) exempt += amount
    else if (rate === 8) reduced += amount
    else standard += amount
  }
  standard += Number(fees) || 0

  const reducedTax = Math.floor(reduced * 0.08)
  const standardTax = Math.floor(standard * 0.10)
  const subtotal = exempt + reduced + standard
  const tax = reducedTax + standardTax
  return {
    exemptSubtotal: exempt,
    reducedSubtotal: reduced,
    standardSubtotal: standard,
    reducedTax,
    standardTax,
    subtotal,
    tax,
    total: subtotal + tax,
  }
}

/** Total consumption tax for the given lines + fees (bucket-floored). */
export function computeTax(lines: TaxLine[], fees = 0): number {
  return computeTaxBuckets(lines, fees).tax
}

/**
 * Convert free-form sale options (packaging fees, etc.) into tax lines so they
 * can be folded into the bucket calculation with their own per-option rate.
 * Missing rate defaults to 10% (standard).
 */
export function saleOptionsToTaxLines(
  options?: { amount: number; taxRate?: TaxRate | number }[],
): TaxLine[] {
  return (options ?? []).map(o => ({
    quantityKg: 1,
    unitPrice: Number(o.amount) || 0,
    taxRate: o.taxRate == null ? 10 : Number(o.taxRate),
  }))
}

/**
 * Buckets for a SALE: when every line is 免税 (an export), the fees are
 * exempt too — the whole transaction carries no consumption tax.
 */
export function computeSaleTaxBuckets(lines: TaxLine[], fees = 0): TaxBreakdown {
  const allExempt = lines.length > 0 && lines.every(l => Number(l.taxRate) === 0)
  if (!allExempt) return computeTaxBuckets(lines, fees)
  const b = computeTaxBuckets(lines, 0)
  const f = Number(fees) || 0
  return { ...b, exemptSubtotal: b.exemptSubtotal + f, subtotal: b.subtotal + f, total: b.total + f }
}
