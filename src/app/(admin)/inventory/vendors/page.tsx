'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAdminCRUD } from '@/hooks/useAdminCRUD'

interface Vendor {
  id: string
  name: string
  accountNum: string | null
  phone: string | null
  email: string | null
  address: string | null
  paymentTerms: string | null
  notes: string | null
  isActive: boolean
}

const PAYMENT_TERMS = [
  { value: 'cod', label: 'COD (Cash on Delivery)' },
  { value: 'net-7', label: 'Net 7' },
  { value: 'net-15', label: 'Net 15' },
  { value: 'net-30', label: 'Net 30' },
  { value: 'net-60', label: 'Net 60' },
  { value: '2-10-net-30', label: '2/10 Net 30' },
]

export default function VendorsPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  // Search/filter state (kept separate from CRUD hook)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)

  // Refs to break circular dependency with hook callbacks
  const showInactiveRef = useRef(false)
  showInactiveRef.current = showInactive
  const setItemsRef = useRef<React.Dispatch<React.SetStateAction<Vendor[]>> | null>(null)

  const locationId = employee?.location?.id

  // Custom fetch for when showInactive is true (hook's loadItems only loads active)
  const fetchAllVendors = useCallback(async () => {
    if (!locationId || !setItemsRef.current) return
    try {
      const res = await fetch(`/api/inventory/vendors?locationId=${locationId}&activeOnly=false`)
      if (res.ok) {
        const data = await res.json()
        setItemsRef.current(data.data.vendors || [])
      }
    } catch {
      // Silent — hook's loadItems already loaded active vendors as fallback
    }
  }, [locationId])

  const crud = useAdminCRUD<Vendor>({
    apiBase: '/api/inventory/vendors',
    locationId,
    resourceName: 'vendor',
    parseResponse: (data) => data.vendors || [],
    onSaveSuccess: () => {
      if (showInactiveRef.current) fetchAllVendors()
    },
    onDeleteSuccess: () => {
      if (showInactiveRef.current) fetchAllVendors()
    },
  })

  setItemsRef.current = crud.setItems

  const {
    items: vendors,
    isLoading,
    showModal,
    editingItem: editingVendor,
    isSaving,
    modalError,
    loadItems,
    openAddModal,
    openEditModal,
    closeModal,
    handleSave,
    handleDelete,
  } = crud

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/inventory/vendors')
      return
    }
  }, [isAuthenticated, router])

  // Load vendors on mount and when showInactive changes
  useEffect(() => {
    if (!locationId) return
    if (showInactive) {
      fetchAllVendors()
    } else {
      loadItems()
    }
  }, [locationId, showInactive, loadItems, fetchAllVendors])

  const filteredVendors = useMemo(() => {
    if (!search) return vendors
    const lower = search.toLowerCase()
    return vendors.filter(v =>
      v.name.toLowerCase().includes(lower) ||
      v.accountNum?.toLowerCase().includes(lower) ||
      v.email?.toLowerCase().includes(lower)
    )
  }, [vendors, search])

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Vendors"
        subtitle="Manage your suppliers and their contact information"
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }]}
        actions={
          <Button onClick={() => { openAddModal() }}>
            + Add Vendor
          </Button>
        }
      />

      {/* Filters */}
      <div className="mb-6 flex items-center gap-4">
        <input
          type="text"
          placeholder="Search vendors..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded px-3 py-2 w-64"
        />
        <label className="flex items-center gap-2 cursor-pointer text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="rounded"
          />
          Show Inactive
        </label>
        <span className="text-sm text-gray-500 ml-auto">
          {filteredVendors.length} vendor{filteredVendors.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Vendor Grid */}
      {isLoading ? (
        <p className="text-gray-500">Loading...</p>
      ) : filteredVendors.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">
            {search ? 'No vendors match your search' : 'No vendors yet. Add your first vendor to get started.'}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredVendors.map(vendor => (
            <Card
              key={vendor.id}
              className={!vendor.isActive ? 'opacity-60' : ''}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{vendor.name}</CardTitle>
                    {vendor.accountNum && (
                      <p className="text-sm text-gray-500">Account: {vendor.accountNum}</p>
                    )}
                  </div>
                  {!vendor.isActive && (
                    <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600">
                      Inactive
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Contact Info */}
                <div className="space-y-1 text-sm">
                  {vendor.phone && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                      </svg>
                      <span>{vendor.phone}</span>
                    </div>
                  )}
                  {vendor.email && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      <span className="truncate">{vendor.email}</span>
                    </div>
                  )}
                </div>

                {/* Payment Terms */}
                {vendor.paymentTerms && (
                  <div className="pt-2 border-t">
                    <span className="text-xs text-gray-500">Payment Terms: </span>
                    <span className="text-sm font-medium">
                      {PAYMENT_TERMS.find(t => t.value === vendor.paymentTerms)?.label || vendor.paymentTerms}
                    </span>
                  </div>
                )}

                {/* Actions */}
                <div className="pt-2 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => openEditModal(vendor)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(
                      vendor.id,
                      `Are you sure you want to ${vendor.isActive ? 'deactivate' : 'delete'} ${vendor.name}?`
                    )}
                  >
                    {vendor.isActive ? 'Deactivate' : 'Delete'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Vendor Modal */}
      {showModal && (
        <VendorModal
          vendor={editingVendor}
          locationId={locationId || ''}
          onClose={closeModal}
          onSave={async (payload) => {
            const ok = await handleSave(payload)
            if (ok) toast.success(editingVendor ? 'Vendor updated' : 'Vendor created')
            return ok
          }}
          isSaving={isSaving}
          modalError={modalError}
        />
      )}
    </div>
  )
}

// Vendor Modal
function VendorModal({
  vendor,
  locationId,
  onClose,
  onSave,
  isSaving,
  modalError,
}: {
  vendor: Vendor | null
  locationId: string
  onClose: () => void
  onSave: (payload: Record<string, unknown>) => Promise<boolean>
  isSaving: boolean
  modalError: string | null
}) {
  const [form, setForm] = useState({
    name: vendor?.name || '',
    accountNum: vendor?.accountNum || '',
    phone: vendor?.phone || '',
    email: vendor?.email || '',
    address: vendor?.address || '',
    paymentTerms: vendor?.paymentTerms || '',
    notes: vendor?.notes || '',
    isActive: vendor?.isActive ?? true,
  })

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }

    await onSave({
      ...form,
      locationId,
      accountNum: form.accountNum || null,
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      paymentTerms: form.paymentTerms || null,
      notes: form.notes || null,
    })
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={vendor ? 'Edit Vendor' : 'Add Vendor'} size="lg">
        <div className="space-y-4">
          {modalError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {modalError}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-600 mb-1">Vendor Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full border rounded px-3 py-2"
              placeholder="e.g., Sysco, US Foods"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Account Number</label>
            <input
              type="text"
              value={form.accountNum}
              onChange={(e) => setForm({ ...form, accountNum: e.target.value })}
              className="w-full border rounded px-3 py-2"
              placeholder="Your account # with this vendor"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-600 mb-1">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full border rounded px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Address</label>
            <textarea
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full border rounded px-3 py-2"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Payment Terms</label>
            <select
              value={form.paymentTerms}
              onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })}
              className="w-full border rounded px-3 py-2"
            >
              <option value="">Select terms...</option>
              {PAYMENT_TERMS.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full border rounded px-3 py-2"
              rows={2}
              placeholder="Rep name, special instructions, etc."
            />
          </div>

          {vendor && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">Active</span>
            </label>
          )}

          <div className="flex gap-2 pt-4">
            <Button variant="outline" onClick={onClose} disabled={isSaving} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving} className="flex-1">
              {isSaving ? 'Saving...' : vendor ? 'Save Changes' : 'Create Vendor'}
            </Button>
          </div>
        </div>
    </Modal>
  )
}
