import { NextRequest } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import * as EmployeeRepository from '@/lib/repositories/employee-repository'
import { getLocationId } from '@/lib/location-cache'
import { DEFAULT_LAYOUT_SETTINGS, type POSLayoutSettings } from '@/lib/settings'
import { withVenue } from '@/lib/with-venue'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'

// GET - Get employee's layout settings
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('Location required')
    }

    const employee = await EmployeeRepository.getEmployeeByIdWithInclude(id, locationId, {
      location: {
        select: {
          settings: true,
        },
      },
    })

    if (!employee) {
      return notFound('Employee not found')
    }

    // Merge: global defaults < location defaults < personal settings
    const locationSettings = employee.location?.settings as Record<string, unknown> | null
    const globalLayout = locationSettings?.posLayout as Partial<POSLayoutSettings> | undefined
    const personalLayout = employee.posLayoutSettings as Partial<POSLayoutSettings> | null

    const mergedLayout: POSLayoutSettings = {
      ...DEFAULT_LAYOUT_SETTINGS,
      ...(globalLayout || {}),
      ...(personalLayout || {}),
    }

    return ok({
      layout: mergedLayout,
      hasPersonalSettings: !!personalLayout,
    })
  } catch (error) {
    console.error('Failed to get employee layout:', error)
    return err('Failed to get layout settings', 500)
  }
})

// PUT - Update employee's personal layout settings
export const PUT = withVenue(withAuth(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { layout } = body as { layout: Partial<POSLayoutSettings> }

    const locationId = await getLocationId()
    if (!locationId) {
      return err('Location required')
    }

    // Verify employee exists (tenant-scoped, with includes for existing settings)
    const employee = await EmployeeRepository.getEmployeeByIdWithInclude(id, locationId, {
      role: {
        select: {
          permissions: true,
        },
      },
    })

    if (!employee) {
      return notFound('Employee not found')
    }

    // Merge with existing settings
    const existingLayout = employee.posLayoutSettings as Partial<POSLayoutSettings> | null

    const updatedLayout = {
      ...(existingLayout || {}),
      ...layout,
    }

    // Update employee (tenant-scoped) - cast to Prisma.InputJsonValue for JSON field compatibility
    await EmployeeRepository.updateEmployee(id, locationId, {
      posLayoutSettings: updatedLayout as Prisma.InputJsonValue,
    })

    return ok({
      success: true,
      layout: { ...DEFAULT_LAYOUT_SETTINGS, ...updatedLayout },
    })
  } catch (error) {
    console.error('Failed to update employee layout:', error)
    return err('Failed to update layout settings', 500)
  }
}))

// DELETE - Reset employee's personal layout to defaults
export const DELETE = withVenue(withAuth(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const locationId = await getLocationId()
    if (!locationId) {
      return err('Location required')
    }

    await EmployeeRepository.updateEmployee(id, locationId, {
      posLayoutSettings: Prisma.JsonNull,
    })

    return ok({
      success: true,
      layout: DEFAULT_LAYOUT_SETTINGS,
    })
  } catch (error) {
    console.error('Failed to reset employee layout:', error)
    return err('Failed to reset layout settings', 500)
  }
}))
