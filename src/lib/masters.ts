import type { MasterEntry, MasterType } from '@/types'

export interface MasterOption {
  value: string
  label: string
}

export function optionsForType(masters: MasterEntry[], type: MasterType): MasterOption[] {
  return masters
    .filter(m => m.type === type && m.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(m => ({ value: m.englishName, label: m.japaneseName || m.englishName }))
}

export function translateValue(masters: MasterEntry[], type: MasterType, value: string): string {
  const hit = masters.find(m => m.type === type && m.englishName === value)
  return hit?.japaneseName || value
}

export function translateValues(masters: MasterEntry[], type: MasterType, values: string[] | undefined): string[] {
  if (!values) return []
  return values.map(v => translateValue(masters, type, v))
}
