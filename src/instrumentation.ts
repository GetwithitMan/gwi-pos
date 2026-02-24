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

  process.on('unhandledRejection', (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    console.error(JSON.stringify({
      level: 'fatal',
      event: 'unhandledRejection',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    }))
    // Let the process manager handle restart
    process.exit(1)
  })

  process.on('uncaughtException', (error: Error) => {
    console.error(JSON.stringify({
      level: 'fatal',
      event: 'uncaughtException',
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    }))
    // Let the process manager handle restart
    process.exit(1)
  })
}
