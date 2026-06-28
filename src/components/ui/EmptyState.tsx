import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Shared empty-state for lists/tables — one consistent look instead of the ad-hoc
 * per-page markup. Default is a bordered, centered panel (the dominant existing
 * style). Use `variant="plain"` for a borderless inline note, `action` for a CTA,
 * and `<EmptyTableRow>` inside a <tbody>.
 */
export function EmptyState({
  message,
  description,
  icon: Icon,
  action,
  variant = 'panel',
  compact = false,
  className = '',
}: {
  message: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  action?: ReactNode
  variant?: 'panel' | 'plain'
  compact?: boolean
  className?: string
}) {
  if (variant === 'plain') {
    return <p className={`text-center text-sm text-mist ${className}`}>{message}</p>
  }
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl border border-line bg-white text-center ${compact ? 'px-4 py-6' : 'px-4 py-12'} ${className}`}
    >
      {Icon && <Icon size={32} className="text-line" aria-hidden />}
      <p className="text-sm text-mist">{message}</p>
      {description && <p className="text-xs text-mist">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

/** Empty-state as a full-width table row (use inside <tbody>). */
export function EmptyTableRow({
  colSpan,
  message,
  className = '',
}: {
  colSpan: number
  message: ReactNode
  className?: string
}) {
  return (
    <tr>
      <td colSpan={colSpan} className={`px-4 py-12 text-center text-sm text-mist ${className}`}>
        {message}
      </td>
    </tr>
  )
}
