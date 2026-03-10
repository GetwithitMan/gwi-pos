import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings, DEFAULT_EOD_SETTINGS } from '@/lib/settings'
import { getCurrentBusinessDay } from '@/lib/business-day'
import { getDatacapClient } from '@/lib/datacap/helpers'
import { detectPotentialWalkouts } from '@/lib/walkout-detector'
import { emitToLocation } from '@/lib/socket-server'
import { dispatchFloorPlanUpdate, dispatchEntertainmentStatusChanged } from '@/lib/socket-dispatch'
import { notifyNextWaitlistEntry } from '@/lib/entertainment-waitlist-notify'
import { writeFile } from 'fs/promises'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const results: Record<string, unknown>[] = []

  try {
    const locations = await db.location.findMany({
      where: { deletedAt: null },
      select: { id: true, settings: true },
    })

    for (const loc of locations) {
      const parsed = parseSettings(loc.settings as Record<string, unknown> | null)
      const eod = parsed.eod ?? DEFAULT_EOD_SETTINGS
      const batchCloseTime = eod.batchCloseTime || '04:00'

      // Parse configured batch time
      const [batchHour, batchMinute] = batchCloseTime.split(':').map(Number)
      const currentHour = now.getHours()
      const currentMinute = now.getMinutes()

      // Check if we're within the 15-minute window after batch close time
      const batchMinuteOfDay = batchHour * 60 + batchMinute
      const currentMinuteOfDay = currentHour * 60 + currentMinute
      const minutesSinceBatch = currentMinuteOfDay - batchMinuteOfDay

      if (minutesSinceBatch < 0 || minutesSinceBatch >= 15) {
        results.push({ locationId: loc.id, skipped: true, reason: 'outside_batch_window' })
        continue
      }

      // Idempotency: check if auto batch already ran for this business day
      const dayStartTime = parsed.businessDay.dayStartTime ?? '04:00'
      const businessDayStart = getCurrentBusinessDay(dayStartTime).start

      const alreadyRan = await db.auditLog.findFirst({
        where: {
          locationId: loc.id,
          action: 'eod_auto_batch_close',
          createdAt: { gte: businessDayStart },
        },
        select: { id: true },
      })

      if (alreadyRan) {
        results.push({ locationId: loc.id, skipped: true, reason: 'already_ran_today' })
        continue
      }

      const locationResult: Record<string, unknown> = { locationId: loc.id }

      // ── Datacap Batch Close ──────────────────────────────────────────
      if (eod.autoBatchClose && parsed.payments.processor === 'datacap') {
        try {
          const datacapClient = await getDatacapClient(loc.id)
          const readers = await db.paymentReader.findMany({
            where: { locationId: loc.id, deletedAt: null, isActive: true },
            select: { id: true, name: true },
          })

          const batchResults: Record<string, unknown>[] = []
          for (const reader of readers) {
            try {
              const result = await datacapClient.batchClose(reader.id)
              await db.auditLog.create({
                data: {
                  locationId: loc.id,
                  action: 'eod_batch_close_success',
                  entityType: 'payment_reader',
                  entityId: reader.id,
                  details: {
                    readerName: reader.name,
                    batchNo: result.batchNo ?? null,
                    batchItemCount: result.batchItemCount ?? null,
                    automated: true,
                  },
                },
              })
              batchResults.push({ reader: reader.name, status: 'success', batchNo: result.batchNo })

              // Write last-batch.json for heartbeat reporting
              try {
                await writeFile('/opt/gwi-pos/last-batch.json', JSON.stringify({
                  batchClosedAt: now.toISOString(),
                  batchStatus: 'closed',
                  batchItemCount: result.batchItemCount ?? null,
                  batchNo: result.batchNo ?? null,
                }))
              } catch {
                // Not on NUC — skip
              }
            } catch (readerErr) {
              await db.auditLog.create({
                data: {
                  locationId: loc.id,
                  action: 'eod_batch_close_failed',
                  entityType: 'payment_reader',
                  entityId: reader.id,
                  details: {
                    readerName: reader.name,
                    error: readerErr instanceof Error ? readerErr.message : 'Unknown error',
                    automated: true,
                  },
                },
              })
              batchResults.push({ reader: reader.name, status: 'failed', error: readerErr instanceof Error ? readerErr.message : 'Unknown' })
            }
          }
          locationResult.batchResults = batchResults
        } catch (err) {
          locationResult.batchError = err instanceof Error ? err.message : 'Unknown'
        }
      }

      // ── Table Reset (orphaned occupied tables) ────────────────────────
      const orphanedTables = await db.table.findMany({
        where: {
          locationId: loc.id,
          status: 'occupied',
          deletedAt: null,
          orders: { none: { status: 'open', deletedAt: null } },
        },
        select: { id: true },
      })

      if (orphanedTables.length > 0) {
        await db.table.updateMany({
          where: { id: { in: orphanedTables.map(t => t.id) } },
          data: { status: 'available' },
        })
        locationResult.tablesReset = orphanedTables.length
      }

      // ── Entertainment Cleanup ────────────────────────────────────────
      const staleEntertainment = await db.menuItem.findMany({
        where: {
          locationId: loc.id,
          itemType: 'timed_rental',
          entertainmentStatus: 'in_use',
        },
        select: { id: true },
      })

      if (staleEntertainment.length > 0) {
        await db.menuItem.updateMany({
          where: { id: { in: staleEntertainment.map(i => i.id) } },
          data: { entertainmentStatus: 'available', currentOrderId: null, currentOrderItemId: null },
        })
        for (const item of staleEntertainment) {
          await db.floorPlanElement.updateMany({
            where: { linkedMenuItemId: item.id, deletedAt: null, status: 'in_use' },
            data: { status: 'available', currentOrderId: null, sessionStartedAt: null, sessionExpiresAt: null },
          })
        }
        locationResult.entertainmentReset = staleEntertainment.length

        void dispatchFloorPlanUpdate(loc.id, { async: true }).catch(() => {})
        for (const item of staleEntertainment) {
          void dispatchEntertainmentStatusChanged(loc.id, {
            itemId: item.id,
            entertainmentStatus: 'available',
            currentOrderId: null,
            expiresAt: null,
          }, { async: true }).catch(() => {})
          void notifyNextWaitlistEntry(loc.id, item.id).catch(() => {})
        }
      }

      // ── Waitlist Expiry ──────────────────────────────────────────────
      await db.entertainmentWaitlist.updateMany({
        where: {
          locationId: loc.id,
          deletedAt: null,
          status: { in: ['waiting', 'notified'] },
        },
        data: { status: 'expired' },
      })

      // ── Walkout Detection ────────────────────────────────────────────
      void detectPotentialWalkouts(loc.id).catch(console.error)

      // ── Master Audit Log ─────────────────────────────────────────────
      await db.auditLog.create({
        data: {
          locationId: loc.id,
          action: 'eod_auto_batch_close',
          entityType: 'location',
          entityId: loc.id,
          details: {
            automated: true,
            batchCloseTime,
            tablesReset: orphanedTables.length,
            entertainmentReset: staleEntertainment.length,
            timestamp: now.toISOString(),
          },
        },
      })

      // ── Socket Notification ──────────────────────────────────────────
      void emitToLocation(loc.id, 'eod:auto-batch-complete', {
        tablesReset: orphanedTables.length,
        entertainmentReset: staleEntertainment.length,
        batchCloseTime,
        businessDay: businessDayStart.toISOString().split('T')[0],
      }).catch(console.error)

      results.push(locationResult)
    }

    return NextResponse.json({
      ok: true,
      processed: results,
      timestamp: now.toISOString(),
    })
  } catch (error) {
    console.error('[EOD Auto Batch] Failed:', error)
    return NextResponse.json(
      { error: 'EOD auto batch close failed', details: error instanceof Error ? error.message : 'Unknown' },
      { status: 500 }
    )
  }
}
