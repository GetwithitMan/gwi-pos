'use client'

import { useState, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { PinPad } from '@/components/ui/pin-pad'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useDevStore } from '@/stores/dev-store'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { TimeClockModal } from '@/components/time-clock/TimeClockModal'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const login = useAuthStore((state) => state.login)
  const clockInStore = useAuthStore((state) => state.clockIn)
  const setHasDevAccess = useDevStore((state) => state.setHasDevAccess)
  const setWorkingRole = useAuthStore((state) => state.setWorkingRole)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [showRolePicker, setShowRolePicker] = useState(false)
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null)
  const [pendingEmployee, setPendingEmployee] = useState<{ id: string; locationId: string } | null>(null)
  const [pendingAvailableRoles, setPendingAvailableRoles] = useState<{ id: string; name: string; cashHandlingMode: string; isPrimary: boolean }[]>([])
  const [showTimeClockModal, setShowTimeClockModal] = useState(false)

  const employee = useAuthStore((state) => state.employee)

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

  const handleRoleSelected = (role: { id: string; name: string; cashHandlingMode: string; isPrimary: boolean }) => {
    setWorkingRole(role)
    setShowRolePicker(false)
    setShowTimeClockModal(true)
  }

  const handleTimeClockClose = async () => {
    setShowTimeClockModal(false)
  }

  const handleClockInSuccess = (entryId: string) => {
    clockInStore({ entryId })
  }

  const authenticatePin = async (pin: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })

    const json = await response.json()

    if (!response.ok) {
      throw new Error(json.error || 'Invalid PIN')
    }

    const data = json.data
    setHasDevAccess(data.employee.isDevAccess || false)
    login(data.employee)

    const roles = data.employee.availableRoles || []
    if (roles.length === 1) {
      setWorkingRole(roles[0])
    }
    setPendingAvailableRoles(roles)
    setPendingEmployee({ id: data.employee.id, locationId: data.employee.location.id })
    setPendingRedirect(getRedirectPath(data.employee))

    return data.employee
  }

  const handlePinSubmit = async (pin: string) => {
    setIsLoading(true)
    setError('')

    try {
      const emp = await authenticatePin(pin)

      try {
        const statusRes = await fetch(`/api/time-clock/status?employeeId=${emp.id}`)
        const statusData = await statusRes.json()
        const clockData = statusData.data ?? statusData

        if (statusRes.ok && clockData.clockedIn) {
          clockInStore({ entryId: clockData.entryId, clockInTime: clockData.clockInTime })
          router.push(getRedirectPath(emp))
          return
        }
      } catch {}

      setError('Must clock in first')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleClockInOutSubmit = async (pin: string) => {
    setIsLoading(true)
    setError('')

    try {
      const emp = await authenticatePin(pin)

      const workingRole = useAuthStore.getState().workingRole
      if ((emp.availableRoles || []).length > 1 && !workingRole) {
        setShowRolePicker(true)
        return
      }

      setShowTimeClockModal(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection error. Please try again.')
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

  return (
    <>
    {showTimeClockModal && pendingEmployee && employee && (
      <TimeClockModal
        isOpen={showTimeClockModal}
        onClose={handleTimeClockClose}
        employeeId={pendingEmployee.id}
        employeeName={employee.displayName || `${employee.firstName} ${employee.lastName}`}
        locationId={pendingEmployee.locationId}
        permissions={employee.permissions}
        workingRoleId={useAuthStore.getState().workingRole?.id}
        onClockInSuccess={handleClockInSuccess}
      />
    )}

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
          onSecondarySubmit={handleClockInOutSubmit}
          submitLabel="Login"
          secondaryLabel="Clock In / Out"
          isLoading={isLoading}
          error={error}
        />
      </CardContent>
    </Card>
    </>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
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
