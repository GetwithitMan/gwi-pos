/**
 * GET /api/cron/notification-reaper — Ghost Pager Reaper
 *
 * Finds devices with status='assigned' and assignedAt < NOW() - configuredHours.
 * Marks them as 'missing'.
 * Emits staff_alert notification.
 * Auth: verifyCronSecret() (Bearer token from CRON_SECRET)
 *
 * Configurable timeout per location via settings.notifications.ghostPagerTimeoutHours (default: 4)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyCronSecret } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const DEFAULT_GHOST_PAGER_TIMEOUT_HOURS = 4

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronAuthError = verifyCronSecret(authHeader)
  if (cronAuthError) return cronAuthError

  const now = new Date()
  const results: Record<string, unknown>[] = []

  try {
    // Get all locations with their notification settings
    const locations: any[] = await db.$queryRawUnsafe(
      `SELECT id, name, settings FROM "Location" WHERE "deletedAt" IS NULL`
    )

    for (const location of locations) {
      const locationId = location.id
      const settings = (location.settings || {}) as Record<string, any>
      const notificationSettings = settings.notifications || {}
      const timeoutHours = notificationSettings.ghostPagerTimeoutHours || DEFAULT_GHOST_PAGER_TIMEOUT_HOURS

      try {
        // Find ghost pagers: assigned but not seen for longer than the configured timeout
        const ghostDevices: any[] = await db.$queryRawUnsafe(
          `SELECT id, "deviceNumber", "humanLabel", "assignedToSubjectType", "assignedToSubjectId",
                  "assignedAt", "lastSeenAt"
           FROM "NotificationDevice"
           WHERE "locationId" = $1
             AND status = 'assigned'
             AND "assignedAt" < NOW() - ($2 || ' hours')::interval
             AND "deletedAt" IS NULL`,
          locationId,
          String(timeoutHours)
        )

        if (ghostDevices.length === 0) {
          results.push({ locationId, locationName: location.name, ghostDevices: 0, skipped: true })
          continue
        }

        let markedMissing = 0

        for (const device of ghostDevices) {
          try {
            // Mark device as missing
            await db.$executeRawUnsafe(
              `UPDATE "NotificationDevice"
               SET status = 'missing',
                   "assignedToSubjectType" = NULL,
                   "assignedToSubjectId" = NULL,
                   "updatedAt" = CURRENT_TIMESTAMP
               WHERE id = $1 AND "locationId" = $2 AND status = 'assigned'`,
              device.id,
              locationId
            )

            // Log device event
            await db.$executeRawUnsafe(
              `INSERT INTO "NotificationDeviceEvent" (
                id, "deviceId", "locationId", "eventType",
                "subjectType", "subjectId", metadata, "createdAt"
              ) VALUES (
                gen_random_uuid()::text, $1, $2, 'marked_lost',
                $3, $4, $5::jsonb, CURRENT_TIMESTAMP
              )`,
              device.id,
              locationId,
              device.assignedToSubjectType || null,
              device.assignedToSubjectId || null,
              JSON.stringify({
                reason: 'ghost_pager_reaper',
                assignedAt: device.assignedAt,
                lastSeenAt: device.lastSeenAt,
                timeoutHours,
                elapsedHours: device.assignedAt
                  ? Math.round((now.getTime() - new Date(device.assignedAt).getTime()) / (1000 * 60 * 60) * 10) / 10
                  : null,
              })
            )

            // Release any active target assignments for this device
            await db.$executeRawUnsafe(
              `UPDATE "NotificationTargetAssignment"
               SET status = 'released',
                   "releasedAt" = CURRENT_TIMESTAMP,
                   "releaseReason" = 'ghost_pager_timeout',
                   "updatedAt" = CURRENT_TIMESTAMP
               WHERE "locationId" = $1
                 AND "targetValue" = $2
                 AND status = 'active'
                 AND "targetType" IN ('guest_pager', 'staff_pager')`,
              locationId,
              device.deviceNumber
            )

            // Clear pagerNumber cache on the subject if it was an order or waitlist entry
            if (device.assignedToSubjectType === 'order' && device.assignedToSubjectId) {
              void db.$executeRawUnsafe(
                `UPDATE "Order" SET "pagerNumber" = NULL WHERE id = $1 AND "locationId" = $2`,
                device.assignedToSubjectId,
                locationId
              ).catch(console.error)
            } else if (device.assignedToSubjectType === 'waitlist_entry' && device.assignedToSubjectId) {
              void db.$executeRawUnsafe(
                `UPDATE "WaitlistEntry" SET "pagerNumber" = NULL WHERE id = $1 AND "locationId" = $2`,
                device.assignedToSubjectId,
                locationId
              ).catch(console.error)
            }

            markedMissing++
          } catch (deviceErr) {
            console.error(`[cron:notification-reaper] Failed to process ghost device ${device.id}:`, deviceErr)
          }
        }

        // Emit staff_alert notification for the batch of ghost pagers
        if (markedMissing > 0) {
          try {
            const { notifyEvent } = await import('@/lib/notifications/dispatcher')
            await notifyEvent({
              locationId,
              eventType: 'staff_alert' as any,
              subjectType: 'staff_task',
              subjectId: `ghost-reaper-${now.toISOString()}`,
              subjectVersion: 1,
              sourceSystem: 'cron',
              sourceEventId: `ghost_reaper:${locationId}:${now.toISOString()}`,
              dispatchOrigin: 'automatic',
              businessStage: 'initial_ready' as any,
              contextSnapshot: {
                message: `${markedMissing} ghost pager(s) detected and marked as missing after ${timeoutHours}h timeout`,
                ghostDevices: ghostDevices.map(d => ({
                  deviceNumber: d.deviceNumber,
                  assignedAt: d.assignedAt,
                  subjectType: d.assignedToSubjectType,
                  subjectId: d.assignedToSubjectId,
                })),
              },
            })
          } catch {
            // Dispatcher not yet available — non-fatal
            console.warn(`[cron:notification-reaper] Notification dispatcher not available for staff_alert`)
          }
        }

        results.push({
          locationId,
          locationName: location.name,
          ghostDevices: ghostDevices.length,
          markedMissing,
          timeoutHours,
        })

        if (markedMissing > 0) {
          console.log(`[cron:notification-reaper] Location ${location.name}: marked ${markedMissing} ghost pager(s) as missing (timeout: ${timeoutHours}h)`)
        }
      } catch (locErr) {
        console.error(`[cron:notification-reaper] Location ${locationId} error:`, locErr)
        results.push({
          locationId,
          locationName: location.name,
          error: locErr instanceof Error ? locErr.message : 'Unknown error',
        })
      }
    }

    return NextResponse.json({
      success: true,
      processed: results,
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error('[cron:notification-reaper] Fatal error:', error)
    return NextResponse.json(
      { error: 'Ghost pager reaper failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
