/**
 * POST /api/dashboard/verify-admin
 *
 * Validates an employee PIN and returns their dashboard permissions.
 * Used by the NUC Dashboard app to gate access to device management
 * and admin tools behind a manager/admin PIN.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'

export const dynamic = 'force-dynamic'

// Simple in-memory rate limiter (per-location, resets on restart)
const attempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 60_000 // 1 minute

export const POST = withVenue(withAuth('ADMIN', async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json()
    const { pin } = body

    if (!pin || typeof pin !== 'string') {
      return NextResponse.json({ authorized: false }, { status: 400 })
    }

    // Resolve locationId: request context (Vercel/NUC with slug) -> env (NUC single-venue)
    const { getRequestLocationId } = await import('@/lib/request-context')
    const locationId =
      getRequestLocationId() ||
      process.env.POS_LOCATION_ID ||
      process.env.LOCATION_ID

    if (!locationId) {
      return NextResponse.json({ authorized: false, error: 'No location context' }, { status: 400 })
    }

    // Rate limiting
    const key = `${locationId}:dashboard-admin`
    const now = Date.now()
    const attempt = attempts.get(key)
    if (attempt && attempt.resetAt > now && attempt.count >= MAX_ATTEMPTS) {
      return NextResponse.json(
        { authorized: false, error: 'Too many attempts. Try again later.' },
        { status: 429 }
      )
    }

    // Find employee by PIN + locationId
    const employee = await db.employee.findFirst({
      where: {
        locationId,
        pin,
        deletedAt: null,
        isActive: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: {
          select: {
            name: true,
            permissions: true,
          },
        },
        employeeRoles: {
          select: {
            role: {
              select: {
                name: true,
                permissions: true,
              },
            },
          },
        },
      },
    })

    if (!employee) {
      // Track failed attempt
      if (!attempt || attempt.resetAt <= now) {
        attempts.set(key, { count: 1, resetAt: now + WINDOW_MS })
      } else {
        attempt.count++
      }

      // Audit: failed unlock attempt (fire-and-forget)
      void db.auditLog.create({
        data: {
          locationId,
          action: 'dashboard_admin_unlock_failed',
          entityType: 'dashboard',
          entityId: 'admin-unlock',
          details: { pin: '****', success: false },
        },
      }).catch(console.error)

      // Generic failure (no employee enumeration)
      return NextResponse.json({ authorized: false })
    }

    // Flatten all permissions from primary role + all assigned roles
    const allPermissions: string[] = []
    const allRoleNames: string[] = []

    // Primary role
    if (employee.role) {
      allRoleNames.push(employee.role.name)
      const perms = employee.role.permissions
      if (Array.isArray(perms)) {
        allPermissions.push(...(perms as string[]))
      }
    }

    // Additional roles via EmployeeRole junction
    for (const er of employee.employeeRoles) {
      allRoleNames.push(er.role.name)
      const perms = er.role.permissions
      if (Array.isArray(perms)) {
        allPermissions.push(...(perms as string[]))
      }
    }

    const isManager =
      allPermissions.includes('all') ||
      allPermissions.includes('manager') ||
      allRoleNames.some(name =>
        ['Manager', 'Admin', 'Owner', 'Super Admin'].includes(name)
      )

    const hasDeviceMgmt = isManager || allPermissions.includes('dashboard.device_management')
    const hasToolsAdmin = isManager || allPermissions.includes('dashboard.tools_admin')

    if (!hasDeviceMgmt && !hasToolsAdmin) {
      // Employee exists but lacks permissions
      return NextResponse.json({ authorized: false })
    }

    // Reset rate limiter on success
    attempts.delete(key)

    // Audit: successful unlock (fire-and-forget)
    void db.auditLog.create({
      data: {
        locationId,
        employeeId: employee.id,
        action: 'dashboard_admin_unlock_success',
        entityType: 'dashboard',
        entityId: 'admin-unlock',
        details: {
          employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
          permissions: { toolsAdmin: hasToolsAdmin, deviceManagement: hasDeviceMgmt },
        },
      },
    }).catch(console.error)

    return NextResponse.json({
      authorized: true,
      employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
      permissions: {
        toolsAdmin: hasToolsAdmin,
        deviceManagement: hasDeviceMgmt,
      },
    })
  } catch (e) {
    console.error('[dashboard/verify-admin]', e)
    return NextResponse.json({ authorized: false }, { status: 500 })
  }
}))
