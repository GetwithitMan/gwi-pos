'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import { SettingsSaveBar } from '@/components/admin/settings/SettingsSaveBar'
import { ToggleRow } from '@/components/admin/settings/ToggleRow'
import type { MarginEdgeSettings } from '@/lib/settings'
import { DEFAULT_MARGIN_EDGE_SETTINGS } from '@/lib/settings'
import { useAuthStore } from '@/stores/auth-store'

interface MEStatus {
  enabled: boolean
  hasApiKey: boolean
  configured: boolean
  environment: string
  lastSyncAt: string | null
  lastSyncStatus: string | null
  lastSyncError: string | null
  lastProductSyncAt: string | null
  lastInvoiceSyncAt: string | null
  productMappings: number
}

interface MEProductRow {
  id: string
  name: string
  category?: string
  vendorId?: string
  vendorName?: string
  unit?: string
}

interface SyncProductsResult {
  totalProducts: number
  mappedCount: number
  unmappedProducts: MEProductRow[]
}

interface InventoryItemOption {
  id: string
  name: string
  itemType: string
  unit?: string
}

interface SyncInvoicesResult {
  invoicesImported: number
  lineItemsProcessed: number
  costUpdates: number
  errors: string[]
}

export default function MarginEdgeIntegrationPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = useAuthStore(s => s.locationId)
  const [status, setStatus] = useState<MEStatus | null>(null)
  const [form, setForm] = useState<MarginEdgeSettings>(DEFAULT_MARGIN_EDGE_SETTINGS)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [replaceApiKey, setReplaceApiKey] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [syncingProducts, setSyncingProducts] = useState(false)
  const [syncingInvoices, setSyncingInvoices] = useState(false)
  const [unmappedProducts, setUnmappedProducts] = useState<MEProductRow[]>([])
  const [mappingSearch, setMappingSearch] = useState<Record<string, string>>({})
  const [mappingOptions, setMappingOptions] = useState<Record<string, InventoryItemOption[]>>({})
  const [mappingLoading, setMappingLoading] = useState<Record<string, boolean>>({})
  const [mappingSaving, setMappingSaving] = useState<Record<string, boolean>>({})
  const searchTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    async function load() {
      try {
        const [settingsData, statusRes] = await Promise.all([
          loadSettingsApi(),
          fetch('/api/integrations/marginedge/status').then(r => r.json()),
        ])
        const me = settingsData.settings?.marginEdge as (MarginEdgeSettings & { hasApiKey?: boolean }) | undefined
        if (me) {
          setForm({ ...DEFAULT_MARGIN_EDGE_SETTINGS, ...me, apiKey: '', syncOptions: { ...DEFAULT_MARGIN_EDGE_SETTINGS.syncOptions, ...me.syncOptions } })
          setHasApiKey(statusRes.data?.hasApiKey ?? Boolean(me.apiKey))
        }
        setStatus(statusRes.data ?? null)
      } catch {
        toast.error('Failed to load MarginEdge settings')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [])

  function update<K extends keyof MarginEdgeSettings>(key: K, value: MarginEdgeSettings[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  function updateSyncOption(key: keyof MarginEdgeSettings['syncOptions'], value: boolean | number) {
    setForm(prev => ({ ...prev, syncOptions: { ...prev.syncOptions, [key]: value } }))
    setIsDirty(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload: MarginEdgeSettings = { ...form }
      if (replaceApiKey.trim()) payload.apiKey = replaceApiKey.trim()

      await saveSettingsApi({ marginEdge: payload }, employee?.id)

      if (replaceApiKey.trim()) { setHasApiKey(true); setReplaceApiKey('') }
      setIsDirty(false)
      const res = await fetch('/api/integrations/marginedge/status').then(r => r.json())
      setStatus(res.data ?? null)
      toast.success('MarginEdge settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    try {
      const res = await fetch('/api/integrations/marginedge/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employee?.id }),
      })
      const data = await res.json()
      if (data.data?.success) {
        toast.success(data.data.message)
      } else {
        toast.error(data.data?.message ?? 'Connection test failed')
      }
    } catch {
      toast.error('Connection test failed')
    } finally {
      setTesting(false)
    }
  }

  async function handleSyncProducts() {
    setSyncingProducts(true)
    try {
      const res = await fetch('/api/integrations/marginedge/sync-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employee?.id }),
      })
      const data = await res.json()
      if (data.data) {
        const result = data.data as SyncProductsResult
        setUnmappedProducts(result.unmappedProducts)
        toast.success(`${result.totalProducts} products — ${result.mappedCount} mapped, ${result.unmappedProducts.length} unmapped`)
        const statusRes = await fetch('/api/integrations/marginedge/status').then(r => r.json())
        setStatus(statusRes.data ?? null)
      } else {
        toast.error(data.error || 'Product sync failed')
      }
    } catch {
      toast.error('Product sync failed')
    } finally {
      setSyncingProducts(false)
    }
  }

  function handleSearchInventory(meProductId: string, query: string) {
    setMappingSearch(prev => ({ ...prev, [meProductId]: query }))
    clearTimeout(searchTimers.current[meProductId])
    if (!query.trim()) {
      setMappingOptions(prev => ({ ...prev, [meProductId]: [] }))
      return
    }
    searchTimers.current[meProductId] = setTimeout(async () => {
      setMappingLoading(prev => ({ ...prev, [meProductId]: true }))
      try {
        const res = await fetch(`/api/inventory/items?locationId=${locationId}&search=${encodeURIComponent(query)}&limit=10`)
        const data = await res.json()
        setMappingOptions(prev => ({
          ...prev,
          [meProductId]: (data.items ?? []).map((it: { id: string; name: string; itemType: string; storageUnit?: string }) => ({
            id: it.id,
            name: it.name,
            itemType: it.itemType,
            unit: it.storageUnit,
          })),
        }))
      } catch {
        // ignore search errors
      } finally {
        setMappingLoading(prev => ({ ...prev, [meProductId]: false }))
      }
    }, 300)
  }

  async function handleMapProduct(meProduct: MEProductRow, inventoryItem: InventoryItemOption) {
    setMappingSaving(prev => ({ ...prev, [meProduct.id]: true }))
    try {
      const res = await fetch('/api/integrations/marginedge/map-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: employee?.id,
          marginEdgeProductId: meProduct.id,
          marginEdgeProductName: meProduct.name,
          inventoryItemId: inventoryItem.id,
          marginEdgeVendorId: meProduct.vendorId ?? null,
          marginEdgeVendorName: meProduct.vendorName ?? null,
          marginEdgeUnit: meProduct.unit ?? null,
        }),
      })
      if (res.ok) {
        toast.success(`Mapped "${meProduct.name}" → "${inventoryItem.name}"`)
        setUnmappedProducts(prev => prev.filter(p => p.id !== meProduct.id))
        setMappingSearch(prev => { const n = { ...prev }; delete n[meProduct.id]; return n })
        setMappingOptions(prev => { const n = { ...prev }; delete n[meProduct.id]; return n })
        const statusRes = await fetch('/api/integrations/marginedge/status').then(r => r.json())
        setStatus(statusRes.data ?? null)
      } else {
        const d = await res.json()
        toast.error(d.error || 'Mapping failed')
      }
    } catch {
      toast.error('Mapping failed')
    } finally {
      setMappingSaving(prev => ({ ...prev, [meProduct.id]: false }))
    }
  }

  async function handleSyncInvoices() {
    setSyncingInvoices(true)
    try {
      const res = await fetch('/api/integrations/marginedge/sync-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: employee?.id }),
      })
      const data = await res.json()
      if (data.data) {
        const result = data.data as SyncInvoicesResult
        toast.success(`Imported ${result.invoicesImported} invoices, ${result.lineItemsProcessed} line items, ${result.costUpdates} cost updates.`)
        const statusRes = await fetch('/api/integrations/marginedge/status').then(r => r.json())
        setStatus(statusRes.data ?? null)
      } else {
        toast.error(data.error || 'Invoice sync failed')
      }
    } catch {
      toast.error('Invoice sync failed')
    } finally {
      setSyncingInvoices(false)
    }
  }

  const configured = status?.configured ?? false

  return (
    <div className="p-6 max-w-4xl mx-auto pb-32">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">MarginEdge</h1>
          <p className="text-gray-500">
            Sync invoice and product data from MarginEdge to keep ingredient costs
            current automatically. One-way sync: MarginEdge to GWI POS.
          </p>
        </div>
        {!loading && (
          <span className={`flex-shrink-0 ml-4 px-3 py-1 rounded-full text-sm font-medium ${
            configured
              ? 'bg-green-100 text-green-800'
              : 'bg-yellow-100 text-yellow-800'
          }`}>
            {configured ? 'Connected' : 'Not Configured'}
          </span>
        )}
      </div>

      <div className="space-y-6">

        {/* Enable toggle + Connection status */}
        <Card>
          <CardHeader><CardTitle>Connection</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ToggleRow
              label="Enable MarginEdge Integration"
              description="Activate MarginEdge invoice and product sync. API key must be configured below."
              checked={form.enabled}
              onChange={v => update('enabled', v)}
            />

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="space-y-1">
                <span className="text-sm text-gray-600">Connection status</span>
                <div className={`text-sm font-medium ${configured ? 'text-green-700' : 'text-yellow-700'}`}>
                  {loading ? 'Checking...' : configured ? `Connected — ${(status?.environment ?? 'production').toUpperCase()}` : 'Not configured'}
                </div>
              </div>
              <Button
                onClick={handleTest}
                disabled={!hasApiKey || testing}
                variant="outline"
                size="sm"
                title={!hasApiKey ? 'Save your API key below first, then test the connection.' : 'Test live connection to MarginEdge'}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </Button>
            </div>
            {!hasApiKey && !loading && (
              <p className="text-xs text-gray-400">Enter your API key below and save before testing.</p>
            )}
          </CardContent>
        </Card>

        {/* API Credentials */}
        <Card>
          <CardHeader><CardTitle>API Credentials</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">API Key</label>
                {hasApiKey && (
                  <div className="flex items-center gap-1.5 text-xs text-green-700 mb-1.5">
                    <span>✓ Configured</span>
                  </div>
                )}
                <input
                  type="password"
                  value={replaceApiKey}
                  onChange={e => { setReplaceApiKey(e.target.value); setIsDirty(true) }}
                  placeholder={hasApiKey ? 'Enter new key to replace...' : 'Enter MarginEdge API key...'}
                  autoComplete="new-password"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Write-only — never displayed after saving</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Restaurant ID (Optional)</label>
                <input
                  type="text"
                  value={form.restaurantId || ''}
                  onChange={e => update('restaurantId', e.target.value || undefined)}
                  placeholder="MarginEdge restaurant ID"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Only needed if your account has multiple restaurants</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sync Options */}
        <Card>
          <CardHeader><CardTitle>Sync Options</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ToggleRow
              label="Sync Invoices"
              description="Import invoices from MarginEdge into GWI POS."
              checked={form.syncOptions.syncInvoices}
              onChange={v => updateSyncOption('syncInvoices', v)}
            />
            <ToggleRow
              label="Sync Products"
              description="Sync product catalog from MarginEdge for mapping to inventory items."
              checked={form.syncOptions.syncProducts}
              onChange={v => updateSyncOption('syncProducts', v)}
            />
            <ToggleRow
              label="Auto-Update Costs"
              description="Automatically update inventory item costs when new invoices arrive."
              checked={form.syncOptions.autoUpdateCosts}
              onChange={v => updateSyncOption('autoUpdateCosts', v)}
            />
            <div className="pt-2 border-t">
              <label className="block text-sm font-medium text-gray-700 mb-1">Cost Change Alert Threshold</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={form.syncOptions.costChangeAlertThreshold}
                  onChange={e => updateSyncOption('costChangeAlertThreshold', Number(e.target.value) || 5)}
                  className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-500">%</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">Only update costs when the change exceeds this percentage.</p>
            </div>
          </CardContent>
        </Card>

        {/* Manual Sync */}
        <Card>
          <CardHeader><CardTitle>Manual Sync</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">Sync Products</div>
                <p className="text-xs text-gray-500">
                  Fetch product catalog from MarginEdge.
                  {status?.productMappings != null && ` ${status.productMappings} products currently mapped.`}
                </p>
              </div>
              <Button
                onClick={handleSyncProducts}
                disabled={!configured || syncingProducts}
                variant="outline"
                size="sm"
              >
                {syncingProducts ? 'Syncing...' : 'Sync Products'}
              </Button>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <div>
                <div className="text-sm font-medium text-gray-700">Sync Invoices</div>
                <p className="text-xs text-gray-500">
                  Import invoices from the last 30 days.
                  {status?.lastInvoiceSyncAt && ` Last sync: ${new Date(status.lastInvoiceSyncAt).toLocaleDateString()}`}
                </p>
              </div>
              <Button
                onClick={handleSyncInvoices}
                disabled={!configured || syncingInvoices}
                variant="outline"
                size="sm"
              >
                {syncingInvoices ? 'Syncing...' : 'Sync Invoices'}
              </Button>
            </div>

            {status?.lastSyncAt && (
              <div className="pt-2 border-t text-xs text-gray-500">
                Last sync: {new Date(status.lastSyncAt).toLocaleString()}
                {status.lastSyncStatus && (
                  <span className={status.lastSyncStatus === 'success' ? ' text-green-600' : ' text-red-600'}>
                    {' — '}{status.lastSyncStatus}
                  </span>
                )}
                {status.lastSyncError && (
                  <div className="text-red-500 mt-1">{status.lastSyncError}</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Product Mapping */}
        {unmappedProducts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Product Mapping ({unmappedProducts.length} unmapped)</CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                Link MarginEdge products to GWI inventory items so invoice costs update automatically.
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                {unmappedProducts.map(p => (
                  <div key={p.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{p.name}</div>
                      <div className="text-xs text-gray-400">
                        {[p.category, p.vendorName, p.unit].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="flex-1 relative">
                      <input
                        type="text"
                        value={mappingSearch[p.id] ?? ''}
                        onChange={e => handleSearchInventory(p.id, e.target.value)}
                        placeholder="Search inventory items..."
                        className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      {mappingLoading[p.id] && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">...</div>
                      )}
                      {(mappingOptions[p.id] ?? []).length > 0 && (
                        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {(mappingOptions[p.id] ?? []).map(item => (
                            <button
                              key={item.id}
                              onClick={() => handleMapProduct(p, item)}
                              disabled={mappingSaving[p.id]}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center justify-between"
                            >
                              <span className="font-medium truncate">{item.name}</span>
                              <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{item.itemType}{item.unit ? ` · ${item.unit}` : ''}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {mappingSaving[p.id] && (
                      <span className="text-xs text-blue-600 flex-shrink-0">Saving...</span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Info box */}
        <Card>
          <CardContent className="pt-6">
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
              MarginEdge data flows one way — invoice and product data from MarginEdge syncs
              into GWI POS to keep your ingredient costs current automatically. Invoices sync
              nightly at 8:00 AM UTC for locations with the integration enabled.
            </div>
          </CardContent>
        </Card>

      </div>

      <SettingsSaveBar
        isDirty={isDirty}
        onSave={handleSave}
        isSaving={saving}
      />
    </div>
  )
}
