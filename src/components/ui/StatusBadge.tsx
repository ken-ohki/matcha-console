import type { SaleStatus, StockStatus } from '@/types'

const stockLabels: Record<StockStatus, string> = {
  normal: '在庫あり',
  low: '欠品間近',
  out: '欠品',
}

const stockColors: Record<StockStatus, string> = {
  normal: 'bg-bone text-matcha',
  low: 'bg-bone text-[#a87b1e]',
  out: 'bg-alert/10 text-alert',
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
  negotiating: 'bg-bone text-[#a87b1e]',
  confirmed: 'bg-bone text-matcha',
  cancelled: 'bg-bone text-graphite',
}

export function SalesStatusBadge({ status }: { status: SaleStatus }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${salesColors[status]}`}>
      {salesLabels[status]}
    </span>
  )
}
