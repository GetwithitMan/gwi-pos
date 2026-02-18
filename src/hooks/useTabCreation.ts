import { useState, useRef, useCallback } from 'react'
import { toast } from '@/stores/toast-store'

interface TabData {
  id: string
  orderNumber?: number
  tabName?: string | null
  status?: string
}

interface UseTabCreationOptions {
  locationId: string
  employeeId: string
  requireNameWithoutCard: boolean
  /** Called after a tab is created (not when sending items). Caller loads order into store. */
  onTabCreated: (tab: TabData) => void
  /** Called when tab was created with pending send-after-tab flow. */
  onSendToTab: (tabId: string) => Promise<void>
  /** Trigger a refresh of the tab list. */
  onRefresh: () => void
}

/**
 * Encapsulates bar-tab creation logic shared between "New Tab" modal and quick-tab button.
 *
 * Returns modal state (`showNewTabModal`, `newTabName`, setters) so BartenderView can render
 * the NewTabModal with these values, and `handleCreateTab` / `handleQuickTab` action handlers.
 */
export function useTabCreation({
  locationId,
  employeeId,
  requireNameWithoutCard,
  onTabCreated,
  onSendToTab,
  onRefresh,
}: UseTabCreationOptions) {
  const [isCreatingTab, setIsCreatingTab] = useState(false)
  const [showNewTabModal, setShowNewTabModal] = useState(false)
  const [newTabName, setNewTabName] = useState('')
  const pendingSendAfterTabRef = useRef(false)

  /** Shared POST to /api/tabs */
  const postTab = useCallback(async (tabName: string | null): Promise<TabData> => {
    const res = await fetch('/api/tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, employeeId, tabName }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || 'Failed to create tab')
    }
    return res.json()
  }, [locationId, employeeId])

  /** Shared post-creation handler: either send items or load the new empty tab. */
  const finishCreate = useCallback(async (data: TabData, shouldSendAfter: boolean) => {
    if (!data.id) return
    if (shouldSendAfter) {
      await onSendToTab(data.id)
    } else {
      onTabCreated(data)
      toast.success('Tab created')
      onRefresh()
    }
  }, [onSendToTab, onTabCreated, onRefresh])

  /**
   * Create tab from modal (with optional name).
   * Called by the "Start Tab" button in NewTabModal.
   */
  const handleCreateTab = useCallback(async () => {
    if (requireNameWithoutCard && !newTabName.trim()) {
      toast.error('Tab name is required')
      return
    }

    setIsCreatingTab(true)
    const shouldSendAfter = pendingSendAfterTabRef.current
    try {
      const data = await postTab(newTabName.trim() || null)
      setShowNewTabModal(false)
      setNewTabName('')
      pendingSendAfterTabRef.current = false
      await finishCreate(data, shouldSendAfter)
    } catch (error) {
      console.error('[BartenderView] Failed to create tab:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to create tab')
    } finally {
      setIsCreatingTab(false)
      pendingSendAfterTabRef.current = false
    }
  }, [requireNameWithoutCard, newTabName, postTab, finishCreate])

  /**
   * Quick-create tab without name (or redirect to modal if name required).
   * Called by the "+" button in the tab bar.
   */
  const handleQuickTab = useCallback(async () => {
    if (requireNameWithoutCard) {
      setShowNewTabModal(true)
      return
    }

    try {
      const data = await postTab(null)
      await finishCreate(data, false)
    } catch (error) {
      console.error('[BartenderView] Failed to create quick tab:', error)
      toast.error('Failed to create tab')
    }
  }, [requireNameWithoutCard, postTab, finishCreate])

  /** Open the new-tab modal, optionally marking a pending send-after-create. */
  const openNewTabModal = useCallback((pendingSend = false) => {
    pendingSendAfterTabRef.current = pendingSend
    setShowNewTabModal(true)
  }, [])

  /** Close the new-tab modal and reset pending-send flag. */
  const closeNewTabModal = useCallback(() => {
    setShowNewTabModal(false)
    pendingSendAfterTabRef.current = false
  }, [])

  return {
    handleCreateTab,
    handleQuickTab,
    isCreatingTab,
    showNewTabModal,
    newTabName,
    setNewTabName,
    openNewTabModal,
    closeNewTabModal,
  }
}
