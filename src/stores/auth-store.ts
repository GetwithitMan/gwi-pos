import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AvailableRole {
  id: string
  name: string
  cashHandlingMode: string
  isPrimary: boolean
}

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
  availableRoles?: AvailableRole[]
}

interface AuthState {
  employee: Employee | null
  locationId: string | null
  isAuthenticated: boolean
  clockedIn: boolean
  clockInTime: string | null
  entryId: string | null
  workingRole: AvailableRole | null

  // Actions
  login: (employee: Employee) => void
  logout: () => void
  serverLogout: () => Promise<void> // Clears httpOnly cookie + local state
  setLocation: (locationId: string) => void
  setWorkingRole: (role: AvailableRole) => void
  clockIn: (data?: { entryId?: string; clockInTime?: string }) => void
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
      entryId: null,
      workingRole: null,

      login: (employee) =>
        set({
          employee,
          locationId: employee.location.id,
          isAuthenticated: true,
          workingRole: null, // Reset on login — will be set if multi-role
        }),

      logout: () => {
        // Fire-and-forget: clear the httpOnly session cookie on the server.
        // Local state clears immediately for instant UX; cookie cleanup is async.
        void fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
        set({
          employee: null,
          isAuthenticated: false,
          clockedIn: false,
          clockInTime: null,
          entryId: null,
          workingRole: null,
        })
      },

      serverLogout: async () => {
        try {
          await fetch('/api/auth/logout', { method: 'POST' })
        } catch {
          // Clear local state even if server call fails
        }
        set({
          employee: null,
          isAuthenticated: false,
          clockedIn: false,
          clockInTime: null,
          entryId: null,
          workingRole: null,
        })
      },

      setLocation: (locationId) =>
        set({ locationId }),

      setWorkingRole: (role) =>
        set({ workingRole: role }),

      clockIn: (data) =>
        set({
          clockedIn: true,
          clockInTime: data?.clockInTime ?? new Date().toISOString(),
          entryId: data?.entryId ?? null,
        }),

      clockOut: () =>
        set({
          clockedIn: false,
          clockInTime: null,
          entryId: null,
          workingRole: null, // Reset working role on clock out
        }),
    }),
    {
      name: 'gwi-pos-auth',
      partialize: (state) => ({
        employee: state.employee,
        locationId: state.locationId,
        isAuthenticated: state.isAuthenticated,
        clockedIn: state.clockedIn,
        clockInTime: state.clockInTime,
        entryId: state.entryId,
        workingRole: state.workingRole,
      }),
    }
  )
)
