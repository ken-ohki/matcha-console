// Selectable payment methods for sales / receivables.
export const PAYMENT_METHODS = [
  '銀行振込',
  'Stripe',
  'Square',
  'Square（オンライン）',
] as const

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
