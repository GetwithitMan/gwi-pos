'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'
import Link from 'next/link'

interface GwiEmployee {
  id: string
  firstName: string
  lastName: string
  role?: { name: string } | null
  sevenShiftsUserId?: number | null
}

interface SevenShiftsUser {
  id: number
  first_name: string
  last_name: string
  email: string
  department_id?: number | null
  department_name?: string
  location_id?: number | null
}

export default function SevenShiftsEmployeeMappingPage() {
  const employee = useAuthStore(s => s.employee)
  const [gwiEmployees, setGwiEmployees] = useState<GwiEmployee[]>([])
  const [sevenShiftsUsers, setSevenShiftsUsers] = useState<SevenShiftsUser[]>([])
  const [loading, setLoading] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [linkingId, setLinkingId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const [gwiRes, usersRes] = await Promise.all([
          fetch('/api/employees').then(r => r.json()),
          fetch('/api/integrations/7shifts/users').then(r => r.json()).catch(() => ({ error: 'Failed to load 7shifts users' })),
        ])
        setGwiEmployees(gwiRes.data ?? gwiRes ?? [])
        if (usersRes.error) {
          setUsersError(usersRes.error)
        } else {
          setSevenShiftsUsers(usersRes.data ?? [])
        }
      } catch {
        toast.error('Failed to load employee data')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  async function handleLink(employeeId: string, sevenShiftsUserId: number | null) {
    setLinkingId(employeeId)
    try {
      const res = await fetch('/api/integrations/7shifts/link-employee', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId,
          sevenShiftsUserId,
          adminEmployeeId: employee?.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to update link')
        return
      }

      // Update local state
      setGwiEmployees(prev =>
        prev.map(emp =>
          emp.id === employeeId
            ? { ...emp, sevenShiftsUserId }
            : emp
        )
      )
      toast.success(sevenShiftsUserId ? 'Employee linked' : 'Employee unlinked')
    } catch {
      toast.error('Failed to update link')
    } finally {
      setLinkingId(null)
    }
  }

  const unlinkedCount = gwiEmployees.filter(e => !e.sevenShiftsUserId).length
  // Build a set of already-linked 7shifts user IDs so they can't be double-assigned
  const linkedUserIds = new Set(gwiEmployees.filter(e => e.sevenShiftsUserId).map(e => e.sevenShiftsUserId!))

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto pb-32">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link href="/settings/integrations/7shifts" className="text-gray-400 hover:text-gray-600 text-sm">&larr; 7shifts Settings</Link>
          </div>
          <h1 className="text-2xl font-bold mb-1">7shifts Employee Mapping</h1>
          <p className="text-gray-500">
            Link GWI POS employees to their 7shifts accounts so time punches and sales data
            are attributed to the correct person.
          </p>
        </div>
        {unlinkedCount > 0 && (
          <span className="flex-shrink-0 ml-4 px-3 py-1 rounded-full text-sm font-medium bg-amber-100 text-amber-800">
            {unlinkedCount} not linked
          </span>
        )}
      </div>

      {usersError && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 mb-6 text-sm text-amber-800">
          <strong>Could not load 7shifts users.</strong>{' '}
          {usersError.includes('credentials') || usersError.includes('configured')
            ? <>Configure your 7shifts credentials first in <Link href="/settings/integrations/7shifts" className="text-blue-600 hover:underline">7shifts Settings</Link>.</>
            : usersError
          }
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Employees</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="pb-2 font-medium text-gray-600">GWI Employee</th>
                  <th className="pb-2 font-medium text-gray-600">Role</th>
                  <th className="pb-2 font-medium text-gray-600">Linked 7shifts Account</th>
                  <th className="pb-2 font-medium text-gray-600 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {gwiEmployees.map(emp => {
                  const isLinked = Boolean(emp.sevenShiftsUserId)
                  const linkedUser = isLinked
                    ? sevenShiftsUsers.find(u => u.id === emp.sevenShiftsUserId)
                    : null
                  const isLinking = linkingId === emp.id

                  return (
                    <tr key={emp.id} className="hover:bg-gray-50">
                      <td className="py-3 font-medium text-gray-900">
                        {emp.firstName} {emp.lastName}
                      </td>
                      <td className="py-3 text-gray-500">
                        {emp.role?.name ?? '—'}
                      </td>
                      <td className="py-3">
                        {isLinked ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">Linked</span>
                            <span className="text-gray-700">
                              {linkedUser
                                ? `${linkedUser.first_name} ${linkedUser.last_name}`
                                : `User #${emp.sevenShiftsUserId}`
                              }
                            </span>
                            {linkedUser?.department_name && (
                              <span className="text-gray-400 text-xs">({linkedUser.department_name})</span>
                            )}
                          </span>
                        ) : (
                          <select
                            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-xs"
                            defaultValue=""
                            disabled={isLinking || sevenShiftsUsers.length === 0}
                            onChange={e => {
                              const userId = parseInt(e.target.value)
                              if (userId) void handleLink(emp.id, userId)
                            }}
                          >
                            <option value="">Select 7shifts user...</option>
                            {sevenShiftsUsers
                              .filter(u => !linkedUserIds.has(u.id))
                              .map(u => (
                                <option key={u.id} value={u.id}>
                                  {u.first_name} {u.last_name} — {u.email}
                                </option>
                              ))
                            }
                          </select>
                        )}
                      </td>
                      <td className="py-3 text-right">
                        {isLinked && (
                          <Button
                            onClick={() => void handleLink(emp.id, null)}
                            disabled={isLinking}
                            variant="outline"
                            size="sm"
                          >
                            {isLinking ? 'Unlinking...' : 'Unlink'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
                {gwiEmployees.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-gray-400">
                      No employees found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
