import { toast } from '@/stores/toast-store'

interface ConflictResponse {
  error: string
  conflict: boolean
  currentVersion: number
}

/**
 * Check if a fetch response is a concurrency conflict (HTTP 409).
 * If so, show a toast and return the current server version.
 * Returns null if not a conflict.
 */
export async function handleConflictResponse(
  response: Response,
  orderId: string,
  onRefresh?: (currentVersion: number) => void,
): Promise<ConflictResponse | null> {
  if (response.status !== 409) return null

  const body = await response.json().catch(() => null)
  if (!body?.conflict) return null

  toast.warning('This tab was changed on another terminal. Your view has been refreshed.')

  if (onRefresh && body.currentVersion != null) {
    onRefresh(body.currentVersion)
  }

  return body as ConflictResponse
}
