'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { DatacapPaymentProcessor } from '@/components/payment/DatacapPaymentProcessor'

interface CardResult {
  cardBrand: string
  cardLast4: string
  authCode: string
  datacapRecordNo: string
  datacapRefNumber: string
  datacapSequenceNo: string
  entryMethod: string
  amountAuthorized: number
}

interface PayAllSplitsModalProps {
  isOpen: boolean
  parentOrderId: string | null
  total: number
  cardTotal?: number
  unpaidCount: number
  terminalId: string
  employeeId: string
  locationId: string
  onPayCash: () => void
  onPayCard: (cardResult: CardResult) => void
  onClose: () => void
  processing?: boolean
}

export function PayAllSplitsModal({
  isOpen,
  parentOrderId,
  total,
  cardTotal,
  unpaidCount,
  terminalId,
  employeeId,
  locationId,
  onPayCash,
  onPayCard,
  onClose,
  processing,
}: PayAllSplitsModalProps) {
  const [step, setStep] = useState<'confirm' | 'datacap_card'>('confirm')

  const handleClose = () => {
    setStep('confirm')
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size={step === 'datacap_card' ? 'md' : 'sm'}>
      <div className="rounded-2xl shadow-2xl w-full overflow-hidden -m-5" style={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255,255,255,0.1)' }}>
        {step === 'confirm' && (
          <div className="p-6">
            <h3 className="text-lg font-bold text-white mb-1">Pay All Splits</h3>
            <p className="text-slate-400 text-sm mb-4">
              {unpaidCount} unpaid checks
            </p>
            <div className="rounded-xl p-4 mb-5" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
              {cardTotal && cardTotal !== total ? (
                <>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-slate-300 text-sm">Cash</span>
                    <span className="text-lg font-bold text-emerald-400">${total.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-300 text-sm">Card</span>
                    <span className="text-lg font-bold text-white">${cardTotal.toFixed(2)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between items-center">
                  <span className="text-slate-300 text-sm">Total</span>
                  <span className="text-2xl font-bold text-white">${total.toFixed(2)}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button
                onClick={onPayCash}
                disabled={processing}
                className="flex-1 py-3 rounded-xl font-bold text-white transition-all"
                style={{ background: processing ? 'rgba(34,197,94,0.3)' : 'rgba(34,197,94,0.8)' }}
              >
                {processing ? 'Processing...' : 'Cash'}
              </button>
              <button
                onClick={() => setStep('datacap_card')}
                disabled={processing}
                className="flex-1 py-3 rounded-xl font-bold text-white transition-all"
                style={{ background: processing ? 'rgba(99,102,241,0.3)' : 'rgba(99,102,241,0.8)' }}
              >
                Card
              </button>
            </div>
          </div>
        )}
        {step === 'datacap_card' && parentOrderId && (
          <div className="p-4">
            <DatacapPaymentProcessor
              orderId={parentOrderId}
              amount={cardTotal || total}
              subtotal={cardTotal || total}
              terminalId={terminalId}
              employeeId={employeeId}
              locationId={locationId}
              onSuccess={(result) => {
                onPayCard({
                  cardBrand: result.cardBrand || '',
                  cardLast4: result.cardLast4 || '',
                  authCode: result.authCode || '',
                  datacapRecordNo: result.recordNo || '',
                  datacapRefNumber: result.refNumber || '',
                  datacapSequenceNo: result.sequenceNo || '',
                  entryMethod: result.entryMethod || '',
                  amountAuthorized: result.amountAuthorized,
                })
              }}
              onCancel={() => setStep('confirm')}
            />
          </div>
        )}
        <button
          onClick={handleClose}
          className="w-full py-3 text-slate-400 text-sm font-medium border-t border-white/10 hover:bg-white/5 transition-colors"
        >
          Cancel
        </button>
      </div>
    </Modal>
  )
}
