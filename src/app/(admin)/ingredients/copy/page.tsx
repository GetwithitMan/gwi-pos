'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

// ─── Types ─────────────────────────────────────────────────────────────

interface LocationOption {
  id: string
  name: string
}

interface IngredientRow {
  id: string
  name: string
  categoryName: string | null
  isActive: boolean
}

interface CopyResult {
  copied: number
  skipped: number
  recipesLinked: number
  failed: Array<{ name: string; reason: string }>
  sourceLocation: string
  targetLocation: string
}

// ─── Page ──────────────────────────────────────────────────────────────

export default function CopyIngredientsPage() {
  const employee = useAuthStore((s) => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/ingredients/copy' })

  const locationId = employee?.location?.id ?? null

  // State
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [sourceLocationId, setSourceLocationId] = useState<string>('')
  const [targetLocationId, setTargetLocationId] = useState<string>('')
  const [ingredients, setIngredients] = useState<IngredientRow[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [includeRecipes, setIncludeRecipes] = useState(true)
  const [skipExisting, setSkipExisting] = useState(true)
  const [loadingLocations, setLoadingLocations] = useState(false)
  const [loadingIngredients, setLoadingIngredients] = useState(false)
  const [copying, setCopying] = useState(false)
  const [result, setResult] = useState<CopyResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [search, setSearch] = useState('')

  // ── Fetch locations in the same organization ──────────────────────
  useEffect(() => {
    if (!locationId) return
    setLoadingLocations(true)
    fetch(`/api/locations?locationId=${locationId}`)
      .then((r) => r.json())
      .then((res) => {
        const raw = res.data?.locations || res.data || []
        const arr = Array.isArray(raw) ? raw : []
        const locs: LocationOption[] = arr.map(
          (l: { id: string; name: string }) => ({ id: l.id, name: l.name }),
        )
        setLocations(locs)
        // Default source to current location
        if (!sourceLocationId && locs.some((l) => l.id === locationId)) {
          setSourceLocationId(locationId)
        }
      })
      .catch(() => setError('Failed to load locations'))
      .finally(() => setLoadingLocations(false))
     
  }, [locationId])

  // ── Fetch ingredients from selected source ────────────────────────
  const loadIngredients = useCallback(() => {
    if (!sourceLocationId) {
      setIngredients([])
      return
    }
    setLoadingIngredients(true)
    setSelectedIds(new Set())
    setResult(null)
    setError(null)

    const params = new URLSearchParams({
      locationId: sourceLocationId,
      includeInactive: 'true',
    })
    if (employee?.id) {
      params.set('requestingEmployeeId', employee.id)
    }

    fetch(`/api/ingredients?${params}`)
      .then((r) => r.json())
      .then((res) => {
        const data: IngredientRow[] = (res.data || []).map(
          (i: { id: string; name: string; categoryRelation?: { name: string } | null; isActive: boolean }) => ({
            id: i.id,
            name: i.name,
            categoryName: i.categoryRelation?.name ?? null,
            isActive: i.isActive,
          }),
        )
        setIngredients(data)
      })
      .catch(() => setError('Failed to load ingredients'))
      .finally(() => setLoadingIngredients(false))
  }, [sourceLocationId, employee?.id])

  useEffect(() => {
    loadIngredients()
  }, [loadIngredients])

  // ── Helpers ───────────────────────────────────────────────────────
  const filteredIngredients = ingredients.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase()),
  )

  const allSelected =
    filteredIngredients.length > 0 &&
    filteredIngredients.every((i) => selectedIds.has(i.id))

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredIngredients.map((i) => i.id)))
    }
  }

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // ── Execute copy ──────────────────────────────────────────────────
  const executeCopy = async () => {
    setConfirmOpen(false)
    setCopying(true)
    setResult(null)
    setError(null)

    try {
      const res = await fetch('/api/inventory/copy-to-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceLocationId,
          targetLocationId,
          items: selectedIds.size > 0 ? [...selectedIds] : [],
          includeRecipes,
          skipExisting,
          requestingEmployeeId: employee?.id,
        }),
      })

      const json = await res.json()
      if (!res.ok) {
        setError(json.error || 'Copy failed')
        return
      }

      setResult(json.data)
    } catch {
      setError('Network error while copying')
    } finally {
      setCopying(false)
    }
  }

  const canCopy =
    sourceLocationId &&
    targetLocationId &&
    sourceLocationId !== targetLocationId &&
    ingredients.length > 0

  // ── Render ────────────────────────────────────────────────────────
  if (!hydrated || !employee?.location?.id) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto mt-6 space-y-4">
          <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
          <div className="h-64 bg-gray-200 rounded-lg animate-pulse" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Copy Ingredients to Location"
        subtitle="Copy ingredients and recipes between locations in your organization"
        breadcrumbs={[
          { label: 'Menu', href: '/menu' },
          { label: 'Ingredients', href: '/ingredients' },
        ]}
      />

      <div className="max-w-4xl mx-auto mt-6 space-y-6">
        {/* Location selectors */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Locations</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Source */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Source Location
              </label>
              <select
                value={sourceLocationId}
                onChange={(e) => setSourceLocationId(e.target.value)}
                disabled={loadingLocations}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              >
                <option value="">Select source...</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.id === locationId ? ' (current)' : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Target */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Target Location
              </label>
              <select
                value={targetLocationId}
                onChange={(e) => setTargetLocationId(e.target.value)}
                disabled={loadingLocations}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              >
                <option value="">Select target...</option>
                {locations
                  .filter((l) => l.id !== sourceLocationId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {l.id === locationId ? ' (current)' : ''}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          {sourceLocationId === targetLocationId && sourceLocationId && (
            <p className="mt-2 text-sm text-red-600">
              Source and target must be different locations.
            </p>
          )}
        </div>

        {/* Options */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Options</h2>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeRecipes}
                onChange={(e) => setIncludeRecipes(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-900">Include Recipes</span>
                <p className="text-xs text-gray-500">
                  Copy ingredient recipes and menu item ingredient links (matches by name)
                </p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={skipExisting}
                onChange={(e) => setSkipExisting(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <div>
                <span className="text-sm font-medium text-gray-900">Skip Existing</span>
                <p className="text-xs text-gray-500">
                  Do not overwrite ingredients that already exist at the target (matched by name)
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Ingredient list */}
        {sourceLocationId && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Ingredients
                {ingredients.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    ({selectedIds.size > 0 ? `${selectedIds.size} selected of ` : ''}
                    {ingredients.length} total)
                  </span>
                )}
              </h2>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 w-48"
                />
              </div>
            </div>

            {loadingIngredients ? (
              <div className="p-8 text-center text-gray-500">Loading ingredients...</div>
            ) : filteredIngredients.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                {ingredients.length === 0
                  ? 'No ingredients found at this location'
                  : 'No ingredients match your search'}
              </div>
            ) : (
              <div className="max-h-[400px] overflow-y-auto">
                {/* Select all header */}
                <div className="sticky top-0 bg-gray-50 border-b border-gray-200 px-4 py-2 flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
                    {allSelected ? 'Deselect All' : 'Select All'}
                  </span>
                </div>

                {filteredIngredients.map((ing) => (
                  <label
                    key={ing.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-0"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(ing.id)}
                      onChange={() => toggleOne(ing.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-900">{ing.name}</span>
                      {ing.categoryName && (
                        <span className="ml-2 text-xs text-gray-500">{ing.categoryName}</span>
                      )}
                    </div>
                    {!ing.isActive && (
                      <span className="text-xs px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">
                        Inactive
                      </span>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Result */}
        {result && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
            <h3 className="font-semibold text-green-900">Copy Complete</h3>
            <div className="text-sm text-green-800 space-y-1">
              <p>
                Copied <strong>{result.copied}</strong> ingredient{result.copied !== 1 ? 's' : ''}{' '}
                from {result.sourceLocation} to {result.targetLocation}
              </p>
              {result.skipped > 0 && (
                <p>
                  Skipped <strong>{result.skipped}</strong> (already exist at target)
                </p>
              )}
              {result.recipesLinked > 0 && (
                <p>
                  Linked <strong>{result.recipesLinked}</strong> recipe/menu item connection{result.recipesLinked !== 1 ? 's' : ''}
                </p>
              )}
              {result.failed.length > 0 && (
                <div className="mt-2">
                  <p className="font-medium text-red-700">
                    Failed ({result.failed.length}):
                  </p>
                  <ul className="list-disc list-inside text-red-600">
                    {result.failed.map((f, i) => (
                      <li key={i}>
                        {f.name}: {f.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Copy button */}
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="lg"
            disabled={!canCopy || copying}
            isLoading={copying}
            onClick={() => setConfirmOpen(true)}
          >
            {copying
              ? 'Copying...'
              : selectedIds.size > 0
                ? `Copy ${selectedIds.size} Ingredient${selectedIds.size !== 1 ? 's' : ''}`
                : `Copy All ${ingredients.length} Ingredients`}
          </Button>
        </div>
      </div>

      {/* Confirmation dialog */}
      <ConfirmDialog
        open={confirmOpen}
        title="Confirm Copy"
        description={`Copy ${
          selectedIds.size > 0 ? selectedIds.size : ingredients.length
        } ingredient${(selectedIds.size > 0 ? selectedIds.size : ingredients.length) !== 1 ? 's' : ''} from ${
          locations.find((l) => l.id === sourceLocationId)?.name ?? 'source'
        } to ${
          locations.find((l) => l.id === targetLocationId)?.name ?? 'target'
        }?${includeRecipes ? ' Recipes and menu item links will also be copied.' : ''}${
          skipExisting ? ' Existing ingredients at the target will be skipped.' : ' WARNING: This may create duplicate ingredients.'
        }`}
        confirmLabel="Copy"
        onConfirm={executeCopy}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}
