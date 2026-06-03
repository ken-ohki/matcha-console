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

/**
 * Compute a tax breakdown from line items plus fees.
 * taxRate 0 = 免税 (no tax). Fees (shipping / other) are always 10% standard.
 */
export function computeTaxBuckets(lines: TaxLine[], fees = 0): TaxBreakdown {
  let exempt = 0
  let reduced = 0
  let standard = 0
  for (const line of lines) {
    const amount = (Number(line.quantityKg) || 0) * (Number(line.unitPrice) || 0)
    const rate = Number(line.taxRate)
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
