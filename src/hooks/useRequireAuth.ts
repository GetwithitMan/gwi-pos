import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'

export function useRequireAuth() {
  const router = useRouter()
  const { employee, locationId, isAuthenticated, logout } = useAuthStore()
  const validatedRef = useRef(false)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

  // One-time session validation: ensure locationId/employeeId exist in the
  // current venue DB. Catches stale sessions after DB routing changes.
  useEffect(() => {
    if (!isAuthenticated || !employee || !locationId || validatedRef.current) return
    validatedRef.current = true

    fetch(`/api/auth/validate-session?locationId=${locationId}&employeeId=${employee.id}`)
      .then((r) => {
        if (r.status === 401) {
          console.warn('[useRequireAuth] Session invalid for current venue DB — forcing re-login')
          logout()
          router.push('/login')
        }
      })
      .catch(() => {
        // Network error — don't force logout, let user retry
      })
  }, [isAuthenticated, employee, locationId, logout, router])

  return { employee, isAuthenticated }
}
