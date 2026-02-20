import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import crypto from 'crypto'
import { withVenue } from '@/lib/with-venue'

// GET single terminal
export const GET = withVenue(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const terminal = await db.terminal.findUnique({
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

    if (!terminal || terminal.deletedAt) {
      return NextResponse.json({ error: 'Terminal not found' }, { status: 404 })
    }

    return NextResponse.json({ data: { terminal } })
  } catch (error) {
    console.error('Failed to fetch terminal:', error)
    return NextResponse.json({ error: 'Failed to fetch terminal' }, { status: 500 })
  }
})

// PUT update terminal
export const PUT = withVenue(async function PUT(
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
    } = body

    // Check terminal exists
    const existing = await db.terminal.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Terminal not found' }, { status: 404 })
    }

    // Validate category if provided
    if (category && !['FIXED_STATION', 'HANDHELD'].includes(category)) {
      return NextResponse.json(
        { error: 'Category must be FIXED_STATION or HANDHELD' },
        { status: 400 }
      )
    }

    // Validate IP address format if provided
    if (staticIp) {
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
      if (!ipv4Regex.test(staticIp)) {
        return NextResponse.json({ error: 'Invalid IP address format' }, { status: 400 })
      }
    }

    // If receiptPrinterId is provided, verify it exists and is a receipt printer
    if (receiptPrinterId) {
      const printer = await db.printer.findUnique({
        where: { id: receiptPrinterId },
      })
      if (!printer) {
        return NextResponse.json({ error: 'Receipt printer not found' }, { status: 400 })
      }
      if (printer.printerRole !== 'receipt') {
        return NextResponse.json(
          { error: 'Selected printer must have receipt role' },
          { status: 400 }
        )
      }
    }

    // If backupTerminalId is provided, verify it exists and is not the same terminal
    if (backupTerminalId) {
      if (backupTerminalId === id) {
        return NextResponse.json(
          { error: 'A terminal cannot be its own backup' },
          { status: 400 }
        )
      }
      const backupTerminal = await db.terminal.findUnique({
        where: { id: backupTerminalId },
      })
      if (!backupTerminal || backupTerminal.deletedAt) {
        return NextResponse.json({ error: 'Backup terminal not found' }, { status: 400 })
      }
    }

    // Validate payment reader if provided
    if (paymentReaderId) {
      const reader = await db.paymentReader.findFirst({
        where: { id: paymentReaderId, deletedAt: null },
      })
      if (!reader) {
        return NextResponse.json({ error: 'Payment reader not found' }, { status: 400 })
      }
    }

    // Validate backup payment reader if provided
    if (backupPaymentReaderId) {
      if (backupPaymentReaderId === paymentReaderId) {
        return NextResponse.json(
          { error: 'Backup reader cannot be the same as primary reader' },
          { status: 400 }
        )
      }
      const backupReader = await db.paymentReader.findFirst({
        where: { id: backupPaymentReaderId, deletedAt: null },
      })
      if (!backupReader) {
        return NextResponse.json({ error: 'Backup payment reader not found' }, { status: 400 })
      }
    }

    // Validate payment provider if provided
    if (paymentProvider && !['DATACAP_DIRECT', 'SIMULATED'].includes(paymentProvider)) {
      return NextResponse.json(
        { error: 'Payment provider must be DATACAP_DIRECT or SIMULATED' },
        { status: 400 }
      )
    }

    const terminal = await db.terminal.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(category !== undefined && { category }),
        ...(staticIp !== undefined && { staticIp: staticIp || null }),
        ...(receiptPrinterId !== undefined && { receiptPrinterId: receiptPrinterId || null }),
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
      },
      include: {
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
      },
    })

    return NextResponse.json({ data: { terminal } })
  } catch (error) {
    console.error('Failed to update terminal:', error)
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      return NextResponse.json(
        { error: 'A terminal with this name already exists at this location' },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Failed to update terminal' }, { status: 500 })
  }
})

// DELETE terminal (soft delete)
export const DELETE = withVenue(async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const existing = await db.terminal.findUnique({ where: { id } })
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: 'Terminal not found' }, { status: 404 })
    }

    // Soft delete
    await db.terminal.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        isPaired: false,
        deviceToken: null,
      },
    })

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('Failed to delete terminal:', error)
    return NextResponse.json({ error: 'Failed to delete terminal' }, { status: 500 })
  }
})
