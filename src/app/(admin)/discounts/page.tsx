'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAdminCRUD } from '@/hooks/useAdminCRUD'

interface DiscountRule {
  id: string
  name: string
  displayText: string
  description?: string
  discountType: string
  discountConfig: {
    type: 'percent' | 'fixed'
    value: number
    maxAmount?: number
  }
  priority: number
  isStackable: boolean
  requiresApproval: boolean
  maxPerOrder?: number
  isActive: boolean
  isAutomatic: boolean
}

export default function DiscountsPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  const crud = useAdminCRUD<DiscountRule>({
    apiBase: '/api/discounts',
    locationId: employee?.location?.id,
    resourceName: 'discount',
    parseResponse: (data) => data.discounts || [],
  })

  const {
    items: discounts,
    isLoading,
    showModal,
    editingItem: editingDiscount,
    isSaving,
    modalError,
    loadItems,
    openAddModal,
    openEditModal,
    closeModal,
    handleSave,
    handleDelete,
  } = crud

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    displayText: '',
    description: '',
    discountType: 'manual',
    configType: 'percent' as 'percent' | 'fixed',
    configValue: '',
    configMaxAmount: '',
    priority: '0',
    isStackable: true,
    requiresApproval: false,
    maxPerOrder: '',
    isActive: true,
    isAutomatic: false,
  })

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/discounts')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    if (employee?.location?.id) {
      loadItems()
    }
  }, [employee?.location?.id, loadItems])

  const resetForm = () => {
    setFormData({
      name: '',
      displayText: '',
      description: '',
      discountType: 'manual',
      configType: 'percent',
      configValue: '',
      configMaxAmount: '',
      priority: '0',
      isStackable: true,
      requiresApproval: false,
      maxPerOrder: '',
      isActive: true,
      isAutomatic: false,
    })
  }

  const handleEdit = (discount: DiscountRule) => {
    setFormData({
      name: discount.name,
      displayText: discount.displayText,
      description: discount.description || '',
      discountType: discount.discountType,
      configType: discount.discountConfig.type,
      configValue: discount.discountConfig.value.toString(),
      configMaxAmount: discount.discountConfig.maxAmount?.toString() || '',
      priority: discount.priority.toString(),
      isStackable: discount.isStackable,
      requiresApproval: discount.requiresApproval,
      maxPerOrder: discount.maxPerOrder?.toString() || '',
      isActive: discount.isActive,
      isAutomatic: discount.isAutomatic,
    })
    openEditModal(discount)
  }

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employee?.location?.id) return

    const payload = {
      locationId: employee?.location?.id,
      name: formData.name,
      displayText: formData.displayText,
      description: formData.description || null,
      discountType: formData.discountType,
      discountConfig: {
        type: formData.configType,
        value: parseFloat(formData.configValue) || 0,
        maxAmount: formData.configMaxAmount ? parseFloat(formData.configMaxAmount) : undefined,
      },
      priority: parseInt(formData.priority) || 0,
      isStackable: formData.isStackable,
      requiresApproval: formData.requiresApproval,
      maxPerOrder: formData.maxPerOrder ? parseInt(formData.maxPerOrder) : null,
      isActive: formData.isActive,
      isAutomatic: formData.isAutomatic,
    }

    const ok = await handleSave(payload)
    if (ok) resetForm()
  }

  const handleToggleActive = async (discount: DiscountRule) => {
    try {
      const response = await fetch(`/api/discounts/${discount.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !discount.isActive }),
      })

      if (response.ok) {
        loadItems()
      }
    } catch (error) {
      console.error('Failed to toggle discount:', error)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Discounts"
        breadcrumbs={[{ label: 'Menu', href: '/menu' }]}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              resetForm()
              openAddModal()
            }}
          >
            Add Discount
          </Button>
        }
      />
      {/* Content */}
      <main className="max-w-7xl mx-auto mt-6">
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading discounts...</div>
        ) : discounts.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-gray-500 mb-4">No discounts created yet.</p>
            <Button
              variant="primary"
              onClick={() => {
                resetForm()
                openAddModal()
              }}
            >
              Create First Discount
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {discounts.map(discount => (
              <Card
                key={discount.id}
                className={`p-4 ${!discount.isActive ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-bold text-lg">{discount.name}</h3>
                    <p className="text-sm text-gray-600">{discount.displayText}</p>
                  </div>
                  <span
                    className={`px-2 py-1 text-xs rounded ${
                      discount.isActive
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {discount.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {discount.description && (
                  <p className="text-sm text-gray-500 mb-3">{discount.description}</p>
                )}

                <div className="space-y-1 text-sm mb-4">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Amount:</span>
                    <span className="font-medium">
                      {discount.discountConfig.type === 'percent'
                        ? `${discount.discountConfig.value}%`
                        : formatCurrency(discount.discountConfig.value)}
                    </span>
                  </div>
                  {discount.discountConfig.maxAmount && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Max:</span>
                      <span>{formatCurrency(discount.discountConfig.maxAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-600">Stackable:</span>
                    <span>{discount.isStackable ? 'Yes' : 'No'}</span>
                  </div>
                  {discount.requiresApproval && (
                    <div className="text-orange-600 text-xs mt-1">
                      Requires manager approval
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleEdit(discount)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant={discount.isActive ? 'outline' : 'primary'}
                    size="sm"
                    className="flex-1"
                    onClick={() => handleToggleActive(discount)}
                  >
                    {discount.isActive ? 'Disable' : 'Enable'}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDelete(discount.id)}
                  >
                    Delete
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => { closeModal(); resetForm() }}
        title={editingDiscount ? 'Edit Discount' : 'Create Discount'}
        size="md"
      >
        <form onSubmit={handleSubmitForm}>
          <div className="space-y-4">
            {modalError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                {modalError}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Internal Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g., Employee Discount"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Display Text (shown on receipt)
              </label>
              <input
                type="text"
                value={formData.displayText}
                onChange={(e) => setFormData({ ...formData, displayText: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g., 10% Employee Discount"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description (optional)
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="e.g., For active employees only"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type
                </label>
                <select
                  value={formData.configType}
                  onChange={(e) =>
                    setFormData({ ...formData, configType: e.target.value as 'percent' | 'fixed' })
                  }
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="percent">Percentage</option>
                  <option value="fixed">Fixed Amount</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {formData.configType === 'percent' ? 'Percent (%)' : 'Amount ($)'}
                </label>
                <input
                  type="number"
                  value={formData.configValue}
                  onChange={(e) => setFormData({ ...formData, configValue: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder={formData.configType === 'percent' ? '10' : '5.00'}
                  step={formData.configType === 'percent' ? '1' : '0.01'}
                  min="0"
                  max={formData.configType === 'percent' ? '100' : undefined}
                  required
                />
              </div>
            </div>

            {formData.configType === 'percent' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Maximum Discount Amount (optional)
                </label>
                <input
                  type="number"
                  value={formData.configMaxAmount}
                  onChange={(e) => setFormData({ ...formData, configMaxAmount: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., 25.00"
                  step="0.01"
                  min="0"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Per Order
                </label>
                <input
                  type="number"
                  value={formData.maxPerOrder}
                  onChange={(e) => setFormData({ ...formData, maxPerOrder: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="Unlimited"
                  min="1"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Priority
                </label>
                <input
                  type="number"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isStackable}
                  onChange={(e) => setFormData({ ...formData, isStackable: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-sm">Can be combined with other discounts</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.requiresApproval}
                  onChange={(e) =>
                    setFormData({ ...formData, requiresApproval: e.target.checked })
                  }
                  className="w-4 h-4"
                />
                <span className="text-sm">Requires manager approval</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4"
                />
                <span className="text-sm">Active</span>
              </label>
            </div>
          </div>

          <div className="flex gap-2 mt-6">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                closeModal()
                resetForm()
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={isSaving}>
              {isSaving ? 'Saving...' : editingDiscount ? 'Save Changes' : 'Create Discount'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
