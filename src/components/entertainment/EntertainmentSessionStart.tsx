'use client'

import { useState, useEffect } from 'react'
import {
  PrepaidPackage,
  HappyHourConfig,
  isHappyHour,
  getActiveRate,
  getPackageSavings,
} from '@/lib/entertainment-pricing'

interface EntertainmentSessionStartProps {
  itemName: string
  itemId: string
  locationId: string
  ratePerMinute: number
  prepaidPackages?: PrepaidPackage[]
  happyHour?: HappyHourConfig
  // Tab handling
  currentOrderId?: string | null      // Currently open order in POS (if any)
  currentOrderName?: string | null    // "Mike's Party" or "Table 5"
  openTabs?: Array<{                  // List of open tabs to choose from
    id: string
    name: string
    total: number
  }>
  // Callbacks
  onStartWithCurrentOrder: (pkg?: PrepaidPackage) => void  // Add to current order
  onStartWithNewTab: (tabName: string, pkg?: PrepaidPackage) => void  // Create new tab
  onStartWithExistingTab: (orderId: string, pkg?: PrepaidPackage) => void  // Add to existing
  onClose: () => void
}

export function EntertainmentSessionStart({
  itemName,
  itemId,
  locationId,
  ratePerMinute,
  prepaidPackages = [],
  happyHour,
  currentOrderId,
  currentOrderName,
  openTabs,
  onStartWithCurrentOrder,
  onStartWithNewTab,
  onStartWithExistingTab,
  onClose,
}: EntertainmentSessionStartProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [step, setStep] = useState<'tab-select' | 'pricing'>('tab-select')
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null)
  const [selectedTabName, setSelectedTabName] = useState<string | null>(null)
  const [newTabName, setNewTabName] = useState('')
  const [showNewTabInput, setShowNewTabInput] = useState(false)

  const now = new Date()
  const happyHourActive = isHappyHour(now, happyHour)
  const { rate: activeRate } = getActiveRate(ratePerMinute, happyHour, now)

  // Skip tab selection if currentOrderId exists
  useEffect(() => {
    if (currentOrderId) {
      setStep('pricing')
      setSelectedTabId(currentOrderId)
      setSelectedTabName(currentOrderName || 'Current Tab')
    }
  }, [currentOrderId, currentOrderName])

  const handleStartSession = async (pkg?: PrepaidPackage) => {
    setIsProcessing(true)
    try {
      if (currentOrderId) {
        // Add to currently open order
        onStartWithCurrentOrder(pkg)
      } else if (selectedTabId) {
        // Add to existing tab
        onStartWithExistingTab(selectedTabId, pkg)
      } else if (selectedTabName) {
        // Create new tab
        onStartWithNewTab(selectedTabName, pkg)
      }
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-xl border-2 border-gray-200 w-80">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50 rounded-t-lg">
        <div className="flex items-center gap-2">
          <span className="text-xl">🎱</span>
          <span className="font-bold">Start {itemName}</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl"
        >
          ×
        </button>
      </div>

      {/* Tab Selection View */}
      {step === 'tab-select' && (
        <div className="p-4">
          <p className="text-gray-600 mb-4">Select or create a tab:</p>

          {/* New Tab Button or Input */}
          {showNewTabInput ? (
            <div className="mb-4">
              <input
                type="text"
                value={newTabName}
                onChange={e => setNewTabName(e.target.value)}
                placeholder="Enter tab name..."
                className="w-full px-3 py-2 border rounded mb-2"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (newTabName.trim()) {
                      setSelectedTabName(newTabName.trim())
                      setSelectedTabId(null) // Will create new
                      setStep('pricing')
                    }
                  }}
                  disabled={!newTabName.trim()}
                  className="flex-1 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
                >
                  Continue
                </button>
                <button
                  onClick={() => {
                    setShowNewTabInput(false)
                    setNewTabName('')
                  }}
                  className="px-4 py-2 border rounded"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowNewTabInput(true)}
              className="w-full p-4 mb-4 bg-blue-50 border-2 border-blue-300 rounded-lg hover:bg-blue-100 text-left"
            >
              <span className="text-lg">➕</span>
              <span className="font-bold text-blue-800 ml-2">OPEN NEW TAB</span>
            </button>
          )}

          {/* Existing Tabs */}
          {openTabs && openTabs.length > 0 && (
            <>
              <p className="text-sm text-gray-500 mb-2">Or add to existing tab:</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {openTabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => {
                      setSelectedTabId(tab.id)
                      setSelectedTabName(tab.name)
                      setStep('pricing')
                    }}
                    className="w-full p-3 bg-gray-50 border rounded-lg hover:bg-gray-100 text-left flex justify-between"
                  >
                    <span className="font-medium">{tab.name}</span>
                    <span className="text-gray-500">${tab.total.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Pricing View */}
      {step === 'pricing' && (
        <div className="p-4">
          {/* Show selected tab */}
          <div className="mb-4 p-2 bg-gray-100 rounded flex items-center justify-between">
            <span className="text-sm text-gray-600">Adding to:</span>
            <span className="font-medium">{selectedTabName}</span>
            {!currentOrderId && (
              <button
                onClick={() => setStep('tab-select')}
                className="text-blue-500 text-sm ml-2"
              >
                Change
              </button>
            )}
          </div>

          {/* Happy Hour Badge */}
          {happyHourActive && (
            <div className="mb-4 p-2 bg-amber-100 border border-amber-300 rounded-lg text-center">
              <span className="text-amber-800 font-medium">
                🌙 Happy Hour Active! ({happyHour?.discount}% off)
              </span>
            </div>
          )}

          {/* Open Play Option */}
          <button
            onClick={() => handleStartSession()}
            disabled={isProcessing}
            className="w-full mb-4 p-4 bg-blue-50 border-2 border-blue-300 rounded-lg hover:bg-blue-100 transition-colors text-left"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">⏱️</span>
              <span className="font-bold text-blue-800">OPEN PLAY</span>
            </div>
            <div className="text-blue-600 text-sm">
              ${activeRate.toFixed(2)}/min (pay when done)
              {happyHourActive && (
                <span className="ml-1 line-through text-gray-400">
                  ${ratePerMinute.toFixed(2)}
                </span>
              )}
            </div>
          </button>

          {/* Prepaid Packages */}
          {prepaidPackages.length > 0 && (
            <>
              <div className="text-sm text-gray-500 mb-2 text-center">Or prepay:</div>
              <div className="grid grid-cols-3 gap-2">
                {prepaidPackages.map((pkg, idx) => {
                  const savings = getPackageSavings(pkg, ratePerMinute)
                  return (
                    <button
                      key={idx}
                      onClick={() => handleStartSession(pkg)}
                      disabled={isProcessing}
                      className="p-3 bg-green-50 border-2 border-green-300 rounded-lg hover:bg-green-100 transition-colors text-center"
                    >
                      <div className="font-bold text-green-800">{pkg.minutes} min</div>
                      <div className="text-green-700 font-medium">${pkg.price.toFixed(0)}</div>
                      {savings > 0 && (
                        <div className="text-xs text-green-600">save ${savings.toFixed(0)}</div>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
