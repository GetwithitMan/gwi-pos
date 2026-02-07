'use client'

interface QuickPickStripProps {
  selectedItemId?: string | null
  selectedItemQty?: number
  selectedCount?: number              // Number of items selected (multi-select)
  onNumberTap: (num: number) => void
  // Multi-select
  multiSelectMode?: boolean
  onToggleMultiSelect?: () => void
  // Coursing controls
  coursingEnabled?: boolean
  courseCount?: number               // How many course buttons to show (default 5)
  activeCourseNumber?: number | null // Currently selected item's course number
  onCourseAssign?: (courseNumber: number) => void
  // Hold & delay
  onHoldToggle?: () => void
  isHeld?: boolean
  // Delay presets — applies to selected item(s)
  onSetDelay?: (minutes: number) => void
  activeDelay?: number | null        // Currently set delay on selected item(s)
}

/**
 * Vertical action strip rendered in the gutter between the menu grid and order panel.
 *
 * Layout (top to bottom):
 *   QTY label → 0-9 number buttons
 *   ─── separator ───
 *   HOLD button
 *   5m / 10m delay buttons (for coursing)
 *   ─── separator ─── (when coursing enabled)
 *   C1, C2, C3... course assignment buttons
 */
export function QuickPickStrip({
  selectedItemId,
  selectedItemQty,
  selectedCount = 0,
  onNumberTap,
  multiSelectMode,
  onToggleMultiSelect,
  coursingEnabled,
  courseCount = 5,
  activeCourseNumber,
  onCourseAssign,
  onHoldToggle,
  isHeld,
  onSetDelay,
  activeDelay,
}: QuickPickStripProps) {
  const isDisabled = !selectedItemId
  const courseNumbers = Array.from({ length: courseCount }, (_, i) => i + 1)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
        padding: '6px 4px',
        background: 'rgba(15, 23, 42, 0.95)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.06)',
        borderRight: '1px solid rgba(255, 255, 255, 0.06)',
        alignItems: 'center',
        justifyContent: 'flex-start',
        width: '44px',
        flexShrink: 0,
        overflowY: 'auto',
      }}
    >
      {/* ── QTY Section ── */}
      <SectionLabel text="QTY" />

      {/* 0 button (remove / set to 0) */}
      <GutterButton
        label="0"
        isActive={selectedItemId && selectedItemQty === 0}
        isDisabled={isDisabled}
        onClick={() => onNumberTap(0)}
        color="red"
      />

      {/* 1-9 number buttons */}
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
        <GutterButton
          key={num}
          label={String(num)}
          isActive={selectedItemId && selectedItemQty === num}
          isDisabled={isDisabled}
          onClick={() => onNumberTap(num)}
          color="purple"
        />
      ))}

      {/* ── Separator ── */}
      <Divider />

      {/* HOLD button */}
      {onHoldToggle && (
        <GutterButton
          label="HLD"
          isActive={isHeld}
          isDisabled={isDisabled}
          onClick={onHoldToggle}
          color="amber"
          fontSize="10px"
        />
      )}

      {/* Delay preset buttons — apply to selected item(s) */}
      {onSetDelay && (
        <>
          <Divider />
          <SectionLabel text="DLY" />
          <GutterButton
            label="5m"
            isActive={activeDelay === 5}
            isDisabled={false}
            onClick={() => onSetDelay(5)}
            color="blue"
            fontSize="11px"
          />
          <GutterButton
            label="10m"
            isActive={activeDelay === 10}
            isDisabled={false}
            onClick={() => onSetDelay(10)}
            color="blue"
            fontSize="11px"
          />
        </>
      )}

      {/* ── Course Section (only when coursing enabled) ── */}
      {coursingEnabled && onCourseAssign && (
        <>
          <Divider />
          <SectionLabel text="CRS" />

          {courseNumbers.map(cn => (
            <GutterButton
              key={`c${cn}`}
              label={`C${cn}`}
              isActive={selectedItemId && activeCourseNumber === cn}
              isDisabled={isDisabled}
              onClick={() => onCourseAssign(cn)}
              color="blue"
              fontSize="11px"
            />
          ))}
        </>
      )}
    </div>
  )
}

// ── Subcomponents ──

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{
      fontSize: '8px',
      fontWeight: 700,
      color: '#64748b',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.05em',
      marginBottom: '1px',
      whiteSpace: 'nowrap',
    }}>
      {text}
    </div>
  )
}

function Divider() {
  return (
    <div style={{
      width: '24px',
      height: '1px',
      background: 'rgba(255, 255, 255, 0.08)',
      margin: '4px 0',
    }} />
  )
}

// Color schemes for different button purposes
const COLORS = {
  purple: {
    activeBorder: 'rgba(168, 85, 247, 0.6)',
    activeBg: 'rgba(168, 85, 247, 0.2)',
    activeText: '#c084fc',
    hoverBg: 'rgba(168, 85, 247, 0.1)',
    hoverBorder: 'rgba(168, 85, 247, 0.3)',
    hoverText: '#c084fc',
  },
  blue: {
    activeBorder: 'rgba(59, 130, 246, 0.6)',
    activeBg: 'rgba(59, 130, 246, 0.2)',
    activeText: '#60a5fa',
    hoverBg: 'rgba(59, 130, 246, 0.1)',
    hoverBorder: 'rgba(59, 130, 246, 0.3)',
    hoverText: '#60a5fa',
  },
  amber: {
    activeBorder: 'rgba(245, 158, 11, 0.6)',
    activeBg: 'rgba(245, 158, 11, 0.2)',
    activeText: '#fbbf24',
    hoverBg: 'rgba(245, 158, 11, 0.1)',
    hoverBorder: 'rgba(245, 158, 11, 0.3)',
    hoverText: '#fbbf24',
  },
  red: {
    activeBorder: 'rgba(239, 68, 68, 0.6)',
    activeBg: 'rgba(239, 68, 68, 0.2)',
    activeText: '#f87171',
    hoverBg: 'rgba(239, 68, 68, 0.1)',
    hoverBorder: 'rgba(239, 68, 68, 0.3)',
    hoverText: '#f87171',
  },
} as const

interface GutterButtonProps {
  label: string
  isActive?: boolean | null | string
  isDisabled?: boolean
  onClick: () => void
  color: keyof typeof COLORS
  fontSize?: string
}

function GutterButton({ label, isActive, isDisabled, onClick, color, fontSize = '16px' }: GutterButtonProps) {
  const scheme = COLORS[color]
  const active = !!isActive

  return (
    <button
      onClick={onClick}
      disabled={!!isDisabled}
      style={{
        width: '36px',
        height: '32px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '8px',
        border: active
          ? `2px solid ${scheme.activeBorder}`
          : '1px solid rgba(255, 255, 255, 0.08)',
        background: active
          ? scheme.activeBg
          : 'rgba(255, 255, 255, 0.04)',
        color: isDisabled
          ? '#334155'
          : active
            ? scheme.activeText
            : '#94a3b8',
        fontSize,
        fontWeight: 600,
        cursor: isDisabled ? 'default' : 'pointer',
        transition: 'all 0.15s ease',
        opacity: isDisabled ? 0.4 : 1,
        padding: 0,
      }}
      onMouseEnter={(e) => {
        if (!isDisabled && !active) {
          e.currentTarget.style.background = scheme.hoverBg
          e.currentTarget.style.borderColor = scheme.hoverBorder
          e.currentTarget.style.color = scheme.hoverText
        }
      }}
      onMouseLeave={(e) => {
        if (!isDisabled && !active) {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)'
          e.currentTarget.style.color = '#94a3b8'
        }
      }}
    >
      {label}
    </button>
  )
}
