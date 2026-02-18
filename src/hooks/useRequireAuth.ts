import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'

/** Cloud venue parent domains (must match middleware.ts) */
const CLOUD_PARENT_DOMAINS = [
  '.ordercontrolcenter.com',
  '.barpos.restaurant',
]

function isCloudMode(): boolean {
  if (typeof window === 'undefined') return false
  const hostname = window.location.hostname
  return CLOUD_PARENT_DOMAINS.some((d) => hostname.endsWith(d))
}

export function useRequireAuth() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const locationId = useAuthStore(s => s.locationId)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const logout = useAuthStore(s => s.logout)
  const login = useAuthStore(s => s.login)
  const validatedRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

  // One-time session validation: ensure locationId/employeeId exist in the
  // current venue DB. Catches stale sessions after DB routing changes.
  useEffect(() => {
    if (!isAuthenticated || !employee || !locationId || validatedRef.current)
      return
    validatedRef.current = true

    fetch(
      `/api/auth/validate-session?locationId=${locationId}&employeeId=${employee.id}`
    )
      .then(async (r) => {
        if (r.status === 401) {
          console.warn(
            '[useRequireAuth] Session invalid for current venue DB'
          )

          // In cloud mode, re-bootstrap from the httpOnly cloud session
          // cookie instead of redirecting to /login (which is blocked).
          if (isCloudMode()) {
            try {
              const refresh = await fetch('/api/auth/cloud-session')
              if (refresh.ok) {
                const raw = await refresh.json()
                const data = raw.data ?? raw
                login(data.employee)
                console.info(
                  '[useRequireAuth] Cloud session refreshed with locationId:',
                  data.employee.location.id
                )
                return // Auth store now has correct locationId
              }
            } catch {
              // Fall through to logout
            }
          }

          // Local mode or cloud refresh failed — force re-login
          logout()
          router.push('/login')
        }
      })
      .catch(() => {
        // Network error — don't force logout, let user retry
      })
  }, [isAuthenticated, employee, locationId, logout, login, router])

  return { employee, isAuthenticated }
}
