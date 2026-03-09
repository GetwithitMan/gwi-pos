'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LocationSettings, DEFAULT_SETTINGS } from '@/lib/settings'
import { toast } from '@/stores/toast-store'
import { useAuthStore } from '@/stores/auth-store'

export default function LoyaltySettingsPage() {
  const employeeId = useAuthStore(s => s.employee?.id)
  const [settings, setSettings] = useState<LocationSettings>(DEFAULT_SETTINGS)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const data = await response.json()
        const fetched = data.data.settings || {}
        setSettings({
          ...DEFAULT_SETTINGS,
          ...fetched,
          loyalty: { ...DEFAULT_SETTINGS.loyalty, ...(fetched.loyalty || {}) },
        })
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const saveSettings = async () => {
    setIsSaving(true)
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings, employeeId }),
      })
      if (response.ok) {
        toast.success('Loyalty settings saved')
      } else {
        toast.error('Failed to save settings')
      }
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updateLoyalty = (updates: Partial<LocationSettings['loyalty']>) => {
    setSettings(prev => ({
      ...prev,
      loyalty: { ...prev.loyalty, ...updates },
    }))
  }

  if (isLoading) {
    return <div className="p-8 text-center text-gray-400">Loading...</div>
  }

  const loyalty = settings.loyalty
  const disabled = !loyalty.enabled

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Loyalty Program</h1>
          <p className="text-sm text-gray-500 mt-1">Earn and redeem points on customer orders.</p>
        </div>
        <Button onClick={saveSettings} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Enable / Disable */}
      <Card className="p-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={loyalty.enabled}
            onChange={(e) => updateLoyalty({ enabled: e.target.checked })}
            className="w-5 h-5 rounded border-gray-300"
          />
          <div>
            <span className="text-base font-semibold">Enable Loyalty Program</span>
            <p className="text-sm text-gray-500">Earn and redeem points on customer orders.</p>
          </div>
        </label>
      </Card>

      {/* Points Earning */}
      <Card className={`p-6 space-y-4 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <h2 className="text-lg font-semibold">Points Earning</h2>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Points earned per dollar spent</label>
            <input
              type="number"
              min="0"
              step="1"
              value={loyalty.pointsPerDollar}
              onChange={(e) => updateLoyalty({ pointsPerDollar: Math.max(0, parseInt(e.target.value) || 0) })}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              disabled={disabled}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Minimum order amount to earn points</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-400 text-sm">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={loyalty.minimumEarnAmount}
                onChange={(e) => updateLoyalty({ minimumEarnAmount: parseFloat(e.target.value) || 0 })}
                className="w-full pl-7 pr-3 py-2 border rounded-lg text-sm"
                placeholder="0.00"
                disabled={disabled}
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={loyalty.earnOnSubtotal}
              onChange={(e) => updateLoyalty({ earnOnSubtotal: e.target.checked })}
              className="rounded border-gray-300"
              disabled={disabled}
            />
            <div>
              <span className="text-sm">Earn on subtotal only</span>
              <p className="text-xs text-gray-400">When off, points are earned on total including tax.</p>
            </div>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={loyalty.earnOnTips}
              onChange={(e) => updateLoyalty({ earnOnTips: e.target.checked })}
              className="rounded border-gray-300"
              disabled={disabled}
            />
            <span className="text-sm">Include tips in earning calculation</span>
          </label>
        </div>
      </Card>

      {/* Points Redemption */}
      <Card className={`p-6 space-y-4 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <h2 className="text-lg font-semibold">Points Redemption</h2>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={loyalty.redemptionEnabled}
            onChange={(e) => updateLoyalty({ redemptionEnabled: e.target.checked })}
            className="rounded border-gray-300"
            disabled={disabled}
          />
          <span className="text-sm font-medium">Allow point redemption</span>
        </label>

        <div className={`grid grid-cols-3 gap-4 ${!loyalty.redemptionEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Points required per $1 redemption</label>
            <input
              type="number"
              min="1"
              step="1"
              value={loyalty.pointsPerDollarRedemption}
              onChange={(e) => updateLoyalty({ pointsPerDollarRedemption: parseInt(e.target.value) || 1 })}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              disabled={disabled || !loyalty.redemptionEnabled}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Minimum points to redeem</label>
            <input
              type="number"
              min="0"
              step="1"
              value={loyalty.minimumRedemptionPoints}
              onChange={(e) => updateLoyalty({ minimumRedemptionPoints: parseInt(e.target.value) || 0 })}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              disabled={disabled || !loyalty.redemptionEnabled}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Maximum % of order payable with points</label>
            <div className="relative">
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={loyalty.maximumRedemptionPercent}
                onChange={(e) => updateLoyalty({ maximumRedemptionPercent: Math.min(100, Math.max(1, parseInt(e.target.value) || 1)) })}
                className="w-full px-3 py-2 border rounded-lg text-sm pr-7"
                disabled={disabled || !loyalty.redemptionEnabled}
              />
              <span className="absolute right-3 top-2 text-gray-400 text-sm">%</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Display & Bonuses */}
      <Card className={`p-6 space-y-4 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <h2 className="text-lg font-semibold">Display & Bonuses</h2>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={loyalty.showPointsOnReceipt}
            onChange={(e) => updateLoyalty({ showPointsOnReceipt: e.target.checked })}
            className="rounded border-gray-300"
            disabled={disabled}
          />
          <span className="text-sm">Show points balance on receipt</span>
        </label>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Welcome bonus points</label>
          <input
            type="number"
            min="0"
            step="1"
            value={loyalty.welcomeBonus}
            onChange={(e) => updateLoyalty({ welcomeBonus: parseInt(e.target.value) || 0 })}
            className="w-full max-w-xs px-3 py-2 border rounded-lg text-sm"
            disabled={disabled}
          />
          <p className="text-xs text-gray-400 mt-1">Points awarded when a new customer is created.</p>
        </div>
      </Card>

      {/* Summary Preview */}
      {loyalty.enabled && (
        <Card className="p-6">
          <div className="p-4 bg-blue-50 rounded-xl">
            <h4 className="font-medium text-blue-900 mb-1 text-sm">Preview</h4>
            <div className="text-sm text-blue-700 space-y-1">
              <p>Customers earn <span className="font-bold">{loyalty.pointsPerDollar} point{loyalty.pointsPerDollar !== 1 ? 's' : ''}</span> per $1 spent{loyalty.earnOnSubtotal ? ' (subtotal only)' : ' (including tax)'}{loyalty.earnOnTips ? ', tips included' : ''}.</p>
              {loyalty.redemptionEnabled && (
                <p>Redeem <span className="font-bold">{loyalty.pointsPerDollarRedemption} points</span> for $1 off (up to {loyalty.maximumRedemptionPercent}% of order, minimum {loyalty.minimumRedemptionPoints} points).</p>
              )}
              {loyalty.welcomeBonus > 0 && (
                <p>New customers receive <span className="font-bold">{loyalty.welcomeBonus} bonus points</span> on sign-up.</p>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
