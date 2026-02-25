'use client'

/**
 * Monitoring Dashboard
 *
 * Overview of system health, error rates, and recent issues.
 * Navigation hub for detailed error views and health monitoring.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSocket } from '@/hooks/useSocket'

interface ErrorStats {
  bySeverity: { severity: string; count: number }[]
  byErrorType: { errorType: string; count: number }[]
  byStatus: { status: string; count: number }[]
  recentCount: number
  criticalCount: number
}

interface HealthStatus {
  checkType: string
  status: 'HEALTHY' | 'DEGRADED' | 'DOWN'
  responseTime?: number
  lastChecked?: string
}

export default function MonitoringDashboard() {
  const [stats, setStats] = useState<ErrorStats | null>(null)
  const [health, setHealth] = useState<HealthStatus[]>([])
  const [loading, setLoading] = useState(true)

  // Get locationId from localStorage for socket connection
  const [locationId, setLocationId] = useState<string | undefined>(undefined)
  useEffect(() => {
    setLocationId(localStorage.getItem('locationId') || undefined)
  }, [])
  const { isConnected } = useSocket()

  useEffect(() => {
    loadDashboardData()
  }, [])

  // 20s fallback polling only when socket is disconnected
  useEffect(() => {
    if (isConnected) return
    const fallback = setInterval(loadDashboardData, 20000)
    return () => clearInterval(fallback)
  }, [isConnected])

  // Instant refresh on tab switch
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') loadDashboardData()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  async function loadDashboardData() {
    try {
      const locationId = localStorage.getItem('locationId')
      if (!locationId) return

      // Load error stats and health status in parallel
      const [statsRes, healthRes] = await Promise.all([
        fetch(`/api/monitoring/errors?stats=true&locationId=${locationId}`),
        fetch(`/api/monitoring/health-check?locationId=${locationId}`),
      ])

      if (statsRes.ok) {
        const data = await statsRes.json()
        setStats(data.data?.stats || data.data)
      }

      if (healthRes.ok) {
        const data = await healthRes.json()
        setHealth(data.data.checks || [])
      }

    } catch (error) {
      console.error('Failed to load dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center text-white">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto"></div>
            <p className="mt-4">Loading monitoring dashboard...</p>
          </div>
        </div>
      </div>
    )
  }

  const criticalCount = stats?.criticalCount || 0
  const recentCount = stats?.recentCount || 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">System Monitoring</h1>
          <p className="text-gray-300">Real-time error tracking and system health</p>
        </div>

        {/* Alert Banner (if critical errors) */}
        {criticalCount > 0 && (
          <div className="mb-6 bg-red-500/20 border border-red-500/50 rounded-lg p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-red-500 rounded-full p-2">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-white font-semibold">⚠️ {criticalCount} Critical Error{criticalCount > 1 ? 's' : ''} Require Attention</h3>
                  <p className="text-red-200 text-sm">Review and resolve critical issues immediately</p>
                </div>
              </div>
              <Link
                href="/monitoring/errors?severity=CRITICAL&status=NEW"
                className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded-lg font-semibold transition"
              >
                View Critical Errors
              </Link>
            </div>
          </div>
        )}

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">

          {/* Total Errors (24h) */}
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-300 text-sm">Errors (24h)</p>
                <p className="text-4xl font-bold text-white mt-1">{recentCount}</p>
              </div>
              <div className="bg-blue-500/20 rounded-full p-3">
                <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Critical Errors */}
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-300 text-sm">Critical (Unresolved)</p>
                <p className="text-4xl font-bold text-red-400 mt-1">{criticalCount}</p>
              </div>
              <div className="bg-red-500/20 rounded-full p-3">
                <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
            </div>
          </div>

          {/* System Health */}
          <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-300 text-sm">System Health</p>
                <p className="text-2xl font-bold text-green-400 mt-1">
                  {health.some(h => h.status === 'DOWN') ? '🔴 DOWN' :
                   health.some(h => h.status === 'DEGRADED') ? '🟡 DEGRADED' : '🟢 HEALTHY'}
                </p>
              </div>
              <div className="bg-green-500/20 rounded-full p-3">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>

        </div>

        {/* Quick Navigation */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">

          <Link href="/monitoring/errors" className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 hover:bg-white/15 transition group">
            <div className="flex items-center gap-4">
              <div className="bg-orange-500/20 rounded-lg p-4 group-hover:bg-orange-500/30 transition">
                <svg className="w-8 h-8 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-white">Error Logs</h3>
                <p className="text-gray-300 text-sm">View and manage all error logs</p>
              </div>
            </div>
          </Link>

          <Link href="/monitoring/health" className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20 hover:bg-white/15 transition group">
            <div className="flex items-center gap-4">
              <div className="bg-green-500/20 rounded-lg p-4 group-hover:bg-green-500/30 transition">
                <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-semibold text-white">System Health</h3>
                <p className="text-gray-300 text-sm">Monitor critical system components</p>
              </div>
            </div>
          </Link>

        </div>

        {/* Error Breakdown */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* By Severity */}
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20">
              <h3 className="text-xl font-semibold text-white mb-4">Errors by Severity</h3>
              <div className="space-y-3">
                {stats.bySeverity.map((item) => (
                  <div key={item.severity} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${
                        item.severity === 'CRITICAL' ? 'bg-red-500' :
                        item.severity === 'HIGH' ? 'bg-orange-500' :
                        item.severity === 'MEDIUM' ? 'bg-yellow-500' : 'bg-blue-500'
                      }`}></div>
                      <span className="text-gray-300">{item.severity}</span>
                    </div>
                    <span className="text-white font-semibold">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* By Error Type */}
            <div className="bg-white/10 backdrop-blur-md rounded-xl p-6 border border-white/20">
              <h3 className="text-xl font-semibold text-white mb-4">Errors by Type</h3>
              <div className="space-y-3">
                {stats.byErrorType.slice(0, 5).map((item) => (
                  <div key={item.errorType} className="flex items-center justify-between">
                    <span className="text-gray-300">{item.errorType}</span>
                    <span className="text-white font-semibold">{item.count}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}

      </div>
    </div>
  )
}
