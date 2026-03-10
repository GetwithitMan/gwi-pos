'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'

interface Assignment {
  id: string
  employeeId: string
  employeeName: string
  roleName: string
  assignedAt: string
}

interface Section {
  id: string
  name: string
  color: string
  sortOrder: number
  tableCount: number
  assignedEmployees: { id: string; name: string }[]
}

interface EmployeeOption {
  id: string
  firstName: string
  lastName: string
  displayName: string | null
  role: { id: string; name: string }
}

export default function SectionAssignmentsPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = useAuthStore(s => s.locationId)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/settings/sections' })

  const [sections, setSections] = useState<Section[]>([])
  const [assignments, setAssignments] = useState<Record<string, Assignment[]>>({})
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedSection, setExpandedSection] = useState<string | null>(null)
  const [assigningSection, setAssigningSection] = useState<string | null>(null)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const fetchSections = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/sections?locationId=${locationId}`)
      const json = await res.json()
      if (json.data?.sections) {
        setSections(json.data.sections)
        if (json.data.sections.length > 0 && !expandedSection) {
          setExpandedSection(json.data.sections[0].id)
        }
      }
    } catch (e) {
      console.error('Failed to fetch sections:', e)
    }
  }, [locationId, expandedSection])

  const fetchAssignments = useCallback(async (sectionId: string) => {
    if (!locationId) return
    try {
      const res = await fetch(
        `/api/sections/${sectionId}/assignments?locationId=${locationId}`
      )
      const json = await res.json()
      if (json.data?.assignments) {
        setAssignments(prev => ({ ...prev, [sectionId]: json.data.assignments }))
      }
    } catch (e) {
      console.error('Failed to fetch assignments:', e)
    }
  }, [locationId])

  const fetchEmployees = useCallback(async () => {
    if (!locationId || !employee?.id) return
    try {
      const res = await fetch(
        `/api/employees?locationId=${locationId}&requestingEmployeeId=${employee.id}&limit=100`
      )
      const json = await res.json()
      if (json.data?.employees) {
        setEmployees(json.data.employees)
      }
    } catch (e) {
      console.error('Failed to fetch employees:', e)
    }
  }, [locationId, employee?.id])

  useEffect(() => {
    const init = async () => {
      setLoading(true)
      await Promise.all([fetchSections(), fetchEmployees()])
      setLoading(false)
    }
    init()
  }, [fetchSections, fetchEmployees])

  useEffect(() => {
    if (expandedSection) {
      fetchAssignments(expandedSection)
    }
  }, [expandedSection, fetchAssignments])

  const handleAssign = async (sectionId: string) => {
    if (!selectedEmployeeId || !locationId || !employee?.id) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/sections/${sectionId}/assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId: selectedEmployeeId,
          requestingEmployeeId: employee.id,
        }),
      })
      if (res.ok) {
        setSelectedEmployeeId('')
        setAssigningSection(null)
        await Promise.all([fetchAssignments(sectionId), fetchSections()])
      } else {
        const json = await res.json()
        alert(json.error || 'Failed to assign employee')
      }
    } catch (e) {
      console.error('Failed to assign:', e)
      alert('Failed to assign employee')
    } finally {
      setSubmitting(false)
    }
  }

  const handleUnassign = async (sectionId: string, empId: string) => {
    if (!locationId || !employee?.id) return
    try {
      const res = await fetch(
        `/api/sections/${sectionId}/assignments?locationId=${locationId}&employeeId=${empId}&requestingEmployeeId=${employee.id}`,
        { method: 'DELETE' }
      )
      if (res.ok) {
        await Promise.all([fetchAssignments(sectionId), fetchSections()])
      } else {
        const json = await res.json()
        alert(json.error || 'Failed to remove assignment')
      }
    } catch (e) {
      console.error('Failed to unassign:', e)
      alert('Failed to remove assignment')
    }
  }

  const getAvailableEmployees = (sectionId: string) => {
    const assigned = assignments[sectionId] || []
    const assignedIds = new Set(assigned.map(a => a.employeeId))
    return employees.filter(e => !assignedIds.has(e.id))
  }

  if (!hydrated) return null

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Section Assignments</h1>
      <p className="text-sm text-gray-500 mb-6">
        Assign servers to floor plan sections. Assignments help route orders and track coverage.
      </p>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sections.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-lg border">
          <p className="text-gray-500">No sections found. Create sections in the Floor Plan Editor first.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map(section => {
            const isExpanded = expandedSection === section.id
            const sectionAssignments = assignments[section.id] || []
            const isAssigning = assigningSection === section.id
            const available = getAvailableEmployees(section.id)

            return (
              <div key={section.id} className="bg-white rounded-lg border overflow-hidden">
                <button
                  onClick={() => setExpandedSection(isExpanded ? null : section.id)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="w-4 h-4 rounded-full flex-shrink-0"
                      style={{ backgroundColor: section.color }}
                    />
                    <div className="text-left">
                      <span className="font-medium text-gray-900">{section.name}</span>
                      <span className="ml-2 text-xs text-gray-400">
                        {section.tableCount} table{section.tableCount !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {section.assignedEmployees.length > 0 && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                        {section.assignedEmployees.length} assigned
                      </span>
                    )}
                  </div>
                  <svg
                    className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="border-t px-4 py-3">
                    {sectionAssignments.length === 0 ? (
                      <p className="text-sm text-gray-400 mb-3">No servers assigned to this section.</p>
                    ) : (
                      <div className="space-y-2 mb-3">
                        {sectionAssignments.map(a => (
                          <div
                            key={a.id}
                            className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
                          >
                            <div>
                              <span className="text-sm font-medium text-gray-900">{a.employeeName}</span>
                              <span className="ml-2 text-xs text-gray-400">{a.roleName}</span>
                            </div>
                            <button
                              onClick={() => handleUnassign(section.id, a.employeeId)}
                              className="text-xs text-red-600 hover:text-red-800 px-2 py-1 rounded hover:bg-red-50 transition-colors min-h-[32px] min-w-[32px] flex items-center"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {isAssigning ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={selectedEmployeeId}
                          onChange={e => setSelectedEmployeeId(e.target.value)}
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
                        >
                          <option value="">Select an employee...</option>
                          {available.map(emp => (
                            <option key={emp.id} value={emp.id}>
                              {emp.displayName || `${emp.firstName} ${emp.lastName}`} ({emp.role.name})
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleAssign(section.id)}
                          disabled={!selectedEmployeeId || submitting}
                          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[40px]"
                        >
                          {submitting ? 'Saving...' : 'Assign'}
                        </button>
                        <button
                          onClick={() => { setAssigningSection(null); setSelectedEmployeeId('') }}
                          className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 min-h-[40px]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAssigningSection(section.id)}
                        className="text-sm text-blue-600 hover:text-blue-800 font-medium min-h-[40px] px-1"
                      >
                        + Assign Server
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
