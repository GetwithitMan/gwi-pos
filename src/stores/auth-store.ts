import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface Employee {
  id: string
  firstName: string
  lastName: string
  displayName: string
  role: {
    id: string
    name: string
  }
  location: {
    id: string
    name: string
  }
  permissions: string[]
  isDevAccess?: boolean  // Super Admin dev access flag
}

interface AuthState {
  employee: Employee | null
  locationId: string | null
  isAuthenticated: boolean
  clockedIn: boolean
  clockInTime: string | null

  // Actions
  login: (employee: Employee) => void
  logout: () => void
  setLocation: (locationId: string) => void
  clockIn: () => void
  clockOut: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      employee: null,
      locationId: null,
      isAuthenticated: false,
      clockedIn: false,
      clockInTime: null,

      login: (employee) =>
        set({
          employee,
          locationId: employee.location.id,
          isAuthenticated: true,
        }),

      logout: () =>
        set({
          employee: null,
          isAuthenticated: false,
          clockedIn: false,
          clockInTime: null,
        }),

      setLocation: (locationId) =>
        set({ locationId }),

      clockIn: () =>
        set({
          clockedIn: true,
          clockInTime: new Date().toISOString(),
        }),

      clockOut: () =>
        set({
          clockedIn: false,
          clockInTime: null,
        }),
    }),
    {
      name: 'gwi-pos-auth',
      partialize: (state) => ({
        locationId: state.locationId,
        // Don't persist sensitive auth data
      }),
    }
  )
)
