'use client'

import { useState, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PinPad } from '@/components/ui/pin-pad'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useDevStore } from '@/stores/dev-store'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const login = useAuthStore((state) => state.login)
  const clockInStore = useAuthStore((state) => state.clockIn)
  const setHasDevAccess = useDevStore((state) => state.setHasDevAccess)
  const setWorkingRole = useAuthStore((state) => state.setWorkingRole)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showClockInPrompt, setShowClockInPrompt] = useState(false)
  const [showRolePicker, setShowRolePicker] = useState(false)
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null)
  const [pendingEmployee, setPendingEmployee] = useState<{ id: string; locationId: string } | null>(null)
  const [pendingAvailableRoles, setPendingAvailableRoles] = useState<{ id: string; name: string; cashHandlingMode: string; isPrimary: boolean }[]>([])
  const [clockingIn, setClockingIn] = useState(false)

  const getRedirectPath = useCallback((employee: { defaultScreen?: string; permissions?: string[] }) => {
    const redirectParam = searchParams.get('redirect')
    if (redirectParam) return redirectParam

    // Non-POS employees go to Crew Hub
    if (employee.permissions && !hasPermission(employee.permissions, PERMISSIONS.POS_ACCESS)) {
      return '/crew'
    }

    const defaultScreen = employee.defaultScreen || 'orders'
    switch (defaultScreen) {
      case 'kds':
        return '/kds'
      case 'crew':
        return '/crew'
      case 'bar':
      case 'orders':
      default:
        return '/orders'
    }
  }, [searchParams])

  const handleClockInYes = async () => {
    if (!pendingEmployee) return
    // If multi-role and no role selected yet, show role picker first
    const workingRole = useAuthStore.getState().workingRole
    if (pendingAvailableRoles.length > 1 && !workingRole) {
      setShowClockInPrompt(false)
      setShowRolePicker(true)
      return
    }
    setClockingIn(true)
    try {
      const res = await fetch('/api/time-clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: pendingEmployee.locationId,
          employeeId: pendingEmployee.id,
          ...(workingRole ? { workingRoleId: workingRole.id } : {}),
        }),
      })
      if (res.ok) {
        clockInStore()
      }
    } catch {
      // Non-blocking: clock-in failure shouldn't prevent POS access
    } finally {
      setClockingIn(false)
      setShowClockInPrompt(false)
      if (pendingRedirect) router.push(pendingRedirect)
    }
  }

  const handleClockInNo = () => {
    setShowClockInPrompt(false)
    if (pendingRedirect) router.push(pendingRedirect)
  }

  const handleRoleSelected = (role: { id: string; name: string; cashHandlingMode: string; isPrimary: boolean }) => {
    setWorkingRole(role)
    setShowRolePicker(false)
    // Now proceed with clock-in using the selected role
    setShowClockInPrompt(true)
  }

  const handlePinSubmit = async (pin: string) => {
    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Invalid PIN')
        return
      }

      // Set dev access if employee has dev permissions
      setHasDevAccess(data.employee.isDevAccess || false)

      login(data.employee)

      const redirect = getRedirectPath(data.employee)
      const roles = data.employee.availableRoles || []

      // If single role (or no EmployeeRole records), auto-select it
      if (roles.length === 1) {
        setWorkingRole(roles[0])
      }
      setPendingAvailableRoles(roles)

      // Check clock-in status
      try {
        const statusRes = await fetch(`/api/time-clock/status?employeeId=${data.employee.id}`)
        const statusData = await statusRes.json()

        if (statusRes.ok && statusData.clockedIn) {
          // Already clocked in — update store and redirect
          clockInStore()
          router.push(redirect)
          return
        }
      } catch {
        // Status check failed — just redirect (non-blocking)
        router.push(redirect)
        return
      }

      // Not clocked in — show prompt
      setPendingEmployee({ id: data.employee.id, locationId: data.employee.location.id })
      setPendingRedirect(redirect)
      setShowClockInPrompt(true)
    } catch (err) {
      setError('Connection error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (showRolePicker) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Working As</CardTitle>
          <CardDescription className="text-base mt-2">
            Which role are you working today?
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {pendingAvailableRoles.map((role) => (
            <button
              key={role.id}
              onClick={() => handleRoleSelected(role)}
              className={`w-full py-4 rounded-xl font-semibold text-lg transition-all ${
                role.isPrimary
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-white'
              }`}
            >
              {role.name}
              {role.isPrimary && (
                <span className="ml-2 text-xs opacity-70">(Primary)</span>
              )}
            </button>
          ))}
        </CardContent>
      </Card>
    )
  }

  if (showClockInPrompt) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Not Clocked In</CardTitle>
          <CardDescription className="text-base mt-2">
            You are not currently clocked in. Would you like to clock in now?
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-4 justify-center">
          <button
            onClick={handleClockInYes}
            disabled={clockingIn}
            className="px-8 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg text-lg disabled:opacity-50 transition-colors"
          >
            {clockingIn ? 'Clocking In...' : 'Yes, Clock In'}
          </button>
          <button
            onClick={handleClockInNo}
            disabled={clockingIn}
            className="px-8 py-3 bg-gray-600 hover:bg-gray-700 text-white font-semibold rounded-lg text-lg disabled:opacity-50 transition-colors"
          >
            No, Skip
          </button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-4">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center">
            <svg
              className="w-10 h-10 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>
        </div>
        <CardTitle className="text-2xl">GWI POS</CardTitle>
        <CardDescription>Enter your PIN to sign in</CardDescription>
      </CardHeader>
      <CardContent>
        <PinPad
          onSubmit={handlePinSubmit}
          isLoading={isLoading}
          error={error}
        />
      </CardContent>
    </Card>
  )
}

/** Hidden 5-tap zone in top-left corner to exit Chromium kiosk mode */
function KioskExitZone() {
  const tapCount = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleTap = useCallback(() => {
    tapCount.current++
    if (tapTimer.current) clearTimeout(tapTimer.current)

    if (tapCount.current >= 5) {
      tapCount.current = 0
      fetch('/api/system/exit-kiosk', { method: 'POST' }).catch(() => {})
      return
    }

    // Reset after 3 seconds of no taps
    tapTimer.current = setTimeout(() => { tapCount.current = 0 }, 3000)
  }, [])

  return (
    <div
      className="fixed top-0 left-0 w-16 h-16 z-50"
      onClick={handleTap}
      aria-hidden="true"
    />
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
      <KioskExitZone />
      <Suspense fallback={
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <p className="text-gray-500">Loading...</p>
          </CardContent>
        </Card>
      }>
        <LoginContent />
      </Suspense>
    </div>
  )
}
