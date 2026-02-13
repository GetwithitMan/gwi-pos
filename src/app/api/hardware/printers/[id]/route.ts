import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'

// GET single printer
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const printer = await db.printer.findUnique({
      where: { id },
    })

    if (!printer) {
      return NextResponse.json({ error: 'Printer not found' }, { status: 404 })
    }

    return NextResponse.json({ printer })
  } catch (error) {
    console.error('Failed to fetch printer:', error)
    return NextResponse.json({ error: 'Failed to fetch printer' }, { status: 500 })
  }
})

// PUT update printer
export const PUT = withVenue(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const existingPrinter = await db.printer.findUnique({
      where: { id },
    })

    if (!existingPrinter) {
      return NextResponse.json({ error: 'Printer not found' }, { status: 404 })
    }

    const {
      name,
      printerType,
      model,
      ipAddress,
      port,
      printerRole,
      isDefault,
      paperWidth,
      supportsCut,
      isActive,
      sortOrder,
      printSettings,
    } = body

    // If setting as default, unset other defaults for the same role
    if (isDefault && (!existingPrinter.isDefault || printerRole !== existingPrinter.printerRole)) {
      await db.printer.updateMany({
        where: {
          locationId: existingPrinter.locationId,
          printerRole: printerRole || existingPrinter.printerRole,
          isDefault: true,
          id: { not: id },
        },
        data: { isDefault: false },
      })
    }

    const printer = await db.printer.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(printerType !== undefined && { printerType }),
        ...(model !== undefined && { model }),
        ...(ipAddress !== undefined && { ipAddress }),
        ...(port !== undefined && { port }),
        ...(printerRole !== undefined && { printerRole }),
        ...(isDefault !== undefined && { isDefault }),
        ...(paperWidth !== undefined && { paperWidth }),
        ...(supportsCut !== undefined && { supportsCut }),
        ...(isActive !== undefined && { isActive }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(printSettings !== undefined && { printSettings }),
      },
    })

    return NextResponse.json({ printer })
  } catch (error) {
    console.error('Failed to update printer:', error)
    return NextResponse.json({ error: 'Failed to update printer' }, { status: 500 })
  }
})

// DELETE printer
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Check if printer exists
    const printer = await db.printer.findUnique({
      where: { id },
    })

    if (!printer) {
      return NextResponse.json({ error: 'Printer not found' }, { status: 404 })
    }

    // Soft delete the printer
    await db.printer.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete printer:', error)
    return NextResponse.json({ error: 'Failed to delete printer' }, { status: 500 })
  }
})
