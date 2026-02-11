'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

const BASIS_TYPE_LABELS: Record<string, string> = {
  tips_earned: 'Tips Earned',
  food_sales: 'Food Sales',
  bar_sales: 'Bar Sales',
  total_sales: 'Total Sales',
  net_sales: 'Net Sales',
}

const BASIS_TYPE_COLORS: Record<string, string> = {
  tips_earned: 'bg-gray-100 text-gray-600',
  food_sales: 'bg-orange-100 text-orange-700',
  bar_sales: 'bg-blue-100 text-blue-700',
  total_sales: 'bg-purple-100 text-purple-700',
  net_sales: 'bg-green-100 text-green-700',
}

const BASIS_TYPE_EXAMPLE_AMOUNTS: Record<string, { label: string; amount: number }> = {
  tips_earned: { label: 'tips', amount: 100 },
  food_sales: { label: 'food sales', amount: 500 },
  bar_sales: { label: 'bar sales', amount: 300 },
  total_sales: { label: 'total sales', amount: 800 },
  net_sales: { label: 'net sales', amount: 750 },
}

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
  basisType: string
  maxPercentage: number | null
  effectiveDate: string | null
  expiresAt: string | null
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
    percentage: '',
    basisType: 'tips_earned',
    maxPercentage: '',
    effectiveDate: '',
    expiresAt: '',
  })
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPercentage, setEditPercentage] = useState('')
  const [editBasisType, setEditBasisType] = useState('tips_earned')
  const [editMaxPercentage, setEditMaxPercentage] = useState('')

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
      const body: Record<string, unknown> = {
        locationId,
        fromRoleId: newRule.fromRoleId,
        toRoleId: newRule.toRoleId,
        percentage,
        basisType: newRule.basisType,
      }
      if (newRule.maxPercentage !== '') {
        const maxPct = parseFloat(newRule.maxPercentage)
        if (!isNaN(maxPct) && maxPct > 0 && maxPct <= 100) {
          body.maxPercentage = maxPct
        }
      }
      if (newRule.effectiveDate) {
        body.effectiveDate = new Date(newRule.effectiveDate).toISOString()
      }
      if (newRule.expiresAt) {
        body.expiresAt = new Date(newRule.expiresAt).toISOString()
      }

      const response = await fetch('/api/tip-out-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (response.ok) {
        const data = await response.json()
        setRules([...rules, data.data])
        setNewRule({ fromRoleId: '', toRoleId: '', percentage: '', basisType: 'tips_earned', maxPercentage: '', effectiveDate: '', expiresAt: '' })
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

  const handleUpdateRule = async (ruleId: string) => {
    const percentage = parseFloat(editPercentage)
    if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
      setError('Percentage must be between 0 and 100')
      return
    }

    const body: Record<string, unknown> = {
      percentage,
      basisType: editBasisType,
    }
    if (editMaxPercentage !== '') {
      const maxPct = parseFloat(editMaxPercentage)
      if (!isNaN(maxPct) && maxPct > 0 && maxPct <= 100) {
        body.maxPercentage = maxPct
      } else {
        body.maxPercentage = null
      }
    } else {
      body.maxPercentage = null
    }

    try {
      const response = await fetch(`/api/tip-out-rules/${ruleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (response.ok) {
        const data = await response.json()
        setRules(rules.map(r => r.id === ruleId ? data.data : r))
        setEditingId(null)
        setEditPercentage('')
        setEditBasisType('tips_earned')
        setEditMaxPercentage('')
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
    setEditBasisType(rule.basisType || 'tips_earned')
    setEditMaxPercentage(rule.maxPercentage != null ? rule.maxPercentage.toString() : '')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditPercentage('')
    setEditBasisType('tips_earned')
    setEditMaxPercentage('')
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
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Tip-Out Rules"
        subtitle="Configure automatic tip-out percentages by role"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        actions={
          <Button variant="primary" onClick={() => setShowAddForm(true)}>
            Add Rule
          </Button>
        }
      />

      <div className="max-w-4xl mx-auto space-y-6">
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
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Basis Type
                </label>
                <select
                  value={newRule.basisType}
                  onChange={(e) => setNewRule({ ...newRule, basisType: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  {Object.entries(BASIS_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max % Cap <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    max="100"
                    value={newRule.maxPercentage}
                    onChange={(e) => setNewRule({ ...newRule, maxPercentage: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="e.g., 5"
                  />
                  <span className="text-gray-500">%</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">Caps tip-out at this % of tips earned</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Effective Date <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="date"
                  value={newRule.effectiveDate}
                  onChange={(e) => setNewRule({ ...newRule, effectiveDate: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expires At <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="date"
                  value={newRule.expiresAt}
                  onChange={(e) => setNewRule({ ...newRule, expiresAt: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
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
                    setNewRule({ fromRoleId: '', toRoleId: '', percentage: '', basisType: 'tips_earned', maxPercentage: '', effectiveDate: '', expiresAt: '' })
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
                    <th className="text-center py-3 px-2 font-medium text-gray-600">Basis</th>
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
                          <div className="space-y-2">
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
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <input
                                type="number"
                                step="0.5"
                                min="0"
                                max="100"
                                value={editMaxPercentage}
                                onChange={(e) => setEditMaxPercentage(e.target.value)}
                                className="w-20 px-2 py-1 border rounded text-xs"
                                placeholder="Cap %"
                              />
                            </div>
                          </div>
                        ) : (
                          <div>
                            <span
                              className="cursor-pointer hover:text-blue-600"
                              onClick={() => startEdit(rule)}
                            >
                              {rule.percentage}%
                            </span>
                            {rule.maxPercentage != null && (
                              <div className="text-xs text-gray-400 mt-0.5">Cap: {rule.maxPercentage}%</div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-2 text-center">
                        {editingId === rule.id ? (
                          <div className="space-y-2">
                            <select
                              value={editBasisType}
                              onChange={(e) => setEditBasisType(e.target.value)}
                              className="w-full px-2 py-1 border rounded text-xs"
                            >
                              {Object.entries(BASIS_TYPE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => handleUpdateRule(rule.id)}
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
                          </div>
                        ) : (
                          <div>
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${BASIS_TYPE_COLORS[(rule.basisType || 'tips_earned')]}`}>
                              {(rule.basisType || 'tips_earned') === 'tips_earned'
                                ? 'Tips'
                                : BASIS_TYPE_LABELS[(rule.basisType || 'tips_earned')] || rule.basisType}
                            </span>
                            {(rule.effectiveDate || rule.expiresAt) && (
                              <div className="text-xs text-gray-400 mt-1">
                                {rule.effectiveDate && new Date(rule.effectiveDate).toLocaleDateString()}
                                {rule.effectiveDate && rule.expiresAt && ' - '}
                                {!rule.effectiveDate && rule.expiresAt && 'Until '}
                                {rule.expiresAt && new Date(rule.expiresAt).toLocaleDateString()}
                              </div>
                            )}
                          </div>
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
                            title="Edit rule"
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
                If a <span className="font-medium">{rules.find(r => r.isActive)?.fromRole.name || 'Server'}</span> closes their shift with{' '}
                <span className="font-medium">$100.00</span> in tips, <span className="font-medium">$500</span> food sales,{' '}
                <span className="font-medium">$300</span> bar sales, <span className="font-medium">$800</span> total sales,{' '}
                <span className="font-medium">$750</span> net sales:
              </p>
              <div className="space-y-2">
                {rules.filter(r => r.isActive && r.fromRole.name === (rules.find(r => r.isActive)?.fromRole.name)).map(rule => {
                  const basis = rule.basisType || 'tips_earned'
                  const exampleInfo = BASIS_TYPE_EXAMPLE_AMOUNTS[basis] || BASIS_TYPE_EXAMPLE_AMOUNTS.tips_earned
                  const rawAmount = exampleInfo.amount * rule.percentage / 100
                  let cappedAmount = rawAmount
                  let isCapped = false
                  if (rule.maxPercentage != null && basis !== 'tips_earned') {
                    const capAmount = 100 * rule.maxPercentage / 100 // 100 = example tips
                    if (rawAmount > capAmount) {
                      cappedAmount = capAmount
                      isCapped = true
                    }
                  }
                  return (
                    <div key={rule.id} className="text-sm">
                      <div className="flex justify-between">
                        <span>
                          {rule.toRole.name} ({rule.percentage}% of ${exampleInfo.amount} {exampleInfo.label}):
                        </span>
                        <span className="font-medium">
                          ${cappedAmount.toFixed(2)}
                          {isCapped && <span className="text-orange-500 ml-1">(capped)</span>}
                        </span>
                      </div>
                      {isCapped && rule.maxPercentage != null && (
                        <div className="text-xs text-gray-400 text-right">
                          Raw: ${rawAmount.toFixed(2)}, capped at {rule.maxPercentage}% of tips = ${cappedAmount.toFixed(2)}
                        </div>
                      )}
                    </div>
                  )
                })}
                <div className="border-t pt-2 flex justify-between text-sm font-medium">
                  <span>Total Tip-Outs:</span>
                  <span>
                    ${rules.filter(r => r.isActive && r.fromRole.name === (rules.find(r => r.isActive)?.fromRole.name))
                      .reduce((sum, r) => {
                        const basis = r.basisType || 'tips_earned'
                        const exampleInfo = BASIS_TYPE_EXAMPLE_AMOUNTS[basis] || BASIS_TYPE_EXAMPLE_AMOUNTS.tips_earned
                        const rawAmount = exampleInfo.amount * r.percentage / 100
                        if (r.maxPercentage != null && basis !== 'tips_earned') {
                          const capAmount = 100 * r.maxPercentage / 100
                          return sum + Math.min(rawAmount, capAmount)
                        }
                        return sum + rawAmount
                      }, 0).toFixed(2)}
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
