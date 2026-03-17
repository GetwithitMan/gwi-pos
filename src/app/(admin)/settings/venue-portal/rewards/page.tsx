'use client'

import { useState, useEffect, useCallback, FormEvent } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useRequireAuth } from '@/hooks/useRequireAuth'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Reward {
  id: string
  name: string
  description: string
  pointCost: number
  rewardType: string
  rewardValue: string
  maxRedemptionsPerCustomer: number
  totalAvailable: number
  totalRedeemed: number
  startsAt: string | null
  expiresAt: string | null
  isActive: boolean
  sortOrder: number
}

interface RewardFormData {
  name: string
  description: string
  pointCost: number
  rewardType: string
  rewardValue: string
  maxRedemptionsPerCustomer: number
  totalAvailable: number
  startsAt: string
  expiresAt: string
  isActive: boolean
}

const EMPTY_FORM: RewardFormData = {
  name: '',
  description: '',
  pointCost: 100,
  rewardType: 'discount_percent',
  rewardValue: '',
  maxRedemptionsPerCustomer: 0,
  totalAvailable: 0,
  startsAt: '',
  expiresAt: '',
  isActive: true,
}

const REWARD_TYPES = [
  { value: 'discount_percent', label: 'Percentage Discount' },
  { value: 'discount_fixed', label: 'Fixed Dollar Discount' },
  { value: 'free_item', label: 'Free Item' },
  { value: 'bonus_points', label: 'Bonus Points' },
  { value: 'custom', label: 'Custom Reward' },
]

// ─── Component ──────────────────────────────────────────────────────────────

export default function RewardsCatalogPage() {
  const { employee } = useRequireAuth()

  const [rewards, setRewards] = useState<Reward[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<RewardFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  // ─── Fetch rewards ────────────────────────────────────────────────────────

  const fetchRewards = useCallback(async () => {
    try {
      const res = await fetch('/api/loyalty/rewards')
      if (!res.ok) throw new Error('Failed to load rewards')
      const json = await res.json()
      setRewards(json.rewards ?? json.data ?? [])
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRewards()
  }, [fetchRewards])

  // ─── Open modal ───────────────────────────────────────────────────────────

  const openAdd = () => {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setShowModal(true)
  }

  const openEdit = (reward: Reward) => {
    setForm({
      name: reward.name,
      description: reward.description || '',
      pointCost: reward.pointCost,
      rewardType: reward.rewardType,
      rewardValue: reward.rewardValue || '',
      maxRedemptionsPerCustomer: reward.maxRedemptionsPerCustomer || 0,
      totalAvailable: reward.totalAvailable || 0,
      startsAt: reward.startsAt ? reward.startsAt.slice(0, 10) : '',
      expiresAt: reward.expiresAt ? reward.expiresAt.slice(0, 10) : '',
      isActive: reward.isActive,
    })
    setEditingId(reward.id)
    setShowModal(true)
  }

  // ─── Save reward ──────────────────────────────────────────────────────────

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    if (form.pointCost < 1) {
      toast.error('Point cost must be at least 1')
      return
    }

    setSaving(true)
    try {
      const payload = {
        ...form,
        startsAt: form.startsAt || null,
        expiresAt: form.expiresAt || null,
      }

      if (editingId) {
        // Update
        const res = await fetch(`/api/loyalty/rewards/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({ error: 'Failed to update reward' }))
          throw new Error(json.error || 'Failed to update reward')
        }
        toast.success('Reward updated')
      } else {
        // Create
        const res = await fetch('/api/loyalty/rewards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({ error: 'Failed to create reward' }))
          throw new Error(json.error || 'Failed to create reward')
        }
        toast.success('Reward created')
      }

      setShowModal(false)
      await fetchRewards()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  // ─── Toggle active ────────────────────────────────────────────────────────

  const handleToggleActive = async (reward: Reward) => {
    try {
      const res = await fetch(`/api/loyalty/rewards/${reward.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !reward.isActive }),
      })
      if (!res.ok) throw new Error('Failed to update reward')
      setRewards(prev =>
        prev.map(r => (r.id === reward.id ? { ...r, isActive: !r.isActive } : r)),
      )
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  // ─── Delete reward ────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this reward? This cannot be undone.')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/loyalty/rewards/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete reward')
      toast.success('Reward deleted')
      await fetchRewards()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDeleting(null)
    }
  }

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Loyalty Rewards Catalog"
          subtitle="Loading..."
          breadcrumbs={[
            { label: 'Settings', href: '/settings' },
            { label: 'Customer Portal', href: '/settings/venue-portal' },
          ]}
        />
      </div>
    )
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <AdminPageHeader
        title="Loyalty Rewards Catalog"
        subtitle="Create and manage rewards customers can redeem with loyalty points"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Customer Portal', href: '/settings/venue-portal' },
        ]}
      />

      {/* Actions */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">{rewards.length} reward{rewards.length !== 1 ? 's' : ''}</p>
        <button
          type="button"
          onClick={openAdd}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
        >
          + Add Reward
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Table */}
      {rewards.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-600">
          No rewards created yet. Click &quot;Add Reward&quot; to get started.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Point Cost</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-700">Type</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-700">Redeemed</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-700">Active</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rewards.map((reward) => (
                  <tr key={reward.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{reward.name}</p>
                      {reward.description && (
                        <p className="text-xs text-gray-500 truncate max-w-xs">{reward.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-900 font-mono">
                      {reward.pointCost.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-600 capitalize">
                      {reward.rewardType.replace(/_/g, ' ')}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {reward.totalRedeemed}
                      {reward.totalAvailable > 0 && (
                        <span className="text-gray-400"> / {reward.totalAvailable}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleToggleActive(reward)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          reward.isActive ? 'bg-indigo-600' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                            reward.isActive ? 'translate-x-4' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(reward)}
                        className="text-indigo-600 hover:text-indigo-800 text-sm font-medium mr-3"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(reward.id)}
                        disabled={deleting === reward.id}
                        className="text-red-600 hover:text-red-800 text-sm font-medium disabled:opacity-50"
                      >
                        {deleting === reward.id ? '...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {editingId ? 'Edit Reward' : 'Add Reward'}
            </h3>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label htmlFor="reward-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  id="reward-name"
                  type="text"
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  required
                />
              </div>

              <div>
                <label htmlFor="reward-desc" className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  id="reward-desc"
                  value={form.description}
                  onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-vertical"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="reward-points" className="block text-sm font-medium text-gray-700 mb-1">
                    Point Cost *
                  </label>
                  <input
                    id="reward-points"
                    type="number"
                    value={form.pointCost}
                    onChange={e => setForm(prev => ({ ...prev, pointCost: Math.max(1, parseInt(e.target.value) || 1) }))}
                    min={1}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label htmlFor="reward-type" className="block text-sm font-medium text-gray-700 mb-1">
                    Reward Type
                  </label>
                  <select
                    id="reward-type"
                    value={form.rewardType}
                    onChange={e => setForm(prev => ({ ...prev, rewardType: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    {REWARD_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="reward-value" className="block text-sm font-medium text-gray-700 mb-1">
                  Reward Value
                </label>
                <input
                  id="reward-value"
                  type="text"
                  value={form.rewardValue}
                  onChange={e => setForm(prev => ({ ...prev, rewardValue: e.target.value }))}
                  placeholder={
                    form.rewardType === 'discount_percent'
                      ? 'e.g., 10 (for 10% off)'
                      : form.rewardType === 'discount_fixed'
                        ? 'e.g., 5.00 (for $5 off)'
                        : form.rewardType === 'free_item'
                          ? 'Item name or category'
                          : form.rewardType === 'bonus_points'
                            ? 'e.g., 50 (bonus points)'
                            : 'Describe the reward'
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="reward-max-per" className="block text-sm font-medium text-gray-700 mb-1">
                    Max Redemptions / Customer
                  </label>
                  <input
                    id="reward-max-per"
                    type="number"
                    value={form.maxRedemptionsPerCustomer}
                    onChange={e => setForm(prev => ({ ...prev, maxRedemptionsPerCustomer: Math.max(0, parseInt(e.target.value) || 0) }))}
                    min={0}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <p className="text-xs text-gray-500 mt-0.5">0 = unlimited</p>
                </div>

                <div>
                  <label htmlFor="reward-total" className="block text-sm font-medium text-gray-700 mb-1">
                    Total Available
                  </label>
                  <input
                    id="reward-total"
                    type="number"
                    value={form.totalAvailable}
                    onChange={e => setForm(prev => ({ ...prev, totalAvailable: Math.max(0, parseInt(e.target.value) || 0) }))}
                    min={0}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <p className="text-xs text-gray-500 mt-0.5">0 = unlimited</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="reward-starts" className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date
                  </label>
                  <input
                    id="reward-starts"
                    type="date"
                    value={form.startsAt}
                    onChange={e => setForm(prev => ({ ...prev, startsAt: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label htmlFor="reward-expires" className="block text-sm font-medium text-gray-700 mb-1">
                    End Date
                  </label>
                  <input
                    id="reward-expires"
                    type="date"
                    value={form.expiresAt}
                    onChange={e => setForm(prev => ({ ...prev, expiresAt: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 py-2">
                <input
                  id="reward-active"
                  type="checkbox"
                  checked={form.isActive}
                  onChange={e => setForm(prev => ({ ...prev, isActive: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                />
                <label htmlFor="reward-active" className="text-sm text-gray-700">Active</label>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 rounded-lg bg-gray-100 text-gray-700 font-medium text-sm hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-lg bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingId ? 'Update Reward' : 'Create Reward'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
