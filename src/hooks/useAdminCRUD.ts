'use client'

import { useState, useCallback, useRef } from 'react'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'

interface UseAdminCRUDConfig<T> {
  apiBase: string
  locationId: string | undefined
  requestingEmployeeId?: string
  resourceName?: string
  getId?: (item: T) => string

  parseResponse?: (data: any) => T[]
  onSaveSuccess?: () => void
  onDeleteSuccess?: () => void
  skipReloadOnSave?: boolean
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
  const authEmployee = useAuthStore(s => s.employee)
  const {
    apiBase,
    locationId,
    requestingEmployeeId: explicitEmployeeId,
    resourceName = 'item',
    getId = (item: T) => (item as Record<string, unknown>).id as string,
    parseResponse,
    onSaveSuccess,
    onDeleteSuccess,
    skipReloadOnSave = false,
  } = config

  // Auto-resolve from auth store if not explicitly provided
  const requestingEmployeeId = explicitEmployeeId ?? authEmployee?.id

  const [items, setItems] = useState<T[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState<T | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const hasLoadedRef = useRef(false)

  // Store parseResponse in a ref so it never destabilizes extractItems.
  // Without this, an inline arrow function passed as parseResponse creates
  // a new reference every render → extractItems changes → loadItems changes
  // → useEffect re-runs → setItems → re-render → infinite loop.
  const parseResponseRef = useRef(parseResponse)
  parseResponseRef.current = parseResponse

  const extractItems = useCallback((data: any): T[] => {
    if (parseResponseRef.current) return parseResponseRef.current(data)
    const pluralKey = resourceName + 's'
    return data[pluralKey] || data.data || data
  }, [resourceName])

  const loadItems = useCallback(async () => {
    if (!locationId) return
    if (!hasLoadedRef.current) setIsLoading(true)

    try {
      const params = new URLSearchParams({ locationId: locationId! })
      if (requestingEmployeeId) params.set('requestingEmployeeId', requestingEmployeeId)
      const res = await fetch(`${apiBase}?${params}`)
      if (!res.ok) throw new Error(`Failed to load ${resourceName}s`)
      const raw = await res.json()
      const data = raw.data ?? raw
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
  }, [apiBase, locationId, requestingEmployeeId, resourceName, extractItems])

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

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (requestingEmployeeId) headers['x-employee-id'] = requestingEmployeeId

      // Inject requestingEmployeeId into the body so routes that read from body (not header) also get it
      const bodyPayload = requestingEmployeeId
        ? { ...payload, requestingEmployeeId }
        : payload

      const res = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(bodyPayload),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        setModalError(errorData.error || `Failed to save ${resourceName}`)
        return false
      }

      setShowModal(false)
      setModalError(null)
      if (!skipReloadOnSave) await loadItems()
      onSaveSuccess?.()
      return true
    } catch (err) {
      setModalError(`Failed to save ${resourceName}`)
      return false
    } finally {
      setIsSaving(false)
    }
  }, [editingItem, apiBase, getId, resourceName, loadItems, onSaveSuccess, skipReloadOnSave])

  const handleDelete = useCallback(async (id: string, _confirmMessage?: string): Promise<boolean> => {
    try {
      const deleteHeaders: Record<string, string> = {}
      if (requestingEmployeeId) deleteHeaders['x-employee-id'] = requestingEmployeeId

      const res = await fetch(`${apiBase}/${id}`, { method: 'DELETE', headers: deleteHeaders })

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
