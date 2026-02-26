/**
 * Hardware Command Worker
 *
 * Polls the HardwareCommand table for PENDING commands written by the cloud POS (Vercel)
 * and executes them locally on the NUC where hardware is physically connected.
 *
 * Commands: PRINTER_PING, PRINTER_TEST_PAGE, PAYMENT_READER_PING
 *
 * Only runs on NUC (skipped when process.env.VERCEL is set).
 */

import { masterClient } from './db'
import { testPrinterConnection, sendToPrinter } from './printer-connection'
import {
  buildDocument,
  buildDocumentNoCut,
  line,
  divider,
  twoColumnLine,
  ESCPOS,
  PAPER_WIDTH,
} from './escpos/commands'
import { getDatacapClient } from './datacap/helpers'
import type { PrinterSettings } from '@/types/print'

const POLL_INTERVAL = 3000 // 3 seconds
const CLEANUP_AGE = 5 * 60 * 1000 // 5 minutes

export function startHardwareCommandWorker() {
  // Skip on Vercel — this worker only runs on the NUC
  if (process.env.VERCEL) return

  console.log('[HardwareCmd] Worker started (polling every 3s)')

  async function processPendingCommands() {
    try {
      // Find pending commands that haven't expired
      const commands = await masterClient.hardwareCommand.findMany({
        where: {
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        take: 10,
      })

      for (const cmd of commands) {
        // Optimistic lock: set to PROCESSING
        const updated = await masterClient.hardwareCommand.updateMany({
          where: { id: cmd.id, status: 'PENDING' },
          data: { status: 'PROCESSING' },
        })
        if (updated.count === 0) continue // Already picked up by another worker

        try {
          let result: Record<string, unknown>

          switch (cmd.commandType) {
            case 'PRINTER_PING':
              result = await handlePrinterPing(cmd.targetDeviceId)
              break
            case 'PRINTER_TEST_PAGE':
              result = await handlePrinterTestPage(cmd.targetDeviceId)
              break
            case 'PAYMENT_READER_PING':
              result = await handlePaymentReaderPing(cmd.targetDeviceId)
              break
            default:
              result = { success: false, error: `Unknown command type: ${cmd.commandType}` }
          }

          await masterClient.hardwareCommand.update({
            where: { id: cmd.id },
            data: {
              status: result.success ? 'COMPLETED' : 'FAILED',
              resultPayload: result as any,
              errorMessage: result.success ? null : (result.error as string) || null,
              completedAt: new Date(),
            },
          })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Unknown error'
          await masterClient.hardwareCommand.update({
            where: { id: cmd.id },
            data: {
              status: 'FAILED',
              resultPayload: { success: false, error: errorMsg } as any,
              errorMessage: errorMsg,
              completedAt: new Date(),
            },
          })
        }
      }

      // Cleanup expired commands older than 5 minutes
      await masterClient.hardwareCommand.deleteMany({
        where: {
          createdAt: { lt: new Date(Date.now() - CLEANUP_AGE) },
        },
      }).catch(() => {}) // Ignore cleanup errors

    } catch (err) {
      // Don't crash the worker on transient errors
      console.error('[HardwareCmd] Poll error:', err)
    }
  }

  const timer = setInterval(processPendingCommands, POLL_INTERVAL)
  timer.unref() // Don't keep process alive just for this
}

// ============================================================================
// Command Handlers
// ============================================================================

async function handlePrinterPing(printerId: string): Promise<Record<string, unknown>> {
  const printer = await masterClient.printer.findUnique({ where: { id: printerId } })
  if (!printer) return { success: false, error: 'Printer not found' }

  const result = await testPrinterConnection(printer.ipAddress, printer.port)

  // Update printer status locally
  await masterClient.printer.update({
    where: { id: printerId },
    data: {
      lastPingAt: new Date(),
      lastPingOk: result.success,
    },
  })

  return {
    success: result.success,
    responseTime: result.responseTime,
    error: result.error,
  }
}

async function handlePrinterTestPage(printerId: string): Promise<Record<string, unknown>> {
  const printer = await masterClient.printer.findUnique({ where: { id: printerId } })
  if (!printer) return { success: false, error: 'Printer not found' }

  // Build test page (same logic as /api/hardware/printers/[id]/test)
  const width = printer.paperWidth === 58 ? PAPER_WIDTH['58mm'] : PAPER_WIDTH['80mm']
  const isImpact = printer.printerType === 'impact'
  const printerSettings = printer.printSettings as unknown as PrinterSettings | null
  const hasRedRibbon = printerSettings?.ribbon?.hasRedRibbon ?? false

  const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
  const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
  const WIDE = isImpact ? ESCPOS.IMPACT_DOUBLE_WIDTH : ESCPOS.DOUBLE_WIDTH
  const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE

  const testContent: Buffer[] = [
    ESCPOS.ALIGN_CENTER,
    LARGE,
    line('GWI POS'),
    NORMAL,
    line('Test Page'),
    ESCPOS.ALIGN_LEFT,
    divider(width),
    line(''),
    twoColumnLine('Printer:', printer.name, width),
    twoColumnLine('Type:', printer.printerType, width),
    twoColumnLine('Model:', printer.model || 'Not specified', width),
    twoColumnLine('IP:', printer.ipAddress, width),
    twoColumnLine('Port:', String(printer.port), width),
    twoColumnLine('Role:', printer.printerRole, width),
    twoColumnLine('Paper Width:', `${printer.paperWidth}mm`, width),
    twoColumnLine('Red Ribbon:', hasRedRibbon ? 'Enabled' : 'Not configured', width),
    line(''),
    divider(width),
    line(''),
    ESCPOS.ALIGN_CENTER,
    line('Character Test'),
    ESCPOS.ALIGN_LEFT,
    line(''),
    line('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
    line('abcdefghijklmnopqrstuvwxyz'),
    line('0123456789'),
    line('!@#$%^&*()-_=+[]{}|;:\'",.< >?/'),
    line(''),
    divider(width),
    line(''),
    ESCPOS.ALIGN_CENTER,
    line('Text Size Test'),
    ESCPOS.ALIGN_LEFT,
    line(''),
    line('Normal Text'),
    TALL,
    line('Double Height'),
    NORMAL,
    WIDE,
    line('Double Width'),
    NORMAL,
    LARGE,
    line('Double Size'),
    NORMAL,
    line(''),
  ]

  if (hasRedRibbon) {
    testContent.push(
      divider(width), line(''),
      ESCPOS.ALIGN_CENTER, line('Two-Color Ribbon Test'), ESCPOS.ALIGN_LEFT, line(''),
      line('This line is BLACK'),
      ESCPOS.COLOR_RED, line('This line is RED'),
      LARGE, line('LARGE RED TEXT'), NORMAL,
      ESCPOS.INVERSE_ON, line('** RED INVERTED **'), ESCPOS.INVERSE_OFF,
      ESCPOS.COLOR_BLACK, line('Back to BLACK'), line(''),
    )
  }

  if (!isImpact) {
    testContent.push(
      divider(width), line(''),
      ESCPOS.ALIGN_CENTER, line('Formatting Test'), ESCPOS.ALIGN_LEFT, line(''),
      ESCPOS.BOLD_ON, line('Bold Text'), ESCPOS.BOLD_OFF,
      ESCPOS.UNDERLINE_ON, line('Underlined Text'), ESCPOS.UNDERLINE_OFF,
      line(''),
    )
  }

  testContent.push(
    divider(width), line(''),
    ESCPOS.ALIGN_CENTER,
    line('Test completed at'),
    line(new Date().toLocaleString()),
    ESCPOS.ALIGN_LEFT, line(''),
  )

  const document = printer.supportsCut
    ? buildDocument(...testContent)
    : buildDocumentNoCut(...testContent)

  const result = await sendToPrinter(printer.ipAddress, printer.port, document)

  if (result.success) {
    await masterClient.printJob.create({
      data: {
        locationId: printer.locationId,
        jobType: 'receipt',
        printerId: printer.id,
        status: 'sent',
        sentAt: new Date(),
      },
    })
  }

  return { success: result.success, error: result.error }
}

async function handlePaymentReaderPing(readerId: string): Promise<Record<string, unknown>> {
  const reader = await masterClient.paymentReader.findFirst({
    where: { id: readerId, deletedAt: null },
  })
  if (!reader) return { success: false, error: 'Payment reader not found' }

  const startTime = Date.now()

  try {
    const client = await getDatacapClient(reader.locationId)
    const response = await client.padReset(readerId)

    const responseTime = Date.now() - startTime
    const isOnline = response.cmdStatus === 'Success'

    await masterClient.paymentReader.update({
      where: { id: readerId },
      data: {
        isOnline,
        lastSeenAt: isOnline ? new Date() : reader.lastSeenAt,
        avgResponseTime: responseTime,
        ...(isOnline && { lastError: null, lastErrorAt: null }),
      },
    })

    return { success: isOnline, isOnline, responseTimeMs: responseTime }
  } catch (err) {
    const responseTime = Date.now() - startTime
    const errorMessage = err instanceof Error ? err.message : 'Connection failed'

    await masterClient.paymentReader.update({
      where: { id: readerId },
      data: {
        isOnline: false,
        lastError: errorMessage,
        lastErrorAt: new Date(),
      },
    })

    return { success: false, isOnline: false, error: errorMessage, responseTimeMs: responseTime }
  }
}
