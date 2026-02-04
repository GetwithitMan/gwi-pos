'use client'

import { useState, useEffect, useCallback } from 'react'
import { OfflineManager } from '@/lib/offline-manager'

interface SyncStatus {
  pending: number
  syncing: boolean
  lastError?: string
  connectionStatus: 'online' | 'offline' | 'degraded'
}

export function useOfflineSync(terminalId?: string, terminalName?: string) {
  const [status, setStatus] = useState<SyncStatus>({
    pending: 0,
    syncing: false,
    connectionStatus: 'online',
  })
  const [initialized, setInitialized] = useState(false)

  // Initialize the offline manager
  useEffect(() => {
    if (terminalId && terminalName && !initialized) {
      OfflineManager.initialize(terminalId, terminalName)
      setInitialized(true)
    }
  }, [terminalId, terminalName, initialized])

  // Subscribe to status updates
  useEffect(() => {
    const unsubscribe = OfflineManager.subscribe((syncStatus) => {
      setStatus({
        ...syncStatus,
        connectionStatus: OfflineManager.getConnectionStatus(),
      })
    })

    return unsubscribe
  }, [])

  // Update connection status on online/offline events
  useEffect(() => {
    const updateConnectionStatus = () => {
      setStatus((prev) => ({
        ...prev,
        connectionStatus: OfflineManager.getConnectionStatus(),
      }))
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('online', updateConnectionStatus)
      window.addEventListener('offline', updateConnectionStatus)

      return () => {
        window.removeEventListener('online', updateConnectionStatus)
        window.removeEventListener('offline', updateConnectionStatus)
      }
    }
  }, [])

  // Queue an order for sync
  const queueOrder = useCallback(async (orderData: any) => {
    return OfflineManager.queueOrder(orderData)
  }, [])

  // Force a sync attempt
  const forceSync = useCallback(async () => {
    await OfflineManager.forceSync()
  }, [])

  // Get pending orders
  const getPendingOrders = useCallback(async () => {
    return OfflineManager.getPendingOrders()
  }, [])

  // Get sync logs
  const getSyncLogs = useCallback(async (limit = 50) => {
    return OfflineManager.getSyncLogs(limit)
  }, [])

  return {
    status,
    queueOrder,
    forceSync,
    getPendingOrders,
    getSyncLogs,
    isOffline: status.connectionStatus === 'offline',
    isDegraded: status.connectionStatus === 'degraded',
    hasPending: status.pending > 0,
  }
}
