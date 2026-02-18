'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import type { OrderTypeConfig, FieldDefinition, WorkflowRules, KDSConfig } from '@/types/order-types'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

export default function OrderTypesPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [orderTypes, setOrderTypes] = useState<OrderTypeConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [editingType, setEditingType] = useState<OrderTypeConfig | null>(null)
  const [showModal, setShowModal] = useState(false)

  // Auth check
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

  // Load order types
  const loadOrderTypes = async (locationId: string) => {
    try {
      const response = await fetch(`/api/order-types?locationId=${locationId}&includeInactive=true`)
      if (response.ok) {
        const data = await response.json()
        setOrderTypes(data.orderTypes || [])
      } else {
        console.error('Failed to load order types:', response.status)
      }
    } catch (error) {
      console.error('Failed to load order types:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (employee?.location?.id) {
      loadOrderTypes(employee.location.id)
    }
  }, [employee?.location?.id])

  const handleToggleActive = async (orderType: OrderTypeConfig) => {
    try {
      const response = await fetch(`/api/order-types/${orderType.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !orderType.isActive }),
      })

      if (response.ok && employee?.location?.id) {
        loadOrderTypes(employee.location.id)
      }
    } catch (error) {
      console.error('Failed to update order type:', error)
    }
  }

  const handleEdit = (orderType: OrderTypeConfig) => {
    setEditingType(orderType)
    setShowModal(true)
  }

  const handleCreate = () => {
    setEditingType({
      id: '',
      locationId: employee?.location?.id || '',
      name: '',
      slug: '',
      sortOrder: orderTypes.length,
      isActive: true,
      isSystem: false,
      requiredFields: {},
      optionalFields: {},
      fieldDefinitions: {},
      workflowRules: {},
      kdsConfig: {},
      printConfig: {},
    })
    setShowModal(true)
  }

  const handleSave = async (formData: Partial<OrderTypeConfig>) => {
    try {
      if (editingType?.id) {
        // Update existing
        const response = await fetch(`/api/order-types/${editingType.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData),
        })

        if (response.ok) {
          employee?.location?.id && loadOrderTypes(employee.location.id)
          setShowModal(false)
          setEditingType(null)
        } else {
          const err = await response.json()
          toast.error(`Failed to update: ${err.error || 'Unknown error'}`)
        }
      } else {
        // Create new
        const payload = {
          ...formData,
          locationId: employee?.location?.id,
        }
        const response = await fetch('/api/order-types', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })

        if (response.ok) {
          employee?.location?.id && loadOrderTypes(employee.location.id)
          setShowModal(false)
          setEditingType(null)
        } else {
          const err = await response.json()
          toast.error(`Failed to create: ${err.error || 'Unknown error'}`)
        }
      }
    } catch (error) {
      console.error('Failed to save order type:', error)
      toast.error(`Error: ${error}`)
    }
  }

  const handleDelete = async (orderType: OrderTypeConfig) => {
    if (orderType.isSystem) {
      toast.info('System order types cannot be deleted, only deactivated.')
      return
    }

    if (!confirm(`Delete order type "${orderType.name}"? This cannot be undone.`)) {
      return
    }

    try {
      const response = await fetch(`/api/order-types/${orderType.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        employee?.location?.id && loadOrderTypes(employee.location.id)
      }
    } catch (error) {
      console.error('Failed to delete order type:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Order Types"
        subtitle="Configure order type options and workflows"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        actions={
          <button
            onClick={handleCreate}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
          >
            + New Order Type
          </button>
        }
      />

      {/* Order Types List */}
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {orderTypes.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No order types configured.</p>
              <p className="text-sm mt-2">Click "Initialize System Types" to set up default order types.</p>
              <button
                onClick={async () => {
                  try {
                    const response = await fetch('/api/order-types', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ locationId: employee?.location?.id }),
                    })
                    if (response.ok) {
                      employee?.location?.id && loadOrderTypes(employee.location.id)
                    }
                  } catch (error) {
                    console.error('Failed to initialize order types:', error)
                  }
                }}
                className="mt-4 px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600"
              >
                Initialize System Types
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {orderTypes.map((orderType) => (
                <div
                  key={orderType.id}
                  className={`p-4 flex items-center justify-between ${
                    !orderType.isActive ? 'opacity-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-4">
                    {/* Color indicator */}
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: orderType.color || '#6B7280' }}
                    />

                    {/* Info */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{orderType.name}</span>
                        {orderType.isSystem && (
                          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                            System
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500">
                        <span className="font-mono">{orderType.slug}</span>
                        {orderType.description && ` • ${orderType.description}`}
                      </div>
                      {/* Workflow summary */}
                      <div className="flex gap-2 mt-1 flex-wrap">
                        {(orderType.workflowRules as WorkflowRules)?.requireTableSelection && (
                          <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                            Requires Table
                          </span>
                        )}
                        {(orderType.workflowRules as WorkflowRules)?.requireCustomerName && (
                          <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                            Requires Name
                          </span>
                        )}
                        {(orderType.workflowRules as WorkflowRules)?.requirePaymentBeforeSend && (
                          <span className="px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded">
                            Pay First
                          </span>
                        )}
                        {(orderType.workflowRules as WorkflowRules)?.requireCardOnFile && (
                          <span className="px-2 py-0.5 text-xs bg-violet-100 text-violet-700 rounded">
                            Card Required
                          </span>
                        )}
                        {(orderType.workflowRules as WorkflowRules)?.enablePreAuth && (
                          <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">
                            Pre-Auth
                          </span>
                        )}
                        {Object.keys(orderType.requiredFields || {}).length > 0 && (
                          <span className="px-2 py-0.5 text-xs bg-orange-100 text-orange-700 rounded">
                            {Object.keys(orderType.requiredFields).length} Required Fields
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleActive(orderType)}
                      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                        orderType.isActive
                          ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {orderType.isActive ? 'Active' : 'Inactive'}
                    </button>
                    <button
                      onClick={() => handleEdit(orderType)}
                      className="p-2 text-gray-500 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    {!orderType.isSystem && (
                      <button
                        onClick={() => handleDelete(orderType)}
                        className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {showModal && editingType && (
        <OrderTypeEditModal
          orderType={editingType}
          onSave={handleSave}
          onClose={() => {
            setShowModal(false)
            setEditingType(null)
          }}
        />
      )}
    </div>
  )
}

// Edit Modal Component
function OrderTypeEditModal({
  orderType,
  onSave,
  onClose,
}: {
  orderType: OrderTypeConfig
  onSave: (data: Partial<OrderTypeConfig>) => void
  onClose: () => void
}) {
  const [formData, setFormData] = useState({
    name: orderType.name,
    slug: orderType.slug,
    description: orderType.description || '',
    color: orderType.color || '#6B7280',
    icon: orderType.icon || '',
    requireTableSelection: (orderType.workflowRules as WorkflowRules)?.requireTableSelection || false,
    requireCustomerName: (orderType.workflowRules as WorkflowRules)?.requireCustomerName || false,
    requirePaymentBeforeSend: (orderType.workflowRules as WorkflowRules)?.requirePaymentBeforeSend || false,
    requireCardOnFile: (orderType.workflowRules as WorkflowRules)?.requireCardOnFile || false,
    enablePreAuth: (orderType.workflowRules as WorkflowRules)?.enablePreAuth || false,
    requirePhone: false,
    requireAddress: false,
    requirePickupTime: false,
    optionalPhone: (orderType.optionalFields as Record<string, boolean>)?.phone || false,
    optionalVehicle: (orderType.optionalFields as Record<string, boolean>)?.vehicleType || false,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const requiredFields: Record<string, boolean> = {}
    const optionalFields: Record<string, boolean> = {}
    const fieldDefinitions: Record<string, FieldDefinition> = {}
    const workflowRules: WorkflowRules = {}

    // Build workflow rules
    if (formData.requireTableSelection) {
      workflowRules.requireTableSelection = true
      requiredFields.tableId = true
    }
    if (formData.requireCustomerName) {
      workflowRules.requireCustomerName = true
      requiredFields.tabName = true
      fieldDefinitions.tabName = {
        label: 'Customer Name',
        type: 'text',
        placeholder: 'Enter name',
        required: true,
      }
    }
    if (formData.requirePaymentBeforeSend) {
      workflowRules.requirePaymentBeforeSend = true
    }
    if (formData.requireCardOnFile) {
      workflowRules.requireCardOnFile = true
    }
    if (formData.enablePreAuth) {
      workflowRules.enablePreAuth = true
    }
    if (formData.requirePhone) {
      requiredFields.phone = true
      fieldDefinitions.phone = {
        label: 'Phone Number',
        type: 'phone',
        placeholder: '555-123-4567',
        required: true,
      }
    }
    if (formData.requireAddress) {
      requiredFields.address = true
      fieldDefinitions.address = {
        label: 'Address',
        type: 'textarea',
        placeholder: 'Enter delivery address',
        required: true,
      }
    }
    if (formData.requirePickupTime) {
      requiredFields.pickupTime = true
      fieldDefinitions.pickupTime = {
        label: 'Pickup Time',
        type: 'time',
        required: true,
      }
    }
    if (formData.optionalPhone && !formData.requirePhone) {
      optionalFields.phone = true
      fieldDefinitions.phone = {
        label: 'Phone Number',
        type: 'phone',
        placeholder: '555-123-4567',
      }
    }
    if (formData.optionalVehicle) {
      optionalFields.vehicleType = true
      optionalFields.vehicleColor = true
      fieldDefinitions.vehicleType = {
        label: 'Vehicle Type',
        type: 'select',
        options: [
          { value: 'car', label: 'Car' },
          { value: 'truck', label: 'Truck' },
          { value: 'suv', label: 'SUV' },
          { value: 'van', label: 'Van' },
        ],
      }
      fieldDefinitions.vehicleColor = {
        label: 'Vehicle Color',
        type: 'select',
        options: [
          { value: 'black', label: 'Black' },
          { value: 'white', label: 'White' },
          { value: 'silver', label: 'Silver' },
          { value: 'red', label: 'Red' },
          { value: 'blue', label: 'Blue' },
          { value: 'other', label: 'Other' },
        ],
      }
    }

    const kdsConfig: KDSConfig = {
      badgeText: formData.name,
      badgeColor: formData.color,
    }

    onSave({
      name: formData.name,
      slug: formData.slug || formData.name.toLowerCase().replace(/\s+/g, '_'),
      description: formData.description || undefined,
      color: formData.color,
      icon: formData.icon || undefined,
      requiredFields,
      optionalFields,
      fieldDefinitions,
      workflowRules,
      kdsConfig,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold">
            {orderType.id ? 'Edit Order Type' : 'New Order Type'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
                disabled={orderType.isSystem}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Slug
              </label>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) => setFormData(prev => ({ ...prev, slug: e.target.value }))}
                placeholder={formData.name.toLowerCase().replace(/\s+/g, '_')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                disabled={orderType.isSystem}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <input
              type="text"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Badge Color
            </label>
            <div className="flex gap-2">
              <input
                type="color"
                value={formData.color}
                onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
                className="h-10 w-16 rounded border border-gray-300 cursor-pointer"
              />
              <input
                type="text"
                value={formData.color}
                onChange={(e) => setFormData(prev => ({ ...prev, color: e.target.value }))}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              />
            </div>
          </div>

          {/* Workflow Rules */}
          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Workflow Rules</h3>
            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.requireTableSelection}
                  onChange={(e) => setFormData(prev => ({ ...prev, requireTableSelection: e.target.checked }))}
                  className="rounded border-gray-300"
                  disabled={orderType.isSystem}
                />
                <span className="text-sm">Require table selection</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.requireCustomerName}
                  onChange={(e) => setFormData(prev => ({ ...prev, requireCustomerName: e.target.checked }))}
                  className="rounded border-gray-300"
                  disabled={orderType.isSystem}
                />
                <span className="text-sm">Require customer name</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.requirePaymentBeforeSend}
                  onChange={(e) => setFormData(prev => ({ ...prev, requirePaymentBeforeSend: e.target.checked }))}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">Require payment before sending to kitchen</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.requireCardOnFile}
                  onChange={(e) => setFormData(prev => ({ ...prev, requireCardOnFile: e.target.checked, ...(!e.target.checked ? { enablePreAuth: false } : {}) }))}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">Require card on file (chip read to open tab)</span>
              </label>
              {formData.requireCardOnFile && (
                <label className="flex items-center gap-2 ml-6">
                  <input
                    type="checkbox"
                    checked={formData.enablePreAuth}
                    onChange={(e) => setFormData(prev => ({ ...prev, enablePreAuth: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">Enable pre-authorization &amp; incremental auth</span>
                </label>
              )}
            </div>
          </div>

          {/* Required Fields */}
          {!orderType.isSystem && (
            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Required Fields</h3>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.requirePhone}
                    onChange={(e) => setFormData(prev => ({ ...prev, requirePhone: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">Phone number</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.requireAddress}
                    onChange={(e) => setFormData(prev => ({ ...prev, requireAddress: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">Address</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.requirePickupTime}
                    onChange={(e) => setFormData(prev => ({ ...prev, requirePickupTime: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">Pickup time</span>
                </label>
              </div>
            </div>
          )}

          {/* Optional Fields */}
          {!orderType.isSystem && (
            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Optional Fields</h3>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.optionalPhone}
                    onChange={(e) => setFormData(prev => ({ ...prev, optionalPhone: e.target.checked }))}
                    className="rounded border-gray-300"
                    disabled={formData.requirePhone}
                  />
                  <span className="text-sm">Phone number (optional)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.optionalVehicle}
                    onChange={(e) => setFormData(prev => ({ ...prev, optionalVehicle: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm">Vehicle info (for drive-through)</span>
                </label>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
