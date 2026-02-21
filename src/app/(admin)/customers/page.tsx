'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency, formatDate } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAdminCRUD } from '@/hooks/useAdminCRUD'
import { toast } from '@/stores/toast-store'

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

interface OrdersPagination {
  page: number
  limit: number
  total: number
  totalPages: number
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
  ordersPagination: OrdersPagination
  favoriteItems: {
    menuItemId: string
    name: string
    orderCount: number
    totalQuantity: number
  }[]
}

export default function CustomersPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/customers' })
  const employee = useAuthStore(s => s.employee)
  const [searchTerm, setSearchTerm] = useState('')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [customers, setCustomersLocal] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Detail view modal (separate from CRUD modal)
  const [showDetailModal, setShowDetailModal] = useState(false)
  const [viewingCustomer, setViewingCustomer] = useState<CustomerDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Inline notes edit state
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  // Orders pagination + date filter state
  const [orderPage, setOrderPage] = useState(1)
  const [orderDateFilter, setOrderDateFilter] = useState({ startDate: '', endDate: '' })
  const [pendingDateFilter, setPendingDateFilter] = useState({ startDate: '', endDate: '' })

  // Custom filtered load (search + tag support)
  const loadCustomers = useCallback(async () => {
    if (!employee?.location?.id) return

    try {
      setIsLoading(true)
      const params = new URLSearchParams({ locationId: employee.location.id })
      if (searchTerm) params.append('search', searchTerm)
      if (tagFilter) params.append('tag', tagFilter)

      const response = await fetch(`/api/customers?${params}`)
      if (response.ok) {
        const data = await response.json()
        setCustomersLocal(data.data.customers)
        setTotal(data.data.total)
      }
    } catch (err) {
      console.error('Failed to load customers:', err)
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id, searchTerm, tagFilter])

  const crud = useAdminCRUD<Customer>({
    apiBase: '/api/customers',
    locationId: employee?.location?.id,
    resourceName: 'customer',
    parseResponse: (data) => data.customers || [],
    onSaveSuccess: () => loadCustomers(),
    onDeleteSuccess: () => loadCustomers(),
  })

  const {
    showModal,
    editingItem: editingCustomer,
    isSaving,
    modalError,
    openAddModal: crudOpenAddModal,
    openEditModal: crudOpenEditModal,
    closeModal,
    handleSave: crudHandleSave,
    handleDelete: crudHandleDelete,
  } = crud

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
    if (employee?.location?.id) {
      loadCustomers()
    }
  }, [employee?.location?.id, loadCustomers])

  const loadCustomerDetail = async (
    customerId: string,
    page = 1,
    dateFilter = { startDate: '', endDate: '' }
  ) => {
    setLoadingDetail(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '10' })
      if (dateFilter.startDate) params.set('startDate', dateFilter.startDate)
      if (dateFilter.endDate) params.set('endDate', dateFilter.endDate)
      const response = await fetch(`/api/customers/${customerId}?${params}`)
      if (response.ok) {
        const data = await response.json()
        setViewingCustomer(data.data)
        setShowDetailModal(true)
      }
    } catch (err) {
      console.error('Failed to load customer detail:', err)
    } finally {
      setLoadingDetail(false)
    }
  }

  const resetForm = () => {
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
  }

  const openAddModal = () => {
    resetForm()
    crudOpenAddModal()
  }

  const openEditModal = (customer: Customer) => {
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
    crudOpenEditModal(customer)
  }

  const handleSave = async () => {
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      crud.setModalError('First name and last name are required')
      return
    }

    const payload = {
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
    }

    await crudHandleSave(payload)
  }

  const handleDelete = async (customerId: string) => {
    const deleted = await crudHandleDelete(customerId, 'Are you sure you want to delete this customer? This action cannot be undone.')
    if (deleted && showDetailModal) {
      setShowDetailModal(false)
      setViewingCustomer(null)
    }
  }

  const startEditingNotes = () => {
    setNotesValue(viewingCustomer?.notes ?? '')
    setEditingNotes(true)
  }

  const cancelEditingNotes = () => {
    setEditingNotes(false)
    setNotesValue('')
  }

  const saveNotes = async () => {
    if (!viewingCustomer) return
    setSavingNotes(true)
    try {
      const response = await fetch(`/api/customers/${viewingCustomer.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: notesValue.trim() || null }),
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        toast.error(err.error || 'Failed to save notes')
        return
      }
      setViewingCustomer(prev => prev ? { ...prev, notes: notesValue.trim() || null } : prev)
      setEditingNotes(false)
      setNotesValue('')
      toast.success('Notes saved')
    } catch {
      toast.error('Failed to save notes')
    } finally {
      setSavingNotes(false)
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

  if (!hydrated || !employee) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Customers"
        subtitle={`${total} customer${total !== 1 ? 's' : ''}`}
        actions={
          <Button variant="primary" onClick={openAddModal}>
            + Add Customer
          </Button>
        }
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto mt-6">
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
                onClick={() => {
                  setOrderPage(1)
                  setOrderDateFilter({ startDate: '', endDate: '' })
                  setPendingDateFilter({ startDate: '', endDate: '' })
                  loadCustomerDetail(customer.id, 1, { startDate: '', endDate: '' })
                }}
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
        onClose={closeModal}
        title={editingCustomer ? 'Edit Customer' : 'Add Customer'}
      >
        <div className="space-y-4">
          {modalError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {modalError}
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
              onClick={closeModal}
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
          setOrderPage(1)
          setOrderDateFilter({ startDate: '', endDate: '' })
          setPendingDateFilter({ startDate: '', endDate: '' })
          setEditingNotes(false)
          setNotesValue('')
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

            {/* Notes — inline edit */}
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-medium text-yellow-800">Notes</p>
                {!editingNotes && (
                  <button
                    type="button"
                    onClick={startEditingNotes}
                    className="text-yellow-600 hover:text-yellow-800 p-0.5 rounded transition-colors"
                    title="Edit notes"
                    aria-label="Edit notes"
                  >
                    {/* Pencil icon */}
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>
                )}
              </div>

              {editingNotes ? (
                <div className="space-y-2">
                  <textarea
                    value={notesValue}
                    onChange={(e) => setNotesValue(e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-yellow-300 rounded bg-white text-yellow-900 focus:outline-none focus:ring-1 focus:ring-yellow-400 resize-none"
                    rows={3}
                    placeholder="e.g., Nut allergy, prefers window seat, always asks for extra napkins"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={saveNotes}
                      disabled={savingNotes}
                      className="px-3 py-1 text-xs font-medium bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50 transition-colors"
                    >
                      {savingNotes ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditingNotes}
                      disabled={savingNotes}
                      className="px-3 py-1 text-xs font-medium bg-white text-yellow-700 border border-yellow-300 rounded hover:bg-yellow-50 disabled:opacity-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : viewingCustomer.notes ? (
                <p className="text-sm text-yellow-700 whitespace-pre-wrap">{viewingCustomer.notes}</p>
              ) : (
                <p className="text-sm text-yellow-500 italic">No notes. Click the pencil to add.</p>
              )}
            </div>

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
            <div>
              <h4 className="font-medium text-gray-900 mb-2">Recent Orders</h4>

              {/* Date range filter */}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <input
                  type="date"
                  value={pendingDateFilter.startDate}
                  onChange={(e) => setPendingDateFilter(prev => ({ ...prev, startDate: e.target.value }))}
                  className="text-xs border rounded px-2 py-1 text-gray-700"
                />
                <span className="text-xs text-gray-400">to</span>
                <input
                  type="date"
                  value={pendingDateFilter.endDate}
                  onChange={(e) => setPendingDateFilter(prev => ({ ...prev, endDate: e.target.value }))}
                  className="text-xs border rounded px-2 py-1 text-gray-700"
                />
                <button
                  className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
                  onClick={() => {
                    setOrderDateFilter(pendingDateFilter)
                    setOrderPage(1)
                    loadCustomerDetail(viewingCustomer.id, 1, pendingDateFilter)
                  }}
                >
                  Apply
                </button>
                {(orderDateFilter.startDate || orderDateFilter.endDate) && (
                  <button
                    className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                    onClick={() => {
                      const cleared = { startDate: '', endDate: '' }
                      setOrderDateFilter(cleared)
                      setPendingDateFilter(cleared)
                      setOrderPage(1)
                      loadCustomerDetail(viewingCustomer.id, 1, cleared)
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>

              {viewingCustomer.recentOrders.length > 0 ? (
                <div className="space-y-2">
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
              ) : (
                <p className="text-sm text-gray-400 py-2">No orders found.</p>
              )}

              {/* Pagination controls */}
              {viewingCustomer.ordersPagination.totalPages > 1 && (
                <div className="flex items-center justify-between mt-3 text-xs text-gray-600">
                  <button
                    disabled={orderPage <= 1}
                    className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-100 disabled:cursor-not-allowed"
                    onClick={() => {
                      const newPage = orderPage - 1
                      setOrderPage(newPage)
                      loadCustomerDetail(viewingCustomer.id, newPage, orderDateFilter)
                    }}
                  >
                    &larr; Prev
                  </button>
                  <span>
                    Page {viewingCustomer.ordersPagination.page} of {viewingCustomer.ordersPagination.totalPages}
                  </span>
                  <button
                    disabled={orderPage >= viewingCustomer.ordersPagination.totalPages}
                    className="px-2 py-1 rounded border disabled:opacity-40 hover:bg-gray-100 disabled:cursor-not-allowed"
                    onClick={() => {
                      const newPage = orderPage + 1
                      setOrderPage(newPage)
                      loadCustomerDetail(viewingCustomer.id, newPage, orderDateFilter)
                    }}
                  >
                    Next &rarr;
                  </button>
                </div>
              )}
            </div>

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
