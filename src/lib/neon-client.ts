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

import { PrismaClient } from '@prisma/client'

const globalForNeon = globalThis as unknown as {
  neonPrisma: PrismaClient | undefined
}

function appendPoolParams(url: string): string {
  if (!url) return url
  const limit = parseInt(process.env.DB_POOL_SIZE || '10', 10) // Lower pool for sync client
  const timeout = parseInt(process.env.DATABASE_POOL_TIMEOUT || '10', 10)
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}connection_limit=${limit}&pool_timeout=${timeout}`
}

function createNeonClient(): PrismaClient | null {
  const neonUrl = process.env.NEON_DATABASE_URL
  if (!neonUrl) return null

  const pooledUrl = appendPoolParams(neonUrl)

  return new PrismaClient({
    log: ['error'],
    datasources: { db: { url: pooledUrl } },
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
