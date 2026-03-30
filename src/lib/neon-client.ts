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

import dns from 'dns'
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
    // Force IPv4 on NUC — some venue networks (e.g. Zoey's) have broken IPv6 or
    // TLS inspection that causes Node's "happy eyeballs" algorithm to waste time on
    // failed IPv6 attempts before falling back to IPv4. psql/libpq defaults to IPv4
    // which is why it works when Node fails. Safe to set globally on NUCs.
    dns.setDefaultResultOrder('ipv4first')

    // DB_POOL_SIZE env override for Neon pool; defaults to LOCAL_NEON_SYNC budget
    const rawPoolSize = parseInt(process.env.DB_POOL_SIZE || '', 10)
    const poolSize = Number.isNaN(rawPoolSize) || rawPoolSize < 1 ? CONNECTION_BUDGET.LOCAL_NEON_SYNC : rawPoolSize
    adapter = new PrismaPg({
      connectionString: neonUrl,
      max: poolSize,
      // 45s — NUC networks may have broken TLS inspection or IPv6 issues causing
      // instant connection failures (~780ms). With ipv4first set above, connections
      // should succeed, but we allow extra headroom for Neon pooler cold-starts and
      // slow venue networks. 30s was too short for some venues.
      connectionTimeoutMillis: 45000,
      // Handle venues with strict TLS inspection (deep packet inspection firewalls)
      // that reject Neon's certificate. rejectUnauthorized: false allows connection
      // through these networks. Neon's wire encryption still applies.
      ssl: { rejectUnauthorized: false },
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
