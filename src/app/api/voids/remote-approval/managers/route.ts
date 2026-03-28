/**
 * GET /api/voids/remote-approval/managers
 *
 * Returns list of managers with void permission and phone numbers
 * for the remote approval dropdown.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { maskPhone } from '@/lib/twilio'
import { withVenue } from '@/lib/with-venue'
import { err, ok } from '@/lib/api-response'

export const GET = withVenue(async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const locationId = searchParams.get('locationId')

    if (!locationId) {
      return err('locationId is required')
    }

    // Fetch all active employees with their roles
    const employees = await db.employee.findMany({
      where: {
        locationId,
        isActive: true,
        deletedAt: null,
        phone: { not: null }, // Must have a phone number
      },
      include: {
        role: {
          select: {
            id: true,
            name: true,
            permissions: true,
          },
        },
      },
      orderBy: [{ role: { name: 'asc' } }, { firstName: 'asc' }],
    })

    // Filter to only those with void permission
    const managersWithVoidPermission = employees
      .filter((emp) => {
        const permissions = (emp.role.permissions as string[]) || []
        return (
          hasPermission(permissions, PERMISSIONS.MGR_VOID_ITEMS) ||
          hasPermission(permissions, PERMISSIONS.MGR_VOID_ORDERS)
        )
      })
      .map((emp) => ({
        id: emp.id,
        name: emp.displayName || `${emp.firstName} ${emp.lastName}`,
        firstName: emp.firstName,
        lastName: emp.lastName,
        phone: emp.phone!, // Already filtered for non-null
        phoneMasked: maskPhone(emp.phone!),
        roleName: emp.role.name,
        hasVoidItemsPermission: hasPermission(
          emp.role.permissions as string[],
          PERMISSIONS.MGR_VOID_ITEMS
        ),
        hasVoidOrdersPermission: hasPermission(
          emp.role.permissions as string[],
          PERMISSIONS.MGR_VOID_ORDERS
        ),
      }))

    return ok({
        managers: managersWithVoidPermission,
        count: managersWithVoidPermission.length,
      })
  } catch (error) {
    console.error('[RemoteVoidApproval] Error fetching managers:', error)
    return err('Failed to fetch managers', 500)
  }
})
