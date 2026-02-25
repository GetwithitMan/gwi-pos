/**
 * Custom Next.js Server with Socket.io
 *
 * This wraps the standard Next.js server to add Socket.io support.
 * Socket.io runs on the SAME port as Next.js (no separate process needed).
 *
 * Usage:
 *   Development: npm run dev   (runs this via tsx)
 *   Production:  npm start     (runs this via node on the built output)
 */

import { createServer } from 'http'
import next from 'next'
import { initializeSocketServer, getSocketServer } from './src/lib/socket-server'
import { requestStore } from './src/lib/request-context'
import { getDbForVenue, masterClient } from './src/lib/db'
import { startCloudEventWorker } from './src/lib/cloud-event-queue'
import { startOnlineOrderDispatchWorker } from './src/lib/online-order-worker'
import { scaleService } from './src/lib/scale/scale-service'

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOSTNAME || 'localhost'
const port = parseInt(process.env.PORT || '3005', 10)

// ============================================================================
// EOD Scheduler — runs stale order cleanup daily at 4 AM
// ============================================================================

function startEodScheduler() {
  const EOD_HOUR = 4 // 4 AM local time

  function msUntilNext4AM(): number {
    const now = new Date()
    const next = new Date(now)
    next.setHours(EOD_HOUR, 0, 0, 0)
    if (next <= now) {
      next.setDate(next.getDate() + 1)
    }
    return next.getTime() - now.getTime()
  }

  async function runEodCleanup() {
    const locationId = process.env.POS_LOCATION_ID
    if (!locationId) {
      // Cloud/dev mode without a fixed location — skip automatic cleanup
      return
    }

    try {
      const url = `http://localhost:${port}/api/system/cleanup-stale-orders?locationId=${locationId}`
      const res = await fetch(url, { method: 'POST' })
      const data = await res.json()
      if (data.data?.closedCount > 0) {
        console.log(`[EOD] Cleaned up ${data.data.closedCount} stale draft orders`)
      }
    } catch (err) {
      console.error('[EOD] Stale order cleanup failed:', err)
    }
  }

  function scheduleNext() {
    const delay = msUntilNext4AM()
    const nextRun = new Date(Date.now() + delay)
    console.log(`[EOD] Next stale-order cleanup scheduled for ${nextRun.toLocaleString()}`)

    const timer = setTimeout(async () => {
      await runEodCleanup()
      scheduleNext() // Reschedule for next day
    }, delay)
    // Don't keep the process alive just for the EOD timer
    timer.unref()
  }

  scheduleNext()
}

async function main() {
  const app = next({ dev, hostname, port })
  const handle = app.getRequestHandler()

  await app.prepare()

  const httpServer = createServer((req, res) => {
    // Multi-tenant: wrap request in AsyncLocalStorage with the correct
    // PrismaClient so that `import { db } from '@/lib/db'` automatically
    // routes to the venue's Neon database.
    const slug = req.headers['x-venue-slug'] as string | undefined
    if (slug && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      const prisma = getDbForVenue(slug)
      requestStore.run({ slug, prisma }, () => handle(req, res))
    } else {
      // Local/NUC mode (no slug header): still wrap in requestStore so
      // withVenue() fast-path fires and skips await headers() entirely.
      requestStore.run({ slug: '', prisma: masterClient }, () => handle(req, res))
    }
  })

  // Initialize Socket.io (skip if standalone ws-server handles sockets)
  if (process.env.WS_STANDALONE === 'true') {
    console.log(`[Server] Socket.io disabled (WS_STANDALONE=true, using ws-server on ${process.env.WS_SERVER_URL || 'localhost:3001'})`)
  } else {
    try {
      await initializeSocketServer(httpServer)
      console.log(`[Server] Socket.io initialized on path ${process.env.SOCKET_PATH || '/api/socket'}`)
    } catch (err) {
      console.error('[Server] Failed to initialize Socket.io:', err)
      // Continue without sockets — POS will fall back to polling
    }
  }

  httpServer.listen(port, () => {
    console.log(`[Server] GWI POS ready on http://${hostname}:${port}`)
    console.log(`[Server] Socket.io: ws://${hostname}:${port}/api/socket`)
    console.log(`[Server] Mode: ${dev ? 'development' : 'production'}`)
    startCloudEventWorker()
    startEodScheduler()
    startOnlineOrderDispatchWorker(port)
    void scaleService.initialize().catch(console.error)
  })

  // Graceful shutdown
  let shuttingDown = false
  async function shutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[Server] ${signal} received — shutting down gracefully...`)

    const io = getSocketServer()
    if (io) {
      io.close()
      console.log('[Server] Socket.io closed')
    }

    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        console.log('[Server] HTTP server closed')
        resolve()
      })
    })

    await masterClient.$disconnect()
    console.log('[Server] Prisma disconnected')

    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('unhandledRejection', (err) => {
    console.error('[Server] Unhandled rejection:', err)
  })
  process.on('uncaughtException', (err) => {
    console.error('[Server] Uncaught exception:', err)
    process.exit(1)
  })
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err)
  process.exit(1)
})
