/**
 * Notification Template Engine
 *
 * - `renderMessage()` with channel-aware truncation
 * - Variable substitution ({{variableName}})
 * - Numeric pager collision warning via in-memory tracking (Redis when available)
 * - Validation at save time
 */

import { createChildLogger } from '@/lib/logger'
import type { TargetType } from './types'

const log = createChildLogger('notification-template')

// ─── Channel Truncation Limits ──────────────────────────────────────────────

const CHANNEL_MAX_LENGTHS: Partial<Record<TargetType, number>> = {
  guest_pager: 24,     // Numeric pagers: very short
  staff_pager: 24,
  phone_sms: 160,      // Standard SMS segment
  phone_voice: 500,    // TTS limit
  order_screen: 200,   // Display screen
  table_locator: 50,   // Table locator display
}

const DEFAULT_MAX_LENGTH = 500

// ─── Variable Pattern ───────────────────────────────────────────────────────

const VARIABLE_PATTERN = /\{\{(\w+)\}\}/g

// Known template variables
const KNOWN_VARIABLES = new Set([
  'orderNumber',
  'customerName',
  'partySize',
  'locationName',
  'fulfillmentMode',
  'waitMinutes',
  'pagerNumber',
])

// ─── Numeric Pager Collision Tracking ───────────────────────────────────────

// In-memory pager collision window: locationId -> Map<pagerNumber, { subjectId, assignedAt }>
const pagerCollisionWindow = new Map<string, Map<string, { subjectId: string; assignedAt: number }>>()
const COLLISION_WINDOW_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Check for numeric pager number reuse within the collision window.
 * Warns if the same pager number was recently assigned to a different subject.
 */
export function checkPagerCollision(
  locationId: string,
  pagerNumber: string,
  subjectId: string
): { isCollision: boolean; previousSubjectId?: string } {
  let locationMap = pagerCollisionWindow.get(locationId)
  if (!locationMap) {
    locationMap = new Map()
    pagerCollisionWindow.set(locationId, locationMap)
  }

  const now = Date.now()
  const existing = locationMap.get(pagerNumber)

  // Clean up expired entries
  for (const [key, entry] of locationMap) {
    if (now - entry.assignedAt > COLLISION_WINDOW_MS) {
      locationMap.delete(key)
    }
  }

  if (existing && existing.subjectId !== subjectId && now - existing.assignedAt <= COLLISION_WINDOW_MS) {
    log.warn(
      { locationId, pagerNumber, currentSubject: subjectId, previousSubject: existing.subjectId },
      'Pager number collision detected within window'
    )
    // Update to new subject but warn
    locationMap.set(pagerNumber, { subjectId, assignedAt: now })
    return { isCollision: true, previousSubjectId: existing.subjectId }
  }

  locationMap.set(pagerNumber, { subjectId, assignedAt: now })
  return { isCollision: false }
}

// ─── Render ─────────────────────────────────────────────────────────────────

export interface RenderParams {
  template: string
  variables: Record<string, unknown>
  targetType: TargetType
  maxLength?: number | null
}

/**
 * Render a notification message from a template with variable substitution
 * and channel-aware truncation.
 */
export function renderMessage(params: RenderParams): string {
  const { template, variables, targetType, maxLength } = params

  // Substitute variables
  let rendered = template.replace(VARIABLE_PATTERN, (_match, varName) => {
    const value = variables[varName]
    if (value === undefined || value === null) {
      return '' // Missing variables become empty string
    }
    return String(value)
  })

  // Clean up any double spaces from empty substitutions
  rendered = rendered.replace(/\s{2,}/g, ' ').trim()

  // Channel-aware truncation
  const limit = maxLength ?? CHANNEL_MAX_LENGTHS[targetType] ?? DEFAULT_MAX_LENGTH
  if (rendered.length > limit) {
    rendered = rendered.substring(0, limit - 3) + '...'
  }

  return rendered
}

// ─── Validation (at save time) ──────────────────────────────────────────────

export interface TemplateValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  detectedVariables: string[]
}

/**
 * Validate a template body at save time.
 * Checks for:
 * - Unclosed variable tags
 * - Unknown variable names
 * - Empty body
 * - Required variables present
 */
export function validateTemplate(
  body: string,
  requiredVariables: string[] = []
): TemplateValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const detectedVariables: string[] = []

  if (!body || body.trim().length === 0) {
    errors.push('Template body cannot be empty')
    return { valid: false, errors, warnings, detectedVariables }
  }

  // Detect variables used in template
  const matches = body.matchAll(VARIABLE_PATTERN)
  for (const match of matches) {
    const varName = match[1]
    if (!detectedVariables.includes(varName)) {
      detectedVariables.push(varName)
    }
    if (!KNOWN_VARIABLES.has(varName)) {
      warnings.push(`Unknown template variable: {{${varName}}}`)
    }
  }

  // Check for unclosed tags
  const openBraces = (body.match(/\{\{/g) || []).length
  const closeBraces = (body.match(/\}\}/g) || []).length
  if (openBraces !== closeBraces) {
    errors.push('Template has unclosed variable tags (mismatched {{ and }})')
  }

  // Check required variables are present
  for (const required of requiredVariables) {
    if (!detectedVariables.includes(required)) {
      errors.push(`Required variable {{${required}}} is not present in template body`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    detectedVariables,
  }
}

/**
 * Get the channel truncation limit for a target type.
 */
export function getChannelMaxLength(targetType: TargetType): number {
  return CHANNEL_MAX_LENGTHS[targetType] ?? DEFAULT_MAX_LENGTH
}
