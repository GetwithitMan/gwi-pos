import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { ok } from '@/lib/api-response'

// PATCH /api/card-detections/[id]/prompt-event
//
// Best-effort client prompt timestamps. Updates promptShownAt or promptDismissedAt
// on CardDetection. Failures do NOT affect core detection/action flow.
//
// Always returns 200 — non-blocking by design.
export const PATCH = withVenue(async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: detectionId } = await params
    const body = await request.json().catch(() => ({}))
    const { event } = body

    if (!event || !['shown', 'dismissed', 'auto_dismissed'].includes(event)) {
      // Best-effort — return 200 anyway
      return ok({ ok: true })
    }

    // Look up detection to verify it belongs to this location
    const detection = await db.cardDetection.findUnique({
      where: { id: detectionId },
      select: { id: true, locationId: true },
    })

    if (!detection) {
      // Detection not found — still return 200 (best-effort, non-blocking)
      return ok({ ok: true })
    }

    // Update the appropriate timestamp
    const now = new Date()
    const updateData: Record<string, any> = {}

    if (event === 'shown') {
      updateData.promptShownAt = now
    } else if (event === 'dismissed' || event === 'auto_dismissed') {
      updateData.promptDismissedAt = now
    }

    await db.cardDetection.update({
      where: { id: detectionId },
      data: updateData,
    })

    return ok({ ok: true })
  } catch (error) {
    // Best-effort — failures return 200 anyway (non-blocking)
    console.warn('Failed to update card detection prompt event:', error)
    return ok({ ok: true })
  }
})
