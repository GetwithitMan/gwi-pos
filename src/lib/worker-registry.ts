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

export type WorkerClass = 'required' | 'degraded' | 'optional'

export interface WorkerEntry {
  name: string
  class: WorkerClass
  start: () => void | Promise<void>
  stop: () => void | Promise<void>
  running: boolean
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
  })
}

/**
 * Start all registered workers in order.
 *
 * - required: throws on failure (caller should abort boot)
 * - degraded: logs error, continues
 * - optional: logs warning, continues
 */
export async function startAllWorkers(): Promise<void> {
  for (const worker of workers) {
    try {
      await worker.start()
      worker.running = true
      log.info({ name: worker.name, class: worker.class }, 'Worker started')
    } catch (err) {
      if (worker.class === 'required') {
        log.fatal({ name: worker.name, err }, 'Required worker failed to start')
        throw err
      } else if (worker.class === 'degraded') {
        log.error({ name: worker.name, err }, 'Degraded worker failed to start')
      } else {
        log.warn({ name: worker.name, err }, 'Optional worker failed to start')
      }
    }
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
 * Health summary for /healthz or monitoring endpoints.
 */
export function getWorkerHealth(): Array<{ name: string; class: WorkerClass; running: boolean }> {
  return workers.map(w => ({
    name: w.name,
    class: w.class,
    running: w.running,
  }))
}
