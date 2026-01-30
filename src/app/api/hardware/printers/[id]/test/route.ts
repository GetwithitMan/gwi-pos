import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendToPrinter } from '@/lib/printer-connection'
import {
  buildDocument,
  buildDocumentNoCut,
  line,
  divider,
  twoColumnLine,
  ESCPOS,
  PAPER_WIDTH,
} from '@/lib/escpos/commands'
import { PrinterSettings } from '@/types/printer-settings'

// POST print test page
export async function POST(
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

    // Determine paper width
    const width = printer.paperWidth === 58 ? PAPER_WIDTH['58mm'] : PAPER_WIDTH['80mm']
    const isImpact = printer.printerType === 'impact'

    // Get printer settings to check for red ribbon
    const printerSettings = printer.printSettings as unknown as PrinterSettings | null
    const hasRedRibbon = printerSettings?.ribbon?.hasRedRibbon ?? false

    // Use correct commands based on printer type
    const LARGE = isImpact ? ESCPOS.IMPACT_DOUBLE_SIZE : ESCPOS.DOUBLE_SIZE
    const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT
    const WIDE = isImpact ? ESCPOS.IMPACT_DOUBLE_WIDTH : ESCPOS.DOUBLE_WIDTH
    const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE

    // Build test page
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
      line('!@#$%^&*()-_=+[]{}|;:\'",.<>?/'),
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

    // Add red color test if printer has red ribbon
    if (hasRedRibbon) {
      testContent.push(
        divider(width),
        line(''),
        ESCPOS.ALIGN_CENTER,
        line('Two-Color Ribbon Test'),
        ESCPOS.ALIGN_LEFT,
        line(''),
        line('This line is BLACK'),
        ESCPOS.COLOR_RED,
        line('This line is RED'),
        LARGE,
        line('LARGE RED TEXT'),
        NORMAL,
        ESCPOS.INVERSE_ON,
        line('** RED INVERTED **'),
        ESCPOS.INVERSE_OFF,
        ESCPOS.COLOR_BLACK,
        line('Back to BLACK'),
        line(''),
      )
    }

    // Add formatting test (skip bold/underline for impact - they don't support it well)
    if (!isImpact) {
      testContent.push(
        divider(width),
        line(''),
        ESCPOS.ALIGN_CENTER,
        line('Formatting Test'),
        ESCPOS.ALIGN_LEFT,
        line(''),
        ESCPOS.BOLD_ON,
        line('Bold Text'),
        ESCPOS.BOLD_OFF,
        ESCPOS.UNDERLINE_ON,
        line('Underlined Text'),
        ESCPOS.UNDERLINE_OFF,
        line(''),
      )
    }

    // Footer
    testContent.push(
      divider(width),
      line(''),
      ESCPOS.ALIGN_CENTER,
      line('Test completed at'),
      line(new Date().toLocaleString()),
      ESCPOS.ALIGN_LEFT,
      line(''),
    )

    // Build document with or without cut based on printer capabilities
    const document = printer.supportsCut
      ? buildDocument(...testContent)
      : buildDocumentNoCut(...testContent)

    // Send to printer
    const result = await sendToPrinter(printer.ipAddress, printer.port, document)

    if (result.success) {
      // Create a print job record
      await db.printJob.create({
        data: {
          locationId: printer.locationId,
          jobType: 'receipt',
          printerId: printer.id,
          status: 'sent',
          sentAt: new Date(),
        },
      })
    }

    return NextResponse.json({
      success: result.success,
      error: result.error,
      printer: {
        id: printer.id,
        name: printer.name,
      },
    })
  } catch (error) {
    console.error('Failed to print test page:', error)
    return NextResponse.json({ error: 'Failed to print test page' }, { status: 500 })
  }
}
