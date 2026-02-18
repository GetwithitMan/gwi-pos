/**
 * Eligible Tip Group Templates API
 *
 * GET - Returns templates that an employee's role is eligible for,
 *       plus the allowStandaloneServers setting.
 *       Used at clock-in to show the group selection picker.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseSettings } from '@/lib/settings'
import { getLocationSettings } from '@/lib/location-cache'
import { withVenue } from '@/lib/with-venue'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')
    const employeeId = searchParams.get('employeeId')

    if (!locationId || !employeeId) {
      return NextResponse.json(
        { error: 'locationId and employeeId are required' },
        { status: 400 }
      )
    }

    // Look up the employee's current role
    const employee = await db.employee.findFirst({
      where: { id: employeeId, deletedAt: null },
      select: { roleId: true },
    })

    if (!employee) {
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
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

    return NextResponse.json({
      templates: eligible.map(t => ({
        id: t.id,
        name: t.name,
        defaultSplitMode: t.defaultSplitMode,
      })),
      allowStandaloneServers,
    })
  } catch (error) {
    console.error('Failed to get eligible templates:', error)
    return NextResponse.json(
      { error: 'Failed to get eligible templates' },
      { status: 500 }
    )
  }
})
