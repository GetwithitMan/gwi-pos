'use client'

import { useState, useEffect, useRef } from 'react'
import type { OrderTypeConfig } from '@/types/order-types'
import { SYSTEM_ORDER_TYPES } from '@/types/order-types'

interface UseOrderTypesOptions {
  locationId?: string
}

interface UseOrderTypesReturn {
  orderTypes: OrderTypeConfig[]
  isLoading: boolean
}

// Build fallback configs from SYSTEM_ORDER_TYPES (they're Partial, fill in defaults)
const FALLBACK_ORDER_TYPES: OrderTypeConfig[] = SYSTEM_ORDER_TYPES.map((ot, i) => ({
  id: `system-${ot.slug}`,
  locationId: '',
  name: ot.name || '',
  slug: ot.slug || '',
  description: '',
  color: ot.color,
  icon: ot.icon,
  sortOrder: ot.sortOrder ?? i,
  isActive: true,
  isSystem: true,
  requiredFields: ot.requiredFields || {},
  optionalFields: ot.optionalFields || {},
  fieldDefinitions: ot.fieldDefinitions || {},
  workflowRules: ot.workflowRules || {},
  kdsConfig: ot.kdsConfig || {},
  printConfig: ot.printConfig || {},
}))

export function useOrderTypes({ locationId }: UseOrderTypesOptions): UseOrderTypesReturn {
  const [orderTypes, setOrderTypes] = useState<OrderTypeConfig[]>(FALLBACK_ORDER_TYPES)
  const [isLoading, setIsLoading] = useState(true)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (!locationId || fetchedRef.current) {
      setIsLoading(false)
      return
    }

    let cancelled = false

    async function fetchOrderTypes() {
      try {
        const res = await fetch(`/api/order-types?locationId=${locationId}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled && data.orderTypes?.length > 0) {
          setOrderTypes(data.orderTypes)
          fetchedRef.current = true
        }
      } catch (err) {
        console.warn('[useOrderTypes] Failed to fetch, using defaults:', err)
        // Keep FALLBACK_ORDER_TYPES
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchOrderTypes()
    return () => { cancelled = true }
  }, [locationId])

  return { orderTypes, isLoading }
}
