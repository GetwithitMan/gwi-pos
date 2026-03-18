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

import { createServer, IncomingMessage, ServerResponse } from 'http'
import next from 'next'
import compression from 'compression'  // eslint-disable-line @typescript-eslint/no-var-requires
import { initializeSocketServer, getSocketServer } from './src/lib/socket-server'
import { requestStore } from './src/lib/request-context'
import { getDbForVenue, masterClient } from './src/lib/db'
import { config } from './src/lib/system-config'
import { registerWorker, startAllWorkers, stopAllWorkers } from './src/lib/worker-registry'
import { startCloudEventWorker, stopCloudEventWorker } from './src/lib/cloud-event-queue'
import { startOnlineOrderDispatchWorker, stopOnlineOrderDispatchWorker } from './src/lib/online-order-worker'
import { startHardwareCommandWorker } from './src/lib/hardware-command-worker'
import { scaleService } from './src/lib/scale/scale-service'
import { startUpstreamSyncWorker, stopUpstreamSyncWorker } from './src/lib/sync/upstream-sync-worker'
import { startDownstreamSyncWorker, stopDownstreamSyncWorker } from './src/lib/sync/downstream-sync-worker'
import { startOutageReplayWorker, stopOutageReplayWorker } from './src/lib/sync/outage-replay-worker'
import { startFulfillmentBridge, stopFulfillmentBridge } from './src/lib/fulfillment-bridge-worker'
import { startBridgeCheckpoint, stopBridgeCheckpoint } from './src/lib/bridge-checkpoint'
import { startCloudRelayClient, stopCloudRelayClient } from './src/lib/cloud-relay-client'
import { disconnectNeon } from './src/lib/neon-client'
import { cleanupStaleOrders } from './src/lib/domain/cleanup/stale-order-cleanup'
import { listPendingRetries, processWalkoutRetry } from './src/lib/domain/datacap/walkout-retry-service'

const dev = config.nodeEnv !== 'production'
const hostname = process.env.HOSTNAME || 'localhost'
const port = config.port

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
    const locationId = config.posLocationId
    if (!locationId) {
      // Cloud/dev mode without a fixed location — skip automatic cleanup
      return
    }

    try {
      const result = await cleanupStaleOrders({ locationId })
      if (result.closedCount > 0) {
        console.log(`[EOD] Cleaned up ${result.closedCount} stale draft orders`)
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

// ============================================================================
// Periodic Draft Cleanup — cancels abandoned $0 drafts every 30 minutes
// ============================================================================

function startDraftCleanupInterval() {
  const INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
  const MAX_AGE_HOURS = 1 // Cancel drafts older than 1 hour (more aggressive than EOD's 4h)

  async function cleanupDrafts() {
    const locationId = config.posLocationId
    if (!locationId) return

    try {
      const result = await cleanupStaleOrders({ locationId, maxAgeHours: MAX_AGE_HOURS })
      if (result.closedCount > 0) {
        console.log(`[DraftCleanup] Cancelled ${result.closedCount} abandoned draft orders (>${MAX_AGE_HOURS}h old)`)
      }
    } catch {
      // Silent — non-critical background task
    }
  }

  const timer = setInterval(cleanupDrafts, INTERVAL_MS)
  timer.unref()
  // Run once on startup after a 2-minute delay (let server fully boot)
  const startupTimer = setTimeout(cleanupDrafts, 2 * 60 * 1000)
  startupTimer.unref()
}

// ============================================================================
// Walkout Retry Sweep — retries pending walkout captures every 6 hours
//
// Queries WalkoutRetry rows with status='pending', nextRetryAt <= NOW(), and
// retryCount < maxRetries. For each, calls the walkout-retry API endpoint to
// attempt a Datacap pre-auth capture. NUC-only (requires POS_LOCATION_ID).
// ============================================================================

function startWalkoutRetryScheduler() {
  const INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

  async function sweepWalkoutRetries() {
    const locationId = config.posLocationId
    if (!locationId) return // Cloud/dev mode — skip

    try {
      const retries = await listPendingRetries(locationId)

      // Filter to only those that are due and under the retry limit
      const now = new Date()
      const due = retries.filter(r => {
        if (r.retryCount >= r.maxRetries) return false
        if (!r.nextRetryAt) return true
        return new Date(r.nextRetryAt) <= now
      })

      if (due.length === 0) return

      let succeeded = 0
      let failed = 0

      for (const retry of due) {
        try {
          // Call service directly — no employeeId needed (trusted scheduler context)
          const result = await processWalkoutRetry(retry.id)
          if (result.success) {
            succeeded++
          } else {
            failed++
          }
        } catch {
          failed++
        }
      }

      console.log(`[WalkoutRetry] Sweep complete: ${due.length} attempted, ${succeeded} succeeded, ${failed} failed`)
    } catch (err) {
      console.error('[WalkoutRetry] Sweep failed:', err)
    }
  }

  const timer = setInterval(sweepWalkoutRetries, INTERVAL_MS)
  timer.unref()
  // Run first sweep 5 minutes after boot (let Datacap client initialize)
  const startupTimer = setTimeout(sweepWalkoutRetries, 5 * 60 * 1000)
  startupTimer.unref()
}

async function main() {
  // Guard: detect bad PORT values (e.g. PORT="3005" with quotes → NaN)
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`[Server] Invalid port: ${process.env.PORT} (parsed as ${port}). Check .env for quoted values like PORT="3005" — remove the quotes.`)
    process.exit(1)
  }

  const app = next({ dev, hostname, port })
  const handle = app.getRequestHandler()

  await app.prepare()

  const socketPath = process.env.SOCKET_PATH || '/api/socket'

  // Compression middleware — reduces JSON response sizes by ~70%
  // Threshold 1KB: don't compress tiny responses (overhead > benefit)
  const compress = compression({ threshold: 1024 })

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Let Socket.io handle its own HTTP polling requests — the [orderCode]/[slug]
    // catch-all route would otherwise intercept /api/socket as a page route.
    const pathname = req.url?.split('?')[0] || ''
    if (pathname === socketPath || pathname.startsWith(socketPath + '/')) {
      return // Socket.io's own request listener handles this
    }

    // Apply compression to all non-socket responses
    // Cast to any — compression types expect Express but work fine with raw http
    compress(req as any, res as any, () => {
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

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Server] Port ${port} is already in use. Another process is running on this port.`)
      console.error('[Server] Run: lsof -i :' + port + '  to find the process.')
      process.exit(1)
    }
    console.error('[Server] HTTP server error:', err)
    process.exit(1)
  })

  // ── Pre-listen validation (blocking) ──────────────────────────────────
  // Sync coverage validation — BLOCKING before server accepts connections.
  // Ensures every DB table is in sync config. Fails boot in production if unknown.
  try {
    const { validateSyncCoverage } = await import('./src/lib/sync/sync-config')
    await validateSyncCoverage(masterClient)
  } catch (err) {
    console.error('[Server] Sync coverage validation failed:', err instanceof Error ? err.message : err)
    if (config.isProduction) {
      console.error('[Server] FATAL: Cannot start with sync coverage errors in production')
      process.exit(1)
    }
    // Dev: continue with warning
  }

  httpServer.listen(port, async () => {
    console.log(`[Server] GWI POS ready on http://${hostname}:${port}`)
    console.log(`[Server] Socket.io: ws://${hostname}:${port}/api/socket`)
    console.log(`[Server] Mode: ${dev ? 'development' : 'production'}`)

    // Schema verification (non-blocking, logs warnings)
    void import('./src/lib/schema-verify').then(({ verifySchema }) =>
      verifySchema()
    ).catch(console.error)

    // Tenant model set validation — fatal in production, warning in dev
    void import('./src/lib/tenant-validation').then(({ validateTenantModelSets }) =>
      validateTenantModelSets(masterClient, { failOnStale: config.isProduction })
    ).then(undefined, (err) => {
      console.error('[Server] Tenant model set validation failed:', err instanceof Error ? err.message : err)
      if (config.isProduction) {
        console.error('[Server] FATAL: Cannot start with stale tenant model registry in production')
        process.exit(1)
      }
    })

    // ── Register workers ──────────────────────────────────────────────
    // Order matters: required workers first, then degraded, then optional.
    // Conditional workers check their preconditions inside the start fn.

    registerWorker('cloudEventWorker', 'required',
      () => startCloudEventWorker(),
      () => stopCloudEventWorker()
    )
    registerWorker('onlineOrderDispatch', 'required',
      () => startOnlineOrderDispatchWorker(port),
      () => stopOnlineOrderDispatchWorker()
    )
    registerWorker('hardwareCommand', 'required',
      () => startHardwareCommandWorker(),
      () => { /* no stop — interval-based, exits with process */ }
    )

    // Sync workers — only when sync is enabled, not backup, and Neon URL present
    const syncReady = config.syncEnabled && config.stationRole !== 'backup' && !!config.neonDatabaseUrl
    if (config.syncEnabled && config.stationRole === 'backup') {
      console.warn('[Server] STATION_ROLE=backup — sync workers DISABLED to prevent stale standby PG from overwriting Neon. Promote via promote.sh first.')
    } else if (config.syncEnabled && !config.neonDatabaseUrl) {
      console.error('[Server] SYNC_ENABLED=true but NEON_DATABASE_URL not set — sync workers NOT started. Fix .env and restart.')
    }

    if (syncReady) {
      registerWorker('upstreamSync', 'degraded',
        () => startUpstreamSyncWorker(),
        () => stopUpstreamSyncWorker()
      )
      registerWorker('downstreamSync', 'degraded',
        () => startDownstreamSyncWorker(),
        () => stopDownstreamSyncWorker()
      )
      registerWorker('outageReplay', 'degraded',
        () => startOutageReplayWorker(),
        () => stopOutageReplayWorker()
      )
      registerWorker('fulfillmentBridge', 'degraded',
        () => startFulfillmentBridge(),
        () => stopFulfillmentBridge()
      )
      registerWorker('bridgeCheckpoint', 'degraded',
        () => startBridgeCheckpoint(),
        () => stopBridgeCheckpoint()
      )
      registerWorker('cloudRelay', 'optional',
        () => startCloudRelayClient(),
        () => stopCloudRelayClient()
      )
    }

    registerWorker('eodScheduler', 'optional',
      () => startEodScheduler(),
      () => { /* timer-based, unref'd — exits with process */ }
    )
    registerWorker('draftCleanup', 'optional',
      () => startDraftCleanupInterval(),
      () => { /* interval-based, unref'd — exits with process */ }
    )
    registerWorker('walkoutRetry', 'optional',
      () => startWalkoutRetryScheduler(),
      () => { /* interval-based, unref'd — exits with process */ }
    )
    registerWorker('scaleService', 'optional',
      () => scaleService.initialize(),
      () => { /* no teardown — USB handle released on exit */ }
    )

    try {
      await startAllWorkers()
    } catch (err) {
      console.error('[Server] FATAL: required worker failed — aborting boot:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
    if (syncReady) {
      console.log('[Server] Bidirectional sync workers started (NUC ↔ Neon)')
    }
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

    // Stop accepting new connections. Existing connections stay alive
    // until they finish or the drain timeout fires.
    httpServer.close(() => {
      console.log('[Server] HTTP server closed — all connections drained')
    })
    console.log('[Server] HTTP server draining in-flight requests (10s max)...')

    // Allow up to 10 seconds for in-flight requests to complete.
    // If connections don't close naturally, we exit anyway.
    const drainTimeout = setTimeout(() => {
      console.warn('[Server] Drain timeout reached — forcing exit')
      process.exit(0)
    }, 10_000)
    drainTimeout.unref()

    // While draining, disconnect background services in parallel
    await masterClient.$disconnect()
    console.log('[Server] Prisma disconnected')

    await stopAllWorkers()
    await disconnectNeon()
    console.log('[Server] Neon client disconnected')

    // If we get here before drain timeout, all services are cleaned up.
    // Wait for the HTTP server to fully close (connections drained) or
    // the drain timeout — whichever comes first.
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve())
    })
    clearTimeout(drainTimeout)
    console.log('[Server] Clean shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('unhandledRejection', (err) => {
    console.error('[Server] Unhandled rejection:', err)
  })
  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    // ECONNRESET / EPIPE / aborted are normal — client disconnected mid-request.
    // Do NOT crash the server for these.
    if (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.message === 'aborted') {
      console.warn('[Server] Connection reset (harmless):', err.code || err.message)
      return
    }
    console.error('[Server] Uncaught exception:', err)
    process.exit(1)
  })
}

main().catch((err) => {
  console.error('[Server] Fatal error:', err)
  process.exit(1)
})
