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
      console.log(`[WorkerRegistry] ✓ ${worker.name} started`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      if (worker.class === 'required') {
        console.error(`[WorkerRegistry] FATAL: required worker "${worker.name}" failed to start: ${msg}`)
        throw err
      } else if (worker.class === 'degraded') {
        console.error(`[WorkerRegistry] ERROR: degraded worker "${worker.name}" failed to start: ${msg}`)
      } else {
        console.warn(`[WorkerRegistry] WARN: optional worker "${worker.name}" failed to start: ${msg}`)
      }
    }
  }

  const running = workers.filter(w => w.running).length
  console.log(`[WorkerRegistry] ${running}/${workers.length} workers started`)
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
      console.log(`[WorkerRegistry] ✓ ${worker.name} stopped`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[WorkerRegistry] Failed to stop "${worker.name}": ${msg}`)
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
