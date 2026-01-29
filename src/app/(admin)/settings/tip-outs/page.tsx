'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'

interface Role {
  id: string
  name: string
  isTipped: boolean
}

interface TipOutRule {
  id: string
  locationId: string
  fromRoleId: string
  fromRole: Role
  toRoleId: string
  toRole: Role
  percentage: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export default function TipOutsSettingsPage() {
  const { employee } = useAuthStore()
  const [rules, setRules] = useState<TipOutRule[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Form state for new rule
  const [showAddForm, setShowAddForm] = useState(false)
  const [newRule, setNewRule] = useState({
    fromRoleId: '',
    toRoleId: '',
    percentage: ''
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPercentage, setEditPercentage] = useState('')

  const locationId = employee?.location?.id

  useEffect(() => {
    if (locationId) {
      loadData()
    }
  }, [locationId])

  const loadData = async () => {
    try {
      setIsLoading(true)
      if (!locationId) {
        setError('No location found. Please log in again.')
        return
      }

      // Load roles and tip-out rules in parallel
      const [rolesRes, rulesRes] = await Promise.all([
        fetch(`/api/roles?locationId=${locationId}`),
        fetch(`/api/tip-out-rules?locationId=${locationId}`)
      ])

      if (rolesRes.ok) {
        const rolesData = await rolesRes.json()
        setRoles(rolesData.roles || [])
      }

      if (rulesRes.ok) {
        const rulesData = await rulesRes.json()
        setRules(rulesData.data || [])
      }
    } catch (err) {
      console.error('Failed to load data:', err)
      setError('Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddRule = async () => {
    if (!newRule.fromRoleId || !newRule.toRoleId || !newRule.percentage) {
      setError('Please fill in all fields')
      return
    }

    const percentage = parseFloat(newRule.percentage)
    if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
      setError('Percentage must be between 0 and 100')
      return
    }

    if (!locationId) {
      setError('No location found')
      return
    }

    setIsSubmitting(true)
    setError('')

    try {
      const response = await fetch('/api/tip-out-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          fromRoleId: newRule.fromRoleId,
          toRoleId: newRule.toRoleId,
          percentage
        })
      })

      if (response.ok) {
        const data = await response.json()
        setRules([...rules, data.data])
        setNewRule({ fromRoleId: '', toRoleId: '', percentage: '' })
        setShowAddForm(false)
        setSuccessMessage('Tip-out rule created successfully')
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to create rule')
      }
    } catch (err) {
      console.error('Failed to create rule:', err)
      setError('Failed to create rule')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUpdatePercentage = async (ruleId: string) => {
    const percentage = parseFloat(editPercentage)
    if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
      setError('Percentage must be between 0 and 100')
      return
    }

    try {
      const response = await fetch(`/api/tip-out-rules/${ruleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ percentage })
      })

      if (response.ok) {
        const data = await response.json()
        setRules(rules.map(r => r.id === ruleId ? data.data : r))
        setEditingId(null)
        setEditPercentage('')
        setSuccessMessage('Rule updated successfully')
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to update rule')
      }
    } catch (err) {
      console.error('Failed to update rule:', err)
      setError('Failed to update rule')
    }
  }

  const handleToggleActive = async (rule: TipOutRule) => {
    try {
      const response = await fetch(`/api/tip-out-rules/${rule.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !rule.isActive })
      })

      if (response.ok) {
        const data = await response.json()
        setRules(rules.map(r => r.id === rule.id ? data.data : r))
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to update rule')
      }
    } catch (err) {
      console.error('Failed to toggle rule:', err)
      setError('Failed to update rule')
    }
  }

  const handleDeleteRule = async (ruleId: string) => {
    if (!confirm('Are you sure you want to delete this tip-out rule?')) {
      return
    }

    try {
      const response = await fetch(`/api/tip-out-rules/${ruleId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        setRules(rules.filter(r => r.id !== ruleId))
        setSuccessMessage('Rule deleted successfully')
        setTimeout(() => setSuccessMessage(''), 3000)
      } else {
        const data = await response.json()
        // If deactivated instead of deleted
        if (data.message?.includes('deactivated')) {
          loadData() // Reload to get updated data
          setSuccessMessage(data.message)
          setTimeout(() => setSuccessMessage(''), 3000)
        } else {
          setError(data.error || 'Failed to delete rule')
        }
      }
    } catch (err) {
      console.error('Failed to delete rule:', err)
      setError('Failed to delete rule')
    }
  }

  const startEdit = (rule: TipOutRule) => {
    setEditingId(rule.id)
    setEditPercentage(rule.percentage.toString())
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditPercentage('')
  }

  // Get available "to" roles (exclude the selected "from" role)
  const getAvailableToRoles = () => {
    return roles.filter(r => r.id !== newRule.fromRoleId)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading tip-out settings...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/settings" className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Tip-Out Rules</h1>
              <p className="text-sm text-gray-500">Configure automatic tip-out percentages by role</p>
            </div>
          </div>
          <Button variant="primary" onClick={() => setShowAddForm(true)}>
            Add Rule
          </Button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-6">
        {/* Messages */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
            <button onClick={() => setError('')} className="float-right text-red-500 hover:text-red-700">
              &times;
            </button>
          </div>
        )}
        {successMessage && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
            {successMessage}
          </div>
        )}

        {/* Info Card */}
        <Card className="p-4 bg-blue-50 border-blue-200">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-blue-700">
              <p className="font-medium mb-1">How Tip-Outs Work</p>
              <p>When an employee closes their shift, automatic tip-outs are calculated based on their role. For example, if a Server has a 3% tip-out rule to Bussers, $100 in tips would result in $3 going to the Busser.</p>
            </div>
          </div>
        </Card>

        {/* Add New Rule Form */}
        {showAddForm && (
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Add New Tip-Out Rule</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  From Role (tips out)
                </label>
                <select
                  value={newRule.fromRoleId}
                  onChange={(e) => setNewRule({ ...newRule, fromRoleId: e.target.value, toRoleId: '' })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="">Select role...</option>
                  {roles.map(role => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  To Role (receives)
                </label>
                <select
                  value={newRule.toRoleId}
                  onChange={(e) => setNewRule({ ...newRule, toRoleId: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  disabled={!newRule.fromRoleId}
                >
                  <option value="">Select role...</option>
                  {getAvailableToRoles().map(role => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Percentage
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={newRule.percentage}
                    onChange={(e) => setNewRule({ ...newRule, percentage: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="e.g., 3"
                  />
                  <span className="text-gray-500">%</span>
                </div>
              </div>
              <div className="flex items-end gap-2">
                <Button
                  variant="primary"
                  onClick={handleAddRule}
                  disabled={isSubmitting}
                  className="flex-1"
                >
                  {isSubmitting ? 'Adding...' : 'Add'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowAddForm(false)
                    setNewRule({ fromRoleId: '', toRoleId: '', percentage: '' })
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Existing Rules */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Current Tip-Out Rules</h3>

          {rules.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-lg font-medium mb-1">No tip-out rules configured</p>
              <p className="text-sm">Add a rule to automatically distribute tips between roles.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium text-gray-600">From Role</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-600"></th>
                    <th className="text-left py-3 px-2 font-medium text-gray-600">To Role</th>
                    <th className="text-right py-3 px-2 font-medium text-gray-600">Percentage</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-600">Status</th>
                    <th className="text-right py-3 px-2 font-medium text-gray-600">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(rule => (
                    <tr key={rule.id} className={`border-b ${!rule.isActive ? 'opacity-50' : ''}`}>
                      <td className="py-3 px-2">
                        <span className="font-medium">{rule.fromRole.name}</span>
                      </td>
                      <td className="py-3 px-2 text-center text-gray-400">
                        <svg className="w-5 h-5 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                      </td>
                      <td className="py-3 px-2">
                        <span className="font-medium">{rule.toRole.name}</span>
                      </td>
                      <td className="py-3 px-2 text-right">
                        {editingId === rule.id ? (
                          <div className="flex items-center justify-end gap-2">
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max="100"
                              value={editPercentage}
                              onChange={(e) => setEditPercentage(e.target.value)}
                              className="w-20 px-2 py-1 border rounded"
                              autoFocus
                            />
                            <span className="text-gray-500">%</span>
                            <button
                              onClick={() => handleUpdatePercentage(rule.id)}
                              className="text-green-600 hover:text-green-800"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="text-gray-500 hover:text-gray-700"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <span
                            className="cursor-pointer hover:text-blue-600"
                            onClick={() => startEdit(rule)}
                          >
                            {rule.percentage}%
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-2 text-center">
                        <button
                          onClick={() => handleToggleActive(rule)}
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            rule.isActive
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          {rule.isActive ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td className="py-3 px-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => startEdit(rule)}
                            className="text-blue-600 hover:text-blue-800"
                            title="Edit percentage"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDeleteRule(rule.id)}
                            className="text-red-600 hover:text-red-800"
                            title="Delete rule"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Example Calculation Card */}
        {rules.filter(r => r.isActive).length > 0 && (
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Example Calculation</h3>
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm text-gray-600 mb-3">
                If a <span className="font-medium">{rules.find(r => r.isActive)?.fromRole.name || 'Server'}</span> closes their shift with <span className="font-medium">$100.00</span> in tips:
              </p>
              <div className="space-y-2">
                {rules.filter(r => r.isActive && r.fromRole.name === (rules.find(r => r.isActive)?.fromRole.name)).map(rule => (
                  <div key={rule.id} className="flex justify-between text-sm">
                    <span>{rule.toRole.name} ({rule.percentage}%):</span>
                    <span className="font-medium">${(100 * rule.percentage / 100).toFixed(2)}</span>
                  </div>
                ))}
                <div className="border-t pt-2 flex justify-between text-sm font-medium">
                  <span>Net Tips:</span>
                  <span>
                    ${(100 - rules.filter(r => r.isActive && r.fromRole.name === (rules.find(r => r.isActive)?.fromRole.name))
                      .reduce((sum, r) => sum + r.percentage, 0)).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
