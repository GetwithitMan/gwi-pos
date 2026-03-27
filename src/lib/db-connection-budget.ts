/**
 * Connection Pool Budget — single source of truth for all DB pool sizing.
 *
 * Total PG connections per NUC: 30 (local PG default max_connections=100, budget=30%)
 *
 * Budget allocation:
 * - App pool (masterClient):         20 connections  — API handlers, route queries (env: DB_POOL_SIZE)
 * - Admin pool (adminDb):             3 connections  — cross-tenant ops, MC sync, cron
 * - Neon sync pool (neonClient):      5 connections  — upstream+downstream sync workers
 * - Reserved (health, emergency):     2 connections  — headroom for pg_stat_activity etc.
 *   Total:                           30 connections
 *
 * High-volume venues (concerts, large bars) can increase the app pool via
 * DB_POOL_SIZE env var. The total budget adjusts automatically.
 *
 * Env vars for pool sizing (all optional):
 *   DB_POOL_SIZE     — Explicit app pool size. ALWAYS takes priority over auto-calculation.
 *   VENUE_CAPACITY   — Number of terminals/seats. Used for auto-scaling when DB_POOL_SIZE is unset.
 *                       >50 = concert venue (40 conns), >20 = large restaurant (30 conns), else 20.
 *   HIGH_VOLUME      — Set to "true" for high-volume venues (concerts, festivals). Forces 40 conns
 *                       when DB_POOL_SIZE is unset, regardless of VENUE_CAPACITY.
 *
 * Auto-scaling tiers (when DB_POOL_SIZE is NOT set):
 *   Standard restaurant (default):       20 connections
 *   Large restaurant (capacity > 20):    30 connections
 *   Concert venue (capacity > 50):       40 connections
 *   HIGH_VOLUME override:                40 connections
 *
 * Hard ceiling: app pool is capped at 90 to stay under PostgreSQL's default
 * max_connections=100, leaving room for admin (3), sync (5), and reserved (2).
 *
 * Neon connections (per venue, Vercel):
 * - Per serverless function:          1 connection   (max=1, timeout=60s)
 * - Venue client cache:              50 max          (LRU eviction)
 *
 * NOTE: Do not change these without updating DATABASE-CONNECTION-RULES.md
 */

/** Reserved connection counts (not adjustable via env vars) */
const ADMIN_POOL = 3
const SYNC_POOL = 5
const RESERVED = 2

/** Max app pool to stay under PG default max_connections=100 */
const MAX_APP_POOL = 100 - ADMIN_POOL - SYNC_POOL - RESERVED // = 90

/**
 * Calculate the app pool size automatically based on venue characteristics.
 * Only called when DB_POOL_SIZE env var is not explicitly set.
 */
function calculateAutoPoolSize(): number {
  // HIGH_VOLUME flag forces concert-tier sizing
  if (process.env.HIGH_VOLUME === 'true') return 40

  // Scale based on venue capacity (terminal count or seat count)
  const capacity = parseInt(process.env.VENUE_CAPACITY || '0', 10)
  if (capacity > 50) return 40  // Concert venue / large event space
  if (capacity > 20) return 30  // Large restaurant / busy bar

  return 20 // Standard restaurant
}

const envPoolSize = parseInt(process.env.DB_POOL_SIZE || '0', 10)
const autoPoolSize = envPoolSize > 0 ? envPoolSize : calculateAutoPoolSize()
const appPoolSize = Math.min(autoPoolSize, MAX_APP_POOL)

// Log the chosen pool size at startup for debugging
const poolSource = envPoolSize > 0
  ? `DB_POOL_SIZE=${envPoolSize}`
  : process.env.HIGH_VOLUME === 'true'
    ? 'HIGH_VOLUME=true'
    : parseInt(process.env.VENUE_CAPACITY || '0', 10) > 0
      ? `VENUE_CAPACITY=${process.env.VENUE_CAPACITY}`
      : 'default'
console.log(
  `[DB Pool] App pool: ${appPoolSize} connections (source: ${poolSource})` +
  (autoPoolSize !== appPoolSize ? ` — capped from ${autoPoolSize} to ${appPoolSize} (max_connections safety)` : '') +
  ` | Total budget: ${appPoolSize + ADMIN_POOL + SYNC_POOL + RESERVED} ` +
  `(admin=${ADMIN_POOL}, sync=${SYNC_POOL}, reserved=${RESERVED})`
)

export const CONNECTION_BUDGET = {
  /** Total local PG pool connections across all pools (NUC) */
  LOCAL_TOTAL: appPoolSize + ADMIN_POOL + SYNC_POOL + RESERVED,
  /** Master PrismaClient pool — API handlers, route queries. Auto-scaled or overridden with DB_POOL_SIZE. */
  LOCAL_APP_POOL: appPoolSize,
  /** Admin PrismaClient pool — cross-tenant, MC sync, cron */
  LOCAL_ADMIN_POOL: ADMIN_POOL,
  /** Neon sync pool — upstream + downstream sync workers */
  LOCAL_NEON_SYNC: SYNC_POOL,
  /** Headroom — health checks, emergency queries */
  LOCAL_RESERVED: RESERVED,
  /** Vercel: single connection per serverless function */
  VERCEL_PER_FUNCTION: 1,
  /** Max cached venue PrismaClients (Vercel LRU cache) */
  VENUE_CACHE_MAX: 50,
} as const
