import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { withVenue } from '@/lib/with-venue'
import { requirePermission, getActorFromRequest } from '@/lib/api-auth'
import { PERMISSIONS } from '@/lib/auth-utils'
import { emitCheckEventInTx, checkIdempotency, validateLease, isLeaseError, resolveLocationId } from '@/lib/check-events'
import { emitToLocation } from '@/lib/socket-server'
import { emitOrderEvent } from '@/lib/order-events/emitter'
import { dispatchOpenOrdersChanged } from '@/lib/socket-dispatch'
import { err, created } from '@/lib/api-response'

// ── Zod schema for POST /api/checks/[id]/items ─────────────────────
const AddItemSchema = z.object({
  commandId: z.string().uuid('commandId must be a UUID'),
  terminalId: z.string().min(1, 'terminalId is required'),
  lineItemId: z.string().uuid('lineItemId must be a UUID'),
  menuItemId: z.string().min(1, 'menuItemId is required'),
  name: z.string().min(1, 'name is required'),
  priceCents: z.number().int('priceCents must be an integer'),
  quantity: z.number().int().min(1).default(1),
  modifiers: z.array(z.record(z.string(), z.unknown())).optional(),
  seatNumber: z.number().int().optional(),
  courseNumber: z.number().int().optional(),
  specialNotes: z.string().optional(),
  itemType: z.string().optional(),
  blockTimeMinutes: z.number().int().optional(),
  isHeld: z.boolean().default(false),
  delayMinutes: z.number().int().optional(),
  soldByWeight: z.boolean().default(false),
  weight: z.number().optional(),
  weightUnit: z.string().optional(),
  unitPriceCents: z.number().int().optional(),
  pricingOptionId: z.string().optional(),
  pricingOptionLabel: z.string().optional(),
  pourSize: z.string().optional(),
  pourMultiplier: z.number().optional(),
  isTaxInclusive: z.boolean().default(false),
  pizzaConfigJson: z.string().optional(),
  comboSelectionsJson: z.string().optional(),
  itemDiscountsJson: z.string().optional(),
})

export const POST = withVenue(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: checkId } = await params
    const rawBody = await request.json()
    const parseResult = AddItemSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return err(`Validation failed: ${parseResult.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`)
    }
    const body = parseResult.data

    // Resolve locationId
    const locationId = await resolveLocationId(request)
    if (!locationId) return err('locationId is required', 400)

    // Auth
    const actor = await getActorFromRequest(request)
    if (actor.employeeId) {
      const auth = await requirePermission(actor.employeeId, locationId, PERMISSIONS.POS_ACCESS)
      if (!auth.authorized) return err(auth.error, auth.status)
    }

    // Idempotency
    const existing = await checkIdempotency(body.commandId)
    if (existing) return created(existing)

    // Validate lease — items can be added in draft or committed status
    const leaseResult = await validateLease(checkId, body.terminalId, locationId, {
      allowStatuses: ['draft', 'committed'],
    })
    if (isLeaseError(leaseResult)) return leaseResult.response
    const check = leaseResult.check
    const isCommitted = check.orderId && check.status !== 'draft'

    // Create item + emit event + record command in one transaction
    const eventPayload = {
      lineItemId: body.lineItemId,
      menuItemId: body.menuItemId,
      name: body.name,
      priceCents: body.priceCents,
      quantity: body.quantity,
      modifiers: body.modifiers ?? null,
      specialNotes: body.specialNotes ?? null,
      seatNumber: body.seatNumber ?? null,
      courseNumber: body.courseNumber ?? null,
      isHeld: body.isHeld,
      soldByWeight: body.soldByWeight,
      weight: body.weight ?? null,
      weightUnit: body.weightUnit ?? null,
      unitPriceCents: body.unitPriceCents ?? null,
      itemType: body.itemType ?? null,
      blockTimeMinutes: body.blockTimeMinutes ?? null,
      pricingOptionId: body.pricingOptionId ?? null,
      pricingOptionLabel: body.pricingOptionLabel ?? null,
      pourSize: body.pourSize ?? null,
      pourMultiplier: body.pourMultiplier ?? null,
      isTaxInclusive: body.isTaxInclusive,
      pizzaConfigJson: body.pizzaConfigJson ?? null,
      comboSelectionsJson: body.comboSelectionsJson ?? null,
    }

    const result = await db.$transaction(async (tx) => {
      const newItem = await tx.checkItem.create({
        data: {
          id: body.lineItemId,
          checkId,
          menuItemId: body.menuItemId,
          name: body.name,
          priceCents: body.priceCents,
          quantity: body.quantity,
          modifiersJson: body.modifiers ? JSON.stringify(body.modifiers) : null,
          seatNumber: body.seatNumber ?? null,
          courseNumber: body.courseNumber ?? null,
          specialNotes: body.specialNotes ?? null,
          itemType: body.itemType ?? null,
          blockTimeMinutes: body.blockTimeMinutes ?? null,
          isHeld: body.isHeld,
          delayMinutes: body.delayMinutes ?? null,
          soldByWeight: body.soldByWeight,
          weight: body.weight ?? null,
          weightUnit: body.weightUnit ?? null,
          unitPriceCents: body.unitPriceCents ?? null,
          pricingOptionId: body.pricingOptionId ?? null,
          pricingOptionLabel: body.pricingOptionLabel ?? null,
          pourSize: body.pourSize ?? null,
          pourMultiplier: body.pourMultiplier ?? null,
          isTaxInclusive: body.isTaxInclusive,
          pizzaConfigJson: body.pizzaConfigJson ?? null,
          comboSelectionsJson: body.comboSelectionsJson ?? null,
          itemDiscountsJson: body.itemDiscountsJson ?? null,
        },
      })

      // Dual-write: create linked OrderItem when check is committed
      if (isCommitted) {
        await tx.orderItem.create({
          data: {
            id: body.lineItemId,
            orderId: check.orderId as string,
            locationId,
            menuItemId: body.menuItemId,
            name: body.name,
            price: body.priceCents / 100,
            quantity: body.quantity,
            specialNotes: body.specialNotes ?? null,
            seatNumber: body.seatNumber ?? null,
            courseNumber: body.courseNumber ?? null,
            isHeld: body.isHeld,
            blockTimeMinutes: body.blockTimeMinutes ?? null,
            delayMinutes: body.delayMinutes ?? null,
            soldByWeight: body.soldByWeight,
            weight: body.weight ?? null,
            weightUnit: body.weightUnit ?? null,
            unitPrice: body.unitPriceCents != null ? body.unitPriceCents / 100 : null,
            pourSize: body.pourSize ?? null,
            pourMultiplier: body.pourMultiplier ?? null,
            isTaxInclusive: body.isTaxInclusive,
            pricingOptionId: body.pricingOptionId ?? null,
            pricingOptionLabel: body.pricingOptionLabel ?? null,
            itemTotal: (body.priceCents / 100) * body.quantity,
            modifiers: body.modifiers ? {
              create: body.modifiers.map((mod: Record<string, unknown>) => ({
                locationId,
                modifierId: (mod.modifierId as string) || null,
                name: mod.name as string,
                price: mod.price as number,
                quantity: (mod.quantity as number) ?? 1,
                preModifier: (mod.preModifier as string) || null,
                depth: (mod.depth as number) ?? 0,
                spiritTier: (mod.spiritTier as string) || null,
                linkedBottleProductId: (mod.linkedBottleProductId as string) || null,
                isCustomEntry: (mod.isCustomEntry as boolean) || false,
                isNoneSelection: (mod.isNoneSelection as boolean) || false,
                swapTargetName: (mod.swapTargetName as string) || null,
                swapTargetItemId: (mod.swapTargetItemId as string) || null,
                swapPricingMode: (mod.swapPricingMode as string) || null,
                swapEffectivePrice: (mod.swapEffectivePrice as number) ?? null,
              })),
            } : undefined,
          },
        })
      }

      await tx.check.update({ where: { id: checkId }, data: { updatedAt: new Date() } })

      const eventResult = await emitCheckEventInTx(tx, locationId, checkId, 'CHECK_ITEM_ADDED', {
        ...eventPayload,
        lineItemId: newItem.id,
      }, { commandId: body.commandId })

      await tx.processedCommand.create({
        data: {
          commandId: body.commandId,
          resultJson: JSON.stringify(newItem),
        },
      })

      return { item: newItem, eventResult }
    })

    // Broadcast check:event after txn commits — fire-and-forget
    void emitToLocation(locationId, 'check:event', {
      eventId: result.eventResult.eventId,
      checkId,
      serverSequence: result.eventResult.serverSequence,
      type: 'CHECK_ITEM_ADDED',
      payload: { ...eventPayload, lineItemId: result.item.id },
      commandId: body.commandId,
      deviceId: body.terminalId,
    }).catch(console.error)

    // If committed, also emit order events for terminals listening to order changes
    if (isCommitted) {
      void emitOrderEvent(locationId, check.orderId as string, 'ITEM_ADDED', {
        lineItemId: body.lineItemId,
        menuItemId: body.menuItemId,
        name: body.name,
        priceCents: body.priceCents,
        quantity: body.quantity,
        modifiers: body.modifiers ?? null,
        modifiersJson: body.modifiers ? JSON.stringify(body.modifiers) : null,
        specialNotes: body.specialNotes ?? null,
        seatNumber: body.seatNumber ?? null,
        courseNumber: body.courseNumber ?? null,
        isHeld: body.isHeld,
        soldByWeight: body.soldByWeight,
        weight: body.weight ?? null,
        weightUnit: body.weightUnit ?? null,
        unitPriceCents: body.unitPriceCents ?? null,
        itemType: body.itemType ?? null,
        blockTimeMinutes: body.blockTimeMinutes ?? null,
        pricingOptionId: body.pricingOptionId ?? null,
        pricingOptionLabel: body.pricingOptionLabel ?? null,
        pourSize: body.pourSize ?? null,
        pourMultiplier: body.pourMultiplier ?? null,
        isTaxInclusive: body.isTaxInclusive,
      }).catch(console.error)
      void dispatchOpenOrdersChanged(locationId, {
        trigger: 'item_updated',
        orderId: check.orderId as string,
      }).catch(console.error)
    }

    return created(result.item)
  } catch (error) {
    console.error('Failed to add check item:', error)
    return err('Failed to add check item', 500)
  }
})
