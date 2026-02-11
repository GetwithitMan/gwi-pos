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
  workingRole: AvailableRole | null

  // Actions
  login: (employee: Employee) => void
  logout: () => void
  setLocation: (locationId: string) => void
  setWorkingRole: (role: AvailableRole) => void
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
      workingRole: null,

      login: (employee) =>
        set({
          employee,
          locationId: employee.location.id,
          isAuthenticated: true,
          workingRole: null, // Reset on login — will be set if multi-role
        }),

      logout: () =>
        set({
          employee: null,
          isAuthenticated: false,
          clockedIn: false,
          clockInTime: null,
          workingRole: null,
        }),

      setLocation: (locationId) =>
        set({ locationId }),

      setWorkingRole: (role) =>
        set({ workingRole: role }),

      clockIn: () =>
        set({
          clockedIn: true,
          clockInTime: new Date().toISOString(),
        }),

      clockOut: () =>
        set({
          clockedIn: false,
          clockInTime: null,
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
        workingRole: state.workingRole,
      }),
    }
  )
)
