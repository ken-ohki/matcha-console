import { computeTaxBuckets } from '@/lib/tax'

export type DocumentType = 'invoice' | 'delivery' | 'quotation'
export type DocumentLanguage = 'ja' | 'en'

export interface DocumentLine {
  id: string
  description: string
  isReducedRate: boolean
  quantity: number
  unit: string
  unitPrice: number
}

export interface DocumentData {
  type: DocumentType
  language: DocumentLanguage
  recipientName: string
  recipientHonorific: string
  recipientAddress: string
  recipientPostalCode: string
  issueDate: string
  projectName: string
  taxExempt: boolean
  // type-specific
  validUntil?: string
  terms?: string
  deliveryDate?: string
  deliveryPlace?: string
  paymentDueDate?: string
  paymentDestination?: string
  paymentTerms?: string
  lines: DocumentLine[]
  notes: string
}

export const DOCUMENT_LABELS: Record<DocumentType, { title: string; intro: string; amountLabel: string }> = {
  invoice: { title: '請　求　書', intro: '下記の通りご請求申し上げます。', amountLabel: '御請求金額' },
  delivery: { title: '納　品　書', intro: '下記の通り納品致しました。', amountLabel: '合計金額' },
  quotation: { title: '見　積　書', intro: '下記の通りお見積り申し上げます。', amountLabel: '御見積金額' },
}

export const ISSUER = {
  company: '株式会社SABO',
  companyEn: 'SABO CO., LTD.',
  postalCode: '〒932-0217',
  address: '富山県南砺市本町3-35',
  addressEn: '3-35 Honmachi, Nanto-shi, Toyama 932-0217, Japan',
  tel: '080-6365-5130',
  email: 'info@sabo-inc.jp',
  registrationNumber: 'T9-2300-0101-8984',
  bankInfo: '住信SBIネット銀行　法人第一支店（106）普通1703523\n株式会社SABO',
  bankInfoEn: 'Account Name: SABO CO., LTD.\nBank Name: SBI Sumishin Net Bank, Ltd\nAccount Number: 1061703523\nSWIFT Code: SSNBJPJT',
} as const

export const DEFAULT_EN_PAYMENT_TERMS = `Please refer to the attached Terms & Conditions of Sale.
By making payment, the Buyer acknowledges and agrees to those terms.`

export const TERMS_AND_CONDITIONS_EN = [
  {
    heading: '1. Definitions',
    body: '"Seller" means SABO CO., LTD. "Buyer" means the company to which the Goods are sold. "Goods" means the tea and tea-related products specified in the Invoice.',
  },
  {
    heading: '2. Orders & Acceptance',
    body: 'Orders are deemed accepted only upon Seller\'s written confirmation and receipt of full payment. Quoted prices remain valid for 14 days from the date of quotation unless otherwise stated.',
  },
  {
    heading: '3. Payment',
    body: '100% advance payment by bank transfer in JPY is required prior to shipment. All bank transfer fees and any FX costs are borne by the Buyer. Seller reserves the right to cancel unpaid orders 14 days after issue of the invoice.',
  },
  {
    heading: '4. Delivery & Incoterms',
    body: 'Unless otherwise agreed in writing, delivery is made under Incoterms 2020 FCA (Toyama, Japan). Risk and title to the Goods pass to the Buyer upon completion of export customs clearance at the designated location. If the Buyer requests the Seller to arrange shipment, the Seller may do so on the Buyer\'s behalf as a paid service, acting solely as a forwarder; risk and liability remain transferred to the Buyer at the FCA point.',
  },
  {
    heading: '5. Lead Time',
    body: 'Standard in-stock items are shipped within 5–10 business days after payment confirmation. Custom orders, made-to-order items, and out-of-stock items follow a lead time confirmed per order.',
  },
  {
    heading: '6. Inspection & Quality Claims',
    body: 'The Buyer shall inspect the Goods within 7 days of receipt. Any claims regarding quality, quantity, or visible defects must be submitted in writing with photographic evidence within that period. No claims will be accepted thereafter.',
  },
  {
    heading: '7. Returns',
    body: 'Due to food safety and hygiene regulations, opened products may not be returned under any circumstances. Unopened products with confirmed quality defects may be replaced or refunded at the Seller\'s sole discretion. No returns or refunds are accepted for change of mind, taste preference, or marketing reasons.',
  },
  {
    heading: '8. Storage & Handling',
    body: 'After delivery, the Buyer is responsible for proper storage of the Goods (cool, dry, sealed, away from direct sunlight and strong odors). The Seller is not liable for quality deterioration caused by improper post-delivery handling.',
  },
  {
    heading: '9. Shelf Life & Best-Before Date',
    body: 'The best-before date is marked on each lot. Goods sold close to their best-before date are sold "as is" and at the Buyer\'s acknowledgment.',
  },
  {
    heading: '10. Labeling & Regulatory Compliance',
    body: 'The Goods comply with Japanese food regulations at the time of dispatch. The Buyer is solely responsible for compliance with all import regulations, food safety laws, labeling requirements, and customs procedures in the country of destination and any onward markets.',
  },
  {
    heading: '11. Trademarks & Brand',
    body: 'All trademarks, trade names, and intellectual property of the Seller (including "SABO" and related marks) remain the exclusive property of the Seller. The Buyer shall not modify, repackage, relabel, or rebrand the Goods without the Seller\'s prior written consent.',
  },
  {
    heading: '12. Confidentiality',
    body: 'Pricing, contractual terms, and proprietary product information are confidential between the parties and shall not be disclosed to third parties without prior written consent.',
  },
  {
    heading: '13. Force Majeure',
    body: 'Neither party shall be liable for any failure or delay in performance caused by events beyond reasonable control, including but not limited to natural disasters, pandemics, war, civil unrest, government restrictions, port or shipping disruptions, energy shortages, or supplier failure.',
  },
  {
    heading: '14. Limitation of Liability',
    body: 'The Seller\'s total liability arising out of or in connection with any order shall not exceed the invoice value of that order. The Seller shall not be liable for any indirect, consequential, incidental, or special damages, including loss of profit, loss of business, or loss of goodwill.',
  },
  {
    heading: '15. Governing Law & Jurisdiction',
    body: 'These Terms and any related transactions shall be governed by the laws of Japan. The parties shall first seek to resolve any dispute through good-faith negotiation. If unresolved, the parties agree to the exclusive jurisdiction of the Toyama District Court, Japan.',
  },
  {
    heading: '16. Entire Agreement',
    body: 'These Terms & Conditions of Sale, together with the Invoice, constitute the entire agreement between the parties regarding the subject matter and supersede any prior understanding. The Buyer\'s general purchase terms shall not apply unless expressly accepted in writing by the Seller.',
  },
] as const

export function newLineId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createBlankLine(overrides: Partial<DocumentLine> = {}): DocumentLine {
  return {
    id: newLineId(),
    description: '',
    isReducedRate: true,
    quantity: 1,
    unit: 'kg',
    unitPrice: 0,
    ...overrides,
  }
}

export interface DocumentTotals {
  reducedSubtotal: number   // 8%対象 (税抜)
  standardSubtotal: number  // 10%対象 (税抜)
  reducedTax: number        // 8%消費税
  standardTax: number       // 10%消費税
  subtotal: number          // 税抜合計
  tax: number               // 消費税合計
  total: number             // 税込合計
}

export function computeTotals(lines: DocumentLine[]): DocumentTotals {
  // Delegate to the shared tax module so documents and management screens
  // round identically (floor once per rate bucket). Document fees are already
  // represented as lines, so no separate fees argument is passed.
  return computeTaxBuckets(
    lines.map(line => ({
      quantityKg: Number(line.quantity) || 0,
      unitPrice: Number(line.unitPrice) || 0,
      taxRate: line.isReducedRate ? 8 : 10,
    })),
  )
}

export function formatYen(value: number): string {
  return new Intl.NumberFormat('ja-JP').format(Math.round(value))
}

export function formatDateJa(value: string): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }).format(d)
}

export function todayString(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}
