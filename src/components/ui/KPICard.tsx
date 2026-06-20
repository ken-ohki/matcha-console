interface KPICardProps {
  title: string
  value: number | string
  color?: 'default' | 'green' | 'amber' | 'red' | 'violet'
  icon?: React.ReactNode
}

// Swiss style: hairline panel + a thin left accent that carries the semantic
// tone (matcha/alert/etc). The value stays monochrome ink.
const toneBorder = {
  default: 'border-l-mist',
  green: 'border-l-matcha',
  amber: 'border-l-[#a87b1e]',
  red: 'border-l-alert',
  violet: 'border-l-[#5e44a8]',
}

export function KPICard({ title, value, color = 'default', icon }: KPICardProps) {
  return (
    <div className={`panel border-l-2 ${toneBorder[color]} p-bl-3`}>
      <div className="mb-bl flex items-center justify-between">
        <p className="text-xs text-mist">{title}</p>
        {icon && <span className="text-mist">{icon}</span>}
      </div>
      <p className="text-2xl font-display font-bold tracking-tighter2 text-ink">{value}</p>
    </div>
  )
}
