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
import { randomUUID } from 'crypto'
import next from 'next'
import { initializeSocketServer, getSocketServer } from './src/lib/socket-server'
import { requestStore } from './src/lib/request-context'
import { getDbForVenue, masterClient } from './src/lib/db'
import { config } from './src/lib/system-config'
import { logger } from './src/lib/logger'
import { registerWorker, startAllWorkers, stopAllWorkers } from './src/lib/worker-registry'
import { startCloudEventWorker, stopCloudEventWorker } from './src/lib/cloud-event-queue'
import { startOnlineOrderDispatchWorker, stopOnlineOrderDispatchWorker } from './src/lib/online-order-worker'
import { startHardwareCommandWorker } from './src/lib/hardware-command-worker'
import { scaleService } from './src/lib/scale/scale-service'
import { startUpstreamSyncWorker, stopUpstreamSyncWorker } from './src/lib/sync/upstream-sync-worker'
import { startDownstreamSyncWorker, stopDownstreamSyncWorker, initialSyncComplete } from './src/lib/sync/downstream-sync-worker'
import { startOutageReplayWorker, stopOutageReplayWorker } from './src/lib/sync/outage-replay-worker'
import { startFulfillmentBridge, stopFulfillmentBridge } from './src/lib/fulfillment-bridge-worker'
import { startBridgeCheckpoint, stopBridgeCheckpoint } from './src/lib/bridge-checkpoint'
import { startCloudRelayClient, stopCloudRelayClient } from './src/lib/cloud-relay-client'
import { startCellularRelayCleanup, stopCellularRelayCleanup } from './src/lib/cellular-event-relay'
import { disconnectNeon } from './src/lib/neon-client'
import { cleanupStaleOrders } from './src/lib/domain/cleanup/stale-order-cleanup'
import { listPendingRetries, processWalkoutRetry } from './src/lib/domain/datacap/walkout-retry-service'
import { runBootstrap, startSchemaRecheckIfBlocked, stopSchemaRecheck } from './src/lib/venue-bootstrap'
import { computeReadiness, setReadinessState, getReadinessState, advanceToOrders, isReadyForSync, type ReadinessInputs } from './src/lib/readiness'

// Normalize POS_LOCATION_ID early — some NUC .env files only set LOCATION_ID.
// This ensures all downstream code reading process.env.POS_LOCATION_ID gets the value.
if (!process.env.POS_LOCATION_ID && process.env.LOCATION_ID) {
  process.env.POS_LOCATION_ID = process.env.LOCATION_ID
}

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
        logger.info({ closedCount: result.closedCount }, 'Cleaned up stale draft orders')
      }
    } catch (err) {
      logger.error({ err }, 'Stale order cleanup failed')
    }
  }

  function scheduleNext() {
    const delay = msUntilNext4AM()
    const nextRun = new Date(Date.now() + delay)
    logger.info({ nextRun: nextRun.toISOString() }, 'Next stale-order cleanup scheduled')

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
        logger.info({ closedCount: result.closedCount, maxAgeHours: MAX_AGE_HOURS }, 'Cancelled abandoned draft orders')
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

      logger.info({ attempted: due.length, succeeded, failed }, 'Walkout retry sweep complete')
    } catch (err) {
      logger.error({ err }, 'Walkout retry sweep failed')
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
    logger.fatal({ rawPort: process.env.PORT, parsed: port }, 'Invalid port — check .env for quoted values like PORT="3005"')
    process.exit(1)
  }

  const app = next({ dev, hostname, port })
  const handle = app.getRequestHandler()

  // NOTE: Migrations are handled by systemd ExecStartPre (pre-start.sh).
  // server.ts does NOT run nuc-pre-migrate.js — single migration authority.
  // Neon schema is MC's responsibility — NUC observes and blocks sync if behind.

  await app.prepare()

  const socketPath = process.env.SOCKET_PATH || '/api/socket'

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Let Socket.io handle its own HTTP polling requests — the [orderCode]/[slug]
    // catch-all route would otherwise intercept /api/socket as a page route.
    const pathname = req.url?.split('?')[0] || ''
    if (pathname === socketPath || pathname.startsWith(socketPath + '/')) {
      return // Socket.io's own request listener handles this
    }

    // Multi-tenant: wrap request in AsyncLocalStorage with the correct
    // PrismaClient so that `import { db } from '@/lib/db'` automatically
    // routes to the venue's Neon database.
    const slug = req.headers['x-venue-slug'] as string | undefined
    const requestId = (req.headers['x-request-id'] as string) || randomUUID()
    if (slug && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
      getDbForVenue(slug).then((prisma) => {
        requestStore.run({ slug, prisma, requestId }, () => handle(req, res))
      }).catch(() => {
        res.statusCode = 502
        res.end(JSON.stringify({ error: 'Venue database not available' }))
      })
    } else {
      // Local/NUC mode (no slug header): still wrap in requestStore so
      // withVenue() fast-path fires and skips await headers() entirely.
      requestStore.run({ slug: '', prisma: masterClient, requestId }, () => handle(req, res))
    }
  })

  // Initialize Socket.io (skip if standalone ws-server handles sockets)
  if (process.env.WS_STANDALONE === 'true') {
    logger.info({ wsServerUrl: process.env.WS_SERVER_URL || 'localhost:3001' }, 'Socket.io disabled (WS_STANDALONE=true, using ws-server)')
  } else {
    try {
      await initializeSocketServer(httpServer)
      logger.info({ socketPath: process.env.SOCKET_PATH || '/api/socket' }, 'Socket.io initialized')
    } catch (err) {
      logger.error({ err }, 'Failed to initialize Socket.io')
      // Continue without sockets — POS will fall back to polling
    }
  }

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error({ port }, 'Port is already in use. Run: lsof -i :<port> to find the process.')
      process.exit(1)
    }
    logger.error({ err }, 'HTTP server error')
    process.exit(1)
  })

  // ── Pre-listen validation (blocking) ──────────────────────────────────
  // Sync coverage validation — BLOCKING before server accepts connections.
  // Ensures every DB table is in sync config. Fails boot in production if unknown.
  try {
    const { validateSyncCoverage } = await import('./src/lib/sync/sync-config')
    await validateSyncCoverage(masterClient)
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, 'Sync coverage validation failed')
    if (config.isProduction) {
      logger.fatal('Cannot start with sync coverage errors in production')
      process.exit(1)
    }
    // Dev: continue with warning
  }

  // ── Venue Bootstrap (check schema state, conditional repair) ────────────
  let bootstrapResult: Awaited<ReturnType<typeof runBootstrap>> | null = null
  try {
    bootstrapResult = await runBootstrap()
    if (!bootstrapResult.localBootOk) {
      logger.warn({ bootstrapResult }, 'Bootstrap completed with issues — some features may be degraded')
    }
  } catch (err) {
    logger.error({ err }, 'Bootstrap failed — continuing with degraded mode')
  }

  // ── Set initial readiness BEFORE listen ─────────────────────────────────
  // Ensures readiness is never `null` when health/heartbeat endpoints are hit.
  // The listen callback will refine this with schema verification results.
  const initialReadiness = computeReadiness({
    localDbUp: bootstrapResult?.localDb ?? false,
    localSchemaVerified: false,
    neonConfigured: !!config.neonDatabaseUrl,
    neonReachable: bootstrapResult?.neonReachable ?? false,
    neonSchemaVersionOk: false,
    neonCoreTablesExist: false,
    neonRequiredEnumsExist: false,
    baseSeedPresent: false,
    syncEnabled: config.syncEnabled,
    stationRole: config.stationRole,
    initialSyncComplete: false,
    seedComplete: true,
  })
  setReadinessState(initialReadiness)
  logger.info({ level: initialReadiness.level }, 'Initial readiness set (pre-listen)')

  httpServer.listen(port, async () => {
    logger.info({ hostname, port, mode: dev ? 'development' : 'production' }, 'GWI POS ready')
    logger.info({ socketUrl: `ws://${hostname}:${port}/api/socket` }, 'Socket.io endpoint')

    // Schema verification (non-blocking, but result gates sync workers)
    const schemaResult = await import('./src/lib/schema-verify').then(({ verifySchema }) =>
      verifySchema()
    ).catch(err => {
      logger.error({ err }, 'Schema verification failed')
      return { passed: false, missing: [{ table: '_VERIFICATION_ERROR' }], checked: 0, error: String(err) } as const
    })

    // Seed completion check — detect incomplete Neon seeds
    let seedComplete = true
    try {
      const fs = await import('fs')
      const seedStatusPath = '/opt/gwi-pos/.seed-status'
      if (fs.existsSync(seedStatusPath)) {
        const seedStatus = fs.readFileSync(seedStatusPath, 'utf-8').trim()
        if (seedStatus.startsWith('INCOMPLETE')) {
          seedComplete = false
          logger.error({ seedStatus }, 'Seed from Neon is INCOMPLETE — venue may be missing critical data. Re-run installer or: bash scripts/seed-from-neon.sh')
        } else if (seedStatus.startsWith('COMPLETE')) {
          logger.info({ seedStatus }, 'Seed status: complete')
        } else {
          logger.warn({ seedStatus }, 'Unrecognized seed status')
        }
      }
    } catch {
      // No seed status file — either dev env or pre-hardening install. Not an error.
    }

    // Tenant model set validation — log error but never crash (readiness handles degradation)
    void import('./src/lib/tenant-validation').then(({ validateTenantModelSets }) =>
      validateTenantModelSets(masterClient, { failOnStale: false })
    ).then(undefined, (err) => {
      logger.error({ err: err instanceof Error ? err.message : err }, 'Tenant model set validation failed — continuing in degraded mode')
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

    // ── Canonical readiness evaluation ──────────────────────────────────
    // Single source of truth for "is this venue ready?" — replaces inline
    // neonSchemaOk / localSchemaOk / syncReady logic that was duplicated
    // between server.ts, venue-bootstrap.ts, and health endpoints.
    // Wrapped in try/catch — initial readiness was set pre-listen, this refines it.
    let readiness = initialReadiness
    const neonReady = bootstrapResult?.neonSchemaReady
    try {
      const neonSchemaVersionOk = neonReady
        ? (neonReady.schemaVersionMatch || neonReady.schemaVersionAhead)
        : false

      const readinessInputs: ReadinessInputs = {
        localDbUp: bootstrapResult?.localDb ?? false,
        localSchemaVerified: schemaResult.passed,
        neonConfigured: !!config.neonDatabaseUrl,
        neonReachable: bootstrapResult?.neonReachable ?? false,
        neonSchemaVersionOk,
        neonCoreTablesExist: neonReady?.coreTablesExist ?? false,
        neonRequiredEnumsExist: neonReady?.requiredEnumsExist ?? false,
        baseSeedPresent: neonReady?.baseSeedPresent ?? false,
        syncEnabled: config.syncEnabled,
        stationRole: config.stationRole,
        initialSyncComplete: false,
        seedComplete,
      }
      readiness = computeReadiness(readinessInputs)
      setReadinessState(readiness)
    } catch (err) {
      logger.error({ err }, 'Readiness refinement failed — keeping initial BOOT state')
    }

    const syncReady = isReadyForSync()

    // Log specific failure reasons so operators know what to fix
    if (!schemaResult.passed) {
      logger.error({ schemaResult }, 'Local schema verification failed — sync workers will NOT start. Server continues for recovery access.')
    }
    if (config.syncEnabled && config.stationRole === 'backup') {
      logger.warn('STATION_ROLE=backup — sync workers DISABLED to prevent stale standby PG from overwriting Neon. Promote via promote.sh first.')
    } else if (config.syncEnabled && !config.neonDatabaseUrl) {
      logger.error('SYNC_ENABLED=true but NEON_DATABASE_URL not set — sync workers NOT started. Fix .env and restart.')
    }
    if (config.syncEnabled && config.neonDatabaseUrl && !syncReady) {
      if (!neonReady) {
        logger.warn('Neon unreachable at boot — sync workers will start and retry Neon connections internally.')
      } else {
        logger.warn({
          coreTablesExist: neonReady.coreTablesExist,
          requiredEnumsExist: neonReady.requiredEnumsExist,
          schemaVersionMatch: neonReady.schemaVersionMatch,
          baseSeedPresent: neonReady.baseSeedPresent,
          schemaVersion: neonReady.schemaVersion,
          readinessLevel: readiness.level,
          degradedReasons: readiness.degradedReasons,
        }, 'Neon readiness incomplete — sync workers will start and retry.')
      }
    }

    // Start periodic re-check if Neon contract isn't fully satisfied.
    // When Neon becomes reachable, the re-check updates cached state.
    if (!readiness.syncContractReady) {
      startSchemaRecheckIfBlocked()
    }

    // Offline-first: always start sync workers when sync is enabled.
    // Workers handle Neon retries internally — they won't crash if Neon
    // is unreachable, they'll just skip sync cycles until it's available.
    if (syncReady || (config.syncEnabled && config.neonDatabaseUrl && readiness.level !== 'FAILED')) {
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
      registerWorker('cellularRelay', 'optional',
        () => startCellularRelayCleanup(),
        () => stopCellularRelayCleanup()
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

    // ── Notification Worker (opt-in via IS_NOTIFICATION_WORKER env var) ──
    // Only start on NUC (not Vercel), only when explicitly enabled.
    // The worker polls NotificationJob rows and processes them via provider adapters.
    if (process.env.IS_NOTIFICATION_WORKER === 'true' && !process.env.VERCEL) {
      registerWorker('notificationWorker', 'degraded',
        async () => {
          const { startNotificationWorker } = await import('./src/lib/notifications/worker')
          const zone = process.env.WORKER_EXECUTION_ZONE || 'any'
          await startNotificationWorker(zone)
          const role = process.env.WORKER_ROLE || 'notification'
          logger.info(`Notification worker started (role: ${role})`)
        },
        async () => {
          const { stopNotificationWorker } = await import('./src/lib/notifications/worker')
          await stopNotificationWorker()
        }
      )
    }

    try {
      await startAllWorkers()
    } catch (err) {
      logger.fatal({ err }, 'Required worker failed — aborting boot')
      process.exit(1)
    }
    if (syncReady) {
      logger.info('Bidirectional sync workers started (NUC <-> Neon)')

      // Wait up to 15s for the first downstream sync cycle to complete.
      logger.info('Waiting for initial downstream sync cycle (max 15s)...')
      await Promise.race([
        initialSyncComplete,
        new Promise(resolve => setTimeout(resolve, 15_000))
      ])
    } else {
      logger.info('Sync workers started in retry mode (Neon unreachable at boot)')
    }

    // Verify critical tables are populated before advancing to ORDERS.
    // This runs regardless of Neon state — if a previous sync/seed populated
    // these tables, the POS is ready for customer traffic.
    {
      const criticalCounts: Record<string, number> = {}
      const criticalTables = ['Location', 'Organization', 'Role', 'Employee', 'Category', 'OrderType']
      for (const table of criticalTables) {
        try {
          const rows = await masterClient.$queryRawUnsafe<[{ count: bigint }]>(
            `SELECT COUNT(*) as count FROM "${table}" WHERE "deletedAt" IS NULL`
          )
          criticalCounts[table] = Number(rows[0]?.count ?? 0)
        } catch {
          criticalCounts[table] = 0
        }
      }
      // advanceToOrders only advances from SYNC level (enforced internally)
      advanceToOrders(criticalCounts)
      const current = getReadinessState()
      if (current?.level === 'ORDERS') {
        logger.info({ criticalCounts }, 'Server fully ready — ORDERS level reached')
      } else {
        logger.warn({ criticalCounts, level: current?.level }, 'Critical table check complete — awaiting full readiness')
      }
    }
  })

  // Graceful shutdown
  let shuttingDown = false
  async function shutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'Shutting down gracefully...')

    const io = getSocketServer()
    if (io) {
      io.close()
      logger.info('Socket.io closed')
    }

    // Stop accepting new connections. The close promise resolves when
    // all in-flight connections have drained.
    const serverClosed = new Promise<void>((resolve) => {
      httpServer.close(() => {
        logger.info('HTTP server closed — all connections drained')
        resolve()
      })
    })
    logger.info('HTTP server draining in-flight requests (30s max)...')

    // Allow up to 30 seconds for in-flight requests to complete.
    // If connections don't close naturally, we exit anyway.
    const drainTimeout = setTimeout(() => {
      logger.warn('Drain timeout reached — forcing exit')
      process.exit(0)
    }, 30_000)
    drainTimeout.unref()

    // While draining, disconnect background services in parallel.
    // Each step is individually try/caught so one failure doesn't prevent others.
    try {
      await masterClient.$disconnect()
      logger.info('Prisma disconnected')
    } catch (err) {
      logger.error({ err }, 'Prisma disconnect failed during shutdown')
    }

    try {
      stopSchemaRecheck()
      await stopAllWorkers()
    } catch (err) {
      logger.error({ err }, 'Worker stop failed during shutdown')
    }

    try {
      await disconnectNeon()
      logger.info('Neon client disconnected')
    } catch (err) {
      logger.error({ err }, 'Neon disconnect failed during shutdown')
    }

    // Wait for the HTTP server to fully close (connections drained) or
    // the drain timeout — whichever comes first.
    await serverClosed
    clearTimeout(drainTimeout)
    logger.info('Clean shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'Unhandled rejection')
  })
  process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
    // ECONNRESET / EPIPE / aborted are normal — client disconnected mid-request.
    // Do NOT crash the server for these.
    if (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.message === 'aborted') {
      logger.warn({ code: err.code }, 'Connection reset (harmless)')
      return
    }
    logger.fatal({ err }, 'Uncaught exception — initiating graceful shutdown')
    void shutdown('uncaughtException')
  })
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal server error')
  process.exit(1)
})
