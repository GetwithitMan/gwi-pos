'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

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

export default function HardwareDashboard() {
  const [printers, setPrinters] = useState<PrinterStatus[]>([])
  const [kdsScreens, setKdsScreens] = useState<KDSScreenStatus[]>([])
  const [loading, setLoading] = useState(true)

  const fetchStatus = useCallback(async () => {
    try {
      const [printersRes, kdsRes] = await Promise.all([
        fetch('/api/hardware/printers?locationId=loc-1'),
        fetch('/api/hardware/kds-screens?locationId=loc-1'),
      ])

      if (printersRes.ok) {
        const data = await printersRes.json()
        setPrinters(data.printers || [])
      }

      if (kdsRes.ok) {
        const data = await kdsRes.json()
        setKdsScreens(data.screens || [])
      }
    } catch (error) {
      console.error('Failed to fetch hardware status:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    // Refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
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

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/settings"
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span>Settings</span>
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Hardware Management</h1>
          </div>
          <button
            onClick={fetchStatus}
            className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-medium hover:bg-gray-300"
          >
            Refresh Status
          </button>
        </div>

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
