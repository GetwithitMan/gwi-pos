/**
 * Berg modifier byte parser and variant resolver.
 *
 * ECUs that use modifier bytes send them as hex bytes BEFORE the PLU digits in the packet.
 * These are stored in BergDispenseEvent.modifierBytes as a hex string.
 *
 * The BergPluMapping.modifierRule JSON defines how to interpret them:
 * {
 *   "A0": { "label": "Short",  "multiplier": 0.75 },
 *   "A1": { "label": "Single", "multiplier": 1.0 },
 *   "A2": { "label": "Double", "multiplier": 2.0, "menuItemId": "menu_123" },
 *   "B0-05": { "label": "Tall", "oz": 2.0 }
 * }
 *
 * Key format: uppercase hex bytes joined by "-" (no 0x prefix), e.g. "A0" or "B0-05"
 */

export interface ModifierRule {
  label: string
  multiplier?: number
  oz?: number
  menuItemId?: string
}

export interface ParsedModifierKey {
  key: string | null
  invalidReason?: string
}

export interface ResolvedVariant {
  variantKey: string | null
  variantLabel: string | null
  ozResolved: number | null
  menuItemIdOverride: string | null
  resolutionStatus: 'NONE' | 'PARTIAL' | 'FULL'
}

const FORBIDDEN_BYTES = new Set(['00', '02', '03'])
const MAX_BYTES = 4
const HEX_BYTE_RE = /^[0-9A-F]{2}$/

/**
 * Normalize a raw modifierBytes hex string to canonical key format.
 * Input: "0xa0", "A0 05", "a005", "0xA0 0x05" etc.
 * Output: "A0" or "A0-05" (uppercase, byte-separated by "-")
 */
export function parseModifierKey(modifierBytesHex?: string | null): ParsedModifierKey {
  if (!modifierBytesHex || modifierBytesHex.trim() === '') {
    return { key: null }
  }

  // Strip "0x" prefixes and spaces, uppercase
  const cleaned = modifierBytesHex
    .replace(/0x/gi, '')
    .replace(/\s+/g, '')
    .toUpperCase()

  if (cleaned === '') {
    return { key: null }
  }

  // Validate all hex
  if (!/^[0-9A-F]+$/.test(cleaned)) {
    return { key: null, invalidReason: 'Non-hex characters found' }
  }

  // Must be even number of chars (complete bytes)
  if (cleaned.length % 2 !== 0) {
    return { key: null, invalidReason: 'Odd number of hex characters' }
  }

  // Split into 2-char bytes
  const bytes: string[] = []
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes.push(cleaned.substring(i, i + 2))
  }

  // Max 4 bytes
  if (bytes.length > MAX_BYTES) {
    return { key: null, invalidReason: `Exceeds max ${MAX_BYTES} bytes` }
  }

  // Check forbidden bytes
  for (const b of bytes) {
    if (FORBIDDEN_BYTES.has(b)) {
      return { key: null, invalidReason: `Forbidden byte 0x${b}` }
    }
  }

  return { key: bytes.join('-') }
}

/**
 * Resolve pour size variant from modifier bytes against a mapping's modifierRule.
 */
export function resolveVariant(
  modifierRule: unknown,
  modifierBytesHex: string | null | undefined,
  baseOz: number,
  _baseCostPerOz?: number | null
): ResolvedVariant {
  const none: ResolvedVariant = {
    variantKey: null,
    variantLabel: null,
    ozResolved: baseOz,
    menuItemIdOverride: null,
    resolutionStatus: 'NONE',
  }

  // No modifier bytes → NONE
  if (!modifierBytesHex || modifierBytesHex.trim() === '') {
    return none
  }

  // No modifier rule → NONE
  if (!modifierRule || typeof modifierRule !== 'object') {
    return none
  }

  const parsed = parseModifierKey(modifierBytesHex)
  if (!parsed.key) {
    return none
  }

  const rules = modifierRule as Record<string, ModifierRule>
  const rule = rules[parsed.key]

  if (!rule) {
    // Key seen but no matching rule
    return {
      variantKey: parsed.key,
      variantLabel: null,
      ozResolved: baseOz,
      menuItemIdOverride: null,
      resolutionStatus: 'PARTIAL',
    }
  }

  // oz takes precedence over multiplier
  const ozResolved = rule.oz != null
    ? rule.oz
    : baseOz * (rule.multiplier ?? 1.0)

  return {
    variantKey: parsed.key,
    variantLabel: rule.label ?? null,
    ozResolved,
    menuItemIdOverride: rule.menuItemId ?? null,
    resolutionStatus: 'FULL',
  }
}
