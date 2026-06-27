// Shared formatting & date helpers. Replaces per-page duplicate definitions.

export function formatCurrency(n: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(n || 0)
}

export function formatKg(value: number): string {
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(value || 0)} kg`
}

/** Format an ISO/date-ish string for display; empty/invalid → '-'. */
export function formatDate(value?: string): string {
  if (!value) return '-'
  // 表記をYYYY-MM-DDに統一（フルISOタイムスタンプでも日付部分のみ表示）。
  return value.length >= 10 ? value.slice(0, 10) : value
}

export function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "YYYY-MM" from a Date. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function startOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export function endOfMonth(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
}

/** End-of-this-month ISO (alias kept for AR/AP bucket helpers). */
export function endOfMonthIso(d: Date): string {
  return endOfMonth(d)
}

export function endOfNextMonthIso(d: Date): string {
  const last = new Date(d.getFullYear(), d.getMonth() + 2, 0)
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`
}
