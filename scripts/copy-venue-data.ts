#!/usr/bin/env npx tsx
/**
 * copy-venue-data.ts — Copy cloud-authoritative data between venue databases
 *
 * Copies menu, tables, employees, modifiers, and all other cloud-owned config
 * from a source Neon database to a target venue Neon database.
 *
 * The downstream sync worker on the NUC will automatically pull the new data
 * within 15 seconds (based on updatedAt high-water marks).
 *
 * Usage:
 *   npx tsx scripts/copy-venue-data.ts \
 *     --source "postgresql://...@neon.tech/gwi_pos" \
 *     --target "postgresql://...@neon.tech/gwi_pos_fruita_grill" \
 *     [--dry-run]
 *
 * Or with env vars:
 *   COPY_SOURCE_URL="..." COPY_TARGET_URL="..." npx tsx scripts/copy-venue-data.ts
 *
 * Reusable for any venue — not Fruita Grill specific.
 */

import { PrismaClient, Prisma } from '@prisma/client'

// ── Config ────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run')
const VERBOSE = process.argv.includes('--verbose')

const SOURCE_URL =
  process.argv.find((_, i, a) => a[i - 1] === '--source') ||
  process.env.COPY_SOURCE_URL
const TARGET_URL =
  process.argv.find((_, i, a) => a[i - 1] === '--target') ||
  process.env.COPY_TARGET_URL

if (!SOURCE_URL || !TARGET_URL) {
  console.error(`
Usage: npx tsx scripts/copy-venue-data.ts \\
  --source "postgresql://...@neon.tech/gwi_pos" \\
  --target "postgresql://...@neon.tech/gwi_pos_fruita_grill" \\
  [--dry-run] [--verbose]
`)
  process.exit(1)
}

// ── Prisma clients ────────────────────────────────────────────────────────────

const source = new PrismaClient({
  datasources: { db: { url: SOURCE_URL } },
  log: VERBOSE ? ['query'] : [],
})

const target = new PrismaClient({
  datasources: { db: { url: TARGET_URL } },
  log: VERBOSE ? ['query'] : [],
})

// ── Cloud-authoritative models in FK-dependency order ─────────────────────────
// This matches sync-config.ts downstream priority ordering.
// Lower priority = insert first (parents before children).

const MODELS_IN_ORDER = [
  'Organization',
  'Location',
  'PrepStation',
  'Role',
  'Employee',
  'EmployeeRole',
  'Category',
  'MenuItem',
  'ModifierGroup',
  'Modifier',
  'Section',
  'Table',
  'Seat',
  'OrderType',
  'TaxRule',
  'Printer',
  'PrintRoute',
  'PrintRule',
  'KDSScreen',
  'KDSScreenStation',
  'Terminal',
  'PaymentReader',
  'Scale',
  'Station',
  'Customer',
  'Coupon',
  'DiscountRule',
  'GiftCard',
  'HouseAccount',
  'Vendor',
  'InventoryItem',
  'InventoryItemStorage',
  'Ingredient',
  'IngredientCategory',
  'MenuItemRecipe',
  'ComboTemplate',
  'ComboComponent',
  'ComboComponentOption',
  'ModifierGroupTemplate',
  'ModifierTemplate',
  'ModifierInventoryLink',
  'PrepTrayConfig',
  'SectionAssignment',
] as const

// Fields to skip when copying (local-only transactional FKs)
const SKIP_FIELDS: Record<string, string[]> = {
  MenuItem: ['currentOrderId', 'currentOrderItemId'],
  Seat: ['sourceOrderId', 'currentOrderItemId'],
}

// Fields to NULL out (local references that won't exist in target)
const NULL_FIELDS: Record<string, string[]> = {
  MenuItem: ['currentOrderId', 'currentOrderItemId'],
  Seat: ['sourceOrderId', 'currentOrderItemId'],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[copy-venue-data] ${msg}`)
}

function warn(msg: string) {
  console.warn(`[copy-venue-data] ⚠️  ${msg}`)
}

/** Get the Prisma delegate for a model name */
function getDelegate(client: PrismaClient, model: string): any {
  const key = model.charAt(0).toLowerCase() + model.slice(1)
  return (client as any)[key]
}

/** Clean a row for upsert: remove relation objects, null out skip fields */
function cleanRow(model: string, row: Record<string, any>, targetLocationId: string, sourceLocationId: string): Record<string, any> {
  const cleaned: Record<string, any> = {}

  for (const [key, value] of Object.entries(row)) {
    // Skip relation objects (arrays or nested objects with id)
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Prisma.Decimal)) {
      continue
    }

    // Skip explicitly excluded fields
    if (SKIP_FIELDS[model]?.includes(key)) {
      continue
    }

    // Null out local-only FK fields
    if (NULL_FIELDS[model]?.includes(key)) {
      cleaned[key] = null
      continue
    }

    // Remap locationId
    if (key === 'locationId' && value === sourceLocationId) {
      cleaned[key] = targetLocationId
      continue
    }

    // Convert Decimal to number for JSON safety
    if (value instanceof Prisma.Decimal) {
      cleaned[key] = value.toNumber()
      continue
    }

    cleaned[key] = value
  }

  // Force updatedAt to now so downstream sync picks it up
  cleaned.updatedAt = new Date()

  return cleaned
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  log(`Source: ${SOURCE_URL!.replace(/:[^:@]+@/, ':***@')}`)
  log(`Target: ${TARGET_URL!.replace(/:[^:@]+@/, ':***@')}`)
  if (DRY_RUN) log('DRY RUN — no writes will be made')

  // 1. Get location IDs from both databases
  const sourceLocations = await source.location.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, slug: true },
  })
  const targetLocations = await target.location.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, slug: true },
  })

  if (sourceLocations.length === 0) {
    console.error('ERROR: No locations found in source database')
    process.exit(1)
  }
  if (targetLocations.length === 0) {
    console.error('ERROR: No locations found in target database')
    process.exit(1)
  }

  const sourceLocation = sourceLocations[0]
  const targetLocation = targetLocations[0]

  log(`Source location: "${sourceLocation.name}" (${sourceLocation.id})`)
  log(`Target location: "${targetLocation.name}" (${targetLocation.id})`)
  log('')

  // 2. Copy each model in dependency order
  const stats: Record<string, { copied: number; skipped: number; errors: number }> = {}

  for (const model of MODELS_IN_ORDER) {
    const delegate = getDelegate(source, model)
    if (!delegate) {
      if (VERBOSE) warn(`Model "${model}" not found in Prisma client — skipping`)
      continue
    }

    // Skip Organization and Location — they must exist already
    if (model === 'Organization' || model === 'Location') {
      if (VERBOSE) log(`${model}: skipping (must already exist in target)`)
      continue
    }

    try {
      // Read all non-deleted rows from source
      let rows: any[]
      try {
        rows = await delegate.findMany({
          where: { locationId: sourceLocation.id, deletedAt: null },
        })
      } catch {
        // Model might not have locationId (e.g., Organization)
        try {
          rows = await delegate.findMany({ where: { deletedAt: null } })
        } catch {
          rows = await delegate.findMany()
        }
      }

      if (rows.length === 0) {
        stats[model] = { copied: 0, skipped: 0, errors: 0 }
        if (VERBOSE) log(`${model}: 0 rows in source — skipping`)
        continue
      }

      const targetDelegate = getDelegate(target, model)
      let copied = 0
      let skipped = 0
      let errors = 0

      for (const row of rows) {
        const cleaned = cleanRow(model, row, targetLocation.id, sourceLocation.id)

        if (DRY_RUN) {
          copied++
          continue
        }

        try {
          // Build update data (everything except id)
          const { id, ...updateData } = cleaned

          await targetDelegate.upsert({
            where: { id: row.id },
            create: cleaned,
            update: updateData,
          })
          copied++
        } catch (err: any) {
          errors++
          if (VERBOSE) {
            warn(`${model} ${row.id}: ${err.message?.slice(0, 200)}`)
          }
        }
      }

      stats[model] = { copied, skipped, errors }
      const errMsg = errors > 0 ? ` (${errors} errors)` : ''
      log(`${model}: ${copied} copied${errMsg}`)
    } catch (err: any) {
      stats[model] = { copied: 0, skipped: 0, errors: 1 }
      warn(`${model}: FAILED — ${err.message?.slice(0, 200)}`)
    }
  }

  // 3. Summary
  log('')
  log('═══════════════════════════════════════════')
  log('SUMMARY')
  log('═══════════════════════════════════════════')

  let totalCopied = 0
  let totalErrors = 0

  for (const [model, s] of Object.entries(stats)) {
    if (s.copied > 0 || s.errors > 0) {
      totalCopied += s.copied
      totalErrors += s.errors
    }
  }

  log(`Total rows copied: ${totalCopied}`)
  if (totalErrors > 0) warn(`Total errors: ${totalErrors}`)
  if (DRY_RUN) log('(DRY RUN — no actual writes)')

  log('')
  log('Next steps:')
  log('  1. The NUC downstream sync will pick up changes within 15 seconds')
  log('  2. Or trigger manually: curl -X POST http://NUC_IP:3005/api/internal/trigger-sync')
  log('  3. Verify on NUC: ssh into NUC and check table counts')
}

main()
  .catch((err) => {
    console.error('FATAL:', err)
    process.exit(1)
  })
  .finally(async () => {
    await source.$disconnect()
    await target.$disconnect()
  })
