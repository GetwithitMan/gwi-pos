import { describe, it, expect } from 'vitest'
import { OrderStatus } from '@/generated/prisma/enums'
import { VALID_TRANSITIONS, TERMINAL_STATUSES, validateTransition } from '../transitions'

describe('Order Status Transitions', () => {
  it('transition map covers every OrderStatus value (exhaustiveness)', () => {
    const allStatuses = Object.values(OrderStatus)
    for (const status of allStatuses) {
      expect(VALID_TRANSITIONS).toHaveProperty(status)
    }
  })

  it('terminal statuses have empty or single-reopen transition arrays', () => {
    for (const status of TERMINAL_STATUSES) {
      const transitions = VALID_TRANSITIONS[status]
      // voided can reopen to 'open'; all others must be empty
      if (status === 'voided') {
        expect(transitions).toEqual(['open'])
      } else {
        expect(transitions).toEqual([])
      }
    }
  })

  it('voided → open transition is valid (manager reopen)', () => {
    const result = validateTransition('voided', 'open')
    expect(result.valid).toBe(true)
  })

  it('rejects unknown status in transition validation', () => {
    const result = validateTransition('nonexistent_status', 'open')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Unknown order status')
  })
})
