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
import { CONNECTION_BUDGET } from './db-connection-budget'

const isVercel = !!process.env.VERCEL

const globalForNeon = globalThis as unknown as {
  neonPrisma: PrismaClient | undefined
}

function createNeonClient(): PrismaClient | null {
  const neonUrl = process.env.NEON_DATABASE_URL
  if (!neonUrl) return null

  // See CONNECTION_BUDGET in db.ts — Neon sync pool is budgeted separately from local app pool
  let adapter: any
  if (isVercel) {
    adapter = new PrismaPg({ connectionString: neonUrl, max: CONNECTION_BUDGET.VERCEL_PER_FUNCTION, connectionTimeoutMillis: 60000 })
  } else {
    // DB_POOL_SIZE env override for Neon pool; defaults to LOCAL_NEON_SYNC budget
    const rawPoolSize = parseInt(process.env.DB_POOL_SIZE || '', 10)
    const poolSize = Number.isNaN(rawPoolSize) || rawPoolSize < 1 ? CONNECTION_BUDGET.LOCAL_NEON_SYNC : rawPoolSize
    adapter = new PrismaPg({
      connectionString: neonUrl,
      max: poolSize,
      connectionTimeoutMillis: 10000,
    })
  }

  return new PrismaClient({
    adapter,
    log: ['error'],
    transactionOptions: {
      maxWait: 10000,
      timeout: 30000, // 30s — extra headroom for payment transactions
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
