/**
 * KDS Screen Link Processing
 *
 * Runs AFTER a bump DB transaction commits (fire-and-forget).
 * Screen link failures never roll back a bump.
 *
 * Flow:
 * 1. Query KDSScreenLink for source screen
 * 2. For send_to_next → update forwarding fields + dispatch socket event
 * 3. For multi_clear → dispatch multi-clear socket event
 * 4. Write audit log per link processed
 * 5. Determine if this is a final bump (no send_to_next targets) → emit terminal "Made"
 */

import crypto from 'crypto'
import { adminDb, db } from '@/lib/db'
import {
  dispatchOrderForwarded,
  dispatchMultiClear,
  dispatchOrderBumped,
  dispatchItemStatus,
} from '@/lib/socket-dispatch'
import type { KDSBumpAction, KDSLinkType } from './types'

interface ProcessScreenLinksParams {
  orderId: string
  itemIds: string[]
  sourceScreenId: string
  action: 'complete' | 'bump_order'
  bumpedBy: string
}

/**
 * Process all screen links for a bump event.
 * Returns true if this was a final bump (no forward targets).
 */
export async function processScreenLinks(
  locationId: string,
  params: ProcessScreenLinksParams,
): Promise<boolean> {
  const { orderId, itemIds, sourceScreenId, action, bumpedBy } = params
  const eventId = crypto.randomUUID()

  // Query active links from source screen
  const links = await db.kDSScreenLink.findMany({
    where: {
      sourceScreenId,
      isActive: true,
      deletedAt: null,
    },
    include: {
      targetScreen: {
        select: { id: true, name: true, isActive: true, locationId: true, deletedAt: true },
      },
    },
    orderBy: { sortOrder: 'asc' },
  })

  // Separate link types
  const sendToNextLinks = links.filter(l => l.linkType === 'send_to_next')
  const multiClearLinks = links.filter(l => l.linkType === 'multi_clear')

  // Determine if this is a final bump
  const hasActiveSendToNext = sendToNextLinks.some(
    l => l.targetScreen.isActive && !l.targetScreen.deletedAt && l.targetScreen.locationId === locationId
  )
  const isFinalBump = !hasActiveSendToNext

  // Process send_to_next links: forward items to target screens
  for (const link of sendToNextLinks) {
    const target = link.targetScreen

    // Skip invalid/stale targets silently
    if (!target.isActive || target.deletedAt || target.locationId !== locationId) {
      console.warn(`[KDS] Skipping stale send_to_next link ${link.id} → screen ${target.id} (${target.name}): inactive/deleted/wrong location`)
      continue
    }

    // Persist forwarding state on OrderItems
    try {
      await adminDb.orderItem.updateMany({
        where: { id: { in: itemIds } },
        data: {
          kdsForwardedToScreenId: target.id,
          kdsFinalCompleted: false,
        },
      })
    } catch (err) {
      console.error(`[KDS] Failed to persist forwarding state for items → screen ${target.id}:`, err)
    }

    // Dispatch socket event
    void dispatchOrderForwarded(locationId, {
      eventId,
      orderId,
      itemIds,
      targetScreenId: target.id,
      sourceScreenId,
      linkType: link.linkType as KDSLinkType,
      bumpAction: link.bumpAction as KDSBumpAction,
      resetStrikethroughs: link.resetStrikethroughsOnSend,
      bumpedBy,
      locationId,
      timestamp: new Date().toISOString(),
    }).catch(err => console.error('[KDS] dispatchOrderForwarded failed:', err))

    // Audit log
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: null,
        action: 'KDS_FORWARD',
        entityType: 'order',
        entityId: orderId,
        details: {
          sourceScreenId,
          targetScreenId: target.id,
          targetScreenName: target.name,
          itemIds,
          bumpedBy,
          eventId,
          linkType: link.linkType,
          bumpAction: link.bumpAction,
        },
      },
    }).catch(err => console.error('[KDS] Forward audit log failed:', err))
  }

  // Process multi_clear links: notify target screens about item completion
  for (const link of multiClearLinks) {
    const target = link.targetScreen

    // Skip invalid targets
    if (!target.isActive || target.deletedAt || target.locationId !== locationId) {
      console.warn(`[KDS] Skipping stale multi_clear link ${link.id} → screen ${target.id}: inactive/deleted/wrong location`)
      continue
    }

    void dispatchMultiClear(locationId, {
      eventId,
      orderId,
      itemIds,
      targetScreenId: target.id,
      sourceScreenId,
      bumpAction: link.bumpAction as KDSBumpAction,
      locationId,
      timestamp: new Date().toISOString(),
    }).catch(err => console.error('[KDS] dispatchMultiClear failed:', err))

    // Audit log
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: null,
        action: 'KDS_MULTI_CLEAR',
        entityType: 'order',
        entityId: orderId,
        details: {
          sourceScreenId,
          targetScreenId: target.id,
          targetScreenName: target.name,
          itemIds,
          eventId,
          linkType: link.linkType,
          bumpAction: link.bumpAction,
        },
      },
    }).catch(err => console.error('[KDS] Multi-clear audit log failed:', err))
  }

  return isFinalBump
}

/**
 * Process an Expo final bump — checks if all forwarded items for the order
 * on this screen are now complete, then triggers terminal "Made" events.
 */
export async function processExpoFinalBump(
  locationId: string,
  params: {
    orderId: string
    itemIds: string[]
    screenId: string
    bumpedBy: string
  },
): Promise<void> {
  const { orderId, itemIds, screenId, bumpedBy } = params

  // Mark these items as final-completed
  await adminDb.orderItem.updateMany({
    where: { id: { in: itemIds } },
    data: { kdsFinalCompleted: true },
  })

  // Check: are ALL items forwarded to this screen now kdsFinalCompleted?
  const remainingOnScreen = await adminDb.orderItem.count({
    where: {
      orderId,
      kdsForwardedToScreenId: screenId,
      kdsFinalCompleted: false,
      status: { not: 'voided' },
      deletedAt: null,
    },
  })

  if (remainingOnScreen === 0) {
    // This screen's responsibility for the order is complete → final bump
    // Emit terminal "Made", Order Tracker "Ready", SMS if configured

    void dispatchOrderBumped(locationId, {
      orderId,
      stationId: screenId,
      bumpedBy,
      allItemsServed: true,
    }, { async: true }).catch(err => console.error('[KDS] Final bump dispatch failed:', err))

    // Also dispatch per-item status for Android terminals
    for (const iid of itemIds) {
      void dispatchItemStatus(locationId, {
        orderId,
        itemId: iid,
        status: 'completed',
        stationId: screenId,
        updatedBy: bumpedBy,
      }, { async: true }).catch(err => console.error('[KDS] Final bump item status dispatch failed:', err))
    }

    // Audit log
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: null,
        action: 'KDS_FINAL_BUMP',
        entityType: 'order',
        entityId: orderId,
        details: {
          screenId,
          itemIds,
          bumpedBy,
          remainingOnScreen: 0,
        },
      },
    }).catch(err => console.error('[KDS] Final bump audit log failed:', err))
  }
}

/**
 * Check if a screen has any active send_to_next links at a location.
 * Used to determine intermediate vs final bump behavior.
 */
export async function screenHasForwardTargets(
  screenId: string,
  locationId: string,
): Promise<boolean> {
  const count = await db.kDSScreenLink.count({
    where: {
      sourceScreenId: screenId,
      linkType: 'send_to_next',
      isActive: true,
      deletedAt: null,
      targetScreen: {
        isActive: true,
        deletedAt: null,
        locationId,
      },
    },
  })
  return count > 0
}
