'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useOrderStore } from '@/stores/order-store'
import { useOrderSockets } from '@/hooks/useOrderSockets'
import { getDraftOrder, clearDraftOrder } from '@/lib/draft-order-persistence'
import { toast } from '@/stores/toast-store'
import type { Category, MenuItem, FloorPlanSnapshot, ActiveSession } from '../types'
import type { OrderTypeConfig } from '@/types/order-types'

interface UseOrderBootstrapOptions {
  locationId?: string
  employeeId?: string
  employeeRoleId?: string
  onShiftFound: (shift: any) => void
  onNoShift: () => void
  onShiftChecked: () => void
  shiftChecked: boolean
}

export function useOrderBootstrap(options: UseOrderBootstrapOptions) {
  const {
    locationId,
    employeeId,
    employeeRoleId,
    onShiftFound,
    onNoShift,
    onShiftChecked,
    shiftChecked,
  } = options

  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [orderTypes, setOrderTypes] = useState<OrderTypeConfig[]>([])
  const [openOrdersCount, setOpenOrdersCount] = useState(0)
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([])
  const [terminalScaleId, setTerminalScaleId] = useState<string | null>(null)

  // Bootstrap snapshot data for FloorPlanHome
  const [initialSnapshot, setInitialSnapshot] = useState<FloorPlanSnapshot | null | undefined>(undefined)

  // Ref for tracking selected category (used by bootstrap + loadMenu)
  const selectedCategoryRef = useRef(selectedCategory)
  selectedCategoryRef.current = selectedCategory

  // Ref for fallback functions to avoid stale closures
  const loadMenuRef = useRef<() => void>(() => {})
  const loadOrderTypesRef = useRef<() => void>(() => {})
  const checkOpenShiftRef = useRef<() => void>(() => {})
  const bootstrapLoadedRef = useRef(false)

  // TERMINAL_ID constant
  const TERMINAL_ID = 'terminal-1'

  // Session bootstrap
  useEffect(() => {
    if (!locationId || !employeeId || bootstrapLoadedRef.current) return
    bootstrapLoadedRef.current = true

    fetch(`/api/session/bootstrap?locationId=${locationId}&employeeId=${employeeId}`)
      .then(res => res.json())
      .then(({ data }) => {
        if (!data) return

        if (data.menu) {
          setCategories(data.menu.categories)
          setMenuItems([...data.menu.items])
          if (data.menu.categories.length > 0 && !selectedCategoryRef.current) {
            setSelectedCategory(data.menu.categories[0].id)
          }
          setIsLoading(false)
        }

        if (data.shift) {
          onShiftFound({
            ...data.shift,
            employee: {
              ...data.shift.employee,
              roleId: employeeRoleId,
            },
            locationId,
          })
          onShiftChecked()
        } else if (data.shift === null) {
          onNoShift()
          onShiftChecked()
        }

        if (data.orderTypes) {
          setOrderTypes(data.orderTypes)
        }

        if (data.snapshot) {
          setInitialSnapshot(data.snapshot)
          setOpenOrdersCount(data.snapshot.openOrdersCount ?? 0)
        } else {
          setInitialSnapshot(null)
        }
      })
      .catch(err => {
        console.error('Bootstrap failed, falling back to individual fetches:', err)
        bootstrapLoadedRef.current = false
        setInitialSnapshot(null)
        loadMenuRef.current()
        loadOrderTypesRef.current()
        checkOpenShiftRef.current()
      })
  }, [locationId, employeeId, employeeRoleId, onShiftFound, onShiftChecked, onNoShift])

  // Draft order recovery
  const draftCheckedRef = useRef(false)
  const currentOrderRef = useRef(useOrderStore.getState().currentOrder)
  currentOrderRef.current = useOrderStore.getState().currentOrder
  useEffect(() => {
    if (draftCheckedRef.current || !locationId || !employeeId) return
    if (currentOrderRef.current && currentOrderRef.current.items.length > 0) return
    draftCheckedRef.current = true

    const draft = getDraftOrder(locationId, employeeId)
    if (!draft || draft.items.length === 0) return

    const itemCount = draft.items.reduce((sum, i) => sum + i.quantity, 0)
    const age = Date.now() - new Date(draft.savedAt).getTime()
    const ageMinutes = Math.round(age / 60_000)

    toast.info(
      `Draft order recovered (${itemCount} item${itemCount !== 1 ? 's' : ''}, ${ageMinutes}m ago). Restoring...`,
      8000,
    )

    const { startOrder, addItem } = useOrderStore.getState()
    startOrder(draft.orderType as 'dine_in', {
      locationId,
      tableId: draft.tableId,
      tableName: draft.tableName,
      tabName: draft.tabName,
      guestCount: draft.guestCount,
    })

    for (const item of draft.items) {
      addItem({
        menuItemId: item.menuItemId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        modifiers: item.modifiers.map((m) => ({
          id: m.id,
          modifierId: m.id,
          name: m.name,
          price: m.price,
          groupName: m.groupName || '',
          groupId: '',
        })),
        seatNumber: item.seatNumber,
        courseNumber: item.courseNumber,
        specialNotes: item.specialNotes,
        pourSize: item.pourSize,
        pourMultiplier: item.pourMultiplier,
      })
    }

    clearDraftOrder(locationId, employeeId)
  }, [locationId, employeeId])

  // Load menu with cache-busting
  const loadMenu = useCallback(async () => {
    if (!locationId) return
    try {
      const response = await fetch(`/api/menu?locationId=${locationId}`, {
        cache: 'no-store',
      })
      if (response.ok) {
        const data = await response.json()
        setCategories(data.data.categories)
        setMenuItems([...data.data.items])
        if (data.data.categories.length > 0 && !selectedCategoryRef.current) {
          setSelectedCategory(data.data.categories[0].id)
        }
      }
    } catch (error) {
      console.error('Failed to load menu:', error)
    } finally {
      setIsLoading(false)
    }
  }, [locationId])
  loadMenuRef.current = loadMenu

  // Load order types
  const loadOrderTypes = useCallback(async () => {
    if (!locationId) return
    try {
      const response = await fetch(`/api/order-types?locationId=${locationId}`)
      if (response.ok) {
        const data = await response.json()
        setOrderTypes(data.data?.orderTypes || [])
      }
    } catch (error) {
      console.error('Failed to load order types:', error)
    }
  }, [locationId])
  loadOrderTypesRef.current = loadOrderTypes

  // Load on mount (skip if bootstrap already loaded)
  useEffect(() => {
    if (locationId) {
      if (!bootstrapLoadedRef.current) {
        loadMenu()
        loadOrderTypes()
      }
      loadActiveSessions()
    }
  }, [locationId, loadMenu, loadOrderTypes])

  // Load terminal's bound scale ID
  useEffect(() => {
    if (!TERMINAL_ID) return
    fetch(`/api/hardware/terminals/${TERMINAL_ID}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        const terminal = data?.data?.terminal
        if (terminal?.scaleId) setTerminalScaleId(terminal.scaleId)
      })
      .catch(() => {})
  }, [])

  // Throttled loadMenu
  const menuRefreshingRef = useRef(false)
  const menuRefreshQueuedRef = useRef(false)
  const throttledLoadMenu = useCallback(() => {
    if (menuRefreshingRef.current) {
      menuRefreshQueuedRef.current = true
      return
    }
    menuRefreshingRef.current = true
    loadMenu().finally(() => {
      menuRefreshingRef.current = false
      if (menuRefreshQueuedRef.current) {
        menuRefreshQueuedRef.current = false
        loadMenu()
      }
    })
  }, [loadMenu])

  // Socket-based real-time updates
  useOrderSockets({
    locationId,
    onOpenOrdersChanged: () => {
      loadOpenOrdersCount()
    },
    onEntertainmentStatusChanged: (data) => {
      setMenuItems(prev => prev.map(item =>
        item.id === data.itemId
          ? { ...item, entertainmentStatus: data.entertainmentStatus as MenuItem['entertainmentStatus'], currentOrderId: data.currentOrderId }
          : item
      ))
    },
  })

  // Visibility-change fallback for entertainment status
  const selectedCategoryData = categories.find(c => c.id === selectedCategory)
  useEffect(() => {
    if (selectedCategoryData?.categoryType !== 'entertainment') return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') loadMenu()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [selectedCategoryData?.categoryType, loadMenu])

  // Load active sessions
  const loadActiveSessions = async () => {
    if (!locationId) return
    try {
      const params = new URLSearchParams({ locationId, status: 'active' })
      const response = await fetch(`/api/timed-sessions?${params}`)
      if (response.ok) {
        const data = await response.json()
        setActiveSessions(data.data?.sessions || [])
      }
    } catch (error) {
      console.error('Failed to load active sessions:', error)
    }
  }

  // Check for open shift on load
  useEffect(() => {
    if (employeeId && locationId && !shiftChecked && !bootstrapLoadedRef.current) {
      checkOpenShift()
    }
  }, [employeeId, locationId, shiftChecked])

  const checkOpenShift = async () => {
    if (!employeeId || !locationId) return
    try {
      const params = new URLSearchParams({
        locationId,
        employeeId,
        status: 'open',
      })
      const response = await fetch(`/api/shifts?${params}`)
      if (response.ok) {
        const data = await response.json()
        if (data.data?.shifts && data.data.shifts.length > 0) {
          onShiftFound({
            ...data.data.shifts[0],
            employee: {
              ...data.data.shifts[0].employee,
              roleId: employeeRoleId,
            },
            locationId,
          })
        } else {
          onNoShift()
        }
      }
    } catch (error) {
      console.error('Failed to check shift:', error)
    } finally {
      onShiftChecked()
    }
  }
  checkOpenShiftRef.current = checkOpenShift

  // Load open orders count (debounced)
  const loadOpenOrdersCountRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const loadOpenOrdersCount = useCallback(() => {
    if (!locationId) return
    clearTimeout(loadOpenOrdersCountRef.current)
    loadOpenOrdersCountRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ locationId, summary: 'true' })
        const response = await fetch(`/api/orders/open?${params}`)
        if (response.ok) {
          const data = await response.json()
          setOpenOrdersCount(data.data?.orders?.length || 0)
        }
      } catch (error) {
        console.error('Failed to load open orders count:', error)
      }
    }, 300)
  }, [locationId])

  return {
    categories,
    setCategories,
    menuItems,
    setMenuItems,
    selectedCategory,
    setSelectedCategory,
    isLoading,
    orderTypes,
    setOrderTypes,
    openOrdersCount,
    setOpenOrdersCount,
    activeSessions,
    setActiveSessions,
    initialSnapshot,
    terminalScaleId,
    selectedCategoryData,
    loadMenu,
    throttledLoadMenu,
    loadOpenOrdersCount,
    loadActiveSessions,
    bootstrapLoadedRef,
    TERMINAL_ID,
  }
}
