'use client'

/**
 * OpenEntryInput — Free-text special instructions input for modifier groups.
 *
 * Max 200 characters, strips control characters on change,
 * trims and collapses whitespace on blur. No price impact.
 */

interface OpenEntryInputProps {
  groupId: string
  value: string
  onChange: (groupId: string, value: string) => void
}

const MAX_CHARS = 200

/** Strip control characters (keep newlines/tabs for paste scenarios, but collapse later) */
function stripControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

/** Trim and collapse internal whitespace runs to single space */
function normalizeWhitespace(s: string): string {
  return s.trim().replace(/\s+/g, ' ')
}

export function OpenEntryInput({ groupId, value, onChange }: OpenEntryInputProps) {
  const remaining = MAX_CHARS - value.length

  return (
    <div className="mt-3">
      <textarea
        value={value}
        onChange={(e) => {
          const cleaned = stripControlChars(e.target.value)
          if (cleaned.length <= MAX_CHARS) {
            onChange(groupId, cleaned)
          }
        }}
        onBlur={() => {
          const normalized = normalizeWhitespace(value)
          if (normalized !== value) {
            onChange(groupId, normalized)
          }
        }}
        placeholder="Special instructions..."
        maxLength={MAX_CHARS}
        rows={2}
        className="w-full rounded-lg border px-3 py-2.5 text-sm resize-none transition-colors focus:outline-none focus:ring-2"
        style={{
          borderColor: 'var(--site-border)',
          backgroundColor: 'var(--site-bg)',
          color: 'var(--site-text)',
          // focus ring uses brand color via inline since we can't do focus: with CSS vars in tailwind
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--site-brand)'
        }}
        onBlurCapture={(e) => {
          e.currentTarget.style.borderColor = 'var(--site-border)'
        }}
      />
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs" style={{ color: 'var(--site-text-muted)' }}>
          No additional charge
        </span>
        <span
          className="text-xs"
          style={{ color: remaining < 20 ? 'var(--site-brand)' : 'var(--site-text-muted)' }}
        >
          {remaining}/{MAX_CHARS}
        </span>
      </div>
    </div>
  )
}
