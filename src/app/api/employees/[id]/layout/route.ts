import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { DEFAULT_LAYOUT_SETTINGS, type POSLayoutSettings } from '@/lib/settings'

// GET - Get employee's layout settings
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    console.log('[API Layout GET] Loading layout for employee:', id)

    const employee = await db.employee.findUnique({
      where: { id },
      select: {
        id: true,
        posLayoutSettings: true,
        location: {
          select: {
            settings: true,
          },
        },
      },
    })

    if (!employee) {
      console.log('[API Layout GET] Employee not found:', id)
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }

    // Merge: global defaults < location defaults < personal settings
    const locationSettings = employee.location?.settings as Record<string, unknown> | null
    const globalLayout = locationSettings?.posLayout as Partial<POSLayoutSettings> | undefined
    const personalLayout = employee.posLayoutSettings as Partial<POSLayoutSettings> | null

    console.log('[API Layout GET] Personal layout from DB:', personalLayout ? 'exists' : 'null')

    const mergedLayout: POSLayoutSettings = {
      ...DEFAULT_LAYOUT_SETTINGS,
      ...(globalLayout || {}),
      ...(personalLayout || {}),
    }

    console.log('[API Layout GET] Merged layout has categoryColors:', !!mergedLayout.categoryColors)
    console.log('[API Layout GET] Merged layout has menuItemColors:', !!mergedLayout.menuItemColors)

    return NextResponse.json({
      layout: mergedLayout,
      hasPersonalSettings: !!personalLayout,
    })
  } catch (error) {
    console.error('Failed to get employee layout:', error)
    return NextResponse.json(
      { error: 'Failed to get layout settings' },
      { status: 500 }
    )
  }
}

// PUT - Update employee's personal layout settings
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { layout } = body as { layout: Partial<POSLayoutSettings> }

    console.log('[API Layout PUT] Received request for employee:', id)
    console.log('[API Layout PUT] Layout data keys:', layout ? Object.keys(layout) : 'null')

    // Verify employee exists
    const employee = await db.employee.findUnique({
      where: { id },
      select: {
        id: true,
        posLayoutSettings: true,
        role: {
          select: {
            permissions: true,
          },
        },
      },
    })

    if (!employee) {
      console.log('[API Layout PUT] Employee not found:', id)
      return NextResponse.json(
        { error: 'Employee not found' },
        { status: 404 }
      )
    }

    // Check permission - Allow all employees to customize their personal layout
    // This is a fun personalization feature
    const permissions = employee.role?.permissions as Record<string, string[]> | null
    const posLayoutPermissions = permissions?.posLayout || []

    // Skip permission check - all employees can customize their own layout
    console.log('[API Layout PUT] Employee found, permissions:', posLayoutPermissions)

    // Merge with existing settings
    const existingLayout = employee.posLayoutSettings as Partial<POSLayoutSettings> | null
    console.log('[API Layout PUT] Existing layout:', existingLayout ? 'exists' : 'null')

    const updatedLayout = {
      ...(existingLayout || {}),
      ...layout,
    }
    console.log('[API Layout PUT] Merged layout keys:', Object.keys(updatedLayout))

    // Update employee - cast to Prisma.InputJsonValue for JSON field compatibility
    const result = await db.employee.update({
      where: { id },
      data: {
        posLayoutSettings: updatedLayout as Prisma.InputJsonValue,
      },
    })
    console.log('[API Layout PUT] Update successful, result ID:', result.id)

    return NextResponse.json({
      success: true,
      layout: { ...DEFAULT_LAYOUT_SETTINGS, ...updatedLayout },
    })
  } catch (error) {
    console.error('Failed to update employee layout:', error)
    return NextResponse.json(
      { error: 'Failed to update layout settings' },
      { status: 500 }
    )
  }
}

// DELETE - Reset employee's personal layout to defaults
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    await db.employee.update({
      where: { id },
      data: {
        posLayoutSettings: Prisma.JsonNull,
      },
    })

    return NextResponse.json({
      success: true,
      layout: DEFAULT_LAYOUT_SETTINGS,
    })
  } catch (error) {
    console.error('Failed to reset employee layout:', error)
    return NextResponse.json(
      { error: 'Failed to reset layout settings' },
      { status: 500 }
    )
  }
}
