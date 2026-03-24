'use client'

import { useState, useEffect, useCallback, FormEvent } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { toast } from '@/stores/toast-store'

interface Tier {
  id: string
  programId: string
  name: string
  minimumPoints: number
  pointsMultiplier: number
  perks: {
    freeItems?: string[]
    discountPercent?: number
    birthdayReward?: boolean
  }
  color: string
  sortOrder: number
  customerCount: number
}

interface TierForm {
  name: string
  minimumPoints: number
  pointsMultiplier: number
  color: string
  sortOrder: number
  discountPercent: number
  birthdayReward: boolean
}

const EMPTY_FORM: TierForm = {
  name: '',
  minimumPoints: 0,
  pointsMultiplier: 1.0,
  color: '#6366f1',
  sortOrder: 0,
  discountPercent: 0,
  birthdayReward: false,
}

const TIER_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#ef4444', // Red
  '#ec4899', // Pink
  '#0ea5e9', // Sky
  '#64748b', // Slate
]

export default function TiersPage() {
  const { employee } = useRequireAuth()
  const [tiers, setTiers] = useState<Tier[]>([])
  const [programId, setProgramId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<TierForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const fetchTiers = useCallback(async () => {
    try {
      // Get program first
      const progRes = await fetch('/api/loyalty/programs')
      const progJson = await progRes.json()
      const programs = progJson.data || []
      if (programs.length > 0) {
        setProgramId(programs[0].id)
      }

      const res = await fetch('/api/loyalty/tiers')
      if (res.ok) {
        const json = await res.json()
        setTiers(
          (json.data || []).map((t: any) => ({
            ...t,
            minimumPoints: Number(t.minimumPoints),
            pointsMultiplier: Number(t.pointsMultiplier),
            sortOrder: Number(t.sortOrder),
            customerCount: Number(t.customerCount ?? 0),
            perks: typeof t.perks === 'string' ? JSON.parse(t.perks) : (t.perks || {}),
          })),
        )
      }
    } catch (err) {
      console.error('Failed to load tiers:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTiers()
  }, [fetchTiers])

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, sortOrder: tiers.length })
    setEditingId(null)
    setShowModal(true)
  }

  const openEdit = (tier: Tier) => {
    setForm({
      name: tier.name,
      minimumPoints: tier.minimumPoints,
      pointsMultiplier: tier.pointsMultiplier,
      color: tier.color,
      sortOrder: tier.sortOrder,
      discountPercent: tier.perks?.discountPercent ?? 0,
      birthdayReward: tier.perks?.birthdayReward ?? false,
    })
    setEditingId(tier.id)
    setShowModal(true)
  }

  const handleSave = async (e: FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!programId) {
      toast.error('Create a loyalty program first')
      return
    }

    setSaving(true)
    try {
      const payload = {
        programId,
        name: form.name.trim(),
        minimumPoints: form.minimumPoints,
        pointsMultiplier: form.pointsMultiplier,
        color: form.color,
        sortOrder: form.sortOrder,
        perks: {
          discountPercent: form.discountPercent,
          birthdayReward: form.birthdayReward,
          freeItems: [],
        },
      }

      if (editingId) {
        const res = await fetch(`/api/loyalty/tiers/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed')
        toast.success('Tier updated')
      } else {
        const res = await fetch('/api/loyalty/tiers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed')
        toast.success('Tier created')
      }

      setShowModal(false)
      await fetchTiers()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this tier? Customers will be unlinked from it.')) return
    try {
      const res = await fetch(`/api/loyalty/tiers/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      toast.success('Tier deleted')
      await fetchTiers()
    } catch (err: any) {
      toast.error(err.message)
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <AdminPageHeader title="Loyalty Tiers" subtitle="Loading..." breadcrumbs={[{ label: 'Loyalty', href: '/loyalty' }]} />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <AdminPageHeader
        title="Loyalty Tiers"
        subtitle="Reward your best customers with tier-based perks and multipliers"
        breadcrumbs={[{ label: 'Loyalty', href: '/loyalty' }]}
        actions={
          <button
            onClick={openAdd}
            disabled={!programId}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            + Add Tier
          </button>
        }
      />

      {!programId && (
        <div className="bg-amber-50 text-amber-800 rounded-lg px-4 py-3 text-sm">
          Create a loyalty program first before adding tiers.
        </div>
      )}

      {tiers.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No tiers created yet. Add tiers to give customers escalating rewards.
        </div>
      ) : (
        <div className="space-y-3">
          {tiers.map((tier) => (
            <div key={tier.id} className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
              {/* Color badge */}
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ backgroundColor: tier.color }}
              >
                {tier.sortOrder + 1}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900">{tier.name}</p>
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white"
                    style={{ backgroundColor: tier.color }}
                  >
                    {tier.pointsMultiplier}x
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-0.5">
                  {tier.minimumPoints.toLocaleString()} lifetime points to reach
                  {tier.perks?.discountPercent ? ` | ${tier.perks.discountPercent}% discount` : ''}
                  {tier.perks?.birthdayReward ? ' | Birthday reward' : ''}
                </p>
              </div>

              {/* Customer count */}
              <div className="text-right shrink-0">
                <p className="text-sm font-mono font-medium text-gray-900">{tier.customerCount}</p>
                <p className="text-xs text-gray-500">customers</p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => openEdit(tier)}
                  className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(tier.id)}
                  className="text-red-600 hover:text-red-800 text-sm font-medium"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {editingId ? 'Edit Tier' : 'Add Tier'}
            </h3>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tier Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="e.g., Silver, Gold, Platinum"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Minimum Lifetime Points</label>
                  <input
                    type="number"
                    min={0}
                    value={form.minimumPoints}
                    onChange={(e) => setForm(prev => ({ ...prev, minimumPoints: Math.max(0, parseInt(e.target.value) || 0) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Points Multiplier</label>
                  <input
                    type="number"
                    min={1}
                    step={0.1}
                    value={form.pointsMultiplier}
                    onChange={(e) => setForm(prev => ({ ...prev, pointsMultiplier: Math.max(1, parseFloat(e.target.value) || 1) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-0.5">{form.pointsMultiplier}x points earned</p>
                </div>
              </div>

              {/* Color picker */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Badge Color</label>
                <div className="flex gap-2 flex-wrap">
                  {TIER_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm(prev => ({ ...prev, color: c }))}
                      className={`w-8 h-8 rounded-full transition-all ${form.color === c ? 'ring-2 ring-offset-2 ring-indigo-500 scale-110' : 'hover:scale-105'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Perks */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-700">Perks</h4>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Discount Percent</label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={form.discountPercent}
                    onChange={(e) => setForm(prev => ({ ...prev, discountPercent: Math.min(50, Math.max(0, parseInt(e.target.value) || 0)) }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  />
                  <p className="text-xs text-gray-500 mt-0.5">Automatic discount for this tier (0 = none)</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.birthdayReward}
                    onChange={(e) => setForm(prev => ({ ...prev, birthdayReward: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-600"
                  />
                  <span className="text-sm text-gray-700">Birthday reward</span>
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Sort Order</label>
                <input
                  type="number"
                  min={0}
                  value={form.sortOrder}
                  onChange={(e) => setForm(prev => ({ ...prev, sortOrder: parseInt(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
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
                  {saving ? 'Saving...' : editingId ? 'Update Tier' : 'Create Tier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
