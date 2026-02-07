import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  walEnabled: boolean | undefined
}

function createPrismaClient() {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

  return client
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

// Enable WAL mode and busy timeout for SQLite concurrency
// WAL allows concurrent reads while writing, preventing "database is locked" errors
// busy_timeout makes SQLite wait instead of immediately failing on lock contention
if (!globalForPrisma.walEnabled) {
  db.$executeRawUnsafe('PRAGMA journal_mode=WAL;')
    .then(() => db.$executeRawUnsafe('PRAGMA busy_timeout=5000;'))
    .then(() => {
      globalForPrisma.walEnabled = true
      console.log('[db] SQLite WAL mode and busy_timeout enabled')
    })
    .catch((err: unknown) => {
      console.error('[db] Failed to set SQLite pragmas:', err)
    })
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

export default db
