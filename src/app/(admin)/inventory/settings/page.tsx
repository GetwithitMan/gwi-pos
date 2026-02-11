'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface InventorySettings {
  locationId: string
  defaultCountFrequency: string
  countReminderDay: number | null
  countReminderTime: string | null
  requireManagerReview: boolean
  varianceAlertPct: number
  costChangeAlertPct: number
  defaultPourSizeOz: number
  targetFoodCostPct: number | null
  targetLiquorCostPct: number | null
  multiplierLite: number
  multiplierExtra: number
  multiplierTriple: number
  exportEnabled: boolean
  exportTarget: string | null
  exportApiKey: string | null
}

const COUNT_FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
]

const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

export default function InventorySettingsPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [settings, setSettings] = useState<InventorySettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/inventory/settings')
      return
    }
    loadSettings()
  }, [isAuthenticated, router])

  const loadSettings = async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)

    try {
      const res = await fetch(`/api/inventory/settings?locationId=${employee.location.id}`)
      if (res.ok) {
        const data = await res.json()
        setSettings(data.settings)
      } else {
        toast.error('Failed to load settings')
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
      toast.error('Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }

  const updateSetting = <K extends keyof InventorySettings>(key: K, value: InventorySettings[K]) => {
    if (!settings) return
    setSettings({ ...settings, [key]: value })
    setHasChanges(true)
  }

  const handleSave = async () => {
    if (!settings || !employee?.location?.id) return

    setIsSaving(true)
    try {
      const res = await fetch('/api/inventory/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      if (res.ok) {
        toast.success('Settings saved')
        setHasChanges(false)
      } else {
        toast.error('Failed to save settings')
      }
    } catch (error) {
      console.error('Failed to save settings:', error)
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Inventory Settings"
        subtitle="Configure inventory tracking and alerts"
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }]}
        actions={
          <Button onClick={handleSave} disabled={!hasChanges || isSaving}>
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        }
      />

      <div className="max-w-4xl">

      {isLoading ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">
            Loading settings...
          </CardContent>
        </Card>
      ) : settings ? (
        <div className="space-y-6">
          {/* Modifier Multipliers */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Modifier Instruction Multipliers</CardTitle>
              <p className="text-sm text-gray-500">
                Adjust how modifier instructions affect ingredient usage
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    &quot;Lite&quot; / &quot;Light&quot; / &quot;Easy&quot;
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="1"
                      value={settings.multiplierLite}
                      onChange={(e) => updateSetting('multiplierLite', parseFloat(e.target.value) || 0.5)}
                      className="w-24 border rounded px-3 py-2"
                    />
                    <span className="text-sm text-gray-500">
                      ({Math.round(settings.multiplierLite * 100)}%)
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Default: 0.5 (50%)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    &quot;Extra&quot; / &quot;Double&quot;
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      max="5"
                      value={settings.multiplierExtra}
                      onChange={(e) => updateSetting('multiplierExtra', parseFloat(e.target.value) || 2.0)}
                      className="w-24 border rounded px-3 py-2"
                    />
                    <span className="text-sm text-gray-500">
                      ({Math.round(settings.multiplierExtra * 100)}%)
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Default: 2.0 (200%)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    &quot;Triple&quot; / &quot;3x&quot;
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      max="5"
                      value={settings.multiplierTriple}
                      onChange={(e) => updateSetting('multiplierTriple', parseFloat(e.target.value) || 3.0)}
                      className="w-24 border rounded px-3 py-2"
                    />
                    <span className="text-sm text-gray-500">
                      ({Math.round(settings.multiplierTriple * 100)}%)
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Default: 3.0 (300%)
                  </p>
                </div>
              </div>

              <div className="p-3 bg-blue-50 rounded text-sm text-blue-700">
                <strong>How it works:</strong> When a customer orders &quot;Extra Cheese&quot; on a burger,
                the system deducts {settings.multiplierExtra}x the normal cheese amount from inventory.
                &quot;No&quot; / &quot;Hold&quot; instructions skip deduction entirely.
              </div>
            </CardContent>
          </Card>

          {/* Alerts & Thresholds */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Alerts & Thresholds</CardTitle>
              <p className="text-sm text-gray-500">
                Set triggers for inventory alerts
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Variance Alert Threshold
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      value={settings.varianceAlertPct}
                      onChange={(e) => updateSetting('varianceAlertPct', parseFloat(e.target.value) || 5)}
                      className="w-24 border rounded px-3 py-2"
                    />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Alert when count variance exceeds this percentage
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cost Change Alert Threshold
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      value={settings.costChangeAlertPct}
                      onChange={(e) => updateSetting('costChangeAlertPct', parseFloat(e.target.value) || 10)}
                      className="w-24 border rounded px-3 py-2"
                    />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Alert when item cost changes by this percentage
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Target Food Cost %
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      value={settings.targetFoodCostPct || ''}
                      onChange={(e) => updateSetting('targetFoodCostPct', e.target.value ? parseFloat(e.target.value) : null)}
                      className="w-24 border rounded px-3 py-2"
                      placeholder="--"
                    />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Target food cost percentage (typically 28-35%)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Target Liquor Cost %
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      value={settings.targetLiquorCostPct || ''}
                      onChange={(e) => updateSetting('targetLiquorCostPct', e.target.value ? parseFloat(e.target.value) : null)}
                      className="w-24 border rounded px-3 py-2"
                      placeholder="--"
                    />
                    <span className="text-sm text-gray-500">%</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Target liquor cost percentage (typically 18-24%)
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Count Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Inventory Count Settings</CardTitle>
              <p className="text-sm text-gray-500">
                Configure count frequency and approval requirements
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Default Count Frequency
                  </label>
                  <select
                    value={settings.defaultCountFrequency}
                    onChange={(e) => updateSetting('defaultCountFrequency', e.target.value)}
                    className="w-full border rounded px-3 py-2"
                  >
                    {COUNT_FREQUENCIES.map(f => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Count Reminder Day
                  </label>
                  <select
                    value={settings.countReminderDay ?? ''}
                    onChange={(e) => updateSetting('countReminderDay', e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value="">No reminder</option>
                    {DAYS_OF_WEEK.map(d => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="requireManagerReview"
                  checked={settings.requireManagerReview}
                  onChange={(e) => updateSetting('requireManagerReview', e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="requireManagerReview" className="text-sm text-gray-700">
                  Require manager review before applying count adjustments
                </label>
              </div>
            </CardContent>
          </Card>

          {/* Liquor Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Liquor Inventory Settings</CardTitle>
              <p className="text-sm text-gray-500">
                Configure default pour sizes for spirits
              </p>
            </CardHeader>
            <CardContent>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Default Pour Size
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.25"
                    min="0.5"
                    max="3"
                    value={settings.defaultPourSizeOz}
                    onChange={(e) => updateSetting('defaultPourSizeOz', parseFloat(e.target.value) || 1.5)}
                    className="w-24 border rounded px-3 py-2"
                  />
                  <span className="text-sm text-gray-500">oz</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Standard pour size for spirits (typically 1.5 oz)
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Export Settings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Data Export</CardTitle>
              <p className="text-sm text-gray-500">
                Configure inventory data export (for accounting systems)
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="exportEnabled"
                  checked={settings.exportEnabled}
                  onChange={(e) => updateSetting('exportEnabled', e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="exportEnabled" className="text-sm text-gray-700">
                  Enable automated data export
                </label>
              </div>

              {settings.exportEnabled && (
                <div className="grid grid-cols-2 gap-4 pl-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Export Target
                    </label>
                    <input
                      type="text"
                      value={settings.exportTarget || ''}
                      onChange={(e) => updateSetting('exportTarget', e.target.value || null)}
                      className="w-full border rounded px-3 py-2"
                      placeholder="API endpoint or system name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      API Key
                    </label>
                    <input
                      type="password"
                      value={settings.exportApiKey || ''}
                      onChange={(e) => updateSetting('exportApiKey', e.target.value || null)}
                      className="w-full border rounded px-3 py-2"
                      placeholder="API key for authentication"
                    />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
      </div>
    </div>
  )
}
