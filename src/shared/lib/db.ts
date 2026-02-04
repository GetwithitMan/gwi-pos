/**
 * Database Client
 *
 * Re-exports the Prisma client from the existing location.
 * This allows domains to import from @/shared instead of @/lib/db.
 */

export { db } from '@/lib/db'
