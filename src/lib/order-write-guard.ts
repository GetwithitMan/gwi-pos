import { Prisma } from '@prisma/client'

/**
 * Prisma extension that logs warnings for direct Order/OrderItem mutations.
 *
 * These tables are LEGACY — being replaced by OrderSnapshot/OrderItemSnapshot
 * via the event-sourced pipeline. All mutations should emit events via
 * emitOrderEvent/emitOrderEvents from '@/lib/order-events/emitter'.
 *
 * This guard does NOT block writes (that would break the app during migration),
 * but logs them so they can be tracked and eliminated.
 */

const LEGACY_MODELS = new Set(['Order', 'OrderItem'])

function logLegacyWrite(model: string, action: string) {
  const stack = new Error().stack || ''
  const isFromProjector = stack.includes('projector') || stack.includes('order-events')
  const isFromBatchRoute = stack.includes('order-events/batch')

  if (!isFromProjector && !isFromBatchRoute) {
    console.warn(
      `[LEGACY_ORDER_WRITE] ${model}.${action} — ` +
      `This write should be replaced by event emission. ` +
      `See CLAUDE.md "Event-Sourced Order Writes" section.`
    )
  }
}

/**
 * Prisma client extension that intercepts legacy Order/OrderItem write operations
 * and logs warnings. Uses $extends (not deprecated $use middleware).
 *
 * Usage: const client = new PrismaClient().$extends(orderWriteGuardExtension)
 */
export const orderWriteGuardExtension = Prisma.defineExtension({
  query: {
    order: {
      async create({ args, query }) {
        logLegacyWrite('Order', 'create')
        return query(args)
      },
      async createMany({ args, query }) {
        logLegacyWrite('Order', 'createMany')
        return query(args)
      },
      async update({ args, query }) {
        logLegacyWrite('Order', 'update')
        return query(args)
      },
      async updateMany({ args, query }) {
        logLegacyWrite('Order', 'updateMany')
        return query(args)
      },
      async delete({ args, query }) {
        logLegacyWrite('Order', 'delete')
        return query(args)
      },
      async deleteMany({ args, query }) {
        logLegacyWrite('Order', 'deleteMany')
        return query(args)
      },
      async upsert({ args, query }) {
        logLegacyWrite('Order', 'upsert')
        return query(args)
      },
    },
    orderItem: {
      async create({ args, query }) {
        logLegacyWrite('OrderItem', 'create')
        return query(args)
      },
      async createMany({ args, query }) {
        logLegacyWrite('OrderItem', 'createMany')
        return query(args)
      },
      async update({ args, query }) {
        logLegacyWrite('OrderItem', 'update')
        return query(args)
      },
      async updateMany({ args, query }) {
        logLegacyWrite('OrderItem', 'updateMany')
        return query(args)
      },
      async delete({ args, query }) {
        logLegacyWrite('OrderItem', 'delete')
        return query(args)
      },
      async deleteMany({ args, query }) {
        logLegacyWrite('OrderItem', 'deleteMany')
        return query(args)
      },
      async upsert({ args, query }) {
        logLegacyWrite('OrderItem', 'upsert')
        return query(args)
      },
    },
  },
})
