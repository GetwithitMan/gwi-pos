'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LocationSettings, DEFAULT_SETTINGS, getPricingProgram } from '@/lib/settings'
import { formatCurrency } from '@/lib/pricing'
import { useAuthStore } from '@/stores/auth-store'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { HardwareHealthWidget } from '@/components/hardware/HardwareHealthWidget'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useSocket } from '@/hooks/useSocket'
import { toast } from '@/stores/toast-store'

export default function SettingsPage() {
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id
  const { isConnected } = useSocket()
  const [settings, setSettings] = useState<LocationSettings>(DEFAULT_SETTINGS)
  const [locationName, setLocationName] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  // Hardware health data
  const [terminals, setTerminals] = useState<any[]>([])
  const [printers, setPrinters] = useState<any[]>([])
  const [kdsScreens, setKdsScreens] = useState<any[]>([])

  // Batch Settlement state
  const [paymentReaders, setPaymentReaders] = useState<any[]>([])
  const [selectedReaderId, setSelectedReaderId] = useState<string>('')
  const [batchDialogOpen, setBatchDialogOpen] = useState(false)
  const [batchSummaryData, setBatchSummaryData] = useState<{
    success: boolean
    batchNo: string | null
    transactionCount: string | null
    safCount: number
    safAmount: number
    hasSAFPending: boolean
    error: { code: string; message: string } | null
  } | null>(null)
  const [isFetchingBatchSummary, setIsFetchingBatchSummary] = useState(false)
  const [isClosingBatch, setIsClosingBatch] = useState(false)

  // Check if user has admin/settings permissions
  const isSuperAdmin = employee?.role?.name === 'Owner' ||
    employee?.role?.name === 'Admin' ||
    hasPermission(employee?.permissions || [], PERMISSIONS.ADMIN)

  const loadHardwareStatus = useCallback(async () => {
    if (!locationId) return
    try {
      const [terminalsRes, printersRes, kdsRes] = await Promise.all([
        fetch(`/api/hardware/terminals?locationId=${locationId}`),
        fetch(`/api/hardware/printers?locationId=${locationId}`),
        fetch(`/api/hardware/kds-screens?locationId=${locationId}`),
      ])

      if (terminalsRes.ok) {
        const data = await terminalsRes.json()
        setTerminals(data.data.terminals || [])
      }
      if (printersRes.ok) {
        const data = await printersRes.json()
        setPrinters(data.data.printers || [])
      }
      if (kdsRes.ok) {
        const data = await kdsRes.json()
        setKdsScreens(data.data.screens || [])
      }
    } catch (error) {
      console.error('Failed to load hardware status:', error)
    }
  }, [locationId])

  const loadPaymentReaders = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/hardware/payment-readers?locationId=${locationId}&activeOnly=true`)
      if (res.ok) {
        const data = await res.json()
        const readers = data.data.readers || []
        setPaymentReaders(readers)
        if (readers.length > 0 && !selectedReaderId) {
          setSelectedReaderId(readers[0].id)
        }
      }
    } catch (error) {
      console.error('Failed to load payment readers:', error)
    }
  }, [locationId, selectedReaderId])

  const handleOpenBatchDialog = async () => {
    if (!locationId || !selectedReaderId) {
      toast.error('Select a payment reader first')
      return
    }
    setIsFetchingBatchSummary(true)
    setBatchSummaryData(null)
    setBatchDialogOpen(true)
    try {
      const res = await fetch(
        `/api/datacap/batch?locationId=${encodeURIComponent(locationId)}&readerId=${encodeURIComponent(selectedReaderId)}`
      )
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to fetch batch summary')
        setBatchDialogOpen(false)
        return
      }
      setBatchSummaryData(json.data)
    } catch {
      toast.error('Failed to fetch batch summary')
      setBatchDialogOpen(false)
    } finally {
      setIsFetchingBatchSummary(false)
    }
  }

  const handleConfirmBatchClose = async () => {
    if (!locationId || !selectedReaderId) return
    setIsClosingBatch(true)
    try {
      const res = await fetch('/api/datacap/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, readerId: selectedReaderId }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Batch close failed')
        return
      }
      if (json.data?.success) {
        toast.success(
          json.data.batchNo
            ? `Batch #${json.data.batchNo} closed successfully`
            : 'Batch closed successfully'
        )
      } else if (json.data?.error) {
        toast.error(`Batch close error: ${json.data.error.message}`)
      } else {
        toast.warning('Batch close completed with unknown status')
      }
      setBatchDialogOpen(false)
      setBatchSummaryData(null)
    } catch {
      toast.error('Batch close request failed')
    } finally {
      setIsClosingBatch(false)
    }
  }

  useEffect(() => {
    loadSettings()
    loadHardwareStatus()
    loadPaymentReaders()
  }, [loadHardwareStatus, loadPaymentReaders])

  // 20s fallback polling only when socket is disconnected
  useEffect(() => {
    if (isConnected) return
    const fallback = setInterval(loadHardwareStatus, 20000)
    return () => clearInterval(fallback)
  }, [isConnected, loadHardwareStatus])

  // Instant refresh on tab switch
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') loadHardwareStatus()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [loadHardwareStatus])

  const loadSettings = async () => {
    try {
      const response = await fetch('/api/settings')
      if (response.ok) {
        const data = await response.json()
        setSettings(data.data.settings)
        setLocationName(data.data.locationName)
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const saveSettings = async () => {
    setIsSaving(true)
    setSaveMessage('')

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })

      if (response.ok) {
        setSaveMessage('Settings saved successfully!')
        setTimeout(() => setSaveMessage(''), 3000)
      } else {
        setSaveMessage('Failed to save settings')
      }
    } catch (error) {
      console.error('Failed to save settings:', error)
      setSaveMessage('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const updateTax = (updates: Partial<LocationSettings['tax']>) => {
    setSettings(prev => ({
      ...prev,
      tax: { ...prev.tax, ...updates },
    }))
  }

  const updatePriceRounding = (updates: Partial<LocationSettings['priceRounding']>) => {
    setSettings(prev => ({
      ...prev,
      priceRounding: { ...prev.priceRounding, ...updates },
    }))
  }

  const updateTips = (updates: Partial<LocationSettings['tips']>) => {
    setSettings(prev => ({
      ...prev,
      tips: { ...prev.tips, ...updates },
    }))
  }

  const updatePayments = (updates: Partial<LocationSettings['payments']>) => {
    setSettings(prev => ({
      ...prev,
      payments: { ...prev.payments, ...updates },
    }))
  }

  const updateLoyalty = (updates: Partial<LocationSettings['loyalty']>) => {
    setSettings(prev => ({
      ...prev,
      loyalty: { ...prev.loyalty, ...updates },
    }))
  }

  const updateBusinessDay = (updates: Partial<LocationSettings['businessDay']>) => {
    setSettings(prev => ({
      ...prev,
      businessDay: { ...prev.businessDay, ...updates },
    }))
  }

  const updateClockOut = (updates: Partial<LocationSettings['clockOut']>) => {
    setSettings(prev => ({
      ...prev,
      clockOut: { ...prev.clockOut, ...updates },
    }))
  }

  const updateBarTabs = (updates: Partial<LocationSettings['barTabs']>) => {
    setSettings(prev => ({
      ...prev,
      barTabs: { ...prev.barTabs, ...updates },
    }))
  }

  const updateReceipts = (updates: Partial<LocationSettings['receipts']>) => {
    setSettings(prev => ({
      ...prev,
      receipts: { ...prev.receipts, ...updates },
    }))
  }

  const updatePosDisplay = (updates: Partial<LocationSettings['posDisplay']>) => {
    setSettings(prev => ({
      ...prev,
      posDisplay: { ...prev.posDisplay, ...updates },
    }))
  }

  const updateAutoReboot = (updates: Partial<LocationSettings['autoReboot']>) => {
    setSettings(prev => ({
      ...prev,
      autoReboot: { ...prev.autoReboot, ...updates },
    }))
  }

  // T-080 Phase 4: Resolve the effective pricing program (handles backward compat)
  const activePricingProgram = getPricingProgram(settings)

  // Legacy example prices (kept for any legacy usage below)
  const exampleCashPrice = 10.00
  const discountPercent = settings.dualPricing.cashDiscountPercent || 4.0
  const exampleCardPrice = Math.round(exampleCashPrice * (1 + discountPercent / 100) * 100) / 100

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Settings"
        subtitle={locationName}
        actions={
          <div className="flex items-center gap-3">
            {saveMessage && (
              <span className={`text-sm ${saveMessage.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
                {saveMessage}
              </span>
            )}
            <Button variant="primary" onClick={saveSettings} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        }
      />

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Pricing Program Section (Read-Only) — T-080 Phase 4 */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Processing Program</h2>
            {/* Model badge */}
            {activePricingProgram.model === 'none' || !activePricingProgram.enabled ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
                No Surcharge Program
              </span>
            ) : activePricingProgram.model === 'cash_discount' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                Cash Discount
              </span>
            ) : activePricingProgram.model === 'surcharge' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                Surcharge
              </span>
            ) : activePricingProgram.model === 'flat_rate' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                Flat Rate
              </span>
            ) : activePricingProgram.model === 'interchange_plus' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                Interchange Plus
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                Tiered Pricing
              </span>
            )}
          </div>

          {/* Model-specific detail display */}
          {(activePricingProgram.model === 'none' || !activePricingProgram.enabled) && (
            <p className="text-sm text-gray-500">No processing program configured</p>
          )}

          {activePricingProgram.enabled && activePricingProgram.model === 'cash_discount' && (
            <>
              <p className="text-sm text-gray-500 mb-4">
                Card price is the default — cash customers receive a discount
              </p>
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Current Rate</p>
                <div className="bg-gray-50 border rounded-lg p-4">
                  <p className="text-2xl font-bold text-gray-900">{activePricingProgram.cashDiscountPercent ?? discountPercent}%</p>
                  <p className="text-sm text-gray-500 mb-3">Cash Discount</p>
                  <p className="text-sm text-gray-600">
                    {formatCurrency(exampleCashPrice)} → Card: {formatCurrency(exampleCardPrice)} | Cash: {formatCurrency(exampleCashPrice)}
                  </p>
                </div>
              </div>
              <div className="mb-4 space-y-1.5">
                <p className="text-sm font-medium text-gray-700 mb-2">Applies To</p>
                {activePricingProgram.applyToCredit && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Credit cards
                  </div>
                )}
                {activePricingProgram.applyToDebit && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Debit cards
                  </div>
                )}
                {activePricingProgram.showSavingsMessage && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Savings message shown at checkout
                  </div>
                )}
              </div>
            </>
          )}

          {activePricingProgram.enabled && activePricingProgram.model === 'surcharge' && (
            <>
              <p className="text-sm text-gray-500 mb-4">
                A surcharge is added on top of the base price for card payments
              </p>
              <div className="mb-4">
                <p className="text-sm font-medium text-gray-700 mb-2">Surcharge Rate</p>
                <div className="bg-gray-50 border rounded-lg p-4">
                  <p className="text-2xl font-bold text-gray-900">{activePricingProgram.surchargePercent ?? 0}%</p>
                  <p className="text-sm text-gray-500 mb-2">Added to card transactions (Visa/MC cap: 3%)</p>
                  <p className="text-sm text-gray-600">
                    {formatCurrency(exampleCashPrice)} base → Card: {formatCurrency(Math.round(exampleCashPrice * (1 + (activePricingProgram.surchargePercent ?? 0) / 100) * 100) / 100)}
                  </p>
                </div>
              </div>
              <div className="mb-4 space-y-1.5">
                <p className="text-sm font-medium text-gray-700 mb-2">Applies To</p>
                {activePricingProgram.surchargeApplyToCredit !== false && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Credit cards
                  </div>
                )}
                {activePricingProgram.surchargeApplyToDebit && (
                  <div className="flex items-center gap-2 text-sm text-gray-700">
                    <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Debit cards
                  </div>
                )}
              </div>
              {activePricingProgram.surchargeDisclosure && (
                <div className="mb-4">
                  <p className="text-sm font-medium text-gray-700 mb-1">Disclosure Text</p>
                  <p className="text-sm text-gray-500 italic">&ldquo;{activePricingProgram.surchargeDisclosure}&rdquo;</p>
                </div>
              )}
            </>
          )}

          {activePricingProgram.enabled && activePricingProgram.model === 'flat_rate' && (
            <>
              <p className="text-sm text-gray-500 mb-4">
                Flat-rate processing — merchant absorbs fees, customer price is unchanged
              </p>
              <div className="mb-4">
                <div className="bg-gray-50 border rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Rate</span>
                    <span className="font-medium text-gray-900">{activePricingProgram.flatRatePercent ?? 0}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Per-transaction fee</span>
                    <span className="font-medium text-gray-900">{formatCurrency(activePricingProgram.flatRatePerTxn ?? 0)}</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between text-sm">
                    <span className="text-gray-600">Example cost on {formatCurrency(exampleCashPrice)}</span>
                    <span className="font-medium text-gray-900">
                      {formatCurrency(Math.round((exampleCashPrice * (activePricingProgram.flatRatePercent ?? 0) / 100 + (activePricingProgram.flatRatePerTxn ?? 0)) * 100) / 100)}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}

          {activePricingProgram.enabled && activePricingProgram.model === 'interchange_plus' && (
            <>
              <p className="text-sm text-gray-500 mb-4">
                Interchange-plus pricing — merchant pays interchange + markup, customer price is unchanged
              </p>
              <div className="mb-4">
                <div className="bg-gray-50 border rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Markup rate</span>
                    <span className="font-medium text-gray-900">{activePricingProgram.markupPercent ?? 0}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Markup per transaction</span>
                    <span className="font-medium text-gray-900">{formatCurrency(activePricingProgram.markupPerTxn ?? 0)}</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {activePricingProgram.enabled && activePricingProgram.model === 'tiered' && (
            <>
              <p className="text-sm text-gray-500 mb-4">
                Tiered pricing — rate depends on card qualification bucket
              </p>
              <div className="mb-4">
                <div className="bg-gray-50 border rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Qualified rate</span>
                    <span className="font-medium text-gray-900">{activePricingProgram.qualifiedRate ?? 0}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Mid-qualified rate</span>
                    <span className="font-medium text-gray-900">{activePricingProgram.midQualifiedRate ?? 0}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Non-qualified rate</span>
                    <span className="font-medium text-gray-900">{activePricingProgram.nonQualifiedRate ?? 0}%</span>
                  </div>
                  {(activePricingProgram.tieredPerTxn ?? 0) > 0 && (
                    <div className="flex justify-between text-sm border-t pt-2">
                      <span className="text-gray-600">Per-transaction fee</span>
                      <span className="font-medium text-gray-900">{formatCurrency(activePricingProgram.tieredPerTxn ?? 0)}</span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* Info note — always shown */}
          <p className="text-xs text-gray-400 flex items-center gap-1.5 mt-2">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Contact your administrator to change processing rates
          </p>
        </Card>

        {/* Price Rounding Section */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Price Rounding</h2>
              <p className="text-sm text-gray-500">Round totals for easier cash handling</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.priceRounding?.enabled || false}
                onChange={(e) => updatePriceRounding({ enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {settings.priceRounding?.enabled && (
            <div className="space-y-4 border-t pt-4">
              {/* Rounding Increment */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Round to nearest
                </label>
                <select
                  value={settings.priceRounding.increment}
                  onChange={(e) => updatePriceRounding({ increment: e.target.value as LocationSettings['priceRounding']['increment'] })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="none">No rounding</option>
                  <option value="0.05">$0.05 (nickel)</option>
                  <option value="0.10">$0.10 (dime)</option>
                  <option value="0.25">$0.25 (quarter)</option>
                  <option value="0.50">$0.50 (half dollar)</option>
                  <option value="1.00">$1.00 (dollar)</option>
                </select>
              </div>

              {/* Rounding Direction */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Rounding direction
                </label>
                <div className="flex gap-4">
                  {(['nearest', 'up', 'down'] as const).map(dir => (
                    <label key={dir} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="roundingDirection"
                        checked={settings.priceRounding.direction === dir}
                        onChange={() => updatePriceRounding({ direction: dir })}
                        className="text-blue-600"
                      />
                      <span className="text-sm capitalize">{dir}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Apply To */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Apply rounding to
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.priceRounding.applyToCash}
                      onChange={(e) => updatePriceRounding({ applyToCash: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Cash payments</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.priceRounding.applyToCard}
                      onChange={(e) => updatePriceRounding({ applyToCard: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Card payments</span>
                  </label>
                </div>
              </div>

              {/* Example */}
              <div className="bg-gray-50 p-3 rounded-lg">
                <p className="text-sm text-gray-600">
                  Example: $16.47 → {formatCurrency(
                    settings.priceRounding.increment === 'none'
                      ? 16.47
                      : settings.priceRounding.direction === 'up'
                        ? Math.ceil(16.47 / parseFloat(settings.priceRounding.increment)) * parseFloat(settings.priceRounding.increment)
                        : settings.priceRounding.direction === 'down'
                          ? Math.floor(16.47 / parseFloat(settings.priceRounding.increment)) * parseFloat(settings.priceRounding.increment)
                          : Math.round(16.47 / parseFloat(settings.priceRounding.increment)) * parseFloat(settings.priceRounding.increment)
                  )}
                </p>
              </div>
            </div>
          )}
        </Card>

        {/* Tax Settings Section */}
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Tax Settings</h2>
            <p className="text-sm text-gray-500">Configure tax calculation</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Tax Rate
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="20"
                  value={settings.tax.defaultRate}
                  onChange={(e) => updateTax({ defaultRate: parseFloat(e.target.value) || 0 })}
                  className="w-24 px-3 py-2 border rounded-lg"
                />
                <span className="text-gray-500">%</span>
              </div>
            </div>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.tax.calculateAfterDiscount}
                onChange={(e) => updateTax({ calculateAfterDiscount: e.target.checked })}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Calculate tax after discounts</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.tax.taxInclusiveLiquor}
                onChange={(e) => updateTax({ taxInclusiveLiquor: e.target.checked })}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Liquor & alcohol prices include tax</span>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.tax.taxInclusiveFood}
                onChange={(e) => updateTax({ taxInclusiveFood: e.target.checked })}
                className="rounded border-gray-300"
              />
              <span className="text-sm">Food prices include tax</span>
            </label>

          </div>
        </Card>

        {/* Tip Settings Section */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Tip Settings</h2>
              <p className="text-sm text-gray-500">Configure tipping options</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.tips.enabled}
                onChange={(e) => updateTips({ enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {settings.tips.enabled && (
            <div className="space-y-4 border-t pt-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Suggested Tip Percentages
                </label>
                <div className="flex gap-2">
                  {settings.tips.suggestedPercentages.map((pct, idx) => (
                    <input
                      key={idx}
                      type="number"
                      value={pct}
                      onChange={(e) => {
                        const newPcts = [...settings.tips.suggestedPercentages]
                        newPcts[idx] = parseInt(e.target.value) || 0
                        updateTips({ suggestedPercentages: newPcts })
                      }}
                      className="w-16 px-2 py-2 border rounded-lg text-center"
                    />
                  ))}
                  <span className="text-gray-500 self-center">%</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Calculate Tip On
                </label>
                <select
                  value={settings.tips.calculateOn}
                  onChange={(e) => updateTips({ calculateOn: e.target.value as 'subtotal' | 'total' })}
                  className="px-3 py-2 border rounded-lg"
                >
                  <option value="subtotal">Subtotal (before tax)</option>
                  <option value="total">Total (after tax)</option>
                </select>
              </div>
            </div>
          )}
        </Card>

        {/* Bar Tab / Pre-Auth Section */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Bar Tab / Pre-Auth</h2>
              <p className="text-sm text-gray-500">Configure auto-increment and hold amounts for bar tabs</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.payments.autoIncrementEnabled}
                onChange={(e) => updatePayments({ autoIncrementEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="space-y-4 border-t pt-4">
            {/* Tip Buffer */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tip Buffer on Hold
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="50"
                  value={settings.payments.incrementTipBufferPercent ?? 25}
                  onChange={(e) => updatePayments({ incrementTipBufferPercent: parseInt(e.target.value) || 0 })}
                  className="w-20 px-3 py-2 border rounded-lg"
                />
                <span className="text-gray-500">%</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Extra % added to hold to cover potential tip. Set to 0 to hold exact tab total only.
              </p>
              {(settings.payments.incrementTipBufferPercent ?? 25) > 0 && (
                <div className="mt-2 p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                  Example: $50.00 tab → ${(50 * (1 + (settings.payments.incrementTipBufferPercent ?? 25) / 100)).toFixed(2)} hold
                  (covers up to {settings.payments.incrementTipBufferPercent ?? 25}% tip)
                </div>
              )}
            </div>

            {settings.payments.autoIncrementEnabled && (
              <>
                {/* Auto-Increment Threshold */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Auto-Increment Threshold
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="5"
                      min="50"
                      max="100"
                      value={settings.payments.incrementThresholdPercent}
                      onChange={(e) => updatePayments({ incrementThresholdPercent: parseInt(e.target.value) || 80 })}
                      className="w-20 px-3 py-2 border rounded-lg"
                    />
                    <span className="text-gray-500">%</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Automatically re-auth when tab reaches this % of the current hold
                  </p>
                </div>

                {/* Minimum Increment Amount */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Minimum Auto-Increment
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">$</span>
                    <input
                      type="number"
                      step="5"
                      min="5"
                      max="200"
                      value={settings.payments.incrementAmount}
                      onChange={(e) => updatePayments({ incrementAmount: parseInt(e.target.value) || 25 })}
                      className="w-24 px-3 py-2 border rounded-lg"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Minimum amount for background auto-increments (avoids frequent small auths)
                  </p>
                </div>
              </>
            )}

            {/* Max Tab Alert */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Manager Alert Amount
              </label>
              <div className="flex items-center gap-2">
                <span className="text-gray-500">$</span>
                <input
                  type="number"
                  step="50"
                  min="0"
                  max="5000"
                  value={settings.payments.maxTabAlertAmount}
                  onChange={(e) => updatePayments({ maxTabAlertAmount: parseInt(e.target.value) || 500 })}
                  className="w-28 px-3 py-2 border rounded-lg"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Alert manager when a tab exceeds this amount
              </p>
            </div>
          </div>
        </Card>

        {/* Loyalty Program Section */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Loyalty Program</h2>
              <p className="text-sm text-gray-500">Reward customers with points</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.loyalty.enabled}
                onChange={(e) => updateLoyalty({ enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {settings.loyalty.enabled && (
            <div className="space-y-6 border-t pt-4">
              {/* Points Earning */}
              <div>
                <h3 className="font-medium text-gray-900 mb-3">Points Earning</h3>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <label className="text-sm text-gray-700 w-40">Points per $1 spent:</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={settings.loyalty.pointsPerDollar}
                      onChange={(e) => updateLoyalty({ pointsPerDollar: parseFloat(e.target.value) || 0 })}
                      className="w-20 px-3 py-2 border rounded-lg"
                    />
                    <span className="text-sm text-gray-500">points</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="text-sm text-gray-700 w-40">Minimum order to earn:</label>
                    <span className="text-gray-500">$</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={settings.loyalty.minimumEarnAmount}
                      onChange={(e) => updateLoyalty({ minimumEarnAmount: parseFloat(e.target.value) || 0 })}
                      className="w-20 px-3 py-2 border rounded-lg"
                    />
                  </div>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.loyalty.earnOnSubtotal}
                      onChange={(e) => updateLoyalty({ earnOnSubtotal: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Earn on subtotal (before tax)</span>
                  </label>

                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.loyalty.earnOnTips}
                      onChange={(e) => updateLoyalty({ earnOnTips: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Include tips in earning calculation</span>
                  </label>

                  <div className="flex items-center gap-3">
                    <label className="text-sm text-gray-700 w-40">Welcome bonus:</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={settings.loyalty.welcomeBonus}
                      onChange={(e) => updateLoyalty({ welcomeBonus: parseInt(e.target.value) || 0 })}
                      className="w-20 px-3 py-2 border rounded-lg"
                    />
                    <span className="text-sm text-gray-500">points for new customers</span>
                  </div>
                </div>
              </div>

              {/* Points Redemption */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-medium text-gray-900">Points Redemption</h3>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={settings.loyalty.redemptionEnabled}
                      onChange={(e) => updateLoyalty({ redemptionEnabled: e.target.checked })}
                      className="rounded border-gray-300"
                    />
                    <span className="text-sm">Allow redemption</span>
                  </label>
                </div>

                {settings.loyalty.redemptionEnabled && (
                  <div className="space-y-3 pl-4 border-l-2 border-blue-200">
                    <div className="flex items-center gap-3">
                      <label className="text-sm text-gray-700 w-40">Points per $1 value:</label>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={settings.loyalty.pointsPerDollarRedemption}
                        onChange={(e) => updateLoyalty({ pointsPerDollarRedemption: parseInt(e.target.value) || 100 })}
                        className="w-20 px-3 py-2 border rounded-lg"
                      />
                      <span className="text-sm text-gray-500">points = $1</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm text-gray-700 w-40">Minimum to redeem:</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={settings.loyalty.minimumRedemptionPoints}
                        onChange={(e) => updateLoyalty({ minimumRedemptionPoints: parseInt(e.target.value) || 0 })}
                        className="w-20 px-3 py-2 border rounded-lg"
                      />
                      <span className="text-sm text-gray-500">points</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm text-gray-700 w-40">Max % of order:</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        step="1"
                        value={settings.loyalty.maximumRedemptionPercent}
                        onChange={(e) => updateLoyalty({ maximumRedemptionPercent: parseInt(e.target.value) || 50 })}
                        className="w-20 px-3 py-2 border rounded-lg"
                      />
                      <span className="text-sm text-gray-500">%</span>
                    </div>

                    <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                      Example: {settings.loyalty.pointsPerDollarRedemption} points = $1.00 discount
                    </div>
                  </div>
                )}
              </div>

              {/* Display Options */}
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.loyalty.showPointsOnReceipt}
                  onChange={(e) => updateLoyalty({ showPointsOnReceipt: e.target.checked })}
                  className="rounded border-gray-300"
                />
                <span className="text-sm">Show loyalty points on receipt</span>
              </label>
            </div>
          )}
        </Card>

        {/* Happy Hour — full settings at /settings/happy-hour */}
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Happy Hour / Time-Based Pricing</h2>
              <p className="text-sm text-gray-500 mt-1">
                {settings.happyHour.enabled
                  ? `${settings.happyHour.name} is active — ${settings.happyHour.discountType === 'percent' ? `${settings.happyHour.discountValue}% off` : formatCurrency(settings.happyHour.discountValue) + ' off'}`
                  : 'Not currently active'}
              </p>
            </div>
            <Link href="/settings/happy-hour">
              <Button variant="outline">Configure</Button>
            </Link>
          </div>
        </Card>

        {/* Business Day Boundary */}
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Business Day Boundary</h2>
            <p className="text-sm text-gray-500">
              Define when a business day starts for reports, shifts, and daily batches.
              Orders after midnight but before this time count toward the previous business day.
            </p>
          </div>

          <div className="space-y-4">
            {/* Day Start Time */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Day Start Time
              </label>
              <input
                type="time"
                value={settings.businessDay?.dayStartTime || '04:00'}
                onChange={(e) => updateBusinessDay({ dayStartTime: e.target.value })}
                className="px-3 py-2 border rounded-lg"
              />
              <p className="text-xs text-gray-500 mt-1">
                Business day starts at this time. Example: 4:00 AM means a 1:30 AM order on Feb 11 counts as Feb 10.
              </p>
            </div>

            {/* Enforce Clock-Out */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Enforce Clock-Out at Day Boundary</span>
                <p className="text-xs text-gray-500">Force employees to clock out when the business day ends</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.businessDay?.enforceClockOut ?? true}
                  onChange={(e) => updateBusinessDay({ enforceClockOut: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Enforce Tab Close */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Enforce Tab Close at Day Boundary</span>
                <p className="text-xs text-gray-500">Force open tabs to close when the business day ends</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.businessDay?.enforceTabClose ?? true}
                  onChange={(e) => updateBusinessDay({ enforceTabClose: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Batch at Day End */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Run Daily Batch at Day End</span>
                <p className="text-xs text-gray-500">Automatically run daily batch processing when the business day ends</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.businessDay?.batchAtDayEnd ?? true}
                  onChange={(e) => updateBusinessDay({ batchAtDayEnd: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Grace Period */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Grace Period (minutes)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="5"
                  min="0"
                  max="60"
                  value={settings.businessDay?.graceMinutes ?? 15}
                  onChange={(e) => updateBusinessDay({ graceMinutes: parseInt(e.target.value) || 0 })}
                  className="w-20 px-3 py-2 border rounded-lg"
                />
                <span className="text-gray-500">minutes</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Extra time after the day boundary before enforcement kicks in
              </p>
            </div>

            {/* Example */}
            <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
              Business day runs from{' '}
              <span className="font-semibold">{settings.businessDay?.dayStartTime || '04:00'}</span>
              {' '}to{' '}
              <span className="font-semibold">{settings.businessDay?.dayStartTime || '04:00'}</span>
              {' '}next day. Orders at 2:00 AM count toward the previous business day.
            </div>
          </div>
        </Card>

        {/* Clock-Out Requirements */}
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Clock-Out Requirements</h2>
            <p className="text-sm text-gray-500">Control what employees must complete before ending their shift</p>
          </div>

          <div className="space-y-4">
            {/* Require Orders Settled */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Require all orders settled before clock-out</span>
                <p className="text-xs text-gray-500">Employees must close or transfer all open orders before ending their shift</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.clockOut?.requireSettledBeforeClockOut ?? true}
                  onChange={(e) => updateClockOut({ requireSettledBeforeClockOut: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Require Tips Adjusted */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Require tips adjusted before clock-out</span>
                <p className="text-xs text-gray-500">Employees must confirm or adjust all tip amounts before ending their shift</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.clockOut?.requireTipsAdjusted ?? false}
                  onChange={(e) => updateClockOut({ requireTipsAdjusted: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Allow Transfer on Clock-Out */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Allow order transfer on clock-out</span>
                <p className="text-xs text-gray-500">When enabled, employees can transfer their open orders to another active employee instead of settling them</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.clockOut?.allowTransferOnClockOut ?? true}
                  onChange={(e) => updateClockOut({ allowTransferOnClockOut: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </Card>

        {/* Bar Tab Settings */}
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Bar Tab Settings</h2>
            <p className="text-sm text-gray-500">Card requirements, timeouts, and shift close validation</p>
          </div>

          <div className="space-y-4">
            {/* Card Requirements */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Require card to open a tab</span>
                <p className="text-xs text-gray-500">Customers must swipe a credit card to start a bar tab</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.barTabs?.requireCardForTab ?? false}
                  onChange={(e) => updateBarTabs({ requireCardForTab: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Auto-fill customer name from card</span>
                <p className="text-xs text-gray-500">Use cardholder name when opening a tab with a card</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.barTabs?.pullCustomerFromCard ?? true}
                  onChange={(e) => updateBarTabs({ pullCustomerFromCard: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Allow name-only tabs</span>
                <p className="text-xs text-gray-500">Allow opening tabs with just a name (no card required)</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.barTabs?.allowNameOnlyTab ?? true}
                  onChange={(e) => updateBarTabs({ allowNameOnlyTab: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Tab Timeout */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tab Timeout Warning
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="30"
                  min="30"
                  max="720"
                  value={settings.barTabs?.tabTimeoutMinutes ?? 240}
                  onChange={(e) => updateBarTabs({ tabTimeoutMinutes: parseInt(e.target.value) || 240 })}
                  className="w-24 px-3 py-2 border rounded-lg"
                />
                <span className="text-gray-500">minutes</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Show timeout warning after this many minutes of tab inactivity
              </p>
            </div>

            {/* Shift Close Validation */}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Require tabs closed before shift close</span>
                <p className="text-xs text-gray-500">Block shift close if employee has open orders</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.barTabs?.requireCloseTabsBeforeShift ?? true}
                  onChange={(e) => updateBarTabs({ requireCloseTabsBeforeShift: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Manager exempt from tab close</span>
                <p className="text-xs text-gray-500">Managers can close shift even with open tabs</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.barTabs?.managerExemptFromTabClose ?? true}
                  onChange={(e) => updateBarTabs({ managerExemptFromTabClose: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {/* Declined Capture */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max Capture Retries
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="10"
                  value={settings.barTabs?.maxCaptureRetries ?? 3}
                  onChange={(e) => updateBarTabs({ maxCaptureRetries: parseInt(e.target.value) || 3 })}
                  className="w-20 px-3 py-2 border rounded-lg"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Max retry attempts before flagging as walkout
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Auto-flag walkout after declines</span>
                <p className="text-xs text-gray-500">Automatically create walkout flag after max capture retries</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.barTabs?.autoFlagWalkoutAfterDeclines ?? true}
                  onChange={(e) => updateBarTabs({ autoFlagWalkoutAfterDeclines: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </Card>

        {/* Payment Settings */}
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Payment Settings</h2>
            <p className="text-sm text-gray-500">Payment methods, pre-auth, and tip configuration</p>
          </div>

          <div className="space-y-6">
            {/* Accepted Payment Methods */}
            <div>
              <h3 className="font-medium text-gray-900 mb-3">Accepted Payment Methods</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.payments.acceptCash} onChange={(e) => updatePayments({ acceptCash: e.target.checked })} className="rounded border-gray-300" />
                  <span className="text-sm">Cash</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.payments.acceptCredit} onChange={(e) => updatePayments({ acceptCredit: e.target.checked })} className="rounded border-gray-300" />
                  <span className="text-sm">Credit Cards</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.payments.acceptDebit} onChange={(e) => updatePayments({ acceptDebit: e.target.checked })} className="rounded border-gray-300" />
                  <span className="text-sm">Debit Cards</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.payments.acceptGiftCards} onChange={(e) => updatePayments({ acceptGiftCards: e.target.checked })} className="rounded border-gray-300" />
                  <span className="text-sm">Gift Cards</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={settings.payments.acceptHouseAccounts} onChange={(e) => updatePayments({ acceptHouseAccounts: e.target.checked })} className="rounded border-gray-300" />
                  <span className="text-sm">House Accounts</span>
                </label>
              </div>
            </div>

            {/* Pre-Auth */}
            <div>
              <h3 className="font-medium text-gray-900 mb-3">Pre-Authorization</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Enable pre-auth for tabs</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.payments.enablePreAuth}
                      onChange={(e) => updatePayments({ enablePreAuth: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                {settings.payments.enablePreAuth && (
                  <>
                    <div className="flex items-center gap-3">
                      <label className="text-sm text-gray-700 w-48">Default pre-auth amount:</label>
                      <span className="text-gray-500">$</span>
                      <input
                        type="number"
                        min="1"
                        step="5"
                        value={settings.payments.defaultPreAuthAmount}
                        onChange={(e) => updatePayments({ defaultPreAuthAmount: parseFloat(e.target.value) || 100 })}
                        className="w-24 px-3 py-2 border rounded-lg"
                      />
                    </div>

                    <div className="flex items-center gap-3">
                      <label className="text-sm text-gray-700 w-48">Pre-auth expiration:</label>
                      <input
                        type="number"
                        min="1"
                        max="30"
                        value={settings.payments.preAuthExpirationDays}
                        onChange={(e) => updatePayments({ preAuthExpirationDays: parseInt(e.target.value) || 7 })}
                        className="w-20 px-3 py-2 border rounded-lg"
                      />
                      <span className="text-sm text-gray-500">days</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Quick Pay / Tip Suggestions */}
            <div>
              <h3 className="font-medium text-gray-900 mb-3">Quick Pay & Tip Suggestions</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Enable Quick Pay</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.payments.quickPayEnabled}
                      onChange={(e) => updatePayments({ quickPayEnabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-700 w-48">Dollar tip threshold:</label>
                  <span className="text-gray-500">$</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={settings.payments.tipDollarAmountThreshold}
                    onChange={(e) => updatePayments({ tipDollarAmountThreshold: parseFloat(e.target.value) || 15 })}
                    className="w-20 px-3 py-2 border rounded-lg"
                  />
                </div>
                <p className="text-xs text-gray-500 ml-[12.5rem]">
                  Under this amount, show dollar tip suggestions instead of percentages
                </p>

                <div>
                  <label className="block text-sm text-gray-700 mb-1">Dollar tip suggestions (for small orders):</label>
                  <div className="flex gap-2">
                    {(settings.payments.tipDollarSuggestions || [1, 2, 3]).map((amt, idx) => (
                      <div key={idx} className="flex items-center gap-1">
                        <span className="text-gray-500 text-sm">$</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={amt}
                          onChange={(e) => {
                            const newArr = [...(settings.payments.tipDollarSuggestions || [1, 2, 3])]
                            newArr[idx] = parseInt(e.target.value) || 0
                            updatePayments({ tipDollarSuggestions: newArr })
                          }}
                          className="w-16 px-2 py-2 border rounded-lg text-center"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gray-700 mb-1">Percent tip suggestions (for larger orders):</label>
                  <div className="flex gap-2">
                    {(settings.payments.tipPercentSuggestions || [18, 20, 25]).map((pct, idx) => (
                      <input
                        key={idx}
                        type="number"
                        min="0"
                        step="1"
                        value={pct}
                        onChange={(e) => {
                          const newArr = [...(settings.payments.tipPercentSuggestions || [18, 20, 25])]
                          newArr[idx] = parseInt(e.target.value) || 0
                          updatePayments({ tipPercentSuggestions: newArr })
                        }}
                        className="w-16 px-2 py-2 border rounded-lg text-center"
                      />
                    ))}
                    <span className="text-gray-500 self-center">%</span>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-gray-700">Require custom for zero tip</span>
                    <p className="text-xs text-gray-500">Customer must tap Custom to skip tipping</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.payments.requireCustomForZeroTip}
                      onChange={(e) => updatePayments({ requireCustomForZeroTip: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>
            </div>

            {/* Processor */}
            <div>
              <h3 className="font-medium text-gray-900 mb-3">Card Processor</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Processor</label>
                  <select
                    value={settings.payments.processor}
                    onChange={(e) => updatePayments({ processor: e.target.value as 'none' | 'simulated' | 'datacap' })}
                    className="px-3 py-2 border rounded-lg"
                  >
                    <option value="none">None</option>
                    <option value="simulated">Simulated (Testing)</option>
                    <option value="datacap">Datacap Direct</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">Test Mode</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.payments.testMode}
                      onChange={(e) => updatePayments({ testMode: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-700 w-48">Reader timeout:</label>
                  <input
                    type="number"
                    min="10"
                    max="120"
                    step="5"
                    value={settings.payments.readerTimeoutSeconds}
                    onChange={(e) => updatePayments({ readerTimeoutSeconds: parseInt(e.target.value) || 30 })}
                    className="w-20 px-3 py-2 border rounded-lg"
                  />
                  <span className="text-sm text-gray-500">seconds</span>
                </div>
              </div>
            </div>

            {/* Walkout Recovery */}
            <div>
              <h3 className="font-medium text-gray-900 mb-3">Walkout Recovery</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-gray-700">Enable Walkout Recovery</span>
                    <p className="text-xs text-gray-500">Automatically retry capture on tabs flagged as walkouts</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.payments.walkoutRetryEnabled ?? true}
                      onChange={(e) => updatePayments({ walkoutRetryEnabled: e.target.checked })}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Retry Frequency (days)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="30"
                      value={settings.payments.walkoutRetryFrequencyDays ?? 3}
                      onChange={(e) => updatePayments({ walkoutRetryFrequencyDays: parseInt(e.target.value) || 3 })}
                      className="w-20 px-3 py-2 border rounded-lg"
                    />
                    <span className="text-gray-500">days</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    How many days between retry attempts on a walkout tab
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Retry Duration (days)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      max="365"
                      value={settings.payments.walkoutMaxRetryDays ?? 30}
                      onChange={(e) => updatePayments({ walkoutMaxRetryDays: parseInt(e.target.value) || 30 })}
                      className="w-20 px-3 py-2 border rounded-lg"
                    />
                    <span className="text-gray-500">days</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Stop retrying after this many days from the walkout date
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Auto-Detect Idle Timeout (minutes)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="15"
                      min="15"
                      max="480"
                      value={settings.payments.walkoutAutoDetectMinutes ?? 120}
                      onChange={(e) => updatePayments({ walkoutAutoDetectMinutes: parseInt(e.target.value) || 120 })}
                      className="w-24 px-3 py-2 border rounded-lg"
                    />
                    <span className="text-gray-500">minutes</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    If a tab is idle for this many minutes with a pending auth, it will be flagged as a potential walkout.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Batch Settlement — manager-gated */}
        {isSuperAdmin && (
          <Card className="p-6">
            <div className="mb-4">
              <h2 className="text-lg font-semibold">Batch Settlement</h2>
              <p className="text-sm text-gray-500">Settle all card transactions with the processor at end of day</p>
            </div>

            <div className="space-y-4">
              {/* Reader selector */}
              {paymentReaders.length === 0 ? (
                <p className="text-sm text-gray-500">No active payment readers configured for this location.</p>
              ) : (
                <>
                  {paymentReaders.length > 1 && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Payment Reader</label>
                      <select
                        value={selectedReaderId}
                        onChange={(e) => setSelectedReaderId(e.target.value)}
                        className="px-3 py-2 border rounded-lg"
                      >
                        {paymentReaders.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {paymentReaders.length === 1 && (
                    <p className="text-sm text-gray-600">
                      Reader: <span className="font-medium">{paymentReaders[0].name}</span>
                    </p>
                  )}

                  <div className="flex items-center gap-3">
                    <Button
                      variant="primary"
                      onClick={handleOpenBatchDialog}
                      disabled={!selectedReaderId}
                    >
                      Close Batch
                    </Button>
                    <p className="text-xs text-gray-500">
                      Fetches current batch summary before confirming
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Confirmation dialog */}
            {batchDialogOpen && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
                  <h3 className="text-lg font-semibold mb-4">Close Batch</h3>

                  {isFetchingBatchSummary && (
                    <div className="py-6 text-center">
                      <p className="text-sm text-gray-500">Fetching batch summary...</p>
                    </div>
                  )}

                  {!isFetchingBatchSummary && batchSummaryData && (
                    <>
                      {batchSummaryData.error ? (
                        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                          <p className="text-sm font-medium text-red-700">Reader error</p>
                          <p className="text-xs text-red-600 mt-0.5">{batchSummaryData.error.message}</p>
                        </div>
                      ) : (
                        <div className="mb-5 space-y-3">
                          <div className="bg-gray-50 border rounded-lg p-4 space-y-2">
                            {batchSummaryData.batchNo && (
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">Batch #</span>
                                <span className="font-medium text-gray-900">{batchSummaryData.batchNo}</span>
                              </div>
                            )}
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">Transaction count</span>
                              <span className="font-medium text-gray-900">
                                {batchSummaryData.transactionCount ?? '—'}
                              </span>
                            </div>
                            {batchSummaryData.hasSAFPending && (
                              <div className="flex justify-between text-sm border-t pt-2">
                                <span className="text-amber-600">SAF pending</span>
                                <span className="font-medium text-amber-700">
                                  {batchSummaryData.safCount} txn
                                  {batchSummaryData.safAmount > 0 && ` · ${formatCurrency(batchSummaryData.safAmount)}`}
                                </span>
                              </div>
                            )}
                          </div>
                          <p className="text-sm text-gray-600">
                            This will settle all transactions above with your payment processor.
                            This action cannot be undone.
                          </p>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex justify-end gap-3 mt-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setBatchDialogOpen(false)
                        setBatchSummaryData(null)
                      }}
                      disabled={isClosingBatch}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleConfirmBatchClose}
                      disabled={
                        isClosingBatch ||
                        isFetchingBatchSummary ||
                        !batchSummaryData ||
                        !!batchSummaryData.error
                      }
                    >
                      {isClosingBatch ? 'Closing...' : 'Confirm & Close Batch'}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        )}

        {/* POS Display Settings */}
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">POS Display Settings</h2>
            <p className="text-sm text-gray-500">Menu item sizing, layout, and display preferences</p>
          </div>

          <div className="space-y-4">
            {/* Menu Item Size */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Menu Item Size</label>
              <div className="flex gap-4">
                {(['compact', 'normal', 'large'] as const).map(size => (
                  <label key={size} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="menuItemSize"
                      checked={settings.posDisplay?.menuItemSize === size}
                      onChange={() => updatePosDisplay({ menuItemSize: size })}
                      className="text-blue-600"
                    />
                    <span className="text-sm capitalize">{size}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Items Per Row */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Menu Items Per Row</label>
              <select
                value={settings.posDisplay?.menuItemsPerRow ?? 5}
                onChange={(e) => updatePosDisplay({ menuItemsPerRow: parseInt(e.target.value) as 3 | 4 | 5 | 6 })}
                className="px-3 py-2 border rounded-lg"
              >
                <option value={3}>3 per row</option>
                <option value={4}>4 per row</option>
                <option value={5}>5 per row</option>
                <option value={6}>6 per row</option>
              </select>
            </div>

            {/* Category Size */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Category Button Size</label>
              <div className="flex gap-4">
                {([
                  { value: 'sm', label: 'Small' },
                  { value: 'md', label: 'Medium' },
                  { value: 'lg', label: 'Large' },
                ] as const).map(({ value, label }) => (
                  <label key={value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="categorySize"
                      checked={settings.posDisplay?.categorySize === value}
                      onChange={() => updatePosDisplay({ categorySize: value })}
                      className="text-blue-600"
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Order Panel Width */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Order Panel Width</label>
              <div className="flex gap-4">
                {(['narrow', 'normal', 'wide'] as const).map(width => (
                  <label key={width} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="orderPanelWidth"
                      checked={settings.posDisplay?.orderPanelWidth === width}
                      onChange={() => updatePosDisplay({ orderPanelWidth: width })}
                      className="text-blue-600"
                    />
                    <span className="text-sm capitalize">{width}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Color Mode */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Category Color Mode</label>
              <div className="flex gap-4">
                {(['solid', 'subtle', 'outline'] as const).map(mode => (
                  <label key={mode} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="categoryColorMode"
                      checked={settings.posDisplay?.categoryColorMode === mode}
                      onChange={() => updatePosDisplay({ categoryColorMode: mode })}
                      className="text-blue-600"
                    />
                    <span className="text-sm capitalize">{mode}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Show Prices */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Show prices on menu items</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.posDisplay?.showPriceOnMenuItems ?? true}
                  onChange={(e) => updatePosDisplay({ showPriceOnMenuItems: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </Card>

        {/* Receipt Settings */}
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Receipt Settings</h2>
            <p className="text-sm text-gray-500">Customize receipt header, footer, and display options</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Header Text</label>
              <input
                type="text"
                value={settings.receipts?.headerText ?? ''}
                onChange={(e) => updateReceipts({ headerText: e.target.value })}
                placeholder="Thank you for your visit!"
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Footer Text</label>
              <input
                type="text"
                value={settings.receipts?.footerText ?? ''}
                onChange={(e) => updateReceipts({ footerText: e.target.value })}
                placeholder="See you next time!"
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Show server name on receipt</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.receipts?.showServerName ?? true}
                  onChange={(e) => updateReceipts({ showServerName: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Show table number on receipt</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.receipts?.showTableNumber ?? true}
                  onChange={(e) => updateReceipts({ showTableNumber: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </Card>

        {/* Auto-Reboot Schedule */}
        <Card className="p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">System</h2>
            <p className="text-sm text-gray-500">Automatic maintenance and reboot schedule</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-gray-700">Enable automatic nightly reboot</span>
                <p className="text-xs text-gray-500">Restarts the POS server automatically after midnight to clear memory and apply updates</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.autoReboot?.enabled ?? false}
                  onChange={(e) => updateAutoReboot({ enabled: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {settings.autoReboot?.enabled && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reboot delay after midnight (minutes)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="5"
                    min="0"
                    max="240"
                    value={settings.autoReboot?.delayMinutes ?? 30}
                    onChange={(e) => updateAutoReboot({ delayMinutes: parseInt(e.target.value) || 30 })}
                    className="w-20 px-3 py-2 border rounded-lg"
                  />
                  <span className="text-gray-500">minutes</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  System will reboot this many minutes after midnight (e.g., 30 = reboot at 12:30 AM)
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Hardware Health Status */}
        <div className="bg-slate-900 rounded-xl overflow-hidden">
          <HardwareHealthWidget
            terminals={terminals}
            printers={printers}
            kdsScreens={kdsScreens}
          />
        </div>

        {/* Quick Links */}
        <Card className="p-6">
          <h2 className="text-lg font-semibold mb-4">Quick Links</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Link
              href="/settings/hardware"
              className="p-4 border rounded-lg hover:bg-gray-50 text-center"
            >
              <svg className="w-6 h-6 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              <span className="text-sm font-medium">Hardware</span>
            </Link>
            <Link
              href="/settings/order-types"
              className="p-4 border rounded-lg hover:bg-gray-50 text-center"
            >
              <svg className="w-6 h-6 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              <span className="text-sm font-medium">Order Types</span>
            </Link>
            <Link
              href="/settings/tip-outs"
              className="p-4 border rounded-lg hover:bg-gray-50 text-center"
            >
              <svg className="w-6 h-6 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-sm font-medium">Tip-Outs</span>
            </Link>
            <Link
              href="/menu"
              className="p-4 border rounded-lg hover:bg-gray-50 text-center"
            >
              <svg className="w-6 h-6 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <span className="text-sm font-medium">Menu</span>
            </Link>
            <Link
              href="/reports/commission"
              className="p-4 border rounded-lg hover:bg-gray-50 text-center"
            >
              <svg className="w-6 h-6 mx-auto mb-2 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-sm font-medium">Commissions</span>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  )
}
