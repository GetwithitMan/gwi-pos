'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import type { ReceiptSettings } from '@/lib/settings'
import { type GlobalReceiptSettings, DEFAULT_GLOBAL_RECEIPT_SETTINGS } from '@/types/print'

// ────────────────────────────────────────────
// Toggle Component
// ────────────────────────────────────────────

function Toggle({ value, onChange, label, description }: {
  value: boolean
  onChange: (v: boolean) => void
  label: string
  description?: string
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1 mr-4">
        <span className="text-sm font-medium text-gray-900">{label}</span>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          value ? 'bg-blue-600' : 'bg-gray-300'
        }`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          value ? 'translate-x-6' : 'translate-x-1'
        }`} />
      </button>
    </div>
  )
}

// ────────────────────────────────────────────
// Card Wrapper
// ────────────────────────────────────────────

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      </div>
      <div className="px-5 py-4 space-y-1">
        {children}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────
// Page Component
// ────────────────────────────────────────────

export default function ReceiptSettingsPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  // Header & Footer (settings.receipts)
  const [receipts, setReceipts] = useState<ReceiptSettings>({
    headerText: 'Thank you for your visit!',
    footerText: '',
    showServerName: true,
    showTableNumber: true,
  })

  // Receipt Display (settings.receiptDisplay)
  const [receiptDisplay, setReceiptDisplay] = useState<GlobalReceiptSettings>(
    JSON.parse(JSON.stringify(DEFAULT_GLOBAL_RECEIPT_SETTINGS))
  )

  // ──── Auth redirect ────
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

  // ──── Load settings ────
  const loadSettings = useCallback(async () => {
    try {
      setIsLoading(true)
      const res = await fetch('/api/settings')
      if (!res.ok) {
        toast.error('Failed to load receipt settings')
        return
      }
      const data = await res.json()
      if (data.settings?.receipts) {
        setReceipts(data.settings.receipts)
      }
      if (data.settings?.receiptDisplay) {
        setReceiptDisplay(data.settings.receiptDisplay)
      }
    } catch {
      toast.error('Failed to load receipt settings')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // ──── Save settings ────
  const handleSave = async () => {
    try {
      setIsSaving(true)
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: employee?.id,
          settings: {
            receipts,
            receiptDisplay,
          },
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to save receipt settings')
        return
      }
      const data = await res.json()
      if (data.settings?.receipts) setReceipts(data.settings.receipts)
      if (data.settings?.receiptDisplay) setReceiptDisplay(data.settings.receiptDisplay)
      setIsDirty(false)
      toast.success('Receipt settings saved')
    } catch {
      toast.error('Failed to save receipt settings')
    } finally {
      setIsSaving(false)
    }
  }

  // ──── Helpers to update nested state ────
  function updateReceipts<K extends keyof ReceiptSettings>(key: K, value: ReceiptSettings[K]) {
    setReceipts(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  function updateReceipt<K extends keyof GlobalReceiptSettings['receipt']>(key: K, value: GlobalReceiptSettings['receipt'][K]) {
    setReceiptDisplay(prev => ({ ...prev, receipt: { ...prev.receipt, [key]: value } }))
    setIsDirty(true)
  }

  function updateTips<K extends keyof GlobalReceiptSettings['tips']>(key: K, value: GlobalReceiptSettings['tips'][K]) {
    setReceiptDisplay(prev => ({ ...prev, tips: { ...prev.tips, [key]: value } }))
    setIsDirty(true)
  }

  function updateSignature<K extends keyof GlobalReceiptSettings['signature']>(key: K, value: GlobalReceiptSettings['signature'][K]) {
    setReceiptDisplay(prev => ({ ...prev, signature: { ...prev.signature, [key]: value } }))
    setIsDirty(true)
  }

  function updateFooter<K extends keyof GlobalReceiptSettings['footer']>(key: K, value: GlobalReceiptSettings['footer'][K]) {
    setReceiptDisplay(prev => ({ ...prev, footer: { ...prev.footer, [key]: value } }))
    setIsDirty(true)
  }

  function updateKitchen<K extends keyof GlobalReceiptSettings['kitchen']>(key: K, value: GlobalReceiptSettings['kitchen'][K]) {
    setReceiptDisplay(prev => ({ ...prev, kitchen: { ...prev.kitchen, [key]: value } }))
    setIsDirty(true)
  }

  function updateBar<K extends keyof GlobalReceiptSettings['bar']>(key: K, value: GlobalReceiptSettings['bar'][K]) {
    setReceiptDisplay(prev => ({ ...prev, bar: { ...prev.bar, [key]: value } }))
    setIsDirty(true)
  }

  // ──── Loading state ────
  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Receipt Settings</h1>
        <p className="text-gray-500 mb-6">Loading...</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto pb-24">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Receipt Settings</h1>
        <p className="text-gray-500 text-sm">Receipt content, tip display, signature, kitchen and bar ticket formatting.</p>
      </div>

      <div className="space-y-6">

        {/* ─── Card 1: Header & Footer ─── */}
        <SettingsCard title="Header & Footer">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Header Text</label>
              <input
                type="text"
                value={receipts.headerText}
                onChange={e => updateReceipts('headerText', e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Thank you for your visit!"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Footer Text</label>
              <input
                type="text"
                value={receipts.footerText}
                onChange={e => updateReceipts('footerText', e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="We appreciate your business"
              />
            </div>
            <Toggle
              value={receipts.showServerName}
              onChange={v => updateReceipts('showServerName', v)}
              label="Show server name"
            />
            <Toggle
              value={receipts.showTableNumber}
              onChange={v => updateReceipts('showTableNumber', v)}
              label="Show table number"
            />
          </div>
        </SettingsCard>

        {/* ─── Card 2: Receipt Content ─── */}
        <SettingsCard title="Receipt Content">
          <Toggle value={receiptDisplay.receipt.showItemizedItems} onChange={v => updateReceipt('showItemizedItems', v)} label="Show itemized items" />
          <Toggle value={receiptDisplay.receipt.showItemPrices} onChange={v => updateReceipt('showItemPrices', v)} label="Show item prices" />
          <Toggle value={receiptDisplay.receipt.showModifiers} onChange={v => updateReceipt('showModifiers', v)} label="Show modifiers" />
          <Toggle value={receiptDisplay.receipt.showModifierPrices} onChange={v => updateReceipt('showModifierPrices', v)} label="Show modifier prices" />
          <Toggle value={receiptDisplay.receipt.collapseDuplicates} onChange={v => updateReceipt('collapseDuplicates', v)} label="Collapse duplicates (2x Burger)" />
          <div className="border-t border-gray-100 my-2" />
          <Toggle value={receiptDisplay.receipt.showSubtotal} onChange={v => updateReceipt('showSubtotal', v)} label="Show subtotal" />
          <Toggle value={receiptDisplay.receipt.showTax} onChange={v => updateReceipt('showTax', v)} label="Show tax" />
          <Toggle value={receiptDisplay.receipt.showTaxBreakdown} onChange={v => updateReceipt('showTaxBreakdown', v)} label="Show each tax type separately" />
          <Toggle value={receiptDisplay.receipt.showDiscounts} onChange={v => updateReceipt('showDiscounts', v)} label="Show discounts" />
          <Toggle value={receiptDisplay.receipt.showServiceCharge} onChange={v => updateReceipt('showServiceCharge', v)} label="Show auto-gratuity line" />
          <div className="border-t border-gray-100 my-2" />
          <Toggle value={receiptDisplay.receipt.showPaymentMethod} onChange={v => updateReceipt('showPaymentMethod', v)} label="Show payment method (VISA *1234)" />
          <Toggle value={receiptDisplay.receipt.showChange} onChange={v => updateReceipt('showChange', v)} label="Show cash change amount" />
        </SettingsCard>

        {/* ─── Card 3: Tip Section ─── */}
        <SettingsCard title="Tip Section">
          <Toggle value={receiptDisplay.tips.enabled} onChange={v => updateTips('enabled', v)} label="Show tip section on receipt" />
          {receiptDisplay.tips.enabled && (
            <>
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Suggested tip percentages</label>
                <input
                  type="text"
                  value={receiptDisplay.tips.suggestedTips.join(', ')}
                  onChange={e => {
                    const nums = e.target.value
                      .split(',')
                      .map(s => s.trim())
                      .filter(s => s !== '')
                      .map(Number)
                      .filter(n => !isNaN(n) && n > 0)
                    updateTips('suggestedTips', nums.length > 0 ? nums : [18, 20, 22])
                  }}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="18, 20, 22"
                />
                <p className="text-xs text-gray-400 mt-1">Comma-separated percentages</p>
              </div>
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Calculation basis</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => updateTips('calculation', 'pre-tax')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      receiptDisplay.tips.calculation === 'pre-tax'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Pre-Tax
                  </button>
                  <button
                    onClick={() => updateTips('calculation', 'post-tax')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                      receiptDisplay.tips.calculation === 'post-tax'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Post-Tax
                  </button>
                </div>
              </div>
              <Toggle value={receiptDisplay.tips.showCalculatedAmounts} onChange={v => updateTips('showCalculatedAmounts', v)} label="Show dollar amounts next to percentages" />
              <Toggle value={receiptDisplay.tips.allowCustomTip} onChange={v => updateTips('allowCustomTip', v)} label="Show blank custom tip line" />
              <Toggle value={receiptDisplay.tips.showTipGuide} onChange={v => updateTips('showTipGuide', v)} label="Show tip guide (15% = $3.75...)" />
            </>
          )}
        </SettingsCard>

        {/* ─── Card 4: Signature ─── */}
        <SettingsCard title="Signature">
          <Toggle value={receiptDisplay.signature.required} onChange={v => updateSignature('required', v)} label="Require signature" />
          {receiptDisplay.signature.required && (
            <>
              <div className="mt-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Signature threshold</label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">$</span>
                  <input
                    type="number"
                    value={receiptDisplay.signature.threshold ?? ''}
                    onChange={e => {
                      const val = e.target.value.trim()
                      updateSignature('threshold', val === '' ? null : Number(val))
                    }}
                    className="w-32 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Always"
                    min={0}
                    step={1}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">Only require signature above this amount. Leave blank to always require.</p>
              </div>
            </>
          )}
          <div className="mt-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Print copies</label>
            <div className="flex gap-2">
              <button
                onClick={() => updateSignature('printCopies', 1)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  receiptDisplay.signature.printCopies === 1
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                1 Copy
              </button>
              <button
                onClick={() => updateSignature('printCopies', 2)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  receiptDisplay.signature.printCopies === 2
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                2 Copies
              </button>
            </div>
          </div>
          <Toggle value={receiptDisplay.signature.showCopyLabels} onChange={v => updateSignature('showCopyLabels', v)} label="Print 'CUSTOMER COPY' / 'MERCHANT COPY' labels" />
        </SettingsCard>

        {/* ─── Card 5: Receipt Footer Details ─── */}
        <SettingsCard title="Receipt Footer Details">
          <Toggle value={receiptDisplay.footer.showServerName} onChange={v => updateFooter('showServerName', v)} label="Show server name" />
          <Toggle value={receiptDisplay.footer.showDateTime} onChange={v => updateFooter('showDateTime', v)} label="Show date and time" />
          <Toggle value={receiptDisplay.footer.showOrderNumber} onChange={v => updateFooter('showOrderNumber', v)} label="Show order number" />
          <Toggle value={receiptDisplay.footer.showTableName} onChange={v => updateFooter('showTableName', v)} label="Show table name" />
          <div className="border-t border-gray-100 my-2" />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Terms text</label>
            <input
              type="text"
              value={receiptDisplay.footer.termsText}
              onChange={e => updateFooter('termsText', e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Gratuity is optional"
            />
          </div>
          <div className="mt-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Promo text</label>
            <input
              type="text"
              value={receiptDisplay.footer.promoText}
              onChange={e => updateFooter('promoText', e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Thank you for your business!"
            />
          </div>
          <div className="mt-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Custom footer lines</label>
            <textarea
              value={(receiptDisplay.footer.customLines || []).join('\n')}
              onChange={e => {
                const lines = e.target.value.split('\n')
                updateFooter('customLines', lines)
              }}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              placeholder="One line per entry"
            />
            <p className="text-xs text-gray-400 mt-1">Each line will print as a separate footer line</p>
          </div>
        </SettingsCard>

        {/* ─── Card 6: Kitchen Ticket ─── */}
        <SettingsCard title="Kitchen Ticket">
          <Toggle value={receiptDisplay.kitchen.showPrices} onChange={v => updateKitchen('showPrices', v)} label="Show prices" />
          <Toggle value={receiptDisplay.kitchen.showSeatNumbers} onChange={v => updateKitchen('showSeatNumbers', v)} label="Show seat numbers" />
          <Toggle value={receiptDisplay.kitchen.showServerName} onChange={v => updateKitchen('showServerName', v)} label="Show server name" />
          <Toggle value={receiptDisplay.kitchen.showOrderType} onChange={v => updateKitchen('showOrderType', v)} label="Show order type" />
          <Toggle value={receiptDisplay.kitchen.showSpecialInstructions} onChange={v => updateKitchen('showSpecialInstructions', v)} label="Show special instructions" />
          <Toggle value={receiptDisplay.kitchen.highlightAllergies} onChange={v => updateKitchen('highlightAllergies', v)} label="Highlight allergies" />
          <Toggle value={receiptDisplay.kitchen.highlightModifications} onChange={v => updateKitchen('highlightModifications', v)} label="Highlight NO/EXTRA items" />
        </SettingsCard>

        {/* ─── Card 7: Bar Ticket ─── */}
        <SettingsCard title="Bar Ticket">
          <Toggle value={receiptDisplay.bar.showPrices} onChange={v => updateBar('showPrices', v)} label="Show prices" />
          <Toggle value={receiptDisplay.bar.showSeatNumbers} onChange={v => updateBar('showSeatNumbers', v)} label="Show seat numbers" />
          <Toggle value={receiptDisplay.bar.compactMode} onChange={v => updateBar('compactMode', v)} label="Compact layout for speed" />
        </SettingsCard>

      </div>

      {/* ─── Sticky Save Bar ─── */}
      {isDirty && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg px-6 py-3 flex items-center justify-between z-50">
          <span className="text-sm text-gray-500">You have unsaved changes</span>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}
