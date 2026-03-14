'use client'

import { useAutoRefresh } from '@/hooks/useAutoRefresh'
import { useVersionHandshake } from '@/hooks/useVersionHandshake'

/**
 * Mounted in the root layout. Handles two responsibilities:
 * 1. Reports the client's app version to the server (version handshake)
 * 2. Listens for system:update-required and auto-refreshes when idle
 *
 * Does NOT interrupt active payment flows — the 2s delay + deferred
 * refresh pattern ensures safe updates.
 */
export function UpdateRefreshListener() {
  useVersionHandshake()
  useAutoRefresh(false) // Default: always allow refresh (2s delay gives grace period)
  return null
}
