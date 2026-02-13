import { headers } from 'next/headers'
import { PrismaClient } from '@prisma/client'
import { db, getDbForVenue } from './db'

/**
 * Get the correct PrismaClient for the current request.
 *
 * Reads x-venue-slug from request headers (set by middleware.ts).
 * Returns a venue-specific client if a subdomain is active,
 * otherwise returns the master database client.
 *
 * Usage in API routes:
 *   import { getVenueDb } from '@/lib/venue-resolver'
 *   const db = await getVenueDb()
 *   const items = await db.menuItem.findMany({ ... })
 */
export async function getVenueDb(): Promise<PrismaClient> {
  const headersList = await headers()
  const slug = headersList.get('x-venue-slug')

  if (!slug) {
    return db // Master database (gwi-pos.vercel.app / barpos.restaurant)
  }

  return getDbForVenue(slug)
}

/**
 * Get the venue slug from the current request headers.
 * Returns null if on the main domain (no subdomain).
 */
export async function getVenueSlug(): Promise<string | null> {
  const headersList = await headers()
  return headersList.get('x-venue-slug')
}
