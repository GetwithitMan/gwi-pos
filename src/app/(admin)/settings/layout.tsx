'use client'

import { useState, useEffect, useRef } from 'react'
import { SettingsNav } from '@/components/admin/SettingsNav'
import { useAuthStore } from '@/stores/auth-store'

const CLOUD_PARENT_DOMAINS = [
  '.ordercontrolcenter.com',
  '.barpos.restaurant',
]

function isCloudMode(): boolean {
  if (typeof window === 'undefined') return false
  return CLOUD_PARENT_DOMAINS.some((d) => window.location.hostname.endsWith(d))
}

/**
 * useCloudSessionGuard
 *
 * In cloud mode, validates that the auth store's locationId exists
 * in the current venue DB. If stale, refreshes from the httpOnly
 * cloud session cookie BEFORE children render.
 *
 * Returns `ready: false` until validation completes — the layout
 * shows a spinner, preventing any page from using stale data.
 */
function useCloudSessionGuard() {
  const { employee, locationId, isAuthenticated, login } = useAuthStore()
  const [ready, setReady] = useState(false)
  const checkedRef = useRef(false)

  useEffect(() => {
    if (checkedRef.current) return
    checkedRef.current = true

    // Not cloud mode — skip validation, render immediately
    if (!isCloudMode()) {
      setReady(true)
      return
    }

    // Not authenticated at all — let page handle redirect
    if (!isAuthenticated || !employee || !locationId) {
      // Try to bootstrap from cloud session cookie
      fetch('/api/auth/cloud-session')
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json()
            login(data.employee)
          }
        })
        .catch(() => {})
        .finally(() => setReady(true))
      return
    }

    // Authenticated — validate locationId exists in venue DB
    fetch(
      `/api/auth/validate-session?locationId=${locationId}&employeeId=${employee.id}`
    )
      .then(async (res) => {
        if (res.status === 401) {
          // Stale locationId — refresh from cloud session cookie
          const refresh = await fetch('/api/auth/cloud-session')
          if (refresh.ok) {
            const data = await refresh.json()
            login(data.employee)
          }
        }
      })
      .catch(() => {})
      .finally(() => setReady(true))
  }, [isAuthenticated, employee, locationId, login])

  return ready
}

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const ready = useCloudSessionGuard()

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Mobile toggle button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-3 left-3 z-50 lg:hidden bg-white p-2 rounded-lg shadow-md border"
        aria-label="Toggle settings navigation"
      >
        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar - fixed on desktop, sliding on mobile */}
      <div
        className={`fixed top-0 left-0 bottom-0 z-40 transform transition-transform duration-200 lg:relative lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SettingsNav />
      </div>

      {/* Main content — blocked until cloud session is validated */}
      <div className="flex-1 min-w-0">
        {ready ? (
          children
        ) : (
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-500">Verifying session...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
