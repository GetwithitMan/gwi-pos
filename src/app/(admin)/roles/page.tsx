'use client'

import { useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAdminCRUD } from '@/hooks/useAdminCRUD'
import { RoleCard } from '@/components/roles/RoleCard'
import { RoleEditorDrawer } from '@/components/roles/RoleEditorDrawer'

interface Role {
  id: string
  name: string
  permissions: string[]
  isTipped: boolean
  cashHandlingMode: string
  trackLaborCost: boolean
  employeeCount: number
  roleType?: string
  accessLevel?: string
}

export default function RolesPage() {
  const currentEmployee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/roles' })

  const crud = useAdminCRUD<Role>({
    apiBase: '/api/roles',
    locationId: currentEmployee?.location?.id,
    requestingEmployeeId: currentEmployee?.id,
    resourceName: 'role',
    parseResponse: (data) => data.roles || [],
  })

  const {
    items: roles,
    isLoading,
    showModal,
    editingItem: editingRole,
    isSaving,
    modalError,
    loadItems,
    openAddModal,
    closeModal,
    handleSave,
    handleDelete: crudDelete,
  } = crud

  const handleSaveWithAuth = useCallback(
    (payload: Record<string, unknown>) =>
      handleSave({ ...payload, requestingEmployeeId: currentEmployee?.id }),
    [handleSave, currentEmployee?.id]
  )

  useEffect(() => {
    if (currentEmployee?.location?.id) {
      loadItems()
    }
  }, [currentEmployee?.location?.id, loadItems])

  const handleDelete = async (role: Role) => {
    if (role.employeeCount > 0) {
      toast.warning(`Cannot delete "${role.name}" — ${role.employeeCount} employee(s) assigned. Reassign them first.`)
      return
    }
    const res = await fetch(
      `/api/roles/${role.id}?requestingEmployeeId=${encodeURIComponent(currentEmployee?.id ?? '')}`,
      { method: 'DELETE' }
    )
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error || 'Failed to delete role')
      return
    }
    toast.success('Role deleted')
    await loadItems()
  }

  if (!hydrated || !currentEmployee) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <AnimatePresence mode="wait">
        {!showModal ? (
          <motion.div
            key="list"
            initial={{ x: 0, opacity: 1 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -60, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="p-6"
          >
            <AdminPageHeader
              title="Roles & Permissions"
              subtitle="Define what each role can do — set up once, apply to your whole team"
              actions={
                <Button variant="primary" onClick={openAddModal}>
                  + Add Role
                </Button>
              }
            />

            <div className="mt-6">
              {isLoading ? (
                <div className="text-center py-12 text-gray-500">Loading roles...</div>
              ) : roles.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-gray-400 mb-4">
                    <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  </div>
                  <p className="text-gray-500 mb-4">No roles yet. Start with a template to get set up in seconds.</p>
                  <Button variant="primary" onClick={openAddModal}>Create First Role</Button>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {roles.map(role => (
                    <RoleCard
                      key={role.id}
                      role={role}
                      onEdit={() => crud.openEditModal(role)}
                      onDelete={() => handleDelete(role)}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="editor"
            initial={{ x: 80, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 80, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <RoleEditorDrawer
              onBack={closeModal}
              onSave={handleSaveWithAuth}
              roleToEdit={editingRole}
              isCreating={!editingRole}
              isSaving={isSaving}
              modalError={modalError}
              locationId={currentEmployee?.location?.id}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
