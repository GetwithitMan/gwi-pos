'use client'

import type { StockStatus } from '@/lib/stock-status'

interface StockBadgeProps {
  status: StockStatus
  count?: number | null
  ingredientName?: string | null
  className?: string
}

/**
 * Visual badge showing stock level status on menu items
 *
 * Displays color-coded badges:
 * - Critical (red): Very low stock, urgent attention needed
 * - Low (amber): Running low, should restock soon
 * - Out (dark red): No stock available
 * - OK: No badge shown (enough stock)
 */
export function StockBadge({ status, count, ingredientName, className = '' }: StockBadgeProps) {
  // Don't show badge for OK status
  if (status === 'ok') return null

  const styles = {
    critical: 'bg-red-500/90 text-white border-red-400/50',
    low: 'bg-amber-500/90 text-white border-amber-400/50',
    out: 'bg-red-700/95 text-white border-red-600/50',
  }

  const text = status === 'out'
    ? 'OUT'
    : count !== null && count !== undefined && count > 0
      ? `${Math.floor(count)} LEFT`
      : status.toUpperCase()

  return (
    <div
      className={`absolute top-1 right-1 ${styles[status]} text-xs px-2 py-0.5 rounded shadow-lg font-bold border backdrop-blur-sm z-10 ${className}`}
      title={ingredientName ? `${ingredientName}: ${count ?? 0} remaining` : undefined}
    >
      {text}
    </div>
  )
}
