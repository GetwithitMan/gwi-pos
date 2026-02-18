'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useEvents } from '@/lib/events/use-events'
import { useAuthStore } from '@/stores/auth-store'

interface PrinterStatus {
  id: string
  name: string
  printerRole: string
  printerType: string
  ipAddress: string
  port: number
  isActive: boolean
  lastPingOk: boolean
  lastPingAt: string | null
}

interface KDSScreenStatus {
  id: string
  name: string
  slug: string | null
  screenType: string
  isActive: boolean
  isOnline: boolean
  lastSeenAt: string | null
  isPaired: boolean
  lastKnownIp: string | null
  stationCount: number
}

interface TerminalStatus {
  id: string
  name: string
  category: string
  isActive: boolean
  isOnline: boolean
  isPaired: boolean
  lastSeenAt: string | null
  lastKnownIp: string | null
  forceAllPrints: boolean
}

interface PaymentReaderStatus {
  id: string
  name: string
  ipAddress: string
  port: number
  serialNumberMasked: string
  isOnline: boolean
  lastSeenAt: string | null
  terminals: { id: string; name: string }[]
}

// Staleness threshold - 60 seconds
const STALE_THRESHOLD_MS = 60000

function getTerminalLiveStatus(terminal: TerminalStatus): 'online' | 'stale' | 'offline' {
  if (!terminal.isPaired || !terminal.isOnline) return 'offline'
  if (terminal.lastSeenAt) {
    const lastSeen = new Date(terminal.lastSeenAt).getTime()
    if (Date.now() - lastSeen > STALE_THRESHOLD_MS) return 'stale'
  }
  return 'online'
}

export default function HardwareDashboard() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id
  const { isConnected } = useEvents({ locationId })
  const [printers, setPrinters] = useState<PrinterStatus[]>([])
  const [kdsScreens, setKdsScreens] = useState<KDSScreenStatus[]>([])
  const [terminals, setTerminals] = useState<TerminalStatus[]>([])
  const [paymentReaders, setPaymentReaders] = useState<PaymentReaderStatus[]>([])
  const [loading, setLoading] = useState(true)

  const fetchStatus = useCallback(async () => {
    if (!locationId) return
    try {
      const [printersRes, kdsRes, terminalsRes, readersRes] = await Promise.all([
        fetch(`/api/hardware/printers?locationId=${locationId}`),
        fetch(`/api/hardware/kds-screens?locationId=${locationId}`),
        fetch(`/api/hardware/terminals?locationId=${locationId}`),
        fetch(`/api/hardware/payment-readers?locationId=${locationId}`),
      ])

      if (printersRes.ok) {
        const data = await printersRes.json()
        setPrinters(data.data.printers || [])
      }

      if (kdsRes.ok) {
        const data = await kdsRes.json()
        setKdsScreens(data.data.screens || [])
      }

      if (terminalsRes.ok) {
        const data = await terminalsRes.json()
        setTerminals(data.data.terminals || [])
      }

      if (readersRes.ok) {
        const data = await readersRes.json()
        setPaymentReaders(data.data.readers || [])
      }
    } catch (error) {
      console.error('Failed to fetch hardware status:', error)
    } finally {
      setLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // 20s fallback polling only when socket is disconnected
  useEffect(() => {
    if (isConnected) return
    const fallback = setInterval(fetchStatus, 20000)
    return () => clearInterval(fallback)
  }, [isConnected, fetchStatus])

  // Instant refresh on tab switch
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') fetchStatus()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [fetchStatus])

  const handlePingPrinter = async (printerId: string) => {
    try {
      const res = await fetch(`/api/hardware/printers/${printerId}/ping`, {
        method: 'POST',
      })
      if (res.ok) {
        fetchStatus()
      }
    } catch (error) {
      console.error('Failed to ping printer:', error)
    }
  }

  const getStatusColor = (isOnline: boolean) => {
    return isOnline ? 'bg-green-500' : 'bg-red-500'
  }

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'receipt':
        return 'bg-blue-100 text-blue-800'
      case 'kitchen':
        return 'bg-orange-100 text-orange-800'
      case 'bar':
        return 'bg-purple-100 text-purple-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getCategoryBadgeColor = (category: string) => {
    switch (category) {
      case 'FIXED_STATION':
        return 'bg-indigo-100 text-indigo-800'
      case 'HANDHELD':
        return 'bg-teal-100 text-teal-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'FIXED_STATION':
        return 'Fixed'
      case 'HANDHELD':
        return 'Handheld'
      default:
        return category
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <AdminPageHeader
        title="Hardware Management"
        subtitle="Monitor and configure printers, KDS screens, terminals, and payment readers"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        actions={
          <button
            onClick={fetchStatus}
            className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium hover:bg-gray-300"
          >
            Refresh Status
          </button>
        }
      />

      <div className="mx-auto max-w-6xl">
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Printers Section */}
            <div className="rounded-xl bg-white p-6 shadow">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Printers</h2>
                <Link
                  href="/settings/hardware/printers"
                  className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                >
                  Manage Printers
                </Link>
              </div>

              {printers.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  <p>No printers configured</p>
                  <Link
                    href="/settings/hardware/printers"
                    className="mt-2 inline-block text-blue-500 hover:underline"
                  >
                    Add your first printer
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {printers.map((printer) => (
                    <div
                      key={printer.id}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={`h-3 w-3 rounded-full ${getStatusColor(printer.lastPingOk)}`}
                            title={printer.lastPingOk ? 'Online' : 'Offline'}
                          />
                          <h3 className="font-medium text-gray-900">{printer.name}</h3>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${getRoleBadgeColor(printer.printerRole)}`}
                        >
                          {printer.printerRole}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1 text-sm text-gray-600">
                        <p>
                          {printer.ipAddress}:{printer.port}
                        </p>
                        <p className="capitalize">{printer.printerType}</p>
                        {printer.lastPingAt && (
                          <p className="text-xs text-gray-400">
                            Last ping: {new Date(printer.lastPingAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={() => handlePingPrinter(printer.id)}
                          className="rounded bg-gray-200 px-3 py-1 text-xs font-medium hover:bg-gray-300"
                        >
                          Test Connection
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* KDS Screens Section */}
            <div className="rounded-xl bg-white p-6 shadow">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">KDS Screens</h2>
                <Link
                  href="/settings/hardware/kds-screens"
                  className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                >
                  Manage Screens
                </Link>
              </div>

              {kdsScreens.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  <p>No KDS screens configured</p>
                  <Link
                    href="/settings/hardware/kds-screens"
                    className="mt-2 inline-block text-blue-500 hover:underline"
                  >
                    Add your first KDS screen
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {kdsScreens.map((screen) => (
                    <div
                      key={screen.id}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={`h-3 w-3 rounded-full ${getStatusColor(screen.isOnline)}`}
                            title={screen.isOnline ? 'Online' : 'Offline'}
                          />
                          <h3 className="font-medium text-gray-900">{screen.name}</h3>
                        </div>
                        <div className="flex items-center gap-1">
                          {screen.isPaired ? (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                              Paired
                            </span>
                          ) : (
                            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                              Unpaired
                            </span>
                          )}
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-800">
                            {screen.screenType}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 space-y-1 text-sm text-gray-600">
                        <p>
                          {screen.stationCount} station{screen.stationCount !== 1 ? 's' : ''}{' '}
                          assigned
                        </p>
                        {screen.lastSeenAt && (
                          <p className="text-xs text-gray-400">
                            Last seen: {new Date(screen.lastSeenAt).toLocaleString()}
                            {screen.lastKnownIp && ` (${screen.lastKnownIp})`}
                          </p>
                        )}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Link
                          href={`/kds?screen=${screen.slug || screen.id}`}
                          target="_blank"
                          className="rounded bg-gray-200 px-3 py-1 text-xs font-medium hover:bg-gray-300"
                        >
                          Open KDS
                        </Link>
                        <Link
                          href="/kds/pair"
                          target="_blank"
                          className="rounded bg-purple-100 px-3 py-1 text-xs font-medium text-purple-700 hover:bg-purple-200"
                        >
                          Pair Device
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Terminals Section */}
            <div className="rounded-xl bg-white p-6 shadow">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">POS Terminals</h2>
                  <p className="text-sm text-gray-500">
                    Configure terminals with role-based print skip rules
                  </p>
                </div>
                <Link
                  href="/settings/hardware/terminals"
                  className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                >
                  Manage Terminals
                </Link>
              </div>

              {terminals.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  <p>No terminals configured</p>
                  <Link
                    href="/settings/hardware/terminals"
                    className="mt-2 inline-block text-blue-500 hover:underline"
                  >
                    Add your first terminal
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {terminals.map((terminal) => {
                    const liveStatus = getTerminalLiveStatus(terminal)
                    const statusConfig = {
                      online: { dot: 'bg-green-500 animate-pulse', text: 'Online', textClass: 'text-green-700' },
                      stale: { dot: 'bg-yellow-500', text: 'Stale', textClass: 'text-yellow-700' },
                      offline: { dot: 'bg-red-500', text: 'Offline', textClass: 'text-red-700' },
                    }
                    const status = statusConfig[liveStatus]

                    return (
                      <div
                        key={terminal.id}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={`h-3 w-3 rounded-full ${status.dot}`}
                            title={status.text}
                          />
                          <h3 className="font-medium text-gray-900">{terminal.name}</h3>
                        </div>
                        <div className="flex items-center gap-1">
                          {terminal.isPaired ? (
                            <span className={`rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium ${status.textClass}`}>
                              {status.text}
                            </span>
                          ) : (
                            <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                              Unpaired
                            </span>
                          )}
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${getCategoryBadgeColor(terminal.category)}`}
                          >
                            {getCategoryLabel(terminal.category)}
                          </span>
                        </div>
                      </div>
                      <div className="mt-2 space-y-1 text-sm text-gray-600">
                        {terminal.forceAllPrints && (
                          <p className="font-medium text-orange-600">Force All Prints ON</p>
                        )}
                        {terminal.lastSeenAt && (
                          <p className="text-xs text-gray-400">
                            Last seen: {new Date(terminal.lastSeenAt).toLocaleString()}
                            {terminal.lastKnownIp && ` (${terminal.lastKnownIp})`}
                          </p>
                        )}
                      </div>
                    </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Payment Readers Section */}
            <div className="rounded-xl bg-white p-6 shadow">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Payment Readers</h2>
                  <p className="text-sm text-gray-500">
                    Datacap Direct card readers for payment processing
                  </p>
                </div>
                <Link
                  href="/settings/hardware/payment-readers"
                  className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                >
                  Manage Readers
                </Link>
              </div>

              {paymentReaders.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  <p>No payment readers configured</p>
                  <Link
                    href="/settings/hardware/payment-readers"
                    className="mt-2 inline-block text-blue-500 hover:underline"
                  >
                    Add your first reader
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {paymentReaders.map((reader) => (
                    <div
                      key={reader.id}
                      className="rounded-lg border border-gray-200 bg-gray-50 p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={`h-3 w-3 rounded-full ${
                              reader.isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'
                            }`}
                            title={reader.isOnline ? 'Online' : 'Offline'}
                          />
                          <h3 className="font-medium text-gray-900">{reader.name}</h3>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            reader.isOnline
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {reader.isOnline ? 'Online' : 'Offline'}
                        </span>
                      </div>
                      <div className="mt-2 space-y-1 text-sm text-gray-600">
                        <p className="font-mono text-xs">
                          {reader.ipAddress}:{reader.port}
                        </p>
                        <p className="text-xs text-gray-400">
                          SN: {reader.serialNumberMasked}
                        </p>
                        {reader.terminals.length > 0 && (
                          <p className="text-xs">
                            Bound to: {reader.terminals.map((t) => t.name).join(', ')}
                          </p>
                        )}
                        {reader.lastSeenAt && (
                          <p className="text-xs text-gray-400">
                            Last seen: {new Date(reader.lastSeenAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Print Routing Section */}
            <div className="rounded-xl bg-white p-6 shadow">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Print Routing Rules</h2>
                  <p className="text-sm text-gray-500">
                    Configure where items and modifiers print
                  </p>
                </div>
                <Link
                  href="/settings/hardware/routing"
                  className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                >
                  Configure Routing
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
