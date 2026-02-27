'use client'

import { useState, useCallback, useEffect } from 'react'
import { toast } from '@/stores/toast-store'

export interface PricingOption {
  id: string
  groupId: string
  label: string
  price: number | null
  priceCC: number | null
  sortOrder: number
  isDefault: boolean
  showOnPos: boolean
  color: string | null
}

export interface PricingOptionGroup {
  id: string
  menuItemId: string
  name: string
  sortOrder: number
  isRequired: boolean
  showAsQuickPick: boolean
  options: PricingOption[]
}

export function usePricingOptions(itemId: string) {
  const [groups, setGroups] = useState<PricingOptionGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchGroups = useCallback(async () => {
    try {
      const res = await fetch(`/api/menu/items/${itemId}/pricing-options`)
      if (!res.ok) throw new Error('Failed to load')
      const raw = await res.json()
      setGroups(raw.data?.groups ?? [])
    } catch {
      toast.error('Failed to load pricing options')
    } finally {
      setLoading(false)
    }
  }, [itemId])

  useEffect(() => {
    fetchGroups()
  }, [fetchGroups])

  const addGroup = useCallback(async (name: string, showAsQuickPick?: boolean) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/menu/items/${itemId}/pricing-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, showAsQuickPick: showAsQuickPick ?? false }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        toast.error(err.error || 'Failed to create group')
        return
      }
      const raw = await res.json()
      const group = raw.data?.group
      if (group) {
        setGroups(prev => [...prev, group])
      }
    } catch {
      toast.error('Failed to create group')
    } finally {
      setSaving(false)
    }
  }, [itemId])

  const updateGroup = useCallback(async (
    groupId: string,
    data: Partial<Pick<PricingOptionGroup, 'name' | 'isRequired' | 'showAsQuickPick' | 'sortOrder'>>
  ) => {
    // Optimistic update
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, ...data } : g))
    try {
      const res = await fetch(`/api/menu/items/${itemId}/pricing-options/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        toast.error('Failed to update group')
        fetchGroups()
      }
    } catch {
      toast.error('Failed to update group')
      fetchGroups()
    }
  }, [itemId, fetchGroups])

  const deleteGroup = useCallback(async (groupId: string) => {
    // Optimistic removal
    setGroups(prev => prev.filter(g => g.id !== groupId))
    try {
      const res = await fetch(`/api/menu/items/${itemId}/pricing-options/${groupId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        toast.error('Failed to delete group')
        fetchGroups()
      }
    } catch {
      toast.error('Failed to delete group')
      fetchGroups()
    }
  }, [itemId, fetchGroups])

  const addOption = useCallback(async (groupId: string, label: string) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/menu/items/${itemId}/pricing-options/${groupId}/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        toast.error(err.error || 'Failed to add option')
        return
      }
      const raw = await res.json()
      const option = raw.data?.option
      if (option) {
        setGroups(prev => prev.map(g =>
          g.id === groupId ? { ...g, options: [...g.options, option] } : g
        ))
      }
    } catch {
      toast.error('Failed to add option')
    } finally {
      setSaving(false)
    }
  }, [itemId])

  const updateOption = useCallback(async (
    groupId: string,
    optionId: string,
    data: Partial<Pick<PricingOption, 'label' | 'price' | 'isDefault' | 'showOnPos' | 'color' | 'sortOrder'>>
  ) => {
    // Optimistic update
    setGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g
      return {
        ...g,
        options: g.options.map(o => {
          if (o.id === optionId) return { ...o, ...data }
          // If setting new default, unset old defaults
          if (data.isDefault && o.isDefault) return { ...o, isDefault: false }
          return o
        }),
      }
    }))
    try {
      const res = await fetch(`/api/menu/items/${itemId}/pricing-options/${groupId}/options/${optionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        toast.error('Failed to update option')
        fetchGroups()
      }
    } catch {
      toast.error('Failed to update option')
      fetchGroups()
    }
  }, [itemId, fetchGroups])

  const deleteOption = useCallback(async (groupId: string, optionId: string) => {
    // Optimistic removal
    setGroups(prev => prev.map(g =>
      g.id === groupId ? { ...g, options: g.options.filter(o => o.id !== optionId) } : g
    ))
    try {
      const res = await fetch(`/api/menu/items/${itemId}/pricing-options/${groupId}/options/${optionId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        toast.error('Failed to delete option')
        fetchGroups()
      }
    } catch {
      toast.error('Failed to delete option')
      fetchGroups()
    }
  }, [itemId, fetchGroups])

  return {
    groups,
    loading,
    saving,
    addGroup,
    updateGroup,
    deleteGroup,
    addOption,
    updateOption,
    deleteOption,
  }
}
