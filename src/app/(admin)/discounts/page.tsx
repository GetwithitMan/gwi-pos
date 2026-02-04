'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminSubNav, menuSubNav } from '@/components/admin/AdminSubNav'

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
  const { employee, isAuthenticated } = useAuthStore()
  const [discounts, setDiscounts] = useState<DiscountRule[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingDiscount, setEditingDiscount] = useState<DiscountRule | null>(null)

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
      loadDiscounts()
    }
  }, [employee?.location?.id])

  const loadDiscounts = async () => {
    if (!employee?.location?.id) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams({ locationId: employee.location.id })
      const response = await fetch(`/api/discounts?${params}`)
      if (response.ok) {
        const data = await response.json()
        setDiscounts(data.discounts || [])
      }
    } catch (error) {
      console.error('Failed to load discounts:', error)
    } finally {
      setIsLoading(false)
    }
  }

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
    setEditingDiscount(null)
  }

  const handleEdit = (discount: DiscountRule) => {
    setEditingDiscount(discount)
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
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!employee?.location?.id) return

    const payload = {
      locationId: employee.location.id,
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

    try {
      const url = editingDiscount
        ? `/api/discounts/${editingDiscount.id}`
        : '/api/discounts'
      const method = editingDiscount ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        loadDiscounts()
        setShowModal(false)
        resetForm()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to save discount')
      }
    } catch (error) {
      console.error('Failed to save discount:', error)
      alert('Failed to save discount')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this discount?')) return

    try {
      const response = await fetch(`/api/discounts/${id}`, { method: 'DELETE' })
      if (response.ok) {
        loadDiscounts()
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to delete discount')
      }
    } catch (error) {
      console.error('Failed to delete discount:', error)
      alert('Failed to delete discount')
    }
  }

  const handleToggleActive = async (discount: DiscountRule) => {
    try {
      const response = await fetch(`/api/discounts/${discount.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !discount.isActive }),
      })

      if (response.ok) {
        loadDiscounts()
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
              setShowModal(true)
            }}
          >
            Add Discount
          </Button>
        }
      />
      <AdminSubNav items={menuSubNav} basePath="/menu" />

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
                setShowModal(true)
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
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden">
            <div className="p-4 border-b bg-gray-50">
              <h2 className="text-xl font-bold">
                {editingDiscount ? 'Edit Discount' : 'Create Discount'}
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-4 overflow-y-auto max-h-[70vh]">
              <div className="space-y-4">
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
                    setShowModal(false)
                    resetForm()
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="flex-1">
                  {editingDiscount ? 'Save Changes' : 'Create Discount'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
