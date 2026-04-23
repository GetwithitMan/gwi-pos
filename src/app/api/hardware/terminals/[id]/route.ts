import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { withVenue } from '@/lib/with-venue'
import { notifyDataChanged } from '@/lib/cloud-notify'
import { pushUpstream } from '@/lib/sync/outage-safe-write'
import { withAuth } from '@/lib/api-auth-middleware'
import { err, notFound, ok } from '@/lib/api-response'
import { clearCfdMapping } from '@/lib/socket-server'
import { dispatchCFDIdle } from '@/lib/socket-dispatch/cfd-dispatch'

// GET single terminal
export const GET = withVenue(withAuth('ADMIN', async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    let terminal
    try {
      terminal = await db.terminal.findUnique({
        where: { id },
        include: {
          receiptPrinter: {
            select: {
              id: true,
              name: true,
              ipAddress: true,
              printerRole: true,
            },
          },
          paymentReader: {
            select: {
              id: true,
              name: true,
              ipAddress: true,
              port: true,
              serialNumber: true,
              communicationMode: true,
              isOnline: true,
              lastSeenAt: true,
            },
          },
          backupPaymentReader: {
            select: {
              id: true,
              name: true,
              ipAddress: true,
              isOnline: true,
            },
          },
          cfdTerminal: {
            select: {
              id: true,
              name: true,
              category: true,
              cfdIpAddress: true,
              cfdConnectionMode: true,
              cfdSerialNumber: true,
              lastSeenAt: true,
            },
          },
          scale: {
            select: {
              id: true,
              name: true,
              portPath: true,
              isConnected: true,
            },
          },
        },
      })
    } catch {
      // Fallback for un-migrated databases without Scale table
      terminal = await db.terminal.findUnique({
        where: { id },
        include: {
          receiptPrinter: {
            select: {
              id: true,
              name: true,
              ipAddress: true,
              printerRole: true,
            },
          },
          paymentReader: {
            select: {
              id: true,
              name: true,
              ipAddress: true,
              port: true,
              serialNumber: true,
              communicationMode: true,
              isOnline: true,
              lastSeenAt: true,
            },
          },
          backupPaymentReader: {
            select: {
              id: true,
              name: true,
              ipAddress: true,
              isOnline: true,
            },
          },
        },
      })
    }

    if (!terminal || terminal.deletedAt) {
      return notFound('Terminal not found')
    }

    return ok({ terminal })
  } catch (error) {
    console.error('Failed to fetch terminal:', error)
    return err('Failed to fetch terminal', 500)
  }
}))

// PUT update terminal
export const PUT = withVenue(withAuth('ADMIN', async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    const {
      name,
      category,
      staticIp,
      receiptPrinterId,
      kitchenPrinterId,
      barPrinterId,
      roleSkipRules,
      forceAllPrints,
      isActive,
      sortOrder,
      backupTerminalId,
      failoverEnabled,
      failoverTimeout,
      // Payment reader binding
      paymentReaderId,
      paymentProvider,
      backupPaymentReaderId,
      readerFailoverTimeout,
      // Scale binding
      scaleId,
      // CFD pairing
      cfdTerminalId,
      cfdIpAddress,
      cfdConnectionMode,
      cfdSerialNumber,
    } = body

    // Check terminal exists
    const existing = await db.terminal.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return notFound('Terminal not found')
    }

    // If name is being changed, check for active duplicate (soft-delete-safe)
    if (name !== undefined && name !== existing.name) {
      const nameConflict = await db.terminal.findFirst({
        where: { locationId: existing.locationId, name, deletedAt: null, id: { not: id } },
        select: { id: true },
      })
      if (nameConflict) {
        return err('A terminal with this name already exists at this location', 409)
      }
    }

    // Validate category if provided
    if (category && !['FIXED_STATION', 'HANDHELD'].includes(category)) {
      return err('Category must be FIXED_STATION or HANDHELD')
    }

    // Validate IP address format if provided
    if (staticIp) {
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
      if (!ipv4Regex.test(staticIp)) {
        return err('Invalid IP address format')
      }
    }

    // If receiptPrinterId is provided, verify it exists and is a receipt printer
    if (receiptPrinterId) {
      const printer = await db.printer.findUnique({
        where: { id: receiptPrinterId },
      })
      if (!printer) {
        return err('Receipt printer not found')
      }
      if (printer.printerRole !== 'receipt') {
        return err('Selected printer must have receipt role')
      }
    }

    // If backupTerminalId is provided, verify it exists and is not the same terminal
    if (backupTerminalId) {
      if (backupTerminalId === id) {
        return err('A terminal cannot be its own backup')
      }
      const backupTerminal = await db.terminal.findUnique({
        where: { id: backupTerminalId },
      })
      if (!backupTerminal || backupTerminal.deletedAt) {
        return err('Backup terminal not found')
      }
    }

    // Validate payment reader if provided
    if (paymentReaderId) {
      const reader = await db.paymentReader.findFirst({
        where: { id: paymentReaderId, deletedAt: null },
      })
      if (!reader) {
        return err('Payment reader not found')
      }
    }

    // Validate backup payment reader if provided
    if (backupPaymentReaderId) {
      if (backupPaymentReaderId === paymentReaderId) {
        return err('Backup reader cannot be the same as primary reader')
      }
      const backupReader = await db.paymentReader.findFirst({
        where: { id: backupPaymentReaderId, deletedAt: null },
      })
      if (!backupReader) {
        return err('Backup payment reader not found')
      }
    }

    // Validate scale if provided (skip if table doesn't exist)
    let scaleAvailable = true
    if (scaleId) {
      try {
        const scale = await db.scale.findFirst({
          where: { id: scaleId, deletedAt: null },
        })
        if (!scale) {
          return err('Scale not found')
        }
      } catch {
        // Scale table doesn't exist on un-migrated DB — ignore scaleId
        scaleAvailable = false
      }
    }

    // Validate payment provider if provided
    if (paymentProvider && paymentProvider !== 'DATACAP_DIRECT') {
      return err('Payment provider must be DATACAP_DIRECT')
    }

    const baseData = {
      ...(name !== undefined && { name }),
      ...(category !== undefined && { category }),
      ...(staticIp !== undefined && { staticIp: staticIp || null }),
      ...(receiptPrinterId !== undefined && { receiptPrinterId: receiptPrinterId || null }),
      ...(kitchenPrinterId !== undefined && { kitchenPrinterId: kitchenPrinterId || null }),
      ...(barPrinterId !== undefined && { barPrinterId: barPrinterId || null }),
      ...(roleSkipRules !== undefined && { roleSkipRules }),
      ...(forceAllPrints !== undefined && { forceAllPrints }),
      ...(isActive !== undefined && { isActive }),
      ...(sortOrder !== undefined && { sortOrder }),
      ...(backupTerminalId !== undefined && { backupTerminalId: backupTerminalId || null }),
      ...(failoverEnabled !== undefined && { failoverEnabled }),
      ...(failoverTimeout !== undefined && { failoverTimeout }),
      // Payment reader binding
      ...(paymentReaderId !== undefined && { paymentReaderId: paymentReaderId || null }),
      ...(paymentProvider !== undefined && { paymentProvider }),
      ...(backupPaymentReaderId !== undefined && { backupPaymentReaderId: backupPaymentReaderId || null }),
      ...(readerFailoverTimeout !== undefined && { readerFailoverTimeout }),
      // CFD pairing
      ...(cfdTerminalId !== undefined && { cfdTerminalId: cfdTerminalId || null }),
      ...(cfdIpAddress !== undefined && { cfdIpAddress: cfdIpAddress || null }),
      ...(cfdConnectionMode !== undefined && { cfdConnectionMode: cfdConnectionMode || null }),
      ...(cfdSerialNumber !== undefined && { cfdSerialNumber: cfdSerialNumber || null }),
      lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
    }
    const baseInclude = {
      receiptPrinter: {
        select: {
          id: true,
          name: true,
          ipAddress: true,
          printerRole: true,
        },
      },
      backupTerminal: {
        select: {
          id: true,
          name: true,
          isOnline: true,
          lastSeenAt: true,
        },
      },
      paymentReader: {
        select: {
          id: true,
          name: true,
          ipAddress: true,
          port: true,
          serialNumber: true,
          communicationMode: true,
          isOnline: true,
          lastSeenAt: true,
        },
      },
      backupPaymentReader: {
        select: {
          id: true,
          name: true,
          ipAddress: true,
          isOnline: true,
        },
      },
      cfdTerminal: {
        select: {
          id: true,
          name: true,
          category: true,
          cfdIpAddress: true,
          cfdConnectionMode: true,
          cfdSerialNumber: true,
          lastSeenAt: true,
        },
      },
    }

    let terminal
    try {
      terminal = await db.terminal.update({
        where: { id },
        data: {
          ...baseData,
          // Scale binding
          ...(scaleAvailable && scaleId !== undefined && { scaleId: scaleId || null }),
        },
        include: {
          ...baseInclude,
          scale: {
            select: {
              id: true,
              name: true,
              portPath: true,
              isConnected: true,
            },
          },
        },
      })
    } catch {
      // Fallback for un-migrated databases without Scale table/column
      terminal = await db.terminal.update({
        where: { id },
        data: baseData,
        include: baseInclude,
      })
    }

    void notifyDataChanged({ locationId: existing.locationId, domain: 'hardware', action: 'updated', entityId: id })
    void pushUpstream()

    return ok({ terminal })
  } catch (error) {
    console.error('Failed to update terminal:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return err('A terminal with this name already exists at this location')
    }
    return err('Failed to update terminal', 500)
  }
}))

// DELETE terminal (soft delete)
export const DELETE = withVenue(withAuth('ADMIN', async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.terminal.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return notFound('Terminal not found')
    }

    // C8: If this is a CFD being deleted, unpair any registers pointing to it
    if (existing.cfdTerminalId) {
      dispatchCFDIdle(existing.locationId, existing.cfdTerminalId)
    } else if ((existing as any).category === 'CFD_DISPLAY') {
      dispatchCFDIdle(existing.locationId, id)
    }
    if (existing.cfdTerminalId) {
      clearCfdMapping(existing.cfdTerminalId)
    }
    clearCfdMapping(id)
    await (db.terminal.updateMany as any)({
      where: { cfdTerminalId: id, deletedAt: null },
      data: { cfdTerminalId: null, cfdIpAddress: null, cfdConnectionMode: null, lastMutatedBy: 'local' },
    })

    // Soft delete — clear all device-claiming fields so hardware can re-pair
    await db.terminal.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        isPaired: false,
        isOnline: false,
        deviceToken: null,
        deviceFingerprint: null,
        deviceInfo: Prisma.JsonNull,
        pushToken: null,
        lastMutatedBy: process.env.VERCEL ? 'cloud' : 'local',
      },
    })

    void notifyDataChanged({ locationId: existing.locationId, domain: 'hardware', action: 'deleted', entityId: id })
    void pushUpstream()

    return ok({ success: true })
  } catch (error) {
    console.error('Failed to delete terminal:', error)
    return err('Failed to delete terminal', 500)
  }
}))
