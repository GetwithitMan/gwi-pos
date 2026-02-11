'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LocationSettings, DEFAULT_SETTINGS } from '@/lib/settings'
import { formatCurrency } from '@/lib/pricing'
import { toast } from '@/stores/toast-store'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function HappyHourSettingsPage() {
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
        setSettings(data.settings)
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
        body: JSON.stringify({ settings }),
      })
      if (response.ok) {
        toast.success('Happy Hour settings saved')
      } else {
        toast.error('Failed to save settings')
      }
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updateHappyHour = (updates: Partial<LocationSettings['happyHour']>) => {
    setSettings(prev => ({
      ...prev,
      happyHour: { ...prev.happyHour, ...updates },
    }))
  }

  const updateSchedule = (index: number, updates: Partial<LocationSettings['happyHour']['schedules'][0]>) => {
    setSettings(prev => ({
      ...prev,
      happyHour: {
        ...prev.happyHour,
        schedules: prev.happyHour.schedules.map((s, i) =>
          i === index ? { ...s, ...updates } : s
        ),
      },
    }))
  }

  const addSchedule = () => {
    setSettings(prev => ({
      ...prev,
      happyHour: {
        ...prev.happyHour,
        schedules: [
          ...prev.happyHour.schedules,
          { dayOfWeek: [1, 2, 3, 4, 5], startTime: '16:00', endTime: '18:00' },
        ],
      },
    }))
  }

  const removeSchedule = (index: number) => {
    setSettings(prev => ({
      ...prev,
      happyHour: {
        ...prev.happyHour,
        schedules: prev.happyHour.schedules.filter((_, i) => i !== index),
      },
    }))
  }

  const toggleDayOfWeek = (scheduleIndex: number, day: number) => {
    const schedule = settings.happyHour.schedules[scheduleIndex]
    const newDays = schedule.dayOfWeek.includes(day)
      ? schedule.dayOfWeek.filter(d => d !== day)
      : [...schedule.dayOfWeek, day].sort()
    updateSchedule(scheduleIndex, { dayOfWeek: newDays })
  }

  if (isLoading) {
    return <div className="p-8 text-center text-gray-400">Loading...</div>
  }

  const hh = settings.happyHour

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Happy Hour / Time-Based Pricing</h1>
          <p className="text-sm text-gray-500 mt-1">Configure automatic time-based discounts for your menu.</p>
        </div>
        <Button onClick={saveSettings} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      {/* Master Toggle */}
      <Card className="p-6">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={hh.enabled}
            onChange={(e) => updateHappyHour({ enabled: e.target.checked })}
            className="w-5 h-5 rounded border-gray-300"
          />
          <div>
            <span className="text-base font-semibold">Enable Happy Hour</span>
            <p className="text-sm text-gray-500">Automatically apply discounts during scheduled times.</p>
          </div>
        </label>
      </Card>

      {hh.enabled && (
        <>
          {/* Name & Display */}
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Display</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Display Name</label>
              <input
                type="text"
                value={hh.name}
                onChange={(e) => updateHappyHour({ name: e.target.value })}
                className="w-full max-w-xs px-3 py-2 border rounded-lg text-sm"
                placeholder="Happy Hour"
              />
              <p className="text-xs text-gray-400 mt-1">Shown on POS badges, receipts, and online ordering.</p>
            </div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hh.showBadge}
                  onChange={(e) => updateHappyHour({ showBadge: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">Show &ldquo;{hh.name}&rdquo; badge on items</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hh.showOriginalPrice}
                  onChange={(e) => updateHappyHour({ showOriginalPrice: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">Show original price crossed out</span>
              </label>
            </div>
          </Card>

          {/* Schedules */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Schedules</h2>
              <Button variant="outline" size="sm" onClick={addSchedule}>+ Add Schedule</Button>
            </div>

            {hh.schedules.map((schedule, index) => (
              <div key={index} className="p-4 border rounded-xl bg-gray-50 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-gray-700">Schedule {index + 1}</span>
                  {hh.schedules.length > 1 && (
                    <button
                      onClick={() => removeSchedule(index)}
                      className="text-red-500 hover:text-red-700 text-sm font-medium"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {/* Days */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Days</label>
                  <div className="flex gap-1.5">
                    {DAYS.map((day, dayIndex) => (
                      <button
                        key={dayIndex}
                        type="button"
                        onClick={() => toggleDayOfWeek(index, dayIndex)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                          schedule.dayOfWeek.includes(dayIndex)
                            ? 'bg-amber-500 text-white'
                            : 'bg-white border text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Times */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Start Time</label>
                    <input
                      type="time"
                      value={schedule.startTime}
                      onChange={(e) => updateSchedule(index, { startTime: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">End Time</label>
                    <input
                      type="time"
                      value={schedule.endTime}
                      onChange={(e) => updateSchedule(index, { endTime: e.target.value })}
                      className="w-full px-3 py-2 border rounded-lg text-sm"
                    />
                  </div>
                </div>
              </div>
            ))}
          </Card>

          {/* Discount */}
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Discount</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Discount Type</label>
                <select
                  value={hh.discountType}
                  onChange={(e) => updateHappyHour({ discountType: e.target.value as 'percent' | 'fixed' })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="percent">Percentage Off</option>
                  <option value="fixed">Fixed Amount Off</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  {hh.discountType === 'percent' ? 'Discount %' : 'Discount Amount ($)'}
                </label>
                <div className="relative">
                  {hh.discountType === 'fixed' && (
                    <span className="absolute left-3 top-2 text-gray-400 text-sm">$</span>
                  )}
                  <input
                    type="number"
                    min="0"
                    step={hh.discountType === 'percent' ? '1' : '0.01'}
                    value={hh.discountValue}
                    onChange={(e) => updateHappyHour({ discountValue: parseFloat(e.target.value) || 0 })}
                    className={`w-full px-3 py-2 border rounded-lg text-sm ${hh.discountType === 'fixed' ? 'pl-7' : ''}`}
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Applies To</label>
              <select
                value={hh.appliesTo}
                onChange={(e) => updateHappyHour({ appliesTo: e.target.value as 'all' | 'categories' | 'items' })}
                className="w-full max-w-xs px-3 py-2 border rounded-lg text-sm"
              >
                <option value="all">All Menu Items</option>
                <option value="categories">Specific Categories</option>
                <option value="items">Specific Items</option>
              </select>
            </div>

            {hh.appliesTo !== 'all' && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                Select specific {hh.appliesTo} from the Menu page to include them in happy hour pricing.
              </div>
            )}

            {/* Example */}
            <div className="p-4 bg-blue-50 rounded-xl">
              <h4 className="font-medium text-blue-900 mb-1 text-sm">Preview</h4>
              <div className="text-sm text-blue-700">
                A $10.00 item during {hh.name} would be:
                <span className="font-bold ml-1">
                  {hh.discountType === 'percent'
                    ? formatCurrency(10 * (1 - hh.discountValue / 100))
                    : formatCurrency(Math.max(0, 10 - hh.discountValue))}
                </span>
                {hh.showOriginalPrice && (
                  <span className="line-through ml-2 text-blue-400">$10.00</span>
                )}
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
