/**
 * Internal Socket Broadcast API
 *
 * This endpoint is called by other API routes to broadcast events
 * to connected Socket.io clients. It's an internal API not exposed
 * to the public.
 *
 * POST /api/internal/socket/broadcast
 *
 * Headers:
 *   X-Internal-Secret: {INTERNAL_API_SECRET}
 *
 * Body:
 * {
 *   type: 'NEW_ORDER' | 'ITEM_STATUS' | 'ORDER_BUMPED' | 'ENTERTAINMENT_UPDATE',
 *   locationId: string,
 *   manifest?: RoutingManifest (for NEW_ORDER)
 *   payload?: any (for other events)
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import type { RoutingResult } from '@/types/routing'

// In production, verify internal API secret
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'dev-internal-secret'

interface BroadcastRequest {
  type: 'NEW_ORDER' | 'ITEM_STATUS' | 'ORDER_BUMPED' | 'ENTERTAINMENT_UPDATE' | 'LOCATION_ALERT' | 'VOID_APPROVAL' | 'FLOOR_PLAN_UPDATE' | 'MENU_UPDATE' | 'INGREDIENT_LIBRARY_UPDATE'
  locationId: string
  routingResult?: RoutingResult
  payload?: unknown
}

export async function POST(request: NextRequest) {
  // Verify internal secret (skip in development for easier testing)
  if (process.env.NODE_ENV === 'production') {
    const secret = request.headers.get('X-Internal-Secret')
    if (secret !== INTERNAL_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const body: BroadcastRequest = await request.json()
    const { type, locationId, routingResult, payload } = body

    // For serverless/Next.js deployments, we need to import the socket module dynamically
    // In production with custom server, socket server runs in same process
    // In serverless, socket events are skipped (use external service like Pusher/Ably instead)

    let emitToTags: (tags: string[], event: string, data: unknown) => Promise<boolean>
    let emitToLocation: (locationId: string, event: string, data: unknown) => Promise<boolean>

    try {
      // Dynamic import - socket server must be initialized by custom Next.js server
      const socketModule = await import('@/lib/socket-server')
      emitToTags = socketModule.emitToTags
      emitToLocation = socketModule.emitToLocation

      if (!emitToTags || !emitToLocation) {
        throw new Error('Socket functions not exported')
      }
    } catch (error) {
      // Socket server not available (serverless deployment or socket.io not initialized)
      console.warn('[Socket Broadcast] Socket server not available:', error)
      // In serverless mode, just log and return success (events will be polled instead)
      return NextResponse.json({
        success: true,
        warning: 'Socket server not available. KDS will use polling fallback.',
      })
    }

    switch (type) {
      case 'NEW_ORDER': {
        if (!routingResult) {
          return NextResponse.json({ error: 'Missing routingResult' }, { status: 400 })
        }

        // Emit to each station's tags
        for (const manifest of routingResult.manifests) {
          const orderEvent = {
            orderId: routingResult.order.orderId,
            orderNumber: routingResult.order.orderNumber,
            orderType: routingResult.order.orderType,
            tableName: routingResult.order.tableName,
            tabName: routingResult.order.tabName,
            employeeName: routingResult.order.employeeName,
            createdAt: routingResult.order.createdAt.toISOString(),
            virtualGroupId: routingResult.order.virtualGroupId,
            virtualGroupColor: routingResult.order.virtualGroupColor,
            primaryTableName: routingResult.order.primaryTableName,
            memberTables: routingResult.order.memberTables,
            primaryItems: manifest.primaryItems.map((item) => ({
              id: item.id,
              name: item.name,
              quantity: item.quantity,
              seatNumber: item.seatNumber,
              specialNotes: item.specialNotes,
              sourceTableName: item.sourceTableName,
              modifiers: item.modifiers.map((m) => ({
                name: m.name,
                preModifier: m.preModifier,
              })),
              isPizza: item.isPizza,
              isBar: item.isBar,
              pizzaData: item.pizzaData,
            })),
            referenceItems: manifest.referenceItems.map((item) => ({
              id: item.id,
              name: item.name,
              quantity: item.quantity,
              stationName: manifest.stationName,
            })),
            matchedTags: manifest.matchedTags,
            stationId: manifest.stationId,
            stationName: manifest.stationName,
          }

          // Emit to the tags this manifest matched
          await emitToTags(manifest.matchedTags, 'kds:order-received', orderEvent)
        }

        // Also emit to location for general awareness
        await emitToLocation(locationId, 'order:created', {
          orderId: routingResult.order.orderId,
          orderNumber: routingResult.order.orderNumber,
          stations: routingResult.manifests.map((m) => m.stationName),
        })

        break
      }

      case 'ITEM_STATUS': {
        if (!payload) {
          return NextResponse.json({ error: 'Missing payload' }, { status: 400 })
        }
        // Emit to expo and location
        await emitToTags(['expo'], 'kds:item-status', payload)
        await emitToLocation(locationId, 'kds:item-status', payload)
        break
      }

      case 'ORDER_BUMPED': {
        if (!payload) {
          return NextResponse.json({ error: 'Missing payload' }, { status: 400 })
        }
        await emitToTags(['expo'], 'kds:order-bumped', payload)
        await emitToLocation(locationId, 'kds:order-bumped', payload)
        break
      }

      case 'ENTERTAINMENT_UPDATE': {
        if (!payload) {
          return NextResponse.json({ error: 'Missing payload' }, { status: 400 })
        }
        await emitToTags(['entertainment'], 'entertainment:session-update', payload)
        await emitToLocation(locationId, 'entertainment:session-update', payload)
        break
      }

      case 'LOCATION_ALERT': {
        if (!payload) {
          return NextResponse.json({ error: 'Missing payload' }, { status: 400 })
        }
        await emitToLocation(locationId, 'location:alert', payload)
        break
      }

      case 'VOID_APPROVAL': {
        if (!payload) {
          return NextResponse.json({ error: 'Missing payload' }, { status: 400 })
        }
        const voidPayload = payload as {
          type: 'approved' | 'rejected' | 'expired'
          approvalId: string
          terminalId?: string
          approvalCode?: string
          managerName: string
        }
        // Emit to specific terminal if provided
        if (voidPayload.terminalId) {
          // We'd need emitToTerminal function, for now emit to location
          // In production, use terminal-specific room
          await emitToLocation(locationId, 'void:approval-update', voidPayload)
        } else {
          // Broadcast to entire location
          await emitToLocation(locationId, 'void:approval-update', voidPayload)
        }
        break
      }

      case 'FLOOR_PLAN_UPDATE': {
        // Notify all POS terminals to refresh floor plan data
        await emitToLocation(locationId, 'floor-plan:updated', { locationId })
        break
      }

      case 'MENU_UPDATE': {
        // Notify all terminals to refresh menu data (liquor builder, POS)
        await emitToLocation(locationId, 'menu:updated', payload || { locationId })
        break
      }

      case 'INGREDIENT_LIBRARY_UPDATE': {
        // Notify all menu builder terminals to add new ingredient to local library
        if (!payload) {
          return NextResponse.json({ error: 'Missing payload' }, { status: 400 })
        }
        await emitToLocation(locationId, 'ingredient:library-update', payload)
        break
      }

      default:
        return NextResponse.json({ error: `Unknown event type: ${type}` }, { status: 400 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Socket Broadcast] Error:', error)
    return NextResponse.json(
      { error: 'Failed to broadcast event' },
      { status: 500 }
    )
  }
}
