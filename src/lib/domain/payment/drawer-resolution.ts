/**
 * Drawer Resolution
 *
 * Resolves which cash drawer and shift should be attributed for a payment.
 */

import { db } from '@/lib/db'
import type { DrawerAttribution } from './types'

/**
 * Resolve which drawer and shift should be attributed for a cash payment.
 *
 * Priority:
 * 1. If terminal has a physical drawer, use it (+ the shift that claimed it)
 * 2. Fall back to the processing employee's own open shift/drawer
 *
 * Card payments return nulls (no drawer attribution needed).
 */
export async function resolveDrawerForPayment(
  paymentMethod: string,
  processingEmployeeId: string | null,
  terminalId?: string,
): Promise<DrawerAttribution> {
  // Card payments: no drawer attribution
  if (paymentMethod !== 'cash') {
    return { drawerId: null, shiftId: null }
  }

  // 1. If terminal has a physical drawer, use it
  if (terminalId) {
    const drawer = await db.drawer.findFirst({
      where: { deviceId: terminalId, isActive: true, deletedAt: null },
      select: { id: true },
    })
    if (drawer) {
      const ownerShift = await db.shift.findFirst({
        where: { drawerId: drawer.id, status: 'open', deletedAt: null },
        select: { id: true },
      })
      return { drawerId: drawer.id, shiftId: ownerShift?.id ?? null }
    }
  }

  // 2. Fall back to the processing employee's own shift
  if (processingEmployeeId) {
    const employeeShift = await db.shift.findFirst({
      where: { employeeId: processingEmployeeId, status: 'open', deletedAt: null },
      select: { id: true, drawerId: true },
    })
    if (employeeShift) {
      return {
        drawerId: employeeShift.drawerId ?? null,
        shiftId: employeeShift.id,
      }
    }
  }

  return { drawerId: null, shiftId: null }
}
