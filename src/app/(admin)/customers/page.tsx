'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency, formatDate } from '@/lib/utils'

// Common customer tags
const CUSTOMER_TAGS = ['VIP', 'Regular', 'First-Timer', 'Staff', 'Family', 'Business', 'Birthday Club']

interface Customer {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
  name: string
  email: string | null
  phone: string | null
  notes: string | null
  tags: string[]
  loyaltyPoints: number
  totalSpent: number
  totalOrders: number
  averageTicket: number
  lastVisit: string | null
  marketingOptIn: boolean
  birthday: string | null
  createdAt: string
}

interface CustomerDetail extends Customer {
  recentOrders: {
    id: string
    orderNumber: number
    orderType: string
    subtotal: number
    total: number
    status: string
    itemCount: number
    createdAt: string
  }[]
  favoriteItems: {
    menuItemId: string
    name: string
    orderCount: number
    totalQuantity: number
  }[]
}

export default function CustomersPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [total, setTotal] = useState(0)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [viewingCustomer, setViewingCustomer] = useState<CustomerDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    displayName: '',
    email: '',
    phone: '',
    notes: '',
    tags: [] as string[],
    marketingOptIn: true,
    birthday: '',
  })

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/customers')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    if (employee?.location?.id) {
      loadCustomers()
    }
  }, [employee, searchTerm, tagFilter])

  const loadCustomers = async () => {
    if (!employee?.location?.id) return

    try {
      setIsLoading(true)
      const params = new URLSearchParams({ locationId: employee.location.id })
      if (searchTerm) params.append('search', searchTerm)
      if (tagFilter) params.append('tag', tagFilter)

      const response = await fetch(`/api/customers?${params}`)
      if (response.ok) {
        const data = await response.json()
        setCustomers(data.customers)
        setTotal(data.total)
      }
    } catch (err) {
      console.error('Failed to load customers:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const loadCustomerDetail = async (customerId: string) => {
    setLoadingDetail(true)
    try {
      const response = await fetch(`/api/customers/${customerId}`)
      if (response.ok) {
        const data = await response.json()
        setViewingCustomer(data)
        setShowDetailModal(true)
      }
    } catch (err) {
      console.error('Failed to load customer detail:', err)
    } finally {
      setLoadingDetail(false)
    }
  }

  const openAddModal = () => {
    setEditingCustomer(null)
    setFormData({
      firstName: '',
      lastName: '',
      displayName: '',
      email: '',
      phone: '',
      notes: '',
      tags: [],
      marketingOptIn: true,
      birthday: '',
    })
    setError(null)
    setShowModal(true)
  }

  const openEditModal = (customer: Customer) => {
    setEditingCustomer(customer)
    setFormData({
      firstName: customer.firstName,
      lastName: customer.lastName,
      displayName: customer.displayName || '',
      email: customer.email || '',
      phone: customer.phone || '',
      notes: customer.notes || '',
      tags: customer.tags || [],
      marketingOptIn: customer.marketingOptIn,
      birthday: customer.birthday ? customer.birthday.split('T')[0] : '',
    })
    setError(null)
    setShowModal(true)
  }

  const handleSave = async () => {
    setError(null)

    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      setError('First name and last name are required')
      return
    }

    setIsSaving(true)

    try {
      const url = editingCustomer
        ? `/api/customers/${editingCustomer.id}`
        : '/api/customers'

      const response = await fetch(url, {
        method: editingCustomer ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee?.location?.id,
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          displayName: formData.displayName.trim() || null,
          email: formData.email.trim() || null,
          phone: formData.phone.trim() || null,
          notes: formData.notes.trim() || null,
          tags: formData.tags,
          marketingOptIn: formData.marketingOptIn,
          birthday: formData.birthday || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save customer')
      }

      setShowModal(false)
      loadCustomers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save customer')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (customerId: string) => {
    if (!confirm('Are you sure you want to delete this customer? This action cannot be undone.')) {
      return
    }

    try {
      const response = await fetch(`/api/customers/${customerId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        loadCustomers()
        if (showDetailModal) {
          setShowDetailModal(false)
          setViewingCustomer(null)
        }
      }
    } catch (err) {
      console.error('Failed to delete customer:', err)
    }
  }

  const toggleTag = (tag: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag],
    }))
  }

  const getTagColor = (tag: string) => {
    const colors: Record<string, string> = {
      VIP: 'bg-yellow-100 text-yellow-800',
      Regular: 'bg-green-100 text-green-800',
      'First-Timer': 'bg-blue-100 text-blue-800',
      Staff: 'bg-purple-100 text-purple-800',
      Family: 'bg-pink-100 text-pink-800',
      Business: 'bg-gray-100 text-gray-800',
      'Birthday Club': 'bg-red-100 text-red-800',
    }
    return colors[tag] || 'bg-gray-100 text-gray-700'
  }

  if (!isAuthenticated || !employee) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Customers</h1>
              <p className="text-sm text-gray-500">
                {total} customer{total !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={() => router.push('/orders')}>
                Back to POS
              </Button>
              <Button variant="primary" onClick={openAddModal}>
                + Add Customer
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Search and Filters */}
        <div className="mb-6 space-y-4">
          <Input
            placeholder="Search by name, email, or phone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="max-w-md"
          />

          <div className="flex gap-2 flex-wrap">
            <button
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                tagFilter === null ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              onClick={() => setTagFilter(null)}
            >
              All
            </button>
            {CUSTOMER_TAGS.map(tag => (
              <button
                key={tag}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  tagFilter === tag ? 'bg-gray-800 text-white' : `${getTagColor(tag)} hover:opacity-80`
                }`}
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Customer List */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-500">Loading customers...</p>
          </div>
        ) : customers.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="text-4xl mb-4">
              {searchTerm || tagFilter ? '🔍' : '👥'}
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {searchTerm || tagFilter ? 'No customers found' : 'No customers yet'}
            </h3>
            <p className="text-gray-500 mb-4">
              {searchTerm || tagFilter
                ? 'Try adjusting your search or filters'
                : 'Add your first customer to start tracking visits and preferences'}
            </p>
            {!searchTerm && !tagFilter && (
              <Button variant="primary" onClick={openAddModal}>
                + Add Customer
              </Button>
            )}
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {customers.map(customer => (
              <Card
                key={customer.id}
                className="p-4 hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => loadCustomerDetail(customer.id)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-medium text-gray-900">{customer.name}</h3>
                    {customer.email && (
                      <p className="text-sm text-gray-500">{customer.email}</p>
                    )}
                    {customer.phone && (
                      <p className="text-sm text-gray-500">{customer.phone}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-green-600">
                      {formatCurrency(customer.totalSpent)}
                    </p>
                    <p className="text-xs text-gray-500">
                      {customer.totalOrders} order{customer.totalOrders !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>

                {customer.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap mb-2">
                    {customer.tags.map(tag => (
                      <span
                        key={tag}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${getTagColor(tag)}`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>
                    Avg: {formatCurrency(customer.averageTicket)}
                  </span>
                  <span>
                    {customer.lastVisit
                      ? `Last visit: ${formatDate(customer.lastVisit)}`
                      : 'Never visited'}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Add/Edit Customer Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingCustomer ? 'Edit Customer' : 'Add Customer'}
      >
        <div className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                placeholder="John"
              />
            </div>
            <div>
              <Label htmlFor="lastName">Last Name *</Label>
              <Input
                id="lastName"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                placeholder="Doe"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="displayName">Display Name (Optional)</Label>
            <Input
              id="displayName"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              placeholder="Johnny"
            />
            <p className="text-xs text-gray-500 mt-1">How they prefer to be called</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="john@example.com"
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="birthday">Birthday</Label>
            <Input
              id="birthday"
              type="date"
              value={formData.birthday}
              onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
            />
          </div>

          <div>
            <Label>Tags</Label>
            <div className="flex gap-2 flex-wrap mt-2">
              {CUSTOMER_TAGS.map(tag => (
                <button
                  key={tag}
                  type="button"
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    formData.tags.includes(tag)
                      ? 'bg-blue-600 text-white'
                      : `${getTagColor(tag)} hover:opacity-80`
                  }`}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Notes (Allergies, Preferences, etc.)</Label>
            <textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
              rows={3}
              placeholder="e.g., Nut allergy, prefers window seat, always asks for extra napkins"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="marketingOptIn"
              checked={formData.marketingOptIn}
              onChange={(e) => setFormData({ ...formData, marketingOptIn: e.target.checked })}
              className="w-4 h-4"
            />
            <Label htmlFor="marketingOptIn" className="!mb-0">
              Customer agrees to receive marketing emails
            </Label>
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : editingCustomer ? 'Update' : 'Add Customer'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Customer Detail Modal */}
      <Modal
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false)
          setViewingCustomer(null)
        }}
        title="Customer Details"
      >
        {loadingDetail || !viewingCustomer ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Customer Info */}
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-xl font-bold">{viewingCustomer.name}</h3>
                {viewingCustomer.email && (
                  <p className="text-gray-600">{viewingCustomer.email}</p>
                )}
                {viewingCustomer.phone && (
                  <p className="text-gray-600">{viewingCustomer.phone}</p>
                )}
                {viewingCustomer.birthday && (
                  <p className="text-sm text-gray-500">
                    Birthday: {formatDate(viewingCustomer.birthday)}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-green-600">
                  {formatCurrency(viewingCustomer.totalSpent)}
                </p>
                <p className="text-sm text-gray-500">
                  {viewingCustomer.totalOrders} orders
                </p>
                <p className="text-sm text-gray-500">
                  Avg: {formatCurrency(viewingCustomer.averageTicket)}
                </p>
              </div>
            </div>

            {/* Tags */}
            {viewingCustomer.tags.length > 0 && (
              <div className="flex gap-2 flex-wrap">
                {viewingCustomer.tags.map(tag => (
                  <span
                    key={tag}
                    className={`px-3 py-1 rounded-full text-sm font-medium ${getTagColor(tag)}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Notes */}
            {viewingCustomer.notes && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm font-medium text-yellow-800 mb-1">Notes:</p>
                <p className="text-sm text-yellow-700">{viewingCustomer.notes}</p>
              </div>
            )}

            {/* Favorite Items */}
            {viewingCustomer.favoriteItems.length > 0 && (
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Favorite Items</h4>
                <div className="space-y-1">
                  {viewingCustomer.favoriteItems.map(item => (
                    <div key={item.menuItemId} className="flex justify-between text-sm">
                      <span>{item.name}</span>
                      <span className="text-gray-500">
                        {item.totalQuantity}x ({item.orderCount} orders)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Orders */}
            {viewingCustomer.recentOrders.length > 0 && (
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Recent Orders</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {viewingCustomer.recentOrders.map(order => (
                    <div
                      key={order.id}
                      className="flex justify-between items-center p-2 bg-gray-50 rounded"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          #{order.orderNumber} - {order.orderType.replace('_', ' ')}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatDate(order.createdAt)} - {order.itemCount} items
                        </p>
                      </div>
                      <span className="font-medium">{formatCurrency(order.total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Last Visit */}
            <div className="text-sm text-gray-500">
              {viewingCustomer.lastVisit
                ? `Last visit: ${formatDate(viewingCustomer.lastVisit)}`
                : 'No visits recorded'}
              {' | '}
              Customer since: {formatDate(viewingCustomer.createdAt)}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowDetailModal(false)
                  openEditModal(viewingCustomer)
                }}
              >
                Edit
              </Button>
              <Button
                variant="outline"
                className="flex-1 text-red-600 hover:bg-red-50"
                onClick={() => handleDelete(viewingCustomer.id)}
              >
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
