import { create } from 'zustand'

interface DevStore {
  // Environment-based dev mode (always true in development)
  isDevMode: boolean
  setDevMode: (value: boolean) => void

  // Permission-based dev access (requires Super Admin login)
  hasDevAccess: boolean
  setHasDevAccess: (value: boolean) => void

  // Combined check: show dev features if either condition is met
  canShowDevFeatures: () => boolean
}

export const useDevStore = create<DevStore>((set, get) => ({
  // Check NODE_ENV at initialization (client-side safe)
  isDevMode: typeof window !== 'undefined'
    ? process.env.NODE_ENV === 'development'
    : false,
  setDevMode: (value) => set({ isDevMode: value }),

  hasDevAccess: false,
  setHasDevAccess: (value) => set({ hasDevAccess: value }),

  // Show dev features if in dev environment OR logged in as Super Admin
  canShowDevFeatures: () => {
    const { isDevMode, hasDevAccess } = get()
    return isDevMode || hasDevAccess
  },
}))

// Helper to check specific dev permissions
export function hasDevPermission(permissions: string[], permission: string): boolean {
  // 'all' grants all permissions including dev
  if (permissions.includes('all')) return true
  // Check for specific dev permission
  return permissions.includes(permission)
}

// Dev permission constants
export const DEV_PERMISSIONS = {
  ACCESS: 'dev.access',
  TEST_CARDS: 'dev.test_cards',
  TRAINING_MODE: 'dev.training_mode',
  FORCE_SYNC: 'dev.force_sync',
} as const
