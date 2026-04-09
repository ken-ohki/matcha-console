import type { SaleStatus, StockStatus } from '@/types'

const stockLabels: Record<StockStatus, string> = {
  normal: '在庫あり',
  low: '欠品間近',
  out: '欠品',
}

const stockColors: Record<StockStatus, string> = {
  normal: 'bg-green-100 text-green-800',
  low: 'bg-amber-100 text-amber-800',
  out: 'bg-red-100 text-red-800',
}

export function StockStatusBadge({ status }: { status: StockStatus }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${stockColors[status]}`}>
      {stockLabels[status]}
    </span>
  )
}

const salesLabels: Record<SaleStatus, string> = {
  negotiating: '商談中',
  confirmed: '確定',
  cancelled: '取消',
}

const salesColors: Record<SaleStatus, string> = {
  negotiating: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-100 text-slate-600',
}

export function SalesStatusBadge({ status }: { status: SaleStatus }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${salesColors[status]}`}>
      {salesLabels[status]}
    </span>
  )
}
