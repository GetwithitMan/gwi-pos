'use client'

export interface OrderCardInfo {
  id: string
  cardType: string
  cardLast4: string
  cardholderName?: string | null
  isDefault: boolean
  status: string       // authorized | captured | declined | voided
  authAmount: number
  recordNo?: string | null
}

interface MultiCardBadgesProps {
  cards: OrderCardInfo[]
  /** compact: small pill for tab-list rows */
  compact?: boolean
  /** full: expanded card with all details for selected-tab view */
  full?: boolean
}

// Brand palette — bg / text / border / accent
const BRAND: Record<string, { bg: string; text: string; border: string; logo: string; accentBg: string }> = {
  visa:       { bg: 'bg-blue-950',   text: 'text-blue-200',   border: 'border-blue-700',   logo: 'VISA',   accentBg: 'bg-blue-800'   },
  mastercard: { bg: 'bg-red-950',    text: 'text-red-200',    border: 'border-red-700',    logo: 'MC',     accentBg: 'bg-red-800'    },
  amex:       { bg: 'bg-emerald-950',text: 'text-emerald-200',border: 'border-emerald-700',logo: 'AMEX',   accentBg: 'bg-emerald-800' },
  discover:   { bg: 'bg-orange-950', text: 'text-orange-200', border: 'border-orange-700', logo: 'DISC',   accentBg: 'bg-orange-800'  },
  unknown:    { bg: 'bg-gray-900',   text: 'text-gray-300',   border: 'border-gray-700',   logo: 'CARD',   accentBg: 'bg-gray-800'   },
}

const STATUS_DOT: Record<string, string> = {
  authorized: 'bg-green-400',
  captured:   'bg-blue-400',
  declined:   'bg-red-500',
  voided:     'bg-gray-500',
}

const STATUS_LABEL: Record<string, string> = {
  authorized: 'Auth',
  captured:   'Captured',
  declined:   'Declined',
  voided:     'Voided',
}

/** Truncate a Datacap RecordNo token for display: "DC4:ABCD1234…" */
function truncateRecordNo(recordNo: string): string {
  if (!recordNo) return ''
  // Strip the "DC4:" prefix if present, show first 8 chars
  const body = recordNo.startsWith('DC4:') ? recordNo.slice(4) : recordNo
  return `DC4:${body.slice(0, 8)}…`
}

/** Normalise "LAST/FIRST" Datacap format → "First Last", or just return as-is */
function formatName(name: string): string {
  if (!name) return ''
  if (name.includes('/')) {
    const [last, first] = name.split('/')
    return `${first.trim()} ${last.trim()}`
  }
  return name.trim()
}

function brand(cardType: string) {
  return BRAND[cardType?.toLowerCase()] ?? BRAND.unknown
}

/**
 * Card badge(s) for a tab — three display modes:
 *
 * compact  – single-line pill: [LOGO] •••• 4242  (tab-list rows)
 * default  – pill with name + auth amount + status dot
 * full     – expanded card showing all fields including token
 */
export function MultiCardBadges({ cards, compact = false, full = false }: MultiCardBadgesProps) {
  if (cards.length === 0) return null

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1">
        {cards.map(card => {
          const b = brand(card.cardType)
          const isActive = card.status === 'authorized' || card.status === 'captured'
          return (
            <span
              key={card.id}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium
                ${b.bg} ${b.text} ${b.border} ${!isActive ? 'opacity-40' : ''}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[card.status] ?? 'bg-gray-400'} flex-shrink-0`} />
              <span className="font-bold tracking-wide">{b.logo}</span>
              <span className="opacity-70">••••</span>
              <span>{card.cardLast4}</span>
              {card.isDefault && cards.length > 1 && (
                <span className="opacity-50 text-[9px]">★</span>
              )}
            </span>
          )
        })}
      </div>
    )
  }

  if (full) {
    return (
      <div className="space-y-2">
        {cards.map(card => {
          const b = brand(card.cardType)
          const isActive = card.status === 'authorized' || card.status === 'captured'
          const name = card.cardholderName ? formatName(card.cardholderName) : null

          return (
            <div
              key={card.id}
              className={`rounded-xl border px-3 py-2.5 ${b.bg} ${b.border} ${!isActive ? 'opacity-50' : ''}`}
            >
              {/* Row 1: Logo chip + name + default star + amount */}
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-black tracking-widest ${b.accentBg} ${b.text}`}>
                  {b.logo}
                </span>
                <span className={`text-sm font-semibold ${b.text} truncate flex-1`}>
                  {name ?? `•••• ${card.cardLast4}`}
                </span>
                {card.isDefault && cards.length > 1 && (
                  <span className="text-[10px] opacity-60 font-medium">DEFAULT</span>
                )}
                <span className={`text-sm font-bold ${b.text}`}>
                  ${card.authAmount.toFixed(2)}
                </span>
              </div>

              {/* Row 2: •••• last4 + status */}
              <div className="flex items-center gap-2 mt-1">
                <span className={`font-mono text-xs opacity-60 ${b.text}`}>
                  •••• •••• •••• {card.cardLast4}
                </span>
                <span className="flex-1" />
                <span className={`flex items-center gap-1 text-[10px] font-medium ${b.text} opacity-80`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[card.status] ?? 'bg-gray-400'}`} />
                  {STATUS_LABEL[card.status] ?? card.status}
                </span>
              </div>

              {/* Row 3: RecordNo token (if present) */}
              {card.recordNo && (
                <div className={`mt-1.5 pt-1.5 border-t ${b.border} flex items-center gap-1`}>
                  <span className={`text-[9px] uppercase tracking-wider opacity-40 ${b.text}`}>Token</span>
                  <span className={`font-mono text-[10px] opacity-50 ${b.text}`}>
                    {truncateRecordNo(card.recordNo)}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  // Default: medium pill — name + last4 + amount + status dot
  return (
    <div className="flex flex-wrap gap-1.5">
      {cards.map(card => {
        const b = brand(card.cardType)
        const isActive = card.status === 'authorized' || card.status === 'captured'
        const name = card.cardholderName ? formatName(card.cardholderName) : null

        return (
          <div
            key={card.id}
            className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs
              ${b.bg} ${b.text} ${b.border} ${!isActive ? 'opacity-40 line-through' : ''}`}
          >
            {/* Status dot */}
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[card.status] ?? 'bg-gray-400'}`} />

            {/* Brand logo chip */}
            <span className={`rounded px-1 text-[9px] font-black tracking-widest ${b.accentBg}`}>
              {b.logo}
            </span>

            {/* Name or masked PAN */}
            {name ? (
              <span className="font-medium max-w-[100px] truncate">{name}</span>
            ) : null}

            {/* Last 4 */}
            <span className="font-mono opacity-70">••{card.cardLast4}</span>

            {/* Auth hold */}
            <span className="opacity-60">${card.authAmount.toFixed(0)}</span>

            {/* Default star for multi-card tabs */}
            {card.isDefault && cards.length > 1 && (
              <span className="opacity-50 text-[10px]">★</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Single-card summary pill — convenience wrapper for tab headers with exactly one card */
export function CardPill({ card }: { card: OrderCardInfo }) {
  return <MultiCardBadges cards={[card]} />
}
