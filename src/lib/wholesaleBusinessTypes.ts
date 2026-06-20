// Display labels for wholesale member business-type keys (set on the storefront).
// Keep in sync with sabo-wholesale's src/lib/businessTypes.ts.

export const BUSINESS_TYPE_LABEL_JA: Record<string, string> = {
  cafe_matcha: 'カフェ（抹茶専門）',
  cafe_coffee: 'カフェ（コーヒー）',
  cafe_general: 'カフェ（一般）',
  restaurant: 'レストラン',
  bar: 'バー',
  patisserie: '製菓・パティスリー',
  hotel: 'ホテル・旅館',
  retail: '小売・物販',
  tea_shop: '日本茶・ティー専門店',
  ec: 'ECショップ',
  wholesale: '卸売・流通',
  other: 'そのほか',
}

/** Resolve member business types to a display string. Falls back to legacy free-text. */
export function businessTypeText(types: string[] | undefined, legacy: string | undefined): string {
  if (Array.isArray(types) && types.length > 0) {
    return types.map(k => BUSINESS_TYPE_LABEL_JA[k] ?? k).join(' / ')
  }
  return legacy ?? '—'
}
