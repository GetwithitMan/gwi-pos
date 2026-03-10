import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings, type TrainingSettings, DEFAULT_TRAINING_SETTINGS } from '@/lib/settings'
import { requirePermission } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { getLocationSettings, invalidateLocationCache } from '@/lib/location-cache'
import { emitToLocation } from '@/lib/socket-server'
import { withVenue } from '@/lib/with-venue'

// GET: Return current training settings
export const GET = withVenue(async function GET() {
  try {
    const location = await db.location.findFirst({ select: { id: true } })
    if (!location) {
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
    }

    const settings = parseSettings(await getLocationSettings(location.id))
    const training: TrainingSettings = settings.training ?? DEFAULT_TRAINING_SETTINGS

    return NextResponse.json({ data: { training } })
  } catch (error) {
    console.error('Failed to fetch training settings:', error)
    return NextResponse.json({ error: 'Failed to fetch training settings' }, { status: 500 })
  }
})

// PUT: Toggle training mode for an employee
// Payload: { employeeId: string, enabled: boolean }
export const PUT = withVenue(async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { employeeId, enabled, actorEmployeeId } = body as {
      employeeId: string
      enabled: boolean
      actorEmployeeId?: string
    }

    if (!employeeId || typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'employeeId and enabled are required' }, { status: 400 })
    }

    const location = await db.location.findFirst({ select: { id: true } })
    if (!location) {
      return NextResponse.json({ error: 'No location found' }, { status: 404 })
    }

    // Require manager-level permission
    const auth = await requirePermission(actorEmployeeId, location.id, PERMISSIONS.SETTINGS_EDIT)
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status })
    }

    // Get current settings
    const currentSettings = parseSettings(await getLocationSettings(location.id))
    const currentTraining: TrainingSettings = currentSettings.training ?? { ...DEFAULT_TRAINING_SETTINGS }

    // Update the training employee list
    let updatedIds = [...currentTraining.trainingEmployeeIds]
    if (enabled && !updatedIds.includes(employeeId)) {
      updatedIds.push(employeeId)
    } else if (!enabled) {
      updatedIds = updatedIds.filter(id => id !== employeeId)
    }

    // Auto-enable master toggle when first employee is added
    const updatedTraining: TrainingSettings = {
      ...currentTraining,
      enabled: updatedIds.length > 0 ? true : currentTraining.enabled,
      trainingEmployeeIds: updatedIds,
    }

    // Save updated settings
    await db.location.update({
      where: { id: location.id },
      data: {
        settings: JSON.parse(JSON.stringify({
          ...currentSettings,
          training: updatedTraining,
        })),
      },
    })

    // Invalidate cache so all terminals pick up the change
    invalidateLocationCache(location.id)

    // Notify all terminals
    void emitToLocation(location.id, 'settings:updated', { training: updatedTraining })

    // Audit log
    void db.auditLog.create({
      data: {
        locationId: location.id,
        employeeId: actorEmployeeId || 'system',
        action: enabled ? 'training_mode_enabled' : 'training_mode_disabled',
        entityType: 'employee',
        entityId: employeeId,
        details: { trainingEmployeeIds: updatedIds },
      },
    }).catch(console.error)

    return NextResponse.json({ data: { training: updatedTraining } })
  } catch (error) {
    console.error('Failed to update training settings:', error)
    return NextResponse.json({ error: 'Failed to update training settings' }, { status: 500 })
  }
})
