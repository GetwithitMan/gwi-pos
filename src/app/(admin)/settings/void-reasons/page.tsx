'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAdminCRUD } from '@/hooks/useAdminCRUD'
import { useRequireAuth } from '@/hooks/useRequireAuth'

interface VoidReason {
  id: string
  name: string
  description: string | null
  deductInventory: boolean
  requiresManager: boolean
  isActive: boolean
  sortOrder: number
}

export default function VoidReasonsPage() {
  const { employee } = useRequireAuth()

  const crud = useAdminCRUD<VoidReason>({
    apiBase: '/api/inventory/void-reasons',
    locationId: employee?.location?.id,
    resourceName: 'void reason',
    parseResponse: (data) => data.voidReasons || [],
  })

  const {
    items: reasons,
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
  } = crud

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    deductInventory: false,
    requiresManager: false,
    sortOrder: '',
    isActive: true,
  })

  const [deleteTarget, setDeleteTarget] = useState<VoidReason | null>(null)

  useEffect(() => {
    if (employee?.location?.id) {
      loadItems()
    }
  }, [employee?.location?.id, loadItems])

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      deductInventory: false,
      requiresManager: false,
      sortOrder: '',
      isActive: true,
    })
  }

  const handleEdit = (reason: VoidReason) => {
    setFormData({
      name: reason.name,
      description: reason.description || '',
      deductInventory: reason.deductInventory,
      requiresManager: reason.requiresManager,
      sortOrder: reason.sortOrder.toString(),
      isActive: reason.isActive,
    })
    openEditModal(reason)
  }

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!employee?.location?.id) return

    const payload = {
      locationId: employee.location.id,
      name: formData.name,
      description: formData.description || null,
      deductInventory: formData.deductInventory,
      requiresManager: formData.requiresManager,
      sortOrder: formData.sortOrder ? parseInt(formData.sortOrder) : undefined,
      isActive: formData.isActive,
    }

    const ok = await handleSave(payload)
    if (ok) resetForm()
  }

  const handleToggleActive = async (reason: VoidReason) => {
    try {
      const res = await fetch(`/api/inventory/void-reasons/${reason.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !reason.isActive }),
      })
      if (res.ok) loadItems()
    } catch (error) {
      console.error('Failed to toggle void reason:', error)
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Void Reasons"
        subtitle="Manage preset reasons for voiding items and orders"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        actions={
          <Button
            variant="primary"
            onClick={() => {
              resetForm()
              openAddModal()
            }}
          >
            Add Void Reason
          </Button>
        }
      />

      <main>
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading void reasons...</div>
        ) : reasons.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-gray-500 mb-4">No void reasons created yet.</p>
            <Button
              variant="primary"
              onClick={() => {
                resetForm()
                openAddModal()
              }}
            >
              Create First Void Reason
            </Button>
          </Card>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Description</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Flags</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reasons.map((reason) => (
                  <tr key={reason.id} className={`hover:bg-gray-50 transition-colors ${!reason.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{reason.name}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {reason.description || <span className="italic text-gray-300">--</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {reason.requiresManager && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-orange-100 text-orange-700 rounded-full">
                            Manager
                          </span>
                        )}
                        {reason.deductInventory && (
                          <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                            Deduct Inv
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                          reason.isActive
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {reason.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => handleEdit(reason)}>
                          Edit
                        </Button>
                        <Button
                          variant={reason.isActive ? 'ghost' : 'primary'}
                          size="sm"
                          onClick={() => handleToggleActive(reason)}
                        >
                          {reason.isActive ? 'Disable' : 'Enable'}
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => setDeleteTarget(reason)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => { closeModal(); resetForm() }}
        title={editingItem ? 'Edit Void Reason' : 'Create Void Reason'}
        size="md"
      >
        <form onSubmit={handleSubmitForm}>
          <div className="space-y-4">
            {modalError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                {modalError}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Kitchen Error - Made"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Item was prepared but customer changed mind"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
              <input
                type="number"
                value={formData.sortOrder}
                onChange={(e) => setFormData({ ...formData, sortOrder: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Auto (next available)"
                min="0"
              />
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.requiresManager}
                  onChange={(e) => setFormData({ ...formData, requiresManager: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm text-gray-700">Requires manager PIN</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.deductInventory}
                  onChange={(e) => setFormData({ ...formData, deductInventory: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm text-gray-700">Auto-deduct from inventory</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <span className="text-sm text-gray-700">Active</span>
              </label>
            </div>
          </div>

          <div className="flex gap-2 mt-6">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => { closeModal(); resetForm() }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={isSaving}>
              {isSaving ? 'Saving...' : editingItem ? 'Save Changes' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Void Reason"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) {
            await handleDelete(deleteTarget.id)
            setDeleteTarget(null)
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
