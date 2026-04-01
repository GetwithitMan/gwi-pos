/**
 * Worker Registry — centralized lifecycle management for all background workers.
 *
 * Workers are registered with a class that determines failure behavior:
 *   - required: boot aborts if start fails
 *   - degraded: failure logged as error, boot continues (feature partially unavailable)
 *   - optional: failure logged as warning, boot continues (nice-to-have)
 *
 * Workers start in registration order and stop in reverse order.
 */

import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('WorkerRegistry')

/** Exponential backoff delays for worker restarts: 5s, 10s, 30s, 60s, 60s */
const RESTART_DELAYS = [5000, 10000, 30000, 60000, 60000]
const MAX_RESTARTS = RESTART_DELAYS.length

export type WorkerClass = 'required' | 'degraded' | 'optional'

export interface WorkerEntry {
  name: string
  class: WorkerClass
  start: () => void | Promise<void>
  stop: () => void | Promise<void>
  running: boolean
  lastSuccessAt: Date | null
  lastErrorAt: Date | null
  errorCount: number
  restartCount: number
}

const workers: WorkerEntry[] = []

/**
 * Register a worker for lifecycle management.
 * Call before startAllWorkers(). Registration order = start order.
 */
export function registerWorker(
  name: string,
  workerClass: WorkerClass,
  startFn: () => void | Promise<void>,
  stopFn: () => void | Promise<void>
): void {
  workers.push({
    name,
    class: workerClass,
    start: startFn,
    stop: stopFn,
    running: false,
    lastSuccessAt: null,
    lastErrorAt: null,
    errorCount: 0,
    restartCount: 0,
  })
}

/**
 * Attempt to start a worker, restarting with exponential backoff on failure.
 * Only `degraded` and `optional` workers are restarted — `required` workers
 * re-throw so the process can abort.
 */
async function startWithRestart(worker: WorkerEntry): Promise<void> {
  try {
    await worker.start()
    worker.running = true
    worker.lastSuccessAt = new Date()
    // Reset restart count on successful start so future crashes get full backoff budget
    worker.restartCount = 0
    log.info({ name: worker.name, class: worker.class }, 'Worker started')
  } catch (err) {
    worker.running = false
    worker.lastErrorAt = new Date()
    worker.errorCount++

    // Required workers must crash the process — never auto-restart
    if (worker.class === 'required') {
      log.fatal({ name: worker.name, err }, 'Required worker failed to start')
      throw err
    }

    if (worker.restartCount >= MAX_RESTARTS) {
      log.error(
        { err, name: worker.name, restarts: worker.restartCount },
        `Worker ${worker.name} exceeded max restarts (${MAX_RESTARTS}) — leaving dead`,
      )
      return
    }

    const delay = RESTART_DELAYS[worker.restartCount]
    worker.restartCount++

    const level = worker.class === 'degraded' ? 'error' : 'warn'
    log[level](
      { err, name: worker.name, restartCount: worker.restartCount, nextRetryMs: delay },
      `Worker ${worker.name} crashed — restarting in ${delay}ms`,
    )

    setTimeout(() => {
      void startWithRestart(worker)
    }, delay)
  }
}

/**
 * Start all registered workers in order.
 *
 * - required: throws on failure (caller should abort boot)
 * - degraded: logs error, schedules restart with backoff, continues boot
 * - optional: logs warning, schedules restart with backoff, continues boot
 */
export async function startAllWorkers(): Promise<void> {
  for (const worker of workers) {
    await startWithRestart(worker)
  }

  const running = workers.filter(w => w.running).length
  log.info({ running, total: workers.length }, 'Worker startup complete')
}

/**
 * Stop all workers in reverse registration order.
 * Errors are logged but never thrown — shutdown must complete.
 */
export async function stopAllWorkers(): Promise<void> {
  for (let i = workers.length - 1; i >= 0; i--) {
    const worker = workers[i]
    if (!worker.running) continue

    try {
      await worker.stop()
      worker.running = false
      log.info({ name: worker.name }, 'Worker stopped')
    } catch (err) {
      log.error({ name: worker.name, err }, 'Failed to stop worker')
      worker.running = false // Mark stopped even on error — we're shutting down
    }
  }
}

/**
 * Report a successful work cycle for a worker.
 */
export function reportWorkerSuccess(name: string): void {
  const worker = workers.find(w => w.name === name)
  if (worker) {
    worker.lastSuccessAt = new Date()
  }
}

/**
 * Report an error for a worker.
 */
export function reportWorkerError(name: string): void {
  const worker = workers.find(w => w.name === name)
  if (worker) {
    worker.lastErrorAt = new Date()
    worker.errorCount++
  }
}

/**
 * Health summary for /healthz or monitoring endpoints.
 */
export function getWorkerHealth(): Array<{
  name: string
  class: WorkerClass
  running: boolean
  lastSuccessAt: Date | null
  lastErrorAt: Date | null
  errorCount: number
  restartCount: number
}> {
  return workers.map(w => ({
    name: w.name,
    class: w.class,
    running: w.running,
    lastSuccessAt: w.lastSuccessAt,
    lastErrorAt: w.lastErrorAt,
    errorCount: w.errorCount,
    restartCount: w.restartCount,
  }))
}
