/**
 * Table Ownership Domain Logic (Skill 253 - Phase 4)
 *
 * When two or more servers share a table, tips need to be split proportionally.
 * The OrderOwnership system tracks which employees co-own an order and their
 * share percentages.
 *
 * Core operations:
 *   - getActiveOwnership()         -- Read the current ownership split for an order
 *   - addOrderOwner()              -- Add a server to an order's ownership
 *   - removeOrderOwner()           -- Remove a server from an order's ownership
 *   - updateOwnershipSplits()      -- Manually adjust split percentages
 *   - adjustAllocationsByOwnership -- Pure function to distribute tip cents by ownership
 */

import { db } from '@/lib/db'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OwnershipInfo {
  id: string
  orderId: string
  isActive: boolean
  owners: Array<{
    id: string
    employeeId: string
    firstName: string
    lastName: string
    displayName: string | null
    sharePercent: number
  }>
}

export interface OwnershipAllocation {
  employeeId: string
  sharePercent: number
  amountCents: number
}

// ─── Core Functions ──────────────────────────────────────────────────────────

/**
 * Get the current active ownership for an order.
 *
 * Returns null if no active ownership record exists (single-server order).
 * Includes employee name data for display purposes.
 *
 * @param orderId - The order to look up ownership for
 * @returns The active ownership with owner details, or null
 */
export async function getActiveOwnership(
  orderId: string
): Promise<OwnershipInfo | null> {
  const ownership = await db.orderOwnership.findFirst({
    where: {
      orderId,
      isActive: true,
      deletedAt: null,
    },
    include: {
      owners: {
        include: {
          employee: {
            select: {
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      },
    },
  })

  if (!ownership) return null

  return mapToOwnershipInfo(ownership)
}

/**
 * Add a server to an order's ownership split.
 *
 * If no active ownership exists yet, one is created. When splitType is 'even',
 * all existing owners are recalculated to equal shares. When splitType is
 * 'custom', the new owner gets the specified percentage and existing owners
 * are adjusted proportionally.
 *
 * @throws {'ALREADY_OWNER'} If the employee already owns a share of this order
 */
export async function addOrderOwner(params: {
  locationId: string
  orderId: string
  employeeId: string
  createdById: string
  splitType: 'even' | 'custom'
  customPercent?: number
}): Promise<OwnershipInfo> {
  const { locationId, orderId, employeeId, createdById, splitType, customPercent } = params

  return db.$transaction(async (tx) => {
    // Get or create the active ownership record
    let ownership = await tx.orderOwnership.findFirst({
      where: {
        orderId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        owners: {
          include: {
            employee: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        },
      },
    })

    if (!ownership) {
      // Create a new ownership record
      ownership = await tx.orderOwnership.create({
        data: {
          locationId,
          orderId,
          createdById,
          isActive: true,
        },
        include: {
          owners: {
            include: {
              employee: {
                select: {
                  firstName: true,
                  lastName: true,
                  displayName: true,
                },
              },
            },
          },
        },
      })
    }

    // Check for duplicate owner
    const alreadyOwner = ownership.owners.some(
      (o) => o.employeeId === employeeId
    )
    if (alreadyOwner) {
      throw new Error('ALREADY_OWNER')
    }

    // Add the new owner entry (placeholder percent, will be adjusted below)
    await tx.orderOwnershipEntry.create({
      data: {
        orderOwnershipId: ownership.id,
        employeeId,
        sharePercent: 0,
      },
    })

    // Re-fetch all owners after adding the new one
    const allEntries = await tx.orderOwnershipEntry.findMany({
      where: { orderOwnershipId: ownership.id },
    })

    const totalOwners = allEntries.length

    if (splitType === 'even') {
      // Recalculate all owners to equal shares
      const evenSplits = buildEvenSplits(totalOwners)
      for (let i = 0; i < allEntries.length; i++) {
        await tx.orderOwnershipEntry.update({
          where: { id: allEntries[i].id },
          data: { sharePercent: evenSplits[i] },
        })
      }
    } else {
      // Custom percent for the new owner; adjust others proportionally
      const newPercent = customPercent ?? 0
      const remainingPercent = 100 - newPercent

      // Find the new entry (the one we just added)
      const newEntry = allEntries.find((e) => e.employeeId === employeeId)!
      const existingEntries = allEntries.filter((e) => e.employeeId !== employeeId)

      // Set the new owner's percent
      await tx.orderOwnershipEntry.update({
        where: { id: newEntry.id },
        data: { sharePercent: newPercent },
      })

      // Calculate proportional adjustment for existing owners
      const currentTotal = existingEntries.reduce(
        (sum, e) => sum + e.sharePercent,
        0
      )

      if (currentTotal > 0 && existingEntries.length > 0) {
        // Scale existing owners proportionally to fill remainingPercent
        let allocated = 0
        for (let i = 0; i < existingEntries.length; i++) {
          const entry = existingEntries[i]

          if (i === existingEntries.length - 1) {
            // Last owner absorbs rounding remainder
            const adjustedPercent =
              Math.round((remainingPercent - allocated) * 100) / 100
            await tx.orderOwnershipEntry.update({
              where: { id: entry.id },
              data: { sharePercent: adjustedPercent },
            })
          } else {
            const ratio = entry.sharePercent / currentTotal
            const adjustedPercent =
              Math.round(remainingPercent * ratio * 100) / 100
            allocated += adjustedPercent
            await tx.orderOwnershipEntry.update({
              where: { id: entry.id },
              data: { sharePercent: adjustedPercent },
            })
          }
        }
      } else if (existingEntries.length > 0) {
        // All existing owners had 0% — distribute remainder evenly
        const evenSplits = buildEvenSplits(existingEntries.length)
        const scaledSplits = evenSplits.map(
          (s) => Math.round(s * (remainingPercent / 100) * 100) / 100
        )
        // Adjust last to absorb rounding
        const scaledSum = scaledSplits
          .slice(0, -1)
          .reduce((a, b) => a + b, 0)
        scaledSplits[scaledSplits.length - 1] =
          Math.round((remainingPercent - scaledSum) * 100) / 100

        for (let i = 0; i < existingEntries.length; i++) {
          await tx.orderOwnershipEntry.update({
            where: { id: existingEntries[i].id },
            data: { sharePercent: scaledSplits[i] },
          })
        }
      }
    }

    // Re-fetch the final state with employee details
    const final = await tx.orderOwnership.findFirst({
      where: { id: ownership.id },
      include: {
        owners: {
          include: {
            employee: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        },
      },
    })

    return mapToOwnershipInfo(final!)
  })
}

/**
 * Remove a server from an order's ownership split.
 *
 * If only one owner remains after removal, they get 100%. If no owners remain,
 * the ownership record is deactivated and null is returned. With 2+ remaining
 * owners, an even split is recalculated.
 *
 * @returns Updated ownership info, or null if ownership was deactivated
 */
export async function removeOrderOwner(params: {
  orderId: string
  employeeId: string
}): Promise<OwnershipInfo | null> {
  const { orderId, employeeId } = params

  return db.$transaction(async (tx) => {
    const ownership = await tx.orderOwnership.findFirst({
      where: {
        orderId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        owners: true,
      },
    })

    if (!ownership) return null

    // Find the entry to remove
    const entryToRemove = ownership.owners.find(
      (o) => o.employeeId === employeeId
    )
    if (!entryToRemove) return mapToOwnershipInfoMinimal(ownership)

    // Delete the entry
    await tx.orderOwnershipEntry.delete({
      where: { id: entryToRemove.id },
    })

    // Get remaining owners
    const remaining = await tx.orderOwnershipEntry.findMany({
      where: { orderOwnershipId: ownership.id },
    })

    if (remaining.length === 0) {
      // No owners left — deactivate
      await tx.orderOwnership.update({
        where: { id: ownership.id },
        data: { isActive: false },
      })
      return null
    }

    if (remaining.length === 1) {
      // Single owner gets 100%
      await tx.orderOwnershipEntry.update({
        where: { id: remaining[0].id },
        data: { sharePercent: 100 },
      })
    } else {
      // Recalculate even split
      const evenSplits = buildEvenSplits(remaining.length)
      for (let i = 0; i < remaining.length; i++) {
        await tx.orderOwnershipEntry.update({
          where: { id: remaining[i].id },
          data: { sharePercent: evenSplits[i] },
        })
      }
    }

    // Re-fetch with employee details
    const final = await tx.orderOwnership.findFirst({
      where: { id: ownership.id },
      include: {
        owners: {
          include: {
            employee: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        },
      },
    })

    return mapToOwnershipInfo(final!)
  })
}

/**
 * Manually update the split percentages for an order's ownership.
 *
 * Validates that the provided splits sum to 100% (with a tolerance of +/-0.01
 * for floating-point rounding). Each split's employeeId must match an existing
 * owner entry.
 *
 * @throws {Error} If splits do not sum to ~100%
 * @throws {Error} If an employeeId in splits is not a current owner
 */
export async function updateOwnershipSplits(params: {
  orderId: string
  splits: Array<{ employeeId: string; sharePercent: number }>
}): Promise<OwnershipInfo> {
  const { orderId, splits } = params

  // Validate sum to 100% (+/- 0.01 tolerance)
  const total = splits.reduce((sum, s) => sum + s.sharePercent, 0)
  if (Math.abs(total - 100) > 0.01) {
    throw new Error(
      `INVALID_SPLIT_TOTAL: Splits must sum to 100%, got ${total.toFixed(2)}%`
    )
  }

  return db.$transaction(async (tx) => {
    const ownership = await tx.orderOwnership.findFirst({
      where: {
        orderId,
        isActive: true,
        deletedAt: null,
      },
      include: {
        owners: {
          include: {
            employee: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        },
      },
    })

    if (!ownership) {
      throw new Error(`NO_ACTIVE_OWNERSHIP: No active ownership for order ${orderId}`)
    }

    // Build a lookup of existing entries by employeeId
    const entryByEmployee = new Map(
      ownership.owners.map((o) => [o.employeeId, o])
    )

    // Validate all provided employeeIds exist
    for (const split of splits) {
      if (!entryByEmployee.has(split.employeeId)) {
        throw new Error(
          `OWNER_NOT_FOUND: Employee ${split.employeeId} is not an owner of this order`
        )
      }
    }

    // Update each entry's sharePercent
    for (const split of splits) {
      const entry = entryByEmployee.get(split.employeeId)!
      await tx.orderOwnershipEntry.update({
        where: { id: entry.id },
        data: { sharePercent: split.sharePercent },
      })
    }

    // Re-fetch with employee details
    const final = await tx.orderOwnership.findFirst({
      where: { id: ownership.id },
      include: {
        owners: {
          include: {
            employee: {
              select: {
                firstName: true,
                lastName: true,
                displayName: true,
              },
            },
          },
        },
      },
    })

    return mapToOwnershipInfo(final!)
  })
}

/**
 * Distribute tip allocations based on ownership percentages.
 *
 * Pure function (no DB calls). Takes raw allocations and redistributes them
 * to each owner based on their sharePercent. The last owner absorbs any
 * rounding remainder so the total always equals the input total.
 *
 * @param allocations - Original tip allocations (typically one entry per order)
 * @param ownership - The active ownership with owner percentages
 * @returns Array of allocations, one per owner, with guaranteed sum === input sum
 */
export function adjustAllocationsByOwnership(
  allocations: Array<{ employeeId: string; amountCents: number }>,
  ownership: OwnershipInfo
): OwnershipAllocation[] {
  // Sum all incoming tip cents
  const totalCents = allocations.reduce((sum, a) => sum + a.amountCents, 0)

  if (totalCents <= 0 || ownership.owners.length === 0) {
    return []
  }

  const result: OwnershipAllocation[] = []
  let allocated = 0

  for (let i = 0; i < ownership.owners.length; i++) {
    const owner = ownership.owners[i]

    if (i === ownership.owners.length - 1) {
      // Last owner absorbs rounding remainder
      result.push({
        employeeId: owner.employeeId,
        sharePercent: owner.sharePercent,
        amountCents: totalCents - allocated,
      })
    } else {
      const share = Math.round(totalCents * (owner.sharePercent / 100))
      result.push({
        employeeId: owner.employeeId,
        sharePercent: owner.sharePercent,
        amountCents: share,
      })
      allocated += share
    }
  }

  return result
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Build an array of percentages that sum to exactly 100.
 *
 * Each member gets an equal share rounded to 2 decimal places. The last member
 * absorbs any rounding remainder so the total is always exactly 100.
 *
 * @example buildEvenSplits(3) => [33.33, 33.33, 33.34]
 * @example buildEvenSplits(2) => [50.00, 50.00]
 * @example buildEvenSplits(1) => [100.00]
 */
function buildEvenSplits(count: number): number[] {
  if (count <= 0) return []
  if (count === 1) return [100]

  const base = Math.floor((10000 / count)) / 100 // 2 decimal places
  const splits: number[] = []
  let sum = 0

  for (let i = 0; i < count - 1; i++) {
    splits.push(base)
    sum += base
  }

  // Last member gets the remainder to ensure exact 100%
  const remainder = Math.round((100 - sum) * 100) / 100
  splits.push(remainder)

  return splits
}

/**
 * Map a Prisma OrderOwnership (with owners + employee) to the public OwnershipInfo shape.
 */
function mapToOwnershipInfo(ownership: {
  id: string
  orderId: string
  isActive: boolean
  owners: Array<{
    id: string
    employeeId: string
    sharePercent: number
    employee: {
      firstName: string
      lastName: string
      displayName: string | null
    }
  }>
}): OwnershipInfo {
  return {
    id: ownership.id,
    orderId: ownership.orderId,
    isActive: ownership.isActive,
    owners: ownership.owners.map((o) => ({
      id: o.id,
      employeeId: o.employeeId,
      firstName: o.employee.firstName,
      lastName: o.employee.lastName,
      displayName: o.employee.displayName,
      sharePercent: o.sharePercent,
    })),
  }
}

/**
 * Map a minimal ownership (without employee includes) to OwnershipInfo.
 * Used as a fallback when the target employee was not found among owners.
 */
function mapToOwnershipInfoMinimal(ownership: {
  id: string
  orderId: string
  isActive: boolean
  owners: Array<{
    id: string
    employeeId: string
    sharePercent: number
  }>
}): OwnershipInfo {
  return {
    id: ownership.id,
    orderId: ownership.orderId,
    isActive: ownership.isActive,
    owners: ownership.owners.map((o) => ({
      id: o.id,
      employeeId: o.employeeId,
      firstName: '',
      lastName: '',
      displayName: null,
      sharePercent: o.sharePercent,
    })),
  }
}
