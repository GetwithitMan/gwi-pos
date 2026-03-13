'use client'

import { create } from 'zustand'

/**
 * Lightweight UI store for entertainment item pending state.
 * Prevents double-booking race conditions by tracking items currently
 * being started across all ordering entry points (FloorPlan, Bartender, etc.).
 *
 * Uses Zustand (not useRef) so the lock is shared across views.
 */

interface EntertainmentUiState {
  /** Item IDs currently being started (modal open or API in-flight) */
  pendingStartIds: Record<string, true>
  /** Mark an item as pending — blocks additional taps */
  markPending: (id: string) => void
  /** Clear pending state — called on success, cancel, or error */
  clearPending: (id: string) => void
}

export const useEntertainmentUiStore = create<EntertainmentUiState>((set) => ({
  pendingStartIds: {},
  markPending: (id) => set((state) => ({
    pendingStartIds: { ...state.pendingStartIds, [id]: true as const },
  })),
  clearPending: (id) => set((state) => {
    const { [id]: _, ...rest } = state.pendingStartIds
    return { pendingStartIds: rest }
  }),
}))
