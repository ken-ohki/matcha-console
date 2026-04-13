export const TEA_TYPE_OPTIONS = ['抹茶', '粉末茶', '玉露', '煎茶', 'ほうじ茶'] as const

export const GRADE_OPTIONS = ['Specialty', 'Premium', 'Barista', 'Culinary'] as const

export const CULTIVAR_OPTIONS = [
  'やぶきた',
  'さみどり',
  'さえみどり',
  'おくみどり',
  'あさつゆ',
  'せいめい',
  'ごこう',
  'うじひかり',
  'つゆひかり',
  'さえあかり',
  'あさひ',
  'ゆたかみどり',
  'かなやみどり',
  'そうふう',
  'きらり31',
] as const

export const PLUCKING_METHOD_OPTIONS = ['手摘み', '機械摘み'] as const

export const HARVEST_SEASON_OPTIONS = ['1番茶', '2番茶', '秋冬番茶'] as const

export const SHADING_METHOD_OPTIONS = ['棚掛け', '直掛け', '被覆なし'] as const

export const CERTIFICATION_OPTIONS = ['有機JAS', 'FSSC22000', 'US有機', 'EU有機'] as const

export function formatOptionList(values: string[] | undefined, fallback = '-'): string {
  if (!values || values.length === 0) return fallback
  return values.join('、')
}

export function formatCultivars(values: string[] | undefined): string {
  if (!values || values.length === 0) return 'ブレンド'
  return values.join('、')
}
