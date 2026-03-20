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

const isVercel = !!process.env.VERCEL

const globalForNeon = globalThis as unknown as {
  neonPrisma: PrismaClient | undefined
}

function createNeonClient(): PrismaClient | null {
  const neonUrl = process.env.NEON_DATABASE_URL
  if (!neonUrl) return null

  let adapter: any
  if (isVercel) {
    // HTTP — instant, no TCP cold start
    const { PrismaNeon } = require('@prisma/adapter-neon')
    const { Pool: NeonPool } = require('@neondatabase/serverless')
    adapter = new PrismaNeon(new NeonPool({ connectionString: neonUrl }))
  } else {
    // TCP — fast on NUC with local/nearby database
    const rawPoolSize = parseInt(process.env.DB_POOL_SIZE || '10', 10)
    const poolSize = Number.isNaN(rawPoolSize) || rawPoolSize < 1 ? 10 : rawPoolSize
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
