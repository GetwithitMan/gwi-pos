'use client'

import { useState, useCallback, useRef } from 'react'
import { toast } from '@/stores/toast-store'

interface UseAdminCRUDConfig<T> {
  apiBase: string
  locationId: string | undefined
  resourceName?: string
  getId?: (item: T) => string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseResponse?: (data: any) => T[]
  onSaveSuccess?: () => void
  onDeleteSuccess?: () => void
}

interface UseAdminCRUDReturn<T> {
  items: T[]
  isLoading: boolean
  showModal: boolean
  editingItem: T | null
  isSaving: boolean
  modalError: string | null
  loadItems: () => Promise<void>
  openAddModal: () => void
  openEditModal: (item: T) => void
  closeModal: () => void
  handleSave: (payload: Record<string, unknown>) => Promise<boolean>
  handleDelete: (id: string, confirmMessage?: string) => Promise<boolean>
  setItems: React.Dispatch<React.SetStateAction<T[]>>
  setModalError: React.Dispatch<React.SetStateAction<string | null>>
}

export function useAdminCRUD<T>(config: UseAdminCRUDConfig<T>): UseAdminCRUDReturn<T> {
  const {
    apiBase,
    locationId,
    resourceName = 'item',
    getId = (item: T) => (item as Record<string, unknown>).id as string,
    parseResponse,
    onSaveSuccess,
    onDeleteSuccess,
  } = config

  const [items, setItems] = useState<T[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState<T | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const hasLoadedRef = useRef(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const defaultParseResponse = useCallback((data: any): T[] => {
    const pluralKey = resourceName + 's'
    return data[pluralKey] || data.data || data
  }, [resourceName])

  const extractItems = parseResponse || defaultParseResponse

  const loadItems = useCallback(async () => {
    if (!locationId) return
    if (!hasLoadedRef.current) setIsLoading(true)

    try {
      const res = await fetch(`${apiBase}?locationId=${locationId}`)
      if (!res.ok) throw new Error(`Failed to load ${resourceName}s`)
      const data = await res.json()
      setItems(extractItems(data))
    } catch (err) {
      console.error(`Error loading ${resourceName}s:`, err)
      if (hasLoadedRef.current) {
        toast.error(`Failed to load ${resourceName}s`)
      }
    } finally {
      setIsLoading(false)
      hasLoadedRef.current = true
    }
  }, [apiBase, locationId, resourceName, extractItems])

  const openAddModal = useCallback(() => {
    setEditingItem(null)
    setModalError(null)
    setShowModal(true)
  }, [])

  const openEditModal = useCallback((item: T) => {
    setEditingItem(item)
    setModalError(null)
    setShowModal(true)
  }, [])

  const closeModal = useCallback(() => {
    setShowModal(false)
    setModalError(null)
  }, [])

  const handleSave = useCallback(async (payload: Record<string, unknown>): Promise<boolean> => {
    setModalError(null)
    setIsSaving(true)

    try {
      const isEdit = editingItem !== null
      const url = isEdit ? `${apiBase}/${getId(editingItem)}` : apiBase
      const method = isEdit ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        setModalError(errorData.error || `Failed to save ${resourceName}`)
        return false
      }

      setShowModal(false)
      setModalError(null)
      await loadItems()
      onSaveSuccess?.()
      return true
    } catch (err) {
      setModalError(`Failed to save ${resourceName}`)
      return false
    } finally {
      setIsSaving(false)
    }
  }, [editingItem, apiBase, getId, resourceName, loadItems, onSaveSuccess])

  const handleDelete = useCallback(async (id: string, confirmMessage?: string): Promise<boolean> => {
    const message = confirmMessage || `Are you sure you want to delete this ${resourceName}?`
    if (!confirm(message)) return false

    try {
      const res = await fetch(`${apiBase}/${id}`, { method: 'DELETE' })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        toast.error(errorData.error || `Failed to delete ${resourceName}`)
        return false
      }

      await loadItems()
      toast.success(`${resourceName.charAt(0).toUpperCase() + resourceName.slice(1)} deleted`)
      onDeleteSuccess?.()
      return true
    } catch (err) {
      toast.error(`Failed to delete ${resourceName}`)
      return false
    }
  }, [apiBase, resourceName, loadItems, onDeleteSuccess])

  return {
    items,
    isLoading,
    showModal,
    editingItem,
    isSaving,
    modalError,
    loadItems,
    openAddModal,
    openEditModal,
    closeModal,
    handleSave,
    handleDelete,
    setItems,
    setModalError,
  }
}
