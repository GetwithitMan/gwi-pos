/**
 * Connection Pool Budget — single source of truth for all DB pool sizing.
 *
 * Total PG connections per NUC: 25 (local PG default max_connections=100, budget=25%)
 *
 * Budget allocation:
 * - App pool (masterClient):         15 connections  — API handlers, route queries
 * - Admin pool (adminDb):             3 connections  — cross-tenant ops, MC sync, cron
 * - Neon sync pool (neonClient):      5 connections  — upstream+downstream sync workers
 * - Reserved (health, emergency):     2 connections  — headroom for pg_stat_activity etc.
 *   Total:                           25 connections
 *
 * Neon connections (per venue, Vercel):
 * - Per serverless function:          1 connection   (max=1, timeout=60s)
 * - Venue client cache:              50 max          (LRU eviction)
 *
 * NOTE: Do not change these without updating DATABASE-CONNECTION-RULES.md
 */
export const CONNECTION_BUDGET = {
  /** Total local PG pool connections across all pools (NUC) */
  LOCAL_TOTAL: 25,
  /** Master PrismaClient pool — API handlers, route queries */
  LOCAL_APP_POOL: 15,
  /** Admin PrismaClient pool — cross-tenant, MC sync, cron */
  LOCAL_ADMIN_POOL: 3,
  /** Neon sync pool — upstream + downstream sync workers */
  LOCAL_NEON_SYNC: 5,
  /** Headroom — health checks, emergency queries */
  LOCAL_RESERVED: 2,
  /** Vercel: single connection per serverless function */
  VERCEL_PER_FUNCTION: 1,
  /** Max cached venue PrismaClients (Vercel LRU cache) */
  VENUE_CACHE_MAX: 50,
} as const
