/**
 * Multi-tenant cron helper — iterates all active venues for cron job processing.
 *
 * On NUC (single venue): runs callback against the local db.
 * On Vercel (multi-tenant): queries _cron_venue_registry, iterates with getDbForVenue().
 *
 * Uses requestStore.run() so that module-level `db` imports (via the Proxy in db.ts)
 * resolve to the correct venue database within each callback invocation.
 */

import type { PrismaClient } from '@/generated/prisma/client'

export interface ForAllVenuesResult {
  total: number
  succeeded: number
  failed: string[]
}

interface ForAllVenuesOptions {
  /** Max concurrent venue processing (default: 5) */
  concurrency?: number
  /** Label for log messages (e.g., 'eod-batch-close') */
  label?: string
}

/**
 * Iterate over all active venues and run a callback with each venue's DB client.
 *
 * The callback receives the venue's PrismaClient AND the AsyncLocalStorage context
 * is set so that `import { db } from '@/lib/db'` resolves to the venue's client.
 * This means libraries that use `db` at module level (like deduction-processor.ts)
 * will automatically use the correct venue database.
 */
export async function forAllVenues(
  callback: (db: PrismaClient, slug: string) => Promise<void>,
  options?: ForAllVenuesOptions,
): Promise<ForAllVenuesResult> {
  const label = options?.label || 'cron'
  const concurrency = options?.concurrency ?? 5

  // ── NUC mode: single venue, just run against local db ──────────────
  if (!process.env.VERCEL) {
    try {
      const { db } = await import('@/lib/db')
      await callback(db, 'local')
      return { total: 1, succeeded: 1, failed: [] }
    } catch (err) {
      console.error(`[${label}] Local venue failed:`, err)
      return { total: 1, succeeded: 0, failed: ['local'] }
    }
  }

  // ── Vercel mode: multi-tenant, iterate all active venues ───────────
  const { masterClient, getDbForVenue } = await import('@/lib/db')
  const { requestStore } = await import('@/lib/request-context')

  // Query the registry for all active venue slugs
  let slugs: { slug: string }[]
  try {
    slugs = await masterClient.$queryRawUnsafe<{ slug: string }[]>(
      `SELECT slug FROM "_cron_venue_registry" WHERE is_active = true ORDER BY slug`
    )
  } catch (err) {
    // Table might not exist yet (migration not run)
    console.error(`[${label}] Failed to query _cron_venue_registry:`, err)
    return { total: 0, succeeded: 0, failed: ['_registry_query_failed'] }
  }

  if (slugs.length === 0) {
    console.log(`[${label}] No active venues found in registry`)
    return { total: 0, succeeded: 0, failed: [] }
  }

  console.log(`[${label}] Processing ${slugs.length} venue(s)...`)

  const result: ForAllVenuesResult = { total: slugs.length, succeeded: 0, failed: [] }

  // Bounded concurrency via semaphore pattern
  let running = 0
  let idx = 0
  const errors: string[] = []

  await new Promise<void>((resolve) => {
    function next() {
      // All done
      if (idx >= slugs.length && running === 0) {
        resolve()
        return
      }

      // Launch tasks up to concurrency limit
      while (running < concurrency && idx < slugs.length) {
        const venue = slugs[idx++]
        running++

        processVenue(venue.slug)
          .then(() => {
            result.succeeded++
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err)
            console.error(`[${label}] Venue ${venue.slug} failed: ${msg}`)
            errors.push(venue.slug)
          })
          .finally(() => {
            running--
            next()
          })
      }
    }

    async function processVenue(slug: string) {
      console.log(`[${label}] Processing venue ${slug}...`)
      const venueDb = await getDbForVenue(slug)
      // Run the callback inside requestStore so that `db` proxy resolves to venueDb
      await requestStore.run({ slug, prisma: venueDb }, async () => {
        try {
          await callback(venueDb, slug)
        } catch (err: any) {
          // Schema drift: venue DB may not have all tables yet (e.g. DB_PENDING,
          // SEEDED but missing latest migrations). Prisma emits "prisma:error Invalid"
          // or "Invalid `prisma.xxx.findMany()` invocation" for missing tables/columns.
          // Log as warning instead of error so monitoring doesn't alert on expected drift.
          const msg = err instanceof Error ? err.message : String(err)
          if (
            msg.includes('prisma:error') ||
            msg.includes('Invalid `prisma.') ||
            msg.includes('does not exist') ||
            msg.includes('relation') && msg.includes('does not exist') ||
            msg.includes('column') && msg.includes('does not exist') ||
            msg.includes('The table') && msg.includes('does not exist')
          ) {
            console.warn(`[${label}] Venue ${slug} skipped — schema drift (table/column missing): ${msg.slice(0, 200)}`)
            return // Don't re-throw: counts as skipped, not failed
          }
          throw err // Re-throw non-schema errors for normal failure handling
        }
      })
    }

    next()
  })

  result.failed = errors
  console.log(
    `[${label}] Complete: ${result.succeeded}/${result.total} succeeded` +
    (errors.length > 0 ? `, failed: ${errors.join(', ')}` : '')
  )

  return result
}
