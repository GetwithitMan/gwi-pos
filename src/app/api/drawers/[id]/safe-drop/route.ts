import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { queueIfOutage, pushUpstream } from '@/lib/sync/outage-safe-write'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('drawers-safe-drop')

/**
 * POST /api/drawers/[id]/safe-drop
 *
 * Record a mid-shift safe drop (move cash from drawer to safe).
 * Creates a PaidInOut record with type='out' and reason prefixed with '[SAFE DROP]'.
 *
 * Body: {
 *   shiftId: string       — active shift for this drawer
 *   amount: number         — drop amount (must be > 0)
 *   reason?: string        — optional additional reason text
 *   employeeId: string     — employee performing the drop
 *   witnessEmployeeId?: string — optional witness (required if settings mandate it)
 * }
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: drawerId } = await params
    const body = await request.json()
    const {
      shiftId,
      amount,
      reason,
      employeeId,
      witnessEmployeeId,
    } = body as {
      shiftId: string
      amount: number
      reason?: string
      employeeId: string
      witnessEmployeeId?: string
    }

    // ── Validation ────────────────────────────────────────────────────
    if (!employeeId) {
      return err('Employee ID is required')
    }
    if (!shiftId) {
      return err('Shift ID is required')
    }
    if (!amount || Number(amount) <= 0) {
      return err('Amount must be greater than 0')
    }

    // ── Drawer exists? ───────────────────────────────────────────────
    const drawer = await db.drawer.findFirst({
      where: { id: drawerId, isActive: true, deletedAt: null },
      select: { id: true, name: true, locationId: true },
    })
    if (!drawer) {
      return notFound('Drawer not found')
    }

    // ── Permission check ─────────────────────────────────────────────
    const auth = await requirePermission(employeeId, drawer.locationId, PERMISSIONS.MGR_PAY_IN_OUT)
    if (!auth.authorized) {
      return err(auth.error, auth.status)
    }

    // ── Shift is open? ───────────────────────────────────────────────
    const shift = await db.shift.findFirst({
      where: { id: shiftId, status: 'open', deletedAt: null },
      select: { id: true, drawerId: true, locationId: true },
    })
    if (!shift) {
      return err('Shift not found or already closed')
    }

    // ── Load cash management settings ────────────────────────────────
    const locationSettings = parseSettings(await getLocationSettings(drawer.locationId))
    const cashMgmt = locationSettings.cashManagement

    // Max drop amount check
    if (cashMgmt && Number(amount) > cashMgmt.maxDropAmount) {
      return err(`Drop amount exceeds maximum of $${cashMgmt.maxDropAmount.toFixed(2)}`)
    }

    // Witness requirement check
    if (cashMgmt?.requireWitnessForDrops && !witnessEmployeeId) {
      return err('A witness employee is required for safe drops')
    }

    // Validate witness exists if provided
    if (witnessEmployeeId) {
      const witness = await db.employee.findFirst({
        where: { id: witnessEmployeeId, locationId: drawer.locationId, isActive: true, deletedAt: null },
        select: { id: true },
      })
      if (!witness) {
        return err('Witness employee not found')
      }
    }

    // ── Create PaidInOut record ──────────────────────────────────────
    const dropReason = `[SAFE DROP]${reason ? ` ${reason.trim()}` : ''}`

    const record = await db.paidInOut.create({
      data: {
        locationId: drawer.locationId,
        drawerId,
        type: 'out',
        amount: Number(amount),
        reason: dropReason,
        reference: witnessEmployeeId ? `witness:${witnessEmployeeId}` : null,
        employeeId,
        approvedBy: witnessEmployeeId || null,
      },
      include: {
        employee: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
        drawer: {
          select: { id: true, name: true },
        },
      },
    })

    // Queue for Neon replay if in outage mode (fire-and-forget)
    queueIfOutage('PaidInOut', drawer.locationId, record.id, 'INSERT', record as unknown as Record<string, unknown>)
    pushUpstream()

    // ── Audit log ────────────────────────────────────────────────────
    void db.auditLog.create({
      data: {
        locationId: drawer.locationId,
        employeeId,
        action: 'safe_drop',
        entityType: 'drawer',
        entityId: drawerId,
        details: {
          shiftId,
          amount: Number(amount),
          reason: dropReason,
          witnessEmployeeId: witnessEmployeeId || null,
          drawerId,
          drawerName: drawer.name,
        },
      },
    }).catch(err => log.warn({ err }, 'Background task failed'))

    // ── Socket event (fire-and-forget) ───────────────────────────────
    const empName = record.employee.displayName
      || `${record.employee.firstName} ${record.employee.lastName}`

    void emitToLocation(drawer.locationId, 'drawer:safe-drop', {
      id: record.id,
      amount: Number(record.amount),
      employeeId: record.employeeId,
      employeeName: empName,
      drawerId: record.drawerId,
      drawerName: record.drawer.name,
      reason: dropReason,
      createdAt: record.createdAt.toISOString(),
    }).catch(err => log.warn({ err }, 'Background task failed'))

    return ok({
        id: record.id,
        amount: Number(record.amount),
        reason: record.reason,
        employeeId: record.employeeId,
        employeeName: empName,
        drawerId: record.drawerId,
        drawerName: record.drawer.name,
        witnessEmployeeId: witnessEmployeeId || null,
        createdAt: record.createdAt.toISOString(),
      })
  } catch (error) {
    console.error('[SafeDrop API] Error:', error)
    return err('Failed to record safe drop', 500)
  }
})
