interface KPICardProps {
  title: string
  value: number | string
  color?: 'default' | 'green' | 'amber' | 'red' | 'violet'
  icon?: React.ReactNode
}

const colorMap = {
  default: 'bg-white border-[#d9d1be] text-gray-900',
  green: 'bg-[#eff8f0] border-[#b7d7be] text-[#174c33]',
  amber: 'bg-[#fff6e5] border-[#f1d7a2] text-[#8d5b08]',
  red: 'bg-[#fff0ec] border-[#efc3b5] text-[#9d3d28]',
  violet: 'bg-[#f6efff] border-[#d9c7f8] text-[#6b3db5]',
}

const valueColorMap = {
  default: 'text-gray-900',
  green: 'text-[#174c33]',
  amber: 'text-[#8d5b08]',
  red: 'text-[#9d3d28]',
  violet: 'text-[#6b3db5]',
}

export function KPICard({ title, value, color = 'default', icon }: KPICardProps) {
  return (
    <div className={`rounded-2xl border-2 p-5 shadow-sm ${colorMap[color]}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-medium opacity-75">{title}</p>
        {icon && <span className="opacity-60">{icon}</span>}
      </div>
      <p className={`text-3xl font-bold ${valueColorMap[color]}`}>{value}</p>
    </div>
  )
}
