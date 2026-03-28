'use client'

import React from 'react'
import { formatCurrency } from '@/lib/utils'
import { PAYMENT_METHOD_LABELS } from '@/lib/payment'
import { usePaymentContext } from '../PaymentContext'
import {
  sectionLabelClasses,
  methodButtonCash,
  methodButtonCard,
  methodButtonGiftCard,
  methodButtonHouseAccount,
  methodButtonRoomCharge,
  spinnerSmallClasses,
} from '../payment-styles'

/**
 * PaymentMethodStep — payment method selection UI.
 *
 * Displays: pre-authed tab cards, add-card-to-tab, payment method buttons,
 * cash exact, split payment, manual card entry, dual pricing summary.
 */
export function PaymentMethodStep() {
  const {
    paymentSettings,
    dualPricing,
    cashTotal,
    cardTotal,
    remainingBeforeTip,
    pendingPayments,
    pendingTotal,
    isProcessing,
    isConnected,
    tabCards,
    onTabCardsChanged,
    canKeyedEntry,
    addingCard,
    addCardError,
    tabAuthSlow,
    tabAuthSuccess,
    handleSelectMethod,
    handleChargeExistingCard,
    handleAddCardToTab,
    handleCashExact,
    handleSplitPayment,
    setSelectedMethod,
    setShowManualEntry,
  } = usePaymentContext()

  return (
    <div className="flex flex-col gap-2.5">

      {/* Payment Progress — shown when one or more partial payments have been collected */}
      {pendingPayments.length > 0 && (
        <div className="p-3 rounded-[10px] bg-slate-900/90 border border-indigo-500/[0.35] mb-1">
          <div className="text-[11px] text-indigo-400 uppercase tracking-widest font-bold mb-2">
            Payment Progress
          </div>
          {pendingPayments.map((p, i) => (
            <div key={i} className="flex justify-between text-[13px] text-slate-400 mb-1">
              <span className="text-indigo-300">
                {'\u2713'} {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                {p.cardLast4 ? ` \u2022\u2022\u2022${p.cardLast4}` : ''}
                {p.storedOffline && (
                  <span className="ml-1.5 text-[10px] text-amber-500 bg-amber-500/15 px-1.5 py-px rounded font-bold">SAF</span>
                )}
              </span>
              <span className="font-mono text-indigo-200">
                {formatCurrency(p.amount + p.tipAmount)}
              </span>
            </div>
          ))}
          <div className="border-t border-indigo-500/25 mt-2 pt-2 flex justify-between font-bold text-sm">
            <span className="text-amber-500">Remaining</span>
            <span className="font-mono text-amber-500">
              {formatCurrency(remainingBeforeTip)}
            </span>
          </div>
        </div>
      )}

      <h3 className={sectionLabelClasses}>Select Payment Method</h3>

      {/* Disconnected warning */}
      {!isConnected && (
        <div className="py-3 px-4 rounded-[10px] bg-red-500/15 border border-red-500/40 flex items-center gap-2.5 mb-1">
          <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="text-red-400 text-sm font-semibold">
            Card payments unavailable — no connection to server. Cash accepted.
          </span>
        </div>
      )}

      {/* Pre-authed tab cards — charge existing card */}
      {tabCards.length > 0 && (
        <div className="flex flex-col gap-2 mb-1">
          <div className="text-[11px] text-slate-400 uppercase tracking-widest font-semibold">Cards on Tab</div>
          {tabCards.map((card) => (
            <button
              key={card.id}
              onClick={() => handleChargeExistingCard(card)}
              disabled={isProcessing || !isConnected}
              className={`w-full h-[72px] flex items-center gap-4 px-5 rounded-xl border-2 border-purple-500/60 bg-purple-500/[0.18] text-left shadow-[0_2px_8px_rgba(168,85,247,0.25)] ${(!isConnected) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-purple-500/25'}`}
            >
              <span className="text-[28px]">{'\uD83D\uDCB3'}</span>
              <div className="flex-1">
                <div className="text-slate-100 text-[17px] font-semibold">
                  Charge {'\u2022\u2022\u2022'}{card.cardLast4}
                  {card.isDefault && <span className="ml-2 text-[11px] text-purple-400 bg-purple-400/15 py-0.5 px-1.5 rounded">DEFAULT</span>}
                </div>
                <div className="text-purple-400 text-[13px]">
                  {card.cardType}{card.cardholderName ? ` — ${card.cardholderName}` : ''}
                  <span className="ml-2 text-slate-400">Pre-authed ${card.authAmount.toFixed(2)}</span>
                </div>
              </div>
              <div className="text-purple-200 text-[17px] font-bold">{formatCurrency(cardTotal)}</div>
            </button>
          ))}
          <div className="h-px bg-slate-500/15 my-1" />
          <div className="text-[11px] text-slate-400 uppercase tracking-widest font-semibold">Or pay another way</div>
        </div>
      )}

      {/* Add Card to Tab */}
      {onTabCardsChanged && (
        <div className="flex flex-col gap-2 mb-1">
          <button
            onClick={handleAddCardToTab}
            disabled={addingCard || isProcessing || !isConnected}
            className={`w-full py-3.5 px-5 rounded-xl border-none bg-gradient-to-br from-orange-500 to-orange-600 text-white text-base font-bold flex items-center gap-3 shadow-[0_2px_10px_rgba(249,115,22,0.4)] text-left ${(addingCard || isProcessing || !isConnected) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:from-orange-400 hover:to-orange-500'}`}
          >
            <span className="text-2xl">{'\uD83D\uDCB3'}</span>
            <div>
              <div>Add Card to Tab</div>
              <div className="text-xs font-normal opacity-80">Hold another card on this tab</div>
            </div>
          </button>

          {addingCard && (
            <div className="py-2 px-3 flex items-center gap-2">
              <div className={spinnerSmallClasses} />
              <span className={`text-[13px] ${tabAuthSlow ? 'text-amber-500' : 'text-blue-400'}`}>
                {tabAuthSlow
                  ? 'Reader is slow. The card has not been charged yet. Try again or use another method.'
                  : 'Authorizing card...'}
              </span>
            </div>
          )}
          {tabAuthSuccess && (
            <div className="py-2 px-3 text-green-500 text-[13px] font-semibold">
              {'\u2713'} {tabAuthSuccess}
            </div>
          )}
          {addCardError && (
            <div className="p-3 bg-red-500/15 border border-red-500/40 rounded-lg text-red-400 text-sm font-semibold">
              {addCardError}
            </div>
          )}
        </div>
      )}

      {/* Dual pricing banner */}
      {dualPricing.enabled && (
        <div className="text-[13px] text-slate-400 mb-2 p-2.5 bg-green-500/10 rounded-lg border border-green-500/15">
          <span className="text-green-500 font-semibold">Cash: {formatCurrency(cashTotal)}</span>
          <span className="mx-2 text-slate-600">|</span>
          <span>Card: {formatCurrency(cardTotal)}</span>
        </div>
      )}

      {/* Cash button */}
      {paymentSettings.acceptCash && (
        <button
          onClick={() => handleSelectMethod('cash')}
          className={methodButtonCash}
        >
          <span className="text-[28px]">{'\uD83D\uDCB5'}</span>
          <div>
            <div className="text-slate-100 text-[17px] font-semibold">Cash</div>
            <div className="text-green-500 text-[13px] font-medium">
              {formatCurrency(cashTotal)}
              {dualPricing.enabled && dualPricing.showSavingsMessage && (
                <span className="ml-2 text-green-400">Save {formatCurrency(cardTotal - cashTotal)}</span>
              )}
            </div>
          </div>
        </button>
      )}

      {/* Cash Exact — one-tap cash payment, skip entry screen */}
      {paymentSettings.acceptCash && cashTotal > 0 && (
        <button
          onClick={handleCashExact}
          disabled={isProcessing}
          className={`w-full h-14 flex items-center gap-4 px-5 rounded-xl border-2 border-green-500/50 bg-green-500/20 text-left ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-green-500/[0.25]'}`}
        >
          <span className="text-[22px] text-green-500 font-black">$</span>
          <div className="flex-1">
            <div className="text-green-500 text-base font-bold">
              Cash Exact {formatCurrency(cashTotal)}
            </div>
            <div className="text-green-400 text-xs">No change, skip to done</div>
          </div>
        </button>
      )}

      {/* Credit Card */}
      {paymentSettings.acceptCredit && (
        <button
          onClick={() => handleSelectMethod('credit')}
          disabled={!isConnected}
          className={`${methodButtonCard} ${!isConnected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span className="text-[28px]">{'\uD83D\uDCB3'}</span>
          <div>
            <div className="text-slate-100 text-[17px] font-semibold">Credit Card</div>
            <div className="text-indigo-400 text-[13px]">{formatCurrency(cardTotal)}</div>
          </div>
        </button>
      )}

      {/* Debit Card */}
      {paymentSettings.acceptDebit && (
        <button
          onClick={() => handleSelectMethod('debit')}
          disabled={!isConnected}
          className={`${methodButtonCard} ${!isConnected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span className="text-[28px]">{'\uD83D\uDCB3'}</span>
          <div>
            <div className="text-slate-100 text-[17px] font-semibold">Debit Card</div>
            <div className="text-indigo-400 text-[13px]">{formatCurrency(cardTotal)}</div>
          </div>
        </button>
      )}

      {/* Gift Card */}
      {paymentSettings.acceptGiftCards && (
        <button
          onClick={() => handleSelectMethod('gift_card')}
          disabled={!isConnected}
          className={`${methodButtonGiftCard} ${!isConnected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span className="text-[28px]">{'\uD83C\uDF81'}</span>
          <div>
            <div className="text-slate-100 text-[17px] font-semibold">Gift Card</div>
            <div className="text-purple-400 text-[13px]">Enter gift card number</div>
          </div>
        </button>
      )}

      {/* House Account */}
      {paymentSettings.acceptHouseAccounts && (
        <button
          onClick={() => handleSelectMethod('house_account')}
          disabled={!isConnected}
          className={`${methodButtonHouseAccount} ${!isConnected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span className="text-[28px]">{'\uD83C\uDFE2'}</span>
          <div>
            <div className="text-slate-100 text-[17px] font-semibold">House Account</div>
            <div className="text-slate-400 text-[13px]">Charge to account</div>
          </div>
        </button>
      )}

      {/* Bill to Room */}
      {paymentSettings.acceptHotelRoomCharge && (
        <button
          onClick={() => handleSelectMethod('room_charge')}
          disabled={!isConnected}
          className={`${methodButtonRoomCharge} ${!isConnected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
        >
          <span className="text-[28px]">{'\uD83C\uDFE8'}</span>
          <div>
            <div className="text-slate-100 text-[17px] font-semibold">Bill to Room</div>
            <div className="text-teal-300 text-[13px]">Charge to hotel room</div>
          </div>
        </button>
      )}

      {/* Split Payment */}
      {remainingBeforeTip > 0.01 && paymentSettings.acceptCash && paymentSettings.acceptCredit && (
        <>
          <div className="h-px bg-slate-500/15 my-1" />
          <button
            onClick={handleSplitPayment}
            disabled={isProcessing}
            className={`w-full h-14 flex items-center gap-4 px-5 rounded-xl border border-amber-500/30 bg-amber-500/[0.08] text-left ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-amber-500/[0.12]'}`}
          >
            <span className="text-[22px]">{'\u2702'}</span>
            <div>
              <div className="text-amber-500 text-base font-semibold">Split Payment</div>
              <div className="text-amber-900 text-xs">Pay part cash, part card</div>
            </div>
          </button>
        </>
      )}

      {/* Manual Card Entry — manager-only, higher risk */}
      {canKeyedEntry && paymentSettings.acceptCredit && (
        <button
          onClick={() => { setSelectedMethod('credit'); setShowManualEntry(true) }}
          disabled={!isConnected}
          className={`w-full h-14 flex items-center gap-4 px-5 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/[0.06] text-left mt-1 ${!isConnected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-amber-500/[0.1]'}`}
        >
          <span className="text-[22px]">{'\u2328'}</span>
          <div>
            <div className="text-amber-300 text-sm font-semibold">Manual Card Entry</div>
            <div className="text-amber-900 text-[11px]">Type card number (manager only)</div>
          </div>
        </button>
      )}
    </div>
  )
}
