/**
 * Online Order Dispatch Worker
 *
 * Polls every 15 seconds for online orders with status 'received' (payment
 * approved on Vercel but not yet dispatched to kitchen/printers) and triggers
 * the normal send pipeline on the NUC so KDS screens and printers fire.
 *
 * WHY THIS EXISTS:
 *   Online checkout runs on Vercel (cloud), but KDS screens and kitchen printers
 *   are connected to the NUC via local Socket.io. Vercel can't reach the NUC
 *   directly (it's behind NAT). Instead, Vercel writes the paid order to the
 *   shared Neon DB with status 'received', and this worker picks it up within
 *   15 seconds and dispatches locally.
 *
 * 15-second latency is acceptable — customers expect 15–30 min prep time.
 *
 * Only runs on NUC instances (requires POS_LOCATION_ID env var).
 * In cloud/Vercel mode, this worker does not start.
 */

let workerInterval: ReturnType<typeof setInterval> | null = null

const POLL_INTERVAL_MS = 15_000

export function startOnlineOrderDispatchWorker(port: number): void {
  if (workerInterval) return

  const locationId = process.env.POS_LOCATION_ID
  if (!locationId) {
    // Cloud/Vercel mode — no local Socket.io dispatch possible, skip
    return
  }

  console.log('[OnlineOrderWorker] Started (15s polling interval)')

  workerInterval = setInterval(() => {
    void pollAndDispatch(port, locationId).catch((err) =>
      console.error('[OnlineOrderWorker] Poll cycle error:', err)
    )
  }, POLL_INTERVAL_MS)
}

export function stopOnlineOrderDispatchWorker(): void {
  if (workerInterval) {
    clearInterval(workerInterval)
    workerInterval = null
    console.log('[OnlineOrderWorker] Stopped')
  }
}

async function pollAndDispatch(port: number, locationId: string): Promise<void> {
  try {
    const res = await fetch(
      `http://localhost:${port}/api/internal/dispatch-online-order`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.PROVISION_API_KEY || '',
        },
        body: JSON.stringify({ locationId }),
      }
    )

    if (!res.ok) {
      console.error(`[OnlineOrderWorker] Dispatch endpoint returned ${res.status}`)
      return
    }

    const data = (await res.json()) as { dispatched: number; found: number; errors?: string[] }

    if (data.dispatched > 0) {
      console.log(`[OnlineOrderWorker] Dispatched ${data.dispatched} online order(s) to kitchen`)
    }
    if (data.errors?.length) {
      console.error('[OnlineOrderWorker] Dispatch errors:', data.errors)
    }
  } catch {
    // Server might not be ready yet on startup — silently ignore
  }
}
