'use client'

import { useState, useEffect } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { toast } from '@/stores/toast-store'

interface ProgramData {
  id: string
  name: string
  isActive: boolean
  pointsPerDollar: number
  pointValueCents: number
  minimumRedeemPoints: number
  roundingMode: string
  excludedCategoryIds: string[]
  excludedItemTypes: string[]
}

const ROUNDING_MODES = [
  { value: 'floor', label: 'Floor (round down)' },
  { value: 'round', label: 'Round (nearest)' },
  { value: 'ceil', label: 'Ceiling (round up)' },
]

const ITEM_TYPES = [
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'retail', label: 'Retail' },
  { value: 'combos', label: 'Combos' },
]

export default function ProgramSettingsPage() {
  const { employee } = useRequireAuth()

  const [program, setProgram] = useState<ProgramData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    name: 'Loyalty Program',
    isActive: true,
    pointsPerDollar: 1,
    pointValueCents: 1,
    minimumRedeemPoints: 100,
    roundingMode: 'floor',
    excludedCategoryIds: [] as string[],
    excludedItemTypes: [] as string[],
  })

  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([])

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      // Load program
      const res = await fetch('/api/loyalty/programs')
      const json = await res.json()
      const programs = json.data || []
      if (programs.length > 0) {
        const p = programs[0]
        setProgram(p)
        setForm({
          name: p.name || 'Loyalty Program',
          isActive: p.isActive ?? true,
          pointsPerDollar: Number(p.pointsPerDollar) || 1,
          pointValueCents: Number(p.pointValueCents) || 1,
          minimumRedeemPoints: Number(p.minimumRedeemPoints) || 100,
          roundingMode: p.roundingMode || 'floor',
          excludedCategoryIds: Array.isArray(p.excludedCategoryIds) ? p.excludedCategoryIds : [],
          excludedItemTypes: Array.isArray(p.excludedItemTypes) ? p.excludedItemTypes : [],
        })
      }

      // Load categories for exclusion picker
      const catRes = await fetch('/api/categories')
      if (catRes.ok) {
        const catJson = await catRes.json()
        setCategories((catJson.data || catJson.categories || []).map((c: any) => ({ id: c.id, name: c.name })))
      }
    } catch (err) {
      console.error('Failed to load program:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (program) {
        // Update
        const res = await fetch(`/api/loyalty/programs/${program.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({ error: 'Failed' }))
          throw new Error(json.error)
        }
        const updated = await res.json()
        setProgram(updated.data)
        toast.success('Program settings saved')
      } else {
        // Create
        const res = await fetch('/api/loyalty/programs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        if (!res.ok) {
          const json = await res.json().catch(() => ({ error: 'Failed' }))
          throw new Error(json.error)
        }
        const created = await res.json()
        setProgram(created.data)
        toast.success('Loyalty program created')
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to save program')
    } finally {
      setSaving(false)
    }
  }

  const toggleExcludedCategory = (catId: string) => {
    setForm(prev => ({
      ...prev,
      excludedCategoryIds: prev.excludedCategoryIds.includes(catId)
        ? prev.excludedCategoryIds.filter(id => id !== catId)
        : [...prev.excludedCategoryIds, catId],
    }))
  }

  const toggleExcludedItemType = (type: string) => {
    setForm(prev => ({
      ...prev,
      excludedItemTypes: prev.excludedItemTypes.includes(type)
        ? prev.excludedItemTypes.filter(t => t !== type)
        : [...prev.excludedItemTypes, type],
    }))
  }

  if (loading) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <AdminPageHeader title="Program Settings" subtitle="Loading..." breadcrumbs={[{ label: 'Loyalty', href: '/loyalty' }]} />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <AdminPageHeader
        title="Program Settings"
        subtitle="Configure your loyalty program rules"
        breadcrumbs={[{ label: 'Loyalty', href: '/loyalty' }]}
        actions={
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : program ? 'Save Changes' : 'Create Program'}
          </button>
        }
      />

      {/* Active toggle */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => setForm(prev => ({ ...prev, isActive: e.target.checked }))}
            className="w-5 h-5 rounded border-gray-300 text-indigo-600"
          />
          <div>
            <span className="text-base font-semibold text-gray-900">Enable Loyalty Program</span>
            <p className="text-sm text-gray-500">When active, customers earn and redeem points on orders.</p>
          </div>
        </label>
      </div>

      {/* Program Name */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Program Name</h2>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
          className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="Loyalty Program"
        />
      </div>

      {/* Points Earning */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Points Earning</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Points per $1 spent</label>
            <input
              type="number"
              min={1}
              value={form.pointsPerDollar}
              onChange={(e) => setForm(prev => ({ ...prev, pointsPerDollar: Math.max(1, parseInt(e.target.value) || 1) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Rounding mode</label>
            <select
              value={form.roundingMode}
              onChange={(e) => setForm(prev => ({ ...prev, roundingMode: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {ROUNDING_MODES.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Points Redemption */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Points Redemption</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Point value (cents)</label>
            <input
              type="number"
              min={1}
              value={form.pointValueCents}
              onChange={(e) => setForm(prev => ({ ...prev, pointValueCents: Math.max(1, parseInt(e.target.value) || 1) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">1 point = ${(form.pointValueCents / 100).toFixed(2)}</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Minimum points to redeem</label>
            <input
              type="number"
              min={0}
              value={form.minimumRedeemPoints}
              onChange={(e) => setForm(prev => ({ ...prev, minimumRedeemPoints: Math.max(0, parseInt(e.target.value) || 0) }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
          </div>
        </div>
      </div>

      {/* Exclusions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Exclusions</h2>
        <p className="text-sm text-gray-500">Items in excluded categories or types will not earn points.</p>

        {/* Excluded item types */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-2">Excluded item types</label>
          <div className="flex flex-wrap gap-2">
            {ITEM_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => toggleExcludedItemType(t.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  form.excludedItemTypes.includes(t.value)
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {form.excludedItemTypes.includes(t.value) ? 'X ' : ''}{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Excluded categories */}
        {categories.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Excluded categories</label>
            <div className="flex flex-wrap gap-2">
              {categories.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleExcludedCategory(c.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    form.excludedCategoryIds.includes(c.id)
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {form.excludedCategoryIds.includes(c.id) ? 'X ' : ''}{c.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Preview */}
      {form.isActive && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="p-4 bg-indigo-50 rounded-xl">
            <h4 className="font-medium text-indigo-900 mb-2 text-sm">Preview</h4>
            <div className="text-sm text-indigo-700 space-y-1">
              <p>
                Customers earn <span className="font-bold">{form.pointsPerDollar} point{form.pointsPerDollar !== 1 ? 's' : ''}</span> per $1 spent.
              </p>
              <p>
                Each point is worth <span className="font-bold">${(form.pointValueCents / 100).toFixed(2)}</span>.
              </p>
              <p>
                Minimum <span className="font-bold">{form.minimumRedeemPoints} points</span> to redeem (= ${((form.minimumRedeemPoints * form.pointValueCents) / 100).toFixed(2)}).
              </p>
              {form.excludedItemTypes.length > 0 && (
                <p>Excluded types: {form.excludedItemTypes.join(', ')}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
