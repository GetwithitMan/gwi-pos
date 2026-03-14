#!/usr/bin/env tsx
/**
 * Cleanup Stuck Orders
 *
 * Finds and closes two types of stuck orders:
 *   1. Empty zombie open orders — open/sent/in_progress with 0 items and $0 total
 *   2. Stranded split parents — status='split' where all children are closed
 *
 * Usage:
 *   npx tsx scripts/cleanup-stuck-orders.ts [--dry-run] [--location <locationId>]
 */

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const PREFIX = '[cleanup-stuck-orders]'

// ── CLI args ──────────────────────────────────────────────────────
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const locationIdx = args.indexOf('--location')
const locationId = locationIdx !== -1 ? args[locationIdx + 1] : undefined

if (dryRun) console.log(`${PREFIX} DRY RUN — no writes will be made`)
if (locationId) console.log(`${PREFIX} Filtering to location: ${locationId}`)

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

  try {
    // ── Type 1: Empty zombie open orders ──────────────────────────
    console.log(`\n${PREFIX} === Type 1: Empty zombie open orders ===`)

    const zombieWhere: any = {
      status: { in: ['open', 'sent', 'in_progress'] },
      itemCount: 0,
      total: { lte: 0 },
      deletedAt: null,
    }
    if (locationId) zombieWhere.locationId = locationId

    const zombies = await prisma.order.findMany({
      where: zombieWhere,
      select: { id: true, orderNumber: true, status: true, locationId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    console.log(`${PREFIX} Found ${zombies.length} empty zombie orders`)

    if (!dryRun && zombies.length > 0) {
      for (const z of zombies) {
        await prisma.order.update({
          where: { id: z.id },
          data: { status: 'cancelled', closedAt: new Date() },
        })
        console.log(`${PREFIX}   Cancelled: ${z.id} (order #${z.orderNumber}, was ${z.status})`)
      }
    } else if (dryRun) {
      for (const z of zombies) {
        console.log(`${PREFIX}   [dry-run] Would cancel: ${z.id} (order #${z.orderNumber}, status=${z.status}, created=${z.createdAt.toISOString()})`)
      }
    }

    // ── Type 3: Route-A split parents — status='open' but have children ──
    // split/route.ts (even + by_item) never set status='split' on the parent.
    // Children can't be paid because pay/route.ts requires parentOrder.status === 'split'.
    // Fix: set those parents to 'split' so the children become payable.
    console.log(`\n${PREFIX} === Type 3: Route-A split parents (open with children) ===`)

    const routeAWhere: any = {
      status: { in: ['open', 'sent', 'in_progress'] },
      deletedAt: null,
    }
    if (locationId) routeAWhere.locationId = locationId

    const openParentCandidates = await prisma.order.findMany({
      where: {
        ...routeAWhere,
        splitOrders: { some: {} }, // has at least one child
      },
      select: { id: true, orderNumber: true, status: true, locationId: true },
      orderBy: { createdAt: 'asc' },
    })

    console.log(`${PREFIX} Found ${openParentCandidates.length} open orders with split children`)

    let routeAFixed = 0
    for (const parent of openParentCandidates) {
      // Only promote to 'split' if at least one child is still open/unpaid
      const openChildren = await prisma.order.count({
        where: {
          parentOrderId: parent.id,
          status: { notIn: ['paid', 'cancelled', 'voided', 'completed'] },
          deletedAt: null,
        },
      })
      if (openChildren === 0) continue // all children already done — leave for Type 2 to handle

      routeAFixed++
      if (!dryRun) {
        await prisma.order.update({
          where: { id: parent.id },
          data: { status: 'split', version: { increment: 1 } },
        })
        console.log(`${PREFIX}   Fixed: ${parent.id} (order #${parent.orderNumber}, was ${parent.status} → split)`)
      } else {
        console.log(`${PREFIX}   [dry-run] Would fix: ${parent.id} (order #${parent.orderNumber}, was ${parent.status} → split)`)
      }
    }
    console.log(`${PREFIX} Fixed ${routeAFixed} Route-A split parents`)

    // ── Type 2: Stranded split parents ────────────────────────────
    console.log(`\n${PREFIX} === Type 2: Stranded split parents ===`)

    const splitWhere: any = {
      status: 'split',
      deletedAt: null,
    }
    if (locationId) splitWhere.locationId = locationId

    const splitParents = await prisma.order.findMany({
      where: splitWhere,
      select: { id: true, orderNumber: true, locationId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })

    console.log(`${PREFIX} Found ${splitParents.length} split-status orders to evaluate`)

    const closedStatuses = ['paid', 'cancelled', 'voided', 'completed']
    let strandedCount = 0

    for (const parent of splitParents) {
      const children = await prisma.order.findMany({
        where: { parentOrderId: parent.id },
        select: { id: true, status: true },
      })

      if (children.length === 0) continue

      const allChildrenClosed = children.every((c) => closedStatuses.includes(c.status))
      if (!allChildrenClosed) continue

      strandedCount++

      if (!dryRun) {
        await prisma.order.update({
          where: { id: parent.id },
          data: { status: 'paid', paidAt: new Date(), closedAt: new Date() },
        })
        console.log(`${PREFIX}   Closed: ${parent.id} (order #${parent.orderNumber}, ${children.length} children all closed)`)
      } else {
        console.log(`${PREFIX}   [dry-run] Would close: ${parent.id} (order #${parent.orderNumber}, ${children.length} children all closed)`)
      }
    }

    console.log(`${PREFIX} Found ${strandedCount} stranded split parents`)

    // ── Summary ───────────────────────────────────────────────────
    console.log(`\n${PREFIX} === Summary ===`)
    console.log(`${PREFIX}   Empty zombies ${dryRun ? 'found' : 'cancelled'}: ${zombies.length}`)
    console.log(`${PREFIX}   Route-A parents ${dryRun ? 'found' : 'fixed'} → split: ${routeAFixed}`)
    console.log(`${PREFIX}   Stranded splits ${dryRun ? 'found' : 'closed'}: ${strandedCount}`)
    if (dryRun) console.log(`${PREFIX}   (dry run — no changes were made)`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(`${PREFIX} Fatal error:`, err)
  process.exit(1)
})
