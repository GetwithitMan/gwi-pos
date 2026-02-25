'use client'

import { useState, useCallback } from 'react'
import { Modal } from '@/components/ui/modal'
import { useScale } from '@/hooks/useScale'
import { toast } from '@/stores/toast-store'

interface WeightCaptureItem {
  id: string
  name: string
  pricePerWeightUnit: number
  weightUnit: string
}

interface WeightCaptureModalProps {
  isOpen: boolean
  onClose: () => void
  item: WeightCaptureItem
  scaleId: string | null | undefined
  onConfirm: (
    weight: number,
    weightUnit: string,
    unitPrice: number,
    grossWeight?: number,
    tareWeight?: number,
  ) => void
}

export function WeightCaptureModal({
  isOpen,
  onClose,
  item,
  scaleId,
  onConfirm,
}: WeightCaptureModalProps) {
  const { weight, unit, stable, connected, grossNet, overCapacity, lastGrossWeight, tare } = useScale(scaleId)
  const [manualWeight, setManualWeight] = useState('')

  const effectiveWeight = weight ?? 0
  const livePrice = effectiveWeight * item.pricePerWeightUnit

  const manualValue = manualWeight ? parseFloat(manualWeight) : 0
  const manualPrice = manualValue * item.pricePerWeightUnit

  // Can add: scale is stable with positive weight, OR manual entry has a positive value
  const canAddFromScale = connected && stable && effectiveWeight > 0 && !overCapacity
  const canAddFromManual = manualValue > 0
  const canAdd = canAddFromScale || canAddFromManual

  // Weight display color: green=stable, yellow=unstable, red=disconnected/error
  const weightColor = !connected
    ? '#ef4444' // red
    : overCapacity
      ? '#ef4444' // red
      : stable
        ? '#22c55e' // green
        : '#eab308' // yellow

  const handleTare = useCallback(async () => {
    await tare()
  }, [tare])

  const handleConfirm = useCallback(() => {
    if (canAddFromScale && !manualValue) {
      // Use scale reading
      let grossWt: number | undefined
      let tareWt: number | undefined
      if (grossNet === 'net') {
        // Scale is in net mode — tare was used
        if (lastGrossWeight != null && lastGrossWeight > 0) {
          // We saw gross readings before tare — compute exact values
          tareWt = lastGrossWeight
          grossWt = effectiveWeight + lastGrossWeight
        } else {
          // Scale was already in net mode (tared before modal opened).
          // We know tare was used but don't have the exact container weight.
          // Pass grossWeight = undefined, tareWeight = small positive signal
          // so receipt/ticket "NET" label triggers (checks tareWeight > 0).
          tareWt = 0.001
          grossWt = undefined
        }
      } else {
        // Gross mode — no tare, weight is the full gross weight
        grossWt = effectiveWeight
      }
      onConfirm(effectiveWeight, unit, item.pricePerWeightUnit, grossWt, tareWt)
    } else if (canAddFromManual) {
      // Use manual entry
      onConfirm(manualValue, item.weightUnit, item.pricePerWeightUnit)
    } else {
      toast.warning('No valid weight to capture')
      return
    }
    setManualWeight('')
    onClose()
  }, [canAddFromScale, canAddFromManual, effectiveWeight, manualValue, unit, grossNet, lastGrossWeight, item, onConfirm, onClose])

  const handleClose = useCallback(() => {
    setManualWeight('')
    onClose()
  }, [onClose])

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={`Weigh — ${item.name}`} size="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {/* Price per unit display */}
        <div style={{
          textAlign: 'center',
          padding: '8px 16px',
          background: 'rgba(99, 102, 241, 0.1)',
          borderRadius: '10px',
          border: '1px solid rgba(99, 102, 241, 0.2)',
        }}>
          <span style={{ fontSize: '14px', color: '#94a3b8' }}>
            ${item.pricePerWeightUnit.toFixed(2)} / {item.weightUnit}
          </span>
        </div>

        {/* Scale reading display */}
        <div style={{
          textAlign: 'center',
          padding: '24px 16px',
          background: 'rgba(255, 255, 255, 0.03)',
          borderRadius: '12px',
          border: `2px solid ${connected ? (stable ? 'rgba(34, 197, 94, 0.3)' : 'rgba(234, 179, 8, 0.3)') : 'rgba(239, 68, 68, 0.3)'}`,
        }}>
          {connected ? (
            <>
              <div style={{
                fontSize: '48px',
                fontWeight: 700,
                fontFamily: 'monospace',
                color: weightColor,
                lineHeight: 1.1,
              }}>
                {effectiveWeight.toFixed(2)}
              </div>
              <div style={{
                fontSize: '18px',
                color: weightColor,
                fontWeight: 600,
                marginTop: '4px',
              }}>
                {unit}
              </div>
              <div style={{
                fontSize: '12px',
                color: '#64748b',
                marginTop: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}>
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}>
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: weightColor,
                    display: 'inline-block',
                  }} />
                  {stable ? 'Stable' : 'Stabilizing...'}
                </span>
                {grossNet === 'net' && (
                  <span style={{
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: 'rgba(99, 102, 241, 0.15)',
                    color: '#a5b4fc',
                    fontSize: '10px',
                    fontWeight: 600,
                  }}>
                    NET
                  </span>
                )}
                {overCapacity && (
                  <span style={{
                    padding: '1px 6px',
                    borderRadius: '4px',
                    background: 'rgba(239, 68, 68, 0.2)',
                    color: '#f87171',
                    fontSize: '10px',
                    fontWeight: 700,
                  }}>
                    OVER CAPACITY
                  </span>
                )}
              </div>
              {/* Live price calculation */}
              {effectiveWeight > 0 && (
                <div style={{
                  marginTop: '12px',
                  fontSize: '24px',
                  fontWeight: 700,
                  color: stable ? '#22c55e' : '#94a3b8',
                }}>
                  ${livePrice.toFixed(2)}
                </div>
              )}
            </>
          ) : (
            <div style={{ color: scaleId ? '#ef4444' : '#eab308', fontSize: '16px', fontWeight: 500 }}>
              <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ margin: '0 auto 8px', display: 'block' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={scaleId ? "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" : "M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"} />
              </svg>
              {scaleId ? 'Scale Disconnected' : 'No Scale Found'}
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>
                Enter weight manually below
              </div>
            </div>
          )}
        </div>

        {/* Manual weight entry */}
        <div>
          <label style={{
            display: 'block',
            fontSize: '12px',
            fontWeight: 600,
            color: '#94a3b8',
            marginBottom: '6px',
          }}>
            Manual Entry {connected && <span style={{ fontWeight: 400, color: '#64748b' }}>(override)</span>}
          </label>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={manualWeight}
              onChange={(e) => setManualWeight(e.target.value)}
              style={{
                flex: 1,
                height: '40px',
                padding: '0 12px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '8px',
                color: '#e2e8f0',
                fontSize: '16px',
                fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <span style={{ fontSize: '14px', color: '#94a3b8', fontWeight: 600 }}>
              {item.weightUnit}
            </span>
          </div>
          {manualValue > 0 && (
            <div style={{
              marginTop: '4px',
              fontSize: '13px',
              color: '#a5b4fc',
              textAlign: 'right',
            }}>
              = ${manualPrice.toFixed(2)}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {connected && (
            <button
              onClick={handleTare}
              style={{
                flex: 1,
                height: '44px',
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: '10px',
                color: '#a5b4fc',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Tare
            </button>
          )}
          <button
            onClick={handleClose}
            style={{
              flex: 1,
              height: '44px',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '10px',
              color: '#94a3b8',
              fontSize: '14px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canAdd}
            style={{
              flex: 2,
              height: '44px',
              background: canAdd ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.04)',
              border: `1px solid ${canAdd ? 'rgba(34, 197, 94, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
              borderRadius: '10px',
              color: canAdd ? '#4ade80' : '#475569',
              fontSize: '14px',
              fontWeight: 700,
              cursor: canAdd ? 'pointer' : 'not-allowed',
              opacity: canAdd ? 1 : 0.5,
            }}
          >
            Add to Order
          </button>
        </div>
      </div>
    </Modal>
  )
}
