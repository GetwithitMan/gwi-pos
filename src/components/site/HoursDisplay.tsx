/**
 * HoursDisplay — Renders venue operating hours as a Mon–Sun grid.
 *
 * Highlights today's row, shows "Open Now" / "Closed Now" badge,
 * and collapses to "Daily" when all hours are identical.
 * Server component — no interactivity needed.
 */

interface HourEntry {
  day: number // 0 = Sunday, 6 = Saturday
  open: string // "11:00" (24h)
  close: string // "22:00" (24h)
  closed: boolean
}

interface HoursDisplayProps {
  hours: HourEntry[]
  compact?: boolean
  isCurrentlyOpen?: boolean
  timezone?: string
}

const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hour}:${String(m).padStart(2, '0')} ${period}`
}

function allHoursIdentical(hours: HourEntry[]): boolean {
  const nonClosed = hours.filter((h) => !h.closed)
  if (nonClosed.length === 0) return false
  if (nonClosed.length !== 7) return false // Some days closed, not uniform
  return nonClosed.every(
    (h) => h.open === nonClosed[0].open && h.close === nonClosed[0].close
  )
}

export function HoursDisplay({ hours, compact, isCurrentlyOpen }: HoursDisplayProps) {
  if (hours.length === 0) return null

  // Sort by day (0-6, Sun-Sat) for display as Mon-Sun
  const sortedHours = [...hours].sort((a, b) => {
    // Reorder: Mon=1, Tue=2, ..., Sat=6, Sun=0 → Mon first
    const orderA = a.day === 0 ? 7 : a.day
    const orderB = b.day === 0 ? 7 : b.day
    return orderA - orderB
  })

  const today = new Date().getDay() // 0 = Sunday

  // Check if all hours are the same — show condensed
  if (allHoursIdentical(hours)) {
    const sample = hours.find((h) => !h.closed)!
    return (
      <div className={compact ? 'text-sm' : ''}>
        {!compact && isCurrentlyOpen !== undefined && (
          <OpenBadge isOpen={isCurrentlyOpen} />
        )}
        <p
          className={`${compact ? 'text-sm' : 'text-base'} font-medium text-center`}
          style={{ color: 'var(--site-text)' }}
        >
          Daily: {formatTime(sample.open)} – {formatTime(sample.close)}
        </p>
      </div>
    )
  }

  return (
    <div className={compact ? 'text-sm' : ''}>
      {!compact && isCurrentlyOpen !== undefined && (
        <OpenBadge isOpen={isCurrentlyOpen} />
      )}

      <div className="space-y-1">
        {sortedHours.map((h) => {
          const isToday = h.day === today
          return (
            <div
              key={h.day}
              className={`flex justify-between items-center py-1.5 px-3 rounded transition-colors ${
                compact ? 'py-1 px-2' : ''
              }`}
              style={
                isToday
                  ? {
                      backgroundColor: 'color-mix(in srgb, var(--site-brand) 10%, transparent)',
                      borderLeft: '3px solid var(--site-brand)',
                    }
                  : {
                      borderBottom: '1px solid var(--site-border)',
                    }
              }
            >
              {/* Day name: full on md+, abbreviated on mobile */}
              <span
                className={`font-medium ${isToday ? '' : ''}`}
                style={isToday ? { color: 'var(--site-brand)' } : { color: 'var(--site-text)' }}
              >
                <span className="hidden md:inline">{DAY_NAMES_FULL[h.day]}</span>
                <span className="md:hidden">{DAY_NAMES_SHORT[h.day]}</span>
                {isToday && !compact && (
                  <span className="ml-2 text-xs opacity-70">(Today)</span>
                )}
              </span>

              <span style={{ color: h.closed ? 'var(--site-text-muted)' : 'var(--site-text)' }}>
                {h.closed ? 'Closed' : `${formatTime(h.open)} – ${formatTime(h.close)}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function OpenBadge({ isOpen }: { isOpen: boolean }) {
  return (
    <div className="flex justify-center mb-4">
      <span
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium"
        style={{
          backgroundColor: isOpen
            ? 'rgba(34, 197, 94, 0.1)'
            : 'rgba(239, 68, 68, 0.1)',
          color: isOpen ? '#16a34a' : '#dc2626',
        }}
      >
        <span
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: isOpen ? '#16a34a' : '#dc2626' }}
        />
        {isOpen ? 'Open Now' : 'Closed Now'}
      </span>
    </div>
  )
}
