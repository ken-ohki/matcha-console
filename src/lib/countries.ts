export interface CountryOption {
  code: string
  name: string
}

export const COUNTRY_OPTIONS: CountryOption[] = [
  { code: 'AR', name: 'Argentina' },
  { code: 'AU', name: 'Australia' },
  { code: 'AT', name: 'Austria' },
  { code: 'BH', name: 'Bahrain' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BR', name: 'Brazil' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'KH', name: 'Cambodia' },
  { code: 'CA', name: 'Canada' },
  { code: 'CN', name: 'China' },
  { code: 'CZ', name: 'Czechia' },
  { code: 'DK', name: 'Denmark' },
  { code: 'EG', name: 'Egypt' },
  { code: 'EE', name: 'Estonia' },
  { code: 'FJ', name: 'Fiji' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'GR', name: 'Greece' },
  { code: 'HK', name: 'Hong Kong' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IS', name: 'Iceland' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'KE', name: 'Kenya' },
  { code: 'KW', name: 'Kuwait' },
  { code: 'LA', name: 'Laos' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MX', name: 'Mexico' },
  { code: 'MN', name: 'Mongolia' },
  { code: 'MM', name: 'Myanmar' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'NO', name: 'Norway' },
  { code: 'OM', name: 'Oman' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PA', name: 'Panama' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'QA', name: 'Qatar' },
  { code: 'RO', name: 'Romania' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'KR', name: 'South Korea' },
  { code: 'ES', name: 'Spain' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TR', name: 'Turkey' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'VN', name: 'Vietnam' },
]

const NAME_TO_CODE: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const c of COUNTRY_OPTIONS) {
    map[c.name.toLowerCase()] = c.code
  }
  // Common aliases / Japanese fallbacks
  const aliases: Record<string, string> = {
    'usa': 'US',
    'u.s.a.': 'US',
    'us': 'US',
    'america': 'US',
    'uk': 'GB',
    'england': 'GB',
    'great britain': 'GB',
    '日本': 'JP',
    'アメリカ': 'US',
    'イギリス': 'GB',
    'フランス': 'FR',
    'ドイツ': 'DE',
    'シンガポール': 'SG',
    '香港': 'HK',
    '台湾': 'TW',
    'タイ': 'TH',
    'インドネシア': 'ID',
    'フィリピン': 'PH',
    'オーストラリア': 'AU',
  }
  for (const [k, v] of Object.entries(aliases)) {
    map[k.toLowerCase()] = v
  }
  return map
})()

export function countryCodeFromName(name: string | undefined | null): string | null {
  if (!name) return null
  const key = name.trim().toLowerCase()
  if (key.length === 2 && /^[a-z]{2}$/i.test(key)) return key.toUpperCase()
  return NAME_TO_CODE[key] ?? null
}

export function flagEmoji(code: string | undefined | null): string {
  if (!code || code.length !== 2 || !/^[a-zA-Z]{2}$/.test(code)) return ''
  return code
    .toUpperCase()
    .replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt(0)))
}

export function flagFromCountryName(name: string | undefined | null): string {
  return flagEmoji(countryCodeFromName(name))
}
