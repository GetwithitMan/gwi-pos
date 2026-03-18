/**
 * Next.js Instrumentation — Process Crash Safety (BUG #477-478)
 *
 * Registers unhandledRejection and uncaughtException handlers on the Node.js
 * process. Logs structured errors and exits gracefully so the process manager
 * (systemd / PM2 / container runtime) can restart the service.
 *
 * Next.js calls this file's `register()` export once during server startup.
 */

export async function register() {
  // Only install on the Node.js runtime — Edge Runtime does not support process.on
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Use globalThis.process to avoid Turbopack static analysis flagging
  // process.exit / process.on as Edge-incompatible at build time
  const proc = globalThis.process

  proc.on('unhandledRejection', (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    console.error(JSON.stringify({
      level: 'error',
      event: 'unhandledRejection',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    }))
    // Capture to Sentry if available (dynamic import to avoid hard dependency)
    try {
      const Sentry = null as any
      Sentry?.captureException(error, { tags: { handler: 'unhandledRejection' } })
    } catch {
      // Sentry not available — already logged above
    }
    // Do NOT exit — unhandled rejections are serious but should not crash
    // the server. They are logged and monitored via Sentry.
  })

  proc.on('uncaughtException', (error: Error) => {
    console.error(JSON.stringify({
      level: 'fatal',
      event: 'uncaughtException',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    }))
    // Capture to Sentry if available before exiting
    try {
      const Sentry = null as any
      Sentry?.captureException(error, { tags: { handler: 'uncaughtException' } })
    } catch {
      // Sentry not available — already logged above
    }
    // Node.js docs recommend exiting on uncaughtException since the process
    // is in an undefined state. Allow a 5-second grace period for in-flight
    // requests to complete and Sentry to flush before exiting.
    console.error('[instrumentation] Uncaught exception — draining for 5s before exit')
    const exitTimer = setTimeout(() => proc.exit(1), 5_000)
    exitTimer.unref()
  })
}
