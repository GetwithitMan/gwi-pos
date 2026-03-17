import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { withVenue } from '@/lib/with-venue'
import { sendToPrinter } from '@/lib/printer-connection'
import { buildCakeBakerSheet, type CakeBakerSheetData, type CakeBakerSheetTier } from '@/lib/escpos/cake-baker-sheet'
import { parseCakeConfig, parseDesignConfig, parseDietaryConfig } from '@/lib/cake-orders/schemas'

/**
 * POST /api/cake-orders/[id]/print-baker-sheet
 *
 * Prints a baker production sheet for a cake order.
 * Permission: cake.view
 */
export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))

    // ── Resolve actor ─────────────────────────────────────────────────
    const actor = await getActorFromRequest(request)
    const employeeId = actor.employeeId || body.employeeId
    const locationId = actor.locationId || body.locationId

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // ── Permission check ──────────────────────────────────────────────
    const auth = await requirePermission(employeeId, locationId, PERMISSIONS.CAKE_VIEW)
    if (!auth.authorized) {
      return NextResponse.json(
        { code: 'PERMISSION_DENIED', message: auth.error },
        { status: auth.status },
      )
    }

    // ── Fetch CakeOrder + Customer ────────────────────────────────────
    const orders = await db.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT co.*,
              c."firstName" AS "customerFirstName",
              c."lastName" AS "customerLastName",
              c."phone" AS "customerPhone",
              c."email" AS "customerEmail",
              c."allergies" AS "customerAllergies"
       FROM "CakeOrder" co
       LEFT JOIN "Customer" c ON c."id" = co."customerId"
       WHERE co."id" = $1 AND co."locationId" = $2 AND co."deletedAt" IS NULL
       LIMIT 1`,
      id,
      locationId,
    )

    if (orders.length === 0) {
      return NextResponse.json({ error: 'Cake order not found' }, { status: 404 })
    }

    const order = orders[0]

    // ── Parse JSONB configs ───────────────────────────────────────────
    const cakeConfig = parseCakeConfig(order.cakeConfig)
    const designConfig = parseDesignConfig(order.designConfig)
    const dietaryConfig = parseDietaryConfig(order.dietaryConfig)

    // ── Build tier data ───────────────────────────────────────────────
    const tiers: CakeBakerSheetTier[] = cakeConfig.tiers.map((tier, idx) => {
      // Find modifiers by group type name pattern
      const findMod = (keyword: string): string | null => {
        const mod = tier.modifiers.find(
          (m) => m.modifierGroupName.toLowerCase().includes(keyword)
        )
        return mod?.modifierName ?? null
      }

      // Find dietary info from dietaryConfig for this tier
      const dietaryReq = dietaryConfig.requirements.find((r) => r.tierIndex === idx)
      const dietaryNames = dietaryReq?.modifiers.map((m) => m.modifierName).filter(Boolean) ?? []
      const dietaryStr = dietaryNames.length > 0 ? dietaryNames.join(', ') : (dietaryReq?.notes ?? null)

      return {
        name: tier.menuItemName,
        flavor: findMod('flavor'),
        filling: findMod('filling'),
        frosting: findMod('frost'),
        dietary: dietaryStr,
      }
    })

    // ── Build decorations list ────────────────────────────────────────
    const decorations: string[] = designConfig.decorations.map((d) => d.modifierName)

    // ── Assemble baker sheet data ─────────────────────────────────────
    const customerName = [order.customerFirstName, order.customerLastName]
      .filter(Boolean)
      .join(' ')
      .trim() || 'Guest'

    const bakerSheetData: CakeBakerSheetData = {
      orderNumber: (order.orderNumber as number) ?? id.slice(0, 8),
      eventDate: order.eventDate
        ? new Date(order.eventDate as string).toLocaleDateString('en-US', { dateStyle: 'medium' })
        : 'TBD',
      eventTime: (order.eventTimeStart as string) ?? null,
      customerName,
      customerAllergies: (order.customerAllergies as string) ?? null,
      eventType: (order.eventType as string) ?? null,
      guestCount: (order.guestCount as number) ?? null,
      tiers,
      decorations,
      messageText: designConfig.messageText,
      messagePlacement: designConfig.messagePlacement,
      deliveryType: (order.deliveryType as string) ?? null,
      deliveryAddress: (order.deliveryAddress as string) ?? null,
      notes: (order.notes as string) ?? (order.internalNotes as string) ?? null,
    }

    // Combine notes + internalNotes if both exist
    if (order.notes && order.internalNotes) {
      bakerSheetData.notes = `${order.notes}\n---\nInternal: ${order.internalNotes}`
    }

    // ── Build ESC/POS buffer ──────────────────────────────────────────
    const buffer = buildCakeBakerSheet(bakerSheetData)

    // ── Find target printer ───────────────────────────────────────────
    // Use printerId from request body, or fall back to first active receipt printer
    let printer: { id: string; ipAddress: string; port: number } | null = null

    if (body.printerId) {
      const rows: any[] = await db.$queryRawUnsafe(
        `SELECT id, "ipAddress", port FROM "Printer"
         WHERE id = $1 AND "locationId" = $2 AND "isActive" = true LIMIT 1`,
        body.printerId,
        locationId,
      )
      if (rows.length > 0) printer = rows[0]
    }

    // Fallback: first active receipt printer
    if (!printer) {
      const rows: any[] = await db.$queryRawUnsafe(
        `SELECT id, "ipAddress", port FROM "Printer"
         WHERE "locationId" = $1 AND "isActive" = true AND "printerRole" = 'receipt'
         ORDER BY "createdAt" ASC LIMIT 1`,
        locationId,
      )
      if (rows.length > 0) printer = rows[0]
    }

    if (!printer) {
      return NextResponse.json(
        { error: 'No active printer found. Configure a receipt printer in Settings > Hardware.' },
        { status: 422 },
      )
    }

    // ── Send to printer ───────────────────────────────────────────────
    const result = await sendToPrinter(printer.ipAddress, printer.port ?? 9100, buffer)

    if (!result.success) {
      console.error(`[cake-baker-sheet] Print failed for order ${id}:`, result.error)
      return NextResponse.json(
        { error: `Print failed: ${result.error}` },
        { status: 502 },
      )
    }

    // ── Log print job ─────────────────────────────────────────────────
    try {
      await db.$queryRawUnsafe(
        `INSERT INTO "PrintJob" (id, "locationId", "printerId", "jobType", "status", "createdAt", "updatedAt")
         VALUES (gen_random_uuid()::text, $1, $2, 'cake_baker_sheet', 'completed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        locationId,
        printer.id,
      )
    } catch {
      // Non-critical — log but don't fail
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to print baker sheet:', error)
    return NextResponse.json({ error: 'Failed to print baker sheet' }, { status: 500 })
  }
})
