/**
 * Neon Cloud PrismaClient
 *
 * Second PrismaClient connected to the Neon cloud database.
 * Used ONLY by sync workers, hardware-command-worker, and online-order-worker
 * for cross-origin data access.
 *
 * Returns null if NEON_DATABASE_URL is not set (Vercel, dev, or cloud-direct mode).
 * No soft-delete middleware — sync workers use raw SQL.
 */

import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForNeon = globalThis as unknown as {
  neonPrisma: PrismaClient | undefined
}

function createNeonClient(): PrismaClient | null {
  const neonUrl = process.env.NEON_DATABASE_URL
  if (!neonUrl) return null

  const rawPoolSize = parseInt(process.env.DB_POOL_SIZE || '10', 10)
  const poolSize = Number.isNaN(rawPoolSize) || rawPoolSize < 1 ? 10 : rawPoolSize // Lower pool for sync client
  const rawPoolTimeout = parseInt(process.env.DATABASE_POOL_TIMEOUT || '10', 10)
  const poolTimeout = Number.isNaN(rawPoolTimeout) || rawPoolTimeout < 1 ? 10 : rawPoolTimeout

  const adapter = new PrismaPg({
    connectionString: neonUrl,
    max: poolSize,
    connectionTimeoutMillis: poolTimeout * 1000,
  })

  return new PrismaClient({
    adapter,
    log: ['error'],
    transactionOptions: {
      maxWait: 10000,
      timeout: 15000,
    },
  })
}

export const neonClient: PrismaClient | null =
  globalForNeon.neonPrisma ?? createNeonClient()

if (neonClient) {
  globalForNeon.neonPrisma = neonClient
}

export function hasNeonConnection(): boolean {
  return neonClient !== null
}

export async function disconnectNeon(): Promise<void> {
  if (neonClient) {
    await neonClient.$disconnect()
  }
}
