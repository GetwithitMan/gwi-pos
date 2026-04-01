'use client'

import { memo } from 'react'
import SharedOwnershipModal from '@/components/tips/SharedOwnershipModal'
import { CustomerLookupModal } from '@/components/customers/CustomerLookupModal'
import { CustomerProfileModal } from '@/components/customers/CustomerProfileModal'
import { SeatAllergyModal } from './SeatAllergyModal'
import { useOrderPanelStore } from '@/stores/order-panel-store'
import { clientLog } from '@/lib/client-logger'

interface OrderPanelModalsProps {
  orderId?: string | null
  locationId?: string
  employeeId?: string
  employeeRole?: string
  handleSelectCustomer: (customer: any) => void
  submitTaxExempt: () => void
}

export const OrderPanelModals = memo(function OrderPanelModals({
  orderId,
  locationId,
  employeeId,
  employeeRole,
  handleSelectCustomer,
  submitTaxExempt,
}: OrderPanelModalsProps) {
  const showShareOwnership = useOrderPanelStore(s => s.showShareOwnership)
  const setShowShareOwnership = useOrderPanelStore(s => s.setShowShareOwnership)
  const showCustomerModal = useOrderPanelStore(s => s.showCustomerModal)
  const setShowCustomerModal = useOrderPanelStore(s => s.setShowCustomerModal)
  const showCustomerProfile = useOrderPanelStore(s => s.showCustomerProfile)
  const setShowCustomerProfile = useOrderPanelStore(s => s.setShowCustomerProfile)
  const linkedCustomer = useOrderPanelStore(s => s.linkedCustomer)
  const loyaltyEnabled = useOrderPanelStore(s => s.loyaltyEnabled)
  const showTaxExemptDialog = useOrderPanelStore(s => s.showTaxExemptDialog)
  const setShowTaxExemptDialog = useOrderPanelStore(s => s.setShowTaxExemptDialog)
  const taxExemptReason = useOrderPanelStore(s => s.taxExemptReason)
  const setTaxExemptReason = useOrderPanelStore(s => s.setTaxExemptReason)
  const taxExemptId = useOrderPanelStore(s => s.taxExemptId)
  const setTaxExemptId = useOrderPanelStore(s => s.setTaxExemptId)
  const allergyModalSeat = useOrderPanelStore(s => s.allergyModalSeat)
  const setAllergyModalSeat = useOrderPanelStore(s => s.setAllergyModalSeat)
  const seatAllergyNotes = useOrderPanelStore(s => s.seatAllergyNotes)
  const setSeatAllergyNotes = useOrderPanelStore(s => s.setSeatAllergyNotes)

  return (
    <>
      {/* Shared Ownership Modal */}
      {orderId && locationId && employeeId && (
        <SharedOwnershipModal
          orderId={orderId}
          locationId={locationId}
          employeeId={employeeId}
          isOpen={showShareOwnership}
          onClose={() => setShowShareOwnership(false)}
        />
      )}

      {/* Customer Lookup Modal */}
      <CustomerLookupModal
        isOpen={showCustomerModal}
        onClose={() => setShowCustomerModal(false)}
        locationId={locationId || ''}
        employeeId={employeeId}
        currentCustomerId={linkedCustomer?.id ?? null}
        onSelectCustomer={handleSelectCustomer}
        loyaltyEnabled={loyaltyEnabled}
      />

      {/* Customer Profile Modal (shown when clicking linked customer) */}
      {linkedCustomer && (
        <CustomerProfileModal
          isOpen={showCustomerProfile}
          onClose={() => setShowCustomerProfile(false)}
          customerId={linkedCustomer.id}
          locationId={locationId || ''}
          employeeId={employeeId || ''}
          isManager={employeeRole === 'manager' || employeeRole === 'admin' || employeeRole === 'owner'}
          loyaltyEnabled={loyaltyEnabled}
          onChangeCustomer={() => {
            setShowCustomerProfile(false)
            setShowCustomerModal(true)
          }}
          onRemoveCustomer={() => {
            setShowCustomerProfile(false)
            handleSelectCustomer(null)
          }}
        />
      )}

      {/* Tax Exempt Dialog */}
      {showTaxExemptDialog && (
        <TaxExemptDialog
          taxExemptReason={taxExemptReason}
          setTaxExemptReason={setTaxExemptReason}
          taxExemptId={taxExemptId}
          setTaxExemptId={setTaxExemptId}
          onCancel={() => setShowTaxExemptDialog(false)}
          onSubmit={submitTaxExempt}
        />
      )}

      {/* Seat Allergy Notes Modal */}
      {allergyModalSeat && (
        <SeatAllergyModal
          seatNumber={allergyModalSeat.seatNumber}
          currentNotes={seatAllergyNotes[allergyModalSeat.seatNumber] || ''}
          position={allergyModalSeat.position}
          onSave={(seatNumber, notes) => {
            setSeatAllergyNotes(prev => {
              const next = { ...prev }
              if (notes.trim()) {
                next[seatNumber] = notes
              } else {
                delete next[seatNumber]
              }
              return next
            })
            if (orderId) {
              void fetch(`/api/orders/${orderId}/seat-notes`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ seatNumber, allergyNotes: notes }),
              }).catch(err => clientLog.warn('Operation failed:', err))
            }
          }}
          onClose={() => setAllergyModalSeat(null)}
        />
      )}
    </>
  )
})

// ─── Tax Exempt Dialog (inline sub-component) ───────────────────────────────

interface TaxExemptDialogProps {
  taxExemptReason: string
  setTaxExemptReason: (v: string) => void
  taxExemptId: string
  setTaxExemptId: (v: string) => void
  onCancel: () => void
  onSubmit: () => void
}

function TaxExemptDialog({
  taxExemptReason,
  setTaxExemptReason,
  taxExemptId,
  setTaxExemptId,
  onCancel,
  onSubmit,
}: TaxExemptDialogProps) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.6)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 60,
    }}>
      <div style={{
        background: 'rgba(15, 23, 42, 0.95)',
        backdropFilter: 'blur(20px)',
        borderRadius: 16,
        border: '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: '0 25px 50px rgba(0, 0, 0, 0.5)',
        width: '100%',
        maxWidth: 400,
        padding: 24,
      }}>
        <h3 style={{ color: '#f1f5f9', fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
          Tax Exempt
        </h3>

        {/* Tax Exempt Reason */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'block', color: '#94a3b8', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            Reason <span style={{ color: '#f87171' }}>*</span>
          </label>
          <select
            value={taxExemptReason}
            onChange={e => setTaxExemptReason(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(100, 116, 139, 0.3)',
              borderRadius: 8,
              color: '#ffffff',
              fontSize: 14,
              outline: 'none',
            }}
          >
            <option value="">Select reason...</option>
            <option value="Government purchase">Government purchase</option>
            <option value="Resale certificate">Resale certificate</option>
            <option value="Non-profit organization">Non-profit organization</option>
            <option value="Diplomatic exemption">Diplomatic exemption</option>
            <option value="Agricultural exemption">Agricultural exemption</option>
            <option value="Other">Other</option>
          </select>
        </div>

        {/* Custom reason input (when "Other" is selected) */}
        {taxExemptReason === 'Other' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              Specify Reason <span style={{ color: '#f87171' }}>*</span>
            </label>
            <input
              type="text"
              value=""
              onChange={e => setTaxExemptReason(e.target.value)}
              placeholder="Enter exemption reason..."
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'rgba(15, 23, 42, 0.8)',
                border: '1px solid rgba(100, 116, 139, 0.3)',
                borderRadius: 8,
                color: '#ffffff',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>
        )}

        {/* Tax ID (optional) */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', color: '#94a3b8', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            Tax Exempt ID / Certificate # (optional)
          </label>
          <input
            type="text"
            value={taxExemptId}
            onChange={e => setTaxExemptId(e.target.value)}
            placeholder="e.g., EIN, certificate number..."
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(100, 116, 139, 0.3)',
              borderRadius: 8,
              color: '#ffffff',
              fontSize: 14,
              outline: 'none',
            }}
          />
        </div>

        {/* Info banner */}
        <div style={{
          padding: 10,
          borderRadius: 8,
          background: 'rgba(251, 191, 36, 0.1)',
          border: '1px solid rgba(251, 191, 36, 0.2)',
          color: '#fbbf24',
          fontSize: 12,
          marginBottom: 16,
        }}>
          Tax exemption will set all tax to $0 for this order. The pre-exempt tax amount is preserved for audit.
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: 10,
              border: '1px solid rgba(100, 116, 139, 0.3)',
              background: 'transparent',
              color: '#94a3b8',
              fontSize: 15,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={!taxExemptReason.trim() || taxExemptReason === 'Other'}
            style={{
              flex: 1,
              padding: '12px 16px',
              borderRadius: 10,
              border: 'none',
              background: (!taxExemptReason.trim() || taxExemptReason === 'Other') ? '#374151' : '#f59e0b',
              color: (!taxExemptReason.trim() || taxExemptReason === 'Other') ? '#6b7280' : '#1e293b',
              fontSize: 15,
              fontWeight: 700,
              cursor: (!taxExemptReason.trim() || taxExemptReason === 'Other') ? 'not-allowed' : 'pointer',
            }}
          >
            Apply Tax Exempt
          </button>
        </div>
      </div>
    </div>
  )
}
