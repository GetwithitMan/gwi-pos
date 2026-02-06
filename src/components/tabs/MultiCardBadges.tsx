'use client'

interface OrderCardInfo {
  id: string
  cardType: string
  cardLast4: string
  isDefault: boolean
  status: string  // authorized | declined | captured | voided
  authAmount: number
}

interface MultiCardBadgesProps {
  cards: OrderCardInfo[]
  compact?: boolean  // Compact display for tab list
}

const CARD_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  visa: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
  mastercard: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200' },
  amex: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' },
  discover: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  unknown: { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' },
}

const STATUS_ICONS: Record<string, string> = {
  authorized: '',
  captured: '',
  declined: '',
  voided: '',
}

/**
 * Card badges displayed on tab headers showing all cards on a multi-card tab.
 * Default card shown first with "(default)" label.
 * Each badge shows card brand, last 4, and status.
 */
export function MultiCardBadges({ cards, compact = false }: MultiCardBadgesProps) {
  if (cards.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1">
      {cards.map((card) => {
        const colors = CARD_COLORS[card.cardType.toLowerCase()] || CARD_COLORS.unknown
        const statusIcon = STATUS_ICONS[card.status] || ''
        const isActive = card.status === 'authorized' || card.status === 'captured'

        return (
          <span
            key={card.id}
            className={`
              inline-flex items-center gap-1 text-xs rounded-full border px-2 py-0.5
              ${colors.bg} ${colors.text} ${colors.border}
              ${!isActive ? 'opacity-50 line-through' : ''}
              ${compact ? 'text-[10px] px-1.5 py-0' : ''}
            `}
          >
            {statusIcon && <span>{statusIcon}</span>}
            <span className="font-medium">{formatCardBrand(card.cardType)}</span>
            <span>...{card.cardLast4}</span>
            {card.isDefault && !compact && (
              <span className="text-[9px] opacity-60">(default)</span>
            )}
          </span>
        )
      })}
    </div>
  )
}

function formatCardBrand(cardType: string): string {
  const brands: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'MC',
    amex: 'Amex',
    discover: 'Disc',
  }
  return brands[cardType.toLowerCase()] || cardType
}
