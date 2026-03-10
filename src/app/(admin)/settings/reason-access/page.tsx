'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { toast } from '@/stores/toast-store'

type ReasonType = 'void_reason' | 'comp_reason' | 'discount'

interface AccessRule {
  id: string
  subjectType: 'role' | 'employee'
  subjectId: string
  reasonType: ReasonType
  reasonId: string
  accessType: 'allow' | 'deny'
}

interface ReasonItem {
  id: string
  name: string
  isActive: boolean
}

interface Employee {
  id: string
  firstName: string
  lastName: string
  role: string
}

interface Role {
  id: string
  name: string
}

const TABS: { key: ReasonType; label: string }[] = [
  { key: 'void_reason', label: 'Void Reasons' },
  { key: 'comp_reason', label: 'Comp Reasons' },
  { key: 'discount', label: 'Discounts' },
]

export default function ReasonAccessPage() {
  const { employee } = useRequireAuth()
  const locationId = employee?.location?.id

  const [activeTab, setActiveTab] = useState<ReasonType>('void_reason')
  const [accessRules, setAccessRules] = useState<AccessRule[]>([])
  const [reasons, setReasons] = useState<ReasonItem[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Modal state
  const [showRoleModal, setShowRoleModal] = useState(false)
  const [showEmployeeModal, setShowEmployeeModal] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AccessRule | null>(null)

  // Role modal form
  const [roleForm, setRoleForm] = useState({
    roleId: '',
    selectedReasons: [] as string[],
  })

  // Employee modal form
  const [empForm, setEmpForm] = useState({
    employeeId: '',
    selectedReasons: [] as string[],
    accessType: 'allow' as 'allow' | 'deny',
  })

  const [isSaving, setIsSaving] = useState(false)

  const loadReasons = useCallback(async () => {
    if (!locationId) return

    let url: string
    if (activeTab === 'void_reason') {
      url = `/api/inventory/void-reasons?locationId=${locationId}&activeOnly=false`
    } else if (activeTab === 'comp_reason') {
      url = `/api/inventory/comp-reasons?locationId=${locationId}&activeOnly=false`
    } else {
      url = `/api/discounts?locationId=${locationId}`
    }

    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to load reasons')
      const raw = await res.json()
      const data = raw.data ?? raw

      if (activeTab === 'void_reason') {
        setReasons(data.voidReasons || [])
      } else if (activeTab === 'comp_reason') {
        setReasons(data.compReasons || [])
      } else {
        setReasons((data.discounts || []).map((d: { id: string; name: string; isActive: boolean }) => ({
          id: d.id,
          name: d.name,
          isActive: d.isActive,
        })))
      }
    } catch {
      setReasons([])
    }
  }, [locationId, activeTab])

  const loadAccessRules = useCallback(async () => {
    if (!locationId) return

    try {
      const res = await fetch(`/api/settings/reason-access?locationId=${locationId}&reasonType=${activeTab}`)
      if (!res.ok) throw new Error('Failed to load access rules')
      const raw = await res.json()
      const data = raw.data ?? raw
      setAccessRules(data.rules || data || [])
    } catch {
      setAccessRules([])
    }
  }, [locationId, activeTab])

  const loadEmployeesAndRoles = useCallback(async () => {
    if (!locationId) return

    try {
      const [empRes, rolesRes] = await Promise.all([
        fetch(`/api/employees?locationId=${locationId}`),
        fetch(`/api/roles?locationId=${locationId}`),
      ])

      if (empRes.ok) {
        const empRaw = await empRes.json()
        const empData = empRaw.data ?? empRaw
        setEmployees(empData.employees || empData || [])
      }

      if (rolesRes.ok) {
        const rolesRaw = await rolesRes.json()
        const rolesData = rolesRaw.data ?? rolesRaw
        setRoles(rolesData.roles || rolesData || [])
      }
    } catch {
      // Silently fail — employees/roles may not be loaded yet
    }
  }, [locationId])

  useEffect(() => {
    if (!locationId) return
    setIsLoading(true)
    Promise.all([loadReasons(), loadAccessRules(), loadEmployeesAndRoles()])
      .finally(() => setIsLoading(false))
  }, [locationId, loadReasons, loadAccessRules, loadEmployeesAndRoles])

  const getReasonName = (reasonId: string) => {
    return reasons.find((r) => r.id === reasonId)?.name || reasonId
  }

  const getSubjectLabel = (rule: AccessRule) => {
    if (rule.subjectType === 'role') {
      const role = roles.find((r) => r.name === rule.subjectId || r.id === rule.subjectId)
      return role?.name || rule.subjectId
    }
    const emp = employees.find((e) => e.id === rule.subjectId)
    return emp ? `${emp.firstName} ${emp.lastName}` : rule.subjectId
  }

  // Group access rules by reason for display
  const rulesGroupedByReason = reasons.map((reason) => {
    const reasonRules = accessRules.filter((r) => r.reasonId === reason.id)
    const roleAllows = reasonRules.filter((r) => r.subjectType === 'role' && r.accessType === 'allow')
    const empDenies = reasonRules.filter((r) => r.subjectType === 'employee' && r.accessType === 'deny')
    const empAllows = reasonRules.filter((r) => r.subjectType === 'employee' && r.accessType === 'allow')
    return { reason, roleAllows, empDenies, empAllows, allRules: reasonRules }
  })

  const handleAddRoleAccess = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!locationId || !roleForm.roleId || roleForm.selectedReasons.length === 0) return

    setIsSaving(true)
    try {
      for (const reasonId of roleForm.selectedReasons) {
        const res = await fetch('/api/settings/reason-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId,
            subjectType: 'role',
            subjectId: roleForm.roleId,
            reasonType: activeTab,
            reasonId,
            accessType: 'allow',
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          if (!err.error?.includes('already exists')) {
            throw new Error(err.error || 'Failed to add rule')
          }
        }
      }
      toast.success('Role access rules added')
      setShowRoleModal(false)
      setRoleForm({ roleId: '', selectedReasons: [] })
      await loadAccessRules()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add role access')
    } finally {
      setIsSaving(false)
    }
  }

  const handleAddEmployeeOverride = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!locationId || !empForm.employeeId || empForm.selectedReasons.length === 0) return

    setIsSaving(true)
    try {
      for (const reasonId of empForm.selectedReasons) {
        const res = await fetch('/api/settings/reason-access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId,
            subjectType: 'employee',
            subjectId: empForm.employeeId,
            reasonType: activeTab,
            reasonId,
            accessType: empForm.accessType,
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          if (!err.error?.includes('already exists')) {
            throw new Error(err.error || 'Failed to add override')
          }
        }
      }
      toast.success('Employee override added')
      setShowEmployeeModal(false)
      setEmpForm({ employeeId: '', selectedReasons: [], accessType: 'allow' })
      await loadAccessRules()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add employee override')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteRule = async (rule: AccessRule) => {
    try {
      const res = await fetch(`/api/settings/reason-access/${rule.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete rule')
      toast.success('Access rule removed')
      await loadAccessRules()
    } catch {
      toast.error('Failed to delete access rule')
    }
  }

  const toggleReasonSelection = (
    reasonId: string,
    selected: string[],
    setSelected: (ids: string[]) => void
  ) => {
    if (selected.includes(reasonId)) {
      setSelected(selected.filter((id) => id !== reasonId))
    } else {
      setSelected([...selected, reasonId])
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <AdminPageHeader
        title="Reason Access Control"
        subtitle="Control which roles and employees can use specific void reasons, comp reasons, and discounts"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => {
              setRoleForm({ roleId: '', selectedReasons: [] })
              setShowRoleModal(true)
            }}>
              Add Role Access
            </Button>
            <Button variant="primary" onClick={() => {
              setEmpForm({ employeeId: '', selectedReasons: [], accessType: 'allow' })
              setShowEmployeeModal(true)
            }}>
              Add Employee Override
            </Button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-900 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-900">Loading access rules...</div>
      ) : reasons.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
          <p className="text-gray-900">
            No {activeTab === 'void_reason' ? 'void reasons' : activeTab === 'comp_reason' ? 'comp reasons' : 'discounts'} found.
            Create some first before configuring access.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rulesGroupedByReason.map(({ reason, roleAllows, empDenies, empAllows }) => (
            <div
              key={reason.id}
              className={`bg-white border border-gray-200 rounded-xl p-4 ${!reason.isActive ? 'opacity-50' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900">{reason.name}</h3>
                  {!reason.isActive && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-900 rounded-full">
                      Inactive
                    </span>
                  )}
                </div>
              </div>

              {/* Access badges */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {roleAllows.length === 0 && empAllows.length === 0 && empDenies.length === 0 ? (
                  <span className="text-xs text-gray-900 italic">
                    No access rules (all employees can use)
                  </span>
                ) : (
                  <>
                    {roleAllows.map((rule) => (
                      <span
                        key={rule.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded-full group"
                      >
                        {getSubjectLabel(rule)}
                        <button
                          onClick={() => setDeleteTarget(rule)}
                          className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-green-500 hover:text-red-500"
                        >
                          x
                        </button>
                      </span>
                    ))}
                    {empAllows.map((rule) => (
                      <span
                        key={rule.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full group"
                      >
                        + {getSubjectLabel(rule)}
                        <button
                          onClick={() => setDeleteTarget(rule)}
                          className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-blue-500 hover:text-red-500"
                        >
                          x
                        </button>
                      </span>
                    ))}
                    {empDenies.map((rule) => (
                      <span
                        key={rule.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full group"
                      >
                        - {getSubjectLabel(rule)}
                        <button
                          onClick={() => setDeleteTarget(rule)}
                          className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-600"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </>
                )}
              </div>
            </div>
          ))}

          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-gray-900 pt-2">
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-green-100 border border-green-200" />
              Role allowed
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-blue-100 border border-blue-200" />
              Employee allowed
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-red-100 border border-red-200" />
              Employee denied
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-gray-50 border border-gray-200" />
              No rules = all allowed
            </div>
          </div>
        </div>
      )}

      {/* Add Role Access Modal */}
      <Modal
        isOpen={showRoleModal}
        onClose={() => setShowRoleModal(false)}
        title="Add Role Access"
        size="md"
      >
        <form onSubmit={handleAddRoleAccess}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Role</label>
              <select
                value={roleForm.roleId}
                onChange={(e) => setRoleForm({ ...roleForm, roleId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select a role...</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.name}>{role.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Select {activeTab === 'void_reason' ? 'Void Reasons' : activeTab === 'comp_reason' ? 'Comp Reasons' : 'Discounts'}
              </label>
              <div className="space-y-1.5 max-h-60 overflow-y-auto border rounded-lg p-3">
                {reasons.filter((r) => r.isActive).map((reason) => (
                  <label key={reason.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                    <input
                      type="checkbox"
                      checked={roleForm.selectedReasons.includes(reason.id)}
                      onChange={() => toggleReasonSelection(
                        reason.id,
                        roleForm.selectedReasons,
                        (ids) => setRoleForm({ ...roleForm, selectedReasons: ids })
                      )}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm text-gray-900">{reason.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2 mt-6">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setShowRoleModal(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              disabled={isSaving || !roleForm.roleId || roleForm.selectedReasons.length === 0}
            >
              {isSaving ? 'Saving...' : 'Add Access'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Add Employee Override Modal */}
      <Modal
        isOpen={showEmployeeModal}
        onClose={() => setShowEmployeeModal(false)}
        title="Add Employee Override"
        size="md"
      >
        <form onSubmit={handleAddEmployeeOverride}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Employee</label>
              <select
                value={empForm.employeeId}
                onChange={(e) => setEmpForm({ ...empForm, employeeId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="">Select an employee...</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.firstName} {emp.lastName} ({emp.role})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-1">Access Type</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="accessType"
                    value="allow"
                    checked={empForm.accessType === 'allow'}
                    onChange={() => setEmpForm({ ...empForm, accessType: 'allow' })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-900">Allow (grant extra access)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="accessType"
                    value="deny"
                    checked={empForm.accessType === 'deny'}
                    onChange={() => setEmpForm({ ...empForm, accessType: 'deny' })}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-900">Deny (restrict from role access)</span>
                </label>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">
                Select {activeTab === 'void_reason' ? 'Void Reasons' : activeTab === 'comp_reason' ? 'Comp Reasons' : 'Discounts'}
              </label>
              <div className="space-y-1.5 max-h-60 overflow-y-auto border rounded-lg p-3">
                {reasons.filter((r) => r.isActive).map((reason) => (
                  <label key={reason.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                    <input
                      type="checkbox"
                      checked={empForm.selectedReasons.includes(reason.id)}
                      onChange={() => toggleReasonSelection(
                        reason.id,
                        empForm.selectedReasons,
                        (ids) => setEmpForm({ ...empForm, selectedReasons: ids })
                      )}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm text-gray-900">{reason.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2 mt-6">
            <Button type="button" variant="outline" className="flex-1" onClick={() => setShowEmployeeModal(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              className="flex-1"
              disabled={isSaving || !empForm.employeeId || empForm.selectedReasons.length === 0}
            >
              {isSaving ? 'Saving...' : 'Add Override'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Remove Access Rule"
        description={deleteTarget
          ? `Remove ${deleteTarget.accessType} rule for "${getSubjectLabel(deleteTarget)}" on "${getReasonName(deleteTarget.reasonId)}"?`
          : ''
        }
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          if (deleteTarget) {
            await handleDeleteRule(deleteTarget)
            setDeleteTarget(null)
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
