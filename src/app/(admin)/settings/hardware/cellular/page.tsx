'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useAuthStore } from '@/stores/auth-store'
import { getSharedSocket, releaseSharedSocket, isSharedSocketConnected } from '@/lib/shared-socket'
import { toast } from '@/stores/toast-store'

interface CellularDevice {
  terminalId: string
  deviceFingerprint: string
  venueSlug: string
  lastActiveAt: string
  issuedAt: string
  tokenExpiresAt: string
  isExpired: boolean
  isRevoked: boolean
  status: 'active' | 'expired' | 'revoked'
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function truncateId(id: string, maxLen = 12): string {
  if (id.length <= maxLen) return id
  return id.slice(0, maxLen) + '...'
}

function StatusBadge({ status }: { status: string }) {
  const styles = {
    active: 'bg-green-100 text-green-800',
    expired: 'bg-gray-100 text-gray-600',
    revoked: 'bg-red-100 text-red-800',
  }
  const labels = { active: 'Active', expired: 'Expired', revoked: 'Revoked' }
  const className = styles[status as keyof typeof styles] || styles.expired
  const label = labels[status as keyof typeof labels] || status

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {status === 'active' && (
        <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5 animate-pulse" />
      )}
      {label}
    </span>
  )
}

export default function CellularDevicesPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id
  const [devices, setDevices] = useState<CellularDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [revokeTarget, setRevokeTarget] = useState<CellularDevice | null>(null)
  const [revokeReason, setRevokeReason] = useState('')

  const fetchDevices = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/cellular-devices?locationId=${locationId}`)
      if (res.ok) {
        const json = await res.json()
        setDevices(json.data?.devices || [])
      }
    } catch (error) {
      console.error('Failed to fetch cellular devices:', error)
    } finally {
      setLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    fetchDevices()
  }, [fetchDevices])

  // Fallback polling every 30 seconds (only when socket disconnected)
  useEffect(() => {
    if (!locationId) return
    const interval = setInterval(() => {
      if (isSharedSocketConnected()) return
      fetchDevices()
    }, 30_000)
    return () => clearInterval(interval)
  }, [locationId, fetchDevices])

  // Listen for socket events about cellular device changes
  useEffect(() => {
    if (!locationId) return
    const socket = getSharedSocket()

    const onDeviceRevoked = (payload: { terminalId: string }) => {
      setDevices(prev =>
        prev.map(d =>
          d.terminalId === payload.terminalId
            ? { ...d, status: 'revoked' as const, isRevoked: true }
            : d
        )
      )
    }

    socket.on('cellular:device-revoked', onDeviceRevoked)
    return () => {
      socket.off('cellular:device-revoked', onDeviceRevoked)
      releaseSharedSocket()
    }
  }, [locationId])

  const handleRevoke = async () => {
    if (!revokeTarget || !locationId) return
    try {
      const res = await fetch('/api/cellular-devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          terminalId: revokeTarget.terminalId,
          deviceFingerprint: revokeTarget.deviceFingerprint,
          reason: revokeReason || undefined,
        }),
      })
      if (res.ok) {
        toast.success('Device access revoked')
        setDevices(prev =>
          prev.map(d =>
            d.terminalId === revokeTarget.terminalId
              ? { ...d, status: 'revoked' as const, isRevoked: true }
              : d
          )
        )
      } else {
        const err = await res.json()
        toast.error(err.error || 'Failed to revoke device')
      }
    } catch (error) {
      console.error('Failed to revoke device:', error)
      toast.error('Failed to revoke device')
    } finally {
      setRevokeTarget(null)
      setRevokeReason('')
    }
  }

  const activeCount = devices.filter(d => d.status === 'active').length

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="text-gray-900">Loading cellular devices...</div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl">
      <AdminPageHeader
        title="Cellular Devices"
        subtitle="View and manage cellular (LTE/5G) devices connected to this venue"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Hardware', href: '/settings/hardware' },
        ]}
      />

      {/* Restrictions Info Panel */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm">
            <p className="font-medium text-blue-900 mb-2">Cellular Device Capabilities</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="font-medium text-blue-800 mb-1">Can do:</p>
                <ul className="text-blue-700 space-y-0.5">
                  <li>View menu and categories</li>
                  <li>Create orders and add items</li>
                  <li>Send orders to kitchen/bar</li>
                  <li>Process card payments</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-red-700 mb-1">Cannot do:</p>
                <ul className="text-red-600 space-y-0.5">
                  <li>Issue refunds or tip adjustments</li>
                  <li>Split or merge checks</li>
                  <li>Close shifts</li>
                  <li>Access admin, reports, or inventory</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Summary bar */}
      {devices.length > 0 && (
        <div className="mb-4 flex items-center gap-4 text-sm text-gray-600">
          <span>
            <span className="font-medium text-gray-900">{activeCount}</span> active
          </span>
          <span>
            <span className="font-medium text-gray-900">{devices.length}</span> total
          </span>
          <span className="text-gray-900">Auto-refreshes every 30s</span>
        </div>
      )}

      {/* Device list */}
      {devices.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
          <svg className="w-12 h-12 text-gray-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <h3 className="text-lg font-medium text-gray-900 mb-1">No cellular devices connected</h3>
          <p className="text-sm text-gray-900 max-w-md mx-auto">
            Devices connect via Mission Control pairing. Once a cellular device authenticates
            with this venue, it will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {devices.map((device) => (
            <div
              key={`${device.terminalId}:${device.deviceFingerprint}`}
              className={`bg-white rounded-lg border p-4 transition-colors ${
                device.status === 'revoked'
                  ? 'border-red-200 bg-red-50/30'
                  : device.status === 'expired'
                    ? 'border-gray-200 bg-gray-50/30'
                    : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    {/* Terminal icon */}
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      device.status === 'active'
                        ? 'bg-green-100'
                        : device.status === 'revoked'
                          ? 'bg-red-100'
                          : 'bg-gray-100'
                    }`}>
                      <svg className={`w-4 h-4 ${
                        device.status === 'active'
                          ? 'text-green-600'
                          : device.status === 'revoked'
                            ? 'text-red-600'
                            : 'text-gray-900'
                      }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-sm font-medium text-gray-900 truncate"
                          title={device.terminalId}
                        >
                          {truncateId(device.terminalId, 20)}
                        </span>
                        <StatusBadge status={device.status} />
                      </div>
                      <p className="text-xs text-gray-900 truncate" title={device.deviceFingerprint}>
                        Fingerprint: {truncateId(device.deviceFingerprint, 16)}
                      </p>
                    </div>
                  </div>

                  {/* Details row */}
                  <div className="ml-11 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-900">
                    <span title={new Date(device.lastActiveAt).toLocaleString()}>
                      Last active: {formatRelativeTime(device.lastActiveAt)}
                    </span>
                    <span>
                      Token expires: {formatDateTime(device.tokenExpiresAt)}
                    </span>
                    <span>
                      Issued: {formatDateTime(device.issuedAt)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex-shrink-0">
                  {device.status === 'active' && (
                    <button
                      onClick={() => setRevokeTarget(device)}
                      className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                    >
                      Revoke Access
                    </button>
                  )}
                  {device.status === 'revoked' && (
                    <span className="text-xs text-red-500 font-medium">Access Revoked</span>
                  )}
                  {device.status === 'expired' && (
                    <span className="text-xs text-gray-900">Session Expired</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Revoke confirmation dialog */}
      <ConfirmDialog
        open={!!revokeTarget}
        title="Revoke Cellular Device Access"
        description={`This will immediately disconnect the device (Terminal: ${revokeTarget?.terminalId ? truncateId(revokeTarget.terminalId, 20) : ''}). The device will need to re-pair through Mission Control to regain access.`}
        confirmLabel="Revoke Access"
        destructive
        onConfirm={handleRevoke}
        onCancel={() => {
          setRevokeTarget(null)
          setRevokeReason('')
        }}
      />
    </div>
  )
}
