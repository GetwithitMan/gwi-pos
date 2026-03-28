import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { emitToLocation } from '@/lib/socket-server'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { createChildLogger } from '@/lib/logger'
import { err, notFound, ok } from '@/lib/api-response'
const log = createChildLogger('hardware-printers')

// GET single printer
export const GET = withVenue(withAuth('ADMIN', async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const printer = await db.printer.findUnique({
      where: { id },
    })

    if (!printer) {
      return notFound('Printer not found')
    }

    return ok({ printer })
  } catch (error) {
    console.error('Failed to fetch printer:', error)
    return err('Failed to fetch printer', 500)
  }
}))

// PUT update printer
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
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
      return notFound('Printer not found')
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

    // Notify all terminals that hardware config changed
    void emitToLocation(existingPrinter.locationId, 'settings:updated', { source: 'printer', action: 'updated', printerId: id }).catch(err => log.warn({ err }, 'Background task failed'))
    void notifyDataChanged({ locationId: existingPrinter.locationId, domain: 'hardware', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({ printer })
  } catch (error) {
    console.error('Failed to update printer:', error)
    return err('Failed to update printer', 500)
  }
}))

// DELETE printer
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
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
      return notFound('Printer not found')
    }

    // Soft delete the printer
    await db.printer.update({
      where: { id },
      data: { deletedAt: new Date() },
    })

    // Notify all terminals that hardware config changed
    void emitToLocation(printer.locationId, 'settings:updated', { source: 'printer', action: 'deleted', printerId: id }).catch(err => log.warn({ err }, 'Background task failed'))
    void notifyDataChanged({ locationId: printer.locationId, domain: 'hardware', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete printer:', error)
    return err('Failed to delete printer', 500)
  }
}))
