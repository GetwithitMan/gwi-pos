import { Prisma } from '@/generated/prisma/client'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('order-write-guard')

/**
 * Event-Source Migration Guard
 *
 * Prisma extension that logs warnings when Order/OrderItem are written
 * directly instead of through the event-sourced pipeline.
 *
 * Context: Order and OrderItem are being migrated to event-sourced writes
 * via emitOrderEvent/emitOrderEvents. The canonical read model is now
 * OrderSnapshot/OrderItemSnapshot (projected from events).
 *
 * This guard tracks remaining direct-write call sites so they can be
 * systematically migrated. It does NOT block writes — that would break
 * the app during the transition. Writes from the event projector and
 * batch ingester are excluded (they ARE the event pipeline).
 *
 * Remove this guard once all Order/OrderItem writes go through events.
 */

function logDirectWrite(model: string, action: string) {
  const stack = new Error().stack || ''
  // Exclude writes from the event pipeline itself
  const isFromProjector = stack.includes('projector') || stack.includes('order-events')
  const isFromBatchRoute = stack.includes('order-events/batch')

  if (!isFromProjector && !isFromBatchRoute) {
    log.warn(`[ORDER_WRITE_GUARD] ${model}.${action} — ` +
      `Direct write detected. Migrate to event emission. ` +
      `See CLAUDE.md "Event-Sourced Orders" section.`)
  }
}

/**
 * Prisma client extension that intercepts direct Order/OrderItem write operations
 * and logs warnings for migration tracking.
 *
 * Usage: const client = new PrismaClient().$extends(orderWriteGuardExtension)
 */
export const orderWriteGuardExtension = Prisma.defineExtension({
  query: {
    order: {
      async create({ args, query }) {
        logDirectWrite('Order', 'create')
        return query(args)
      },
      async createMany({ args, query }) {
        logDirectWrite('Order', 'createMany')
        return query(args)
      },
      async update({ args, query }) {
        logDirectWrite('Order', 'update')
        return query(args)
      },
      async updateMany({ args, query }) {
        logDirectWrite('Order', 'updateMany')
        return query(args)
      },
      async delete({ args, query }) {
        logDirectWrite('Order', 'delete')
        return query(args)
      },
      async deleteMany({ args, query }) {
        logDirectWrite('Order', 'deleteMany')
        return query(args)
      },
      async upsert({ args, query }) {
        logDirectWrite('Order', 'upsert')
        return query(args)
      },
    },
    orderItem: {
      async create({ args, query }) {
        logDirectWrite('OrderItem', 'create')
        return query(args)
      },
      async createMany({ args, query }) {
        logDirectWrite('OrderItem', 'createMany')
        return query(args)
      },
      async update({ args, query }) {
        logDirectWrite('OrderItem', 'update')
        return query(args)
      },
      async updateMany({ args, query }) {
        logDirectWrite('OrderItem', 'updateMany')
        return query(args)
      },
      async delete({ args, query }) {
        logDirectWrite('OrderItem', 'delete')
        return query(args)
      },
      async deleteMany({ args, query }) {
        logDirectWrite('OrderItem', 'deleteMany')
        return query(args)
      },
      async upsert({ args, query }) {
        logDirectWrite('OrderItem', 'upsert')
        return query(args)
      },
    },
  },
})
