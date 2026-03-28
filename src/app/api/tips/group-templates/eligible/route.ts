/**
 * Eligible Tip Group Templates API
 *
 * GET - Returns templates that an employee's role is eligible for,
 *       plus the allowStandaloneServers setting.
 *       Used at clock-in to show the group selection picker.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

export const GET = withVenue(withAuth({ allowCellular: true }, async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')

    if (!locationId || !employeeId) {
      return err('locationId and employeeId are required')
    }

    // Look up the employee's current role
    const employee = await db.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { roleId: true },
    })

    if (!employee) {
      return notFound('Employee not found')
    }

    // Fetch location settings for allowStandaloneServers
    const locationSettings = await getLocationSettings(locationId)
    const settings = locationSettings ? parseSettings(locationSettings) : null
    const allowStandaloneServers = settings?.tipBank?.allowStandaloneServers ?? true

    // Fetch all active templates for this location
    const templates = await db.tipGroupTemplate.findMany({
      where: {
        locationId,
        active: true,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        defaultSplitMode: true,
        allowedRoleIds: true,
      },
      orderBy: { sortOrder: 'asc' },
    })

    // Filter by role eligibility
    const eligible = templates.filter(t => {
      const roleIds = t.allowedRoleIds as string[]
      // Empty allowedRoleIds means all roles are eligible
      if (!Array.isArray(roleIds) || roleIds.length === 0) return true
      return roleIds.includes(employee.roleId)
    })

    return ok({
      templates: eligible.map(t => ({
        id: t.id,
        name: t.name,
        defaultSplitMode: t.defaultSplitMode,
      })),
      allowStandaloneServers,
    })
  } catch (error) {
    console.error('Failed to get eligible templates:', error)
    return err('Failed to get eligible templates', 500)
  }
}))
