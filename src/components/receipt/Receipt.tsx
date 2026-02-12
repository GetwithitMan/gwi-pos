'use client'

import { formatCurrency, formatDate, formatTime } from '@/lib/utils'
import type { ReceiptSettings } from '@/lib/settings'

export interface ReceiptItem {
  id: string
  name: string
  quantity: number
  price: number
  itemTotal: number
  specialNotes?: string | null
  status?: string
  seatNumber?: number | null  // For seat assignment
  modifiers?: {
    id: string
    name: string
    price: number
    preModifier?: string | null
  }[]
}

export interface ReceiptPayment {
  method: string
  amount: number
  tipAmount: number
  totalAmount: number
  cardBrand?: string | null
  cardLast4?: string | null
  authCode?: string | null
  amountTendered?: number | null
  changeGiven?: number | null
}

export interface ReceiptData {
  id: string
  orderNumber: number
  displayNumber?: string | null
  orderType: string
  tabName?: string | null
  tableName?: string | null
  guestCount?: number | null
  employee: {
    id: string
    name: string
  }
  location: {
    name: string
    address?: string | null
    phone?: string | null
  }
  items: ReceiptItem[]
  payments: ReceiptPayment[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  tipTotal: number
  total: number
  createdAt: string
  paidAt?: string | null
  // Loyalty info
  customer?: {
    name: string
    loyaltyPoints: number
  } | null
  loyaltyPointsEarned?: number | null
  loyaltyPointsRedeemed?: number | null
}

interface ReceiptProps {
  data: ReceiptData
  settings?: Partial<ReceiptSettings>
  showPrices?: boolean // For kitchen receipts (no prices)
}

// Payment method display labels
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  credit: 'Credit Card',
  debit: 'Debit Card',
  gift_card: 'Gift Card',
  house_account: 'House Account',
  loyalty_points: 'Loyalty Points',
}

// Get transaction reference display from transactionId
function getTransactionDisplay(payment: ReceiptPayment): string | null {
  if (!payment.cardLast4) return null

  // Check for special formats
  if (payment.method === 'gift_card') {
    return `GC ****${payment.cardLast4}`
  }
  if (payment.method === 'house_account' && payment.authCode) {
    return payment.authCode // Account name stored in authCode
  }

  // Regular card
  return `****${payment.cardLast4}`
}

export function Receipt({ data, settings, showPrices = true }: ReceiptProps) {
  const receiptSettings = {
    headerText: 'Thank you for your visit!',
    footerText: '',
    showServerName: true,
    showTableNumber: true,
    ...settings,
  }

  // Filter out voided items
  const activeItems = data.items.filter(item => item.status !== 'voided')

  return (
    <div className="receipt font-mono text-sm bg-white p-4 max-w-[320px] mx-auto">
      {/* Header */}
      <div className="text-center border-b border-dashed border-gray-400 pb-3 mb-3">
        <h1 className="text-lg font-bold">{data.location.name}</h1>
        {data.location.address && (
          <p className="text-xs text-gray-600">{data.location.address}</p>
        )}
        {data.location.phone && (
          <p className="text-xs text-gray-600">{data.location.phone}</p>
        )}
      </div>

      {/* Order Info */}
      <div className="border-b border-dashed border-gray-400 pb-3 mb-3 text-xs">
        <div className="flex justify-between">
          <span>Order #:</span>
          <span className="font-bold">{data.displayNumber || data.orderNumber}</span>
        </div>
        <div className="flex justify-between">
          <span>Date:</span>
          <span>{formatDate(data.createdAt)}</span>
        </div>
        <div className="flex justify-between">
          <span>Time:</span>
          <span>{formatTime(data.createdAt)}</span>
        </div>
        {receiptSettings.showServerName && (
          <div className="flex justify-between">
            <span>Server:</span>
            <span>{data.employee.name}</span>
          </div>
        )}
        {receiptSettings.showTableNumber && data.tableName && (
          <div className="flex justify-between">
            <span>Table:</span>
            <span>{data.tableName}</span>
          </div>
        )}
        {data.tabName && (
          <div className="flex justify-between">
            <span>Tab:</span>
            <span>{data.tabName}</span>
          </div>
        )}
        {data.guestCount && data.guestCount > 1 && (
          <div className="flex justify-between">
            <span>Guests:</span>
            <span>{data.guestCount}</span>
          </div>
        )}
      </div>

      {/* Items */}
      <div className="border-b border-dashed border-gray-400 pb-3 mb-3">
        {activeItems.map(item => {
          // Build seat number prefix
          const positionPrefix = item.seatNumber ? `S${item.seatNumber}: ` : ''

          return (
          <div key={item.id} className="mb-2">
            <div className="flex justify-between">
              <span>
                {positionPrefix && <span className="text-gray-500">{positionPrefix}</span>}
                {item.quantity > 1 && `${item.quantity}x `}
                {item.name}
                {item.status === 'comped' && (
                  <span className="text-xs text-red-600 ml-1">(COMP)</span>
                )}
              </span>
              {showPrices && (
                <span className={item.status === 'comped' ? 'line-through text-gray-400' : ''}>
                  {formatCurrency(item.itemTotal)}
                </span>
              )}
            </div>
            {/* Modifiers */}
            {item.modifiers && item.modifiers.length > 0 && (
              <div className="pl-4 text-xs text-gray-600">
                {item.modifiers.map(mod => (
                  <div key={mod.id} className="flex justify-between">
                    <span>
                      {mod.preModifier && `${mod.preModifier} `}
                      {mod.name}
                    </span>
                    {showPrices && mod.price > 0 && (
                      <span>+{formatCurrency(mod.price)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* Special notes */}
            {item.specialNotes && (
              <div className="pl-4 text-xs italic text-gray-500">
                Note: {item.specialNotes}
              </div>
            )}
          </div>
          )
        })}
      </div>

      {/* Totals */}
      {showPrices && (
        <div className="border-b border-dashed border-gray-400 pb-3 mb-3">
          <div className="flex justify-between text-xs">
            <span>Subtotal:</span>
            <span>{formatCurrency(data.subtotal)}</span>
          </div>
          {data.discountTotal > 0 && (
            <div className="flex justify-between text-xs text-green-600">
              <span>Discount:</span>
              <span>-{formatCurrency(data.discountTotal)}</span>
            </div>
          )}
          <div className="flex justify-between text-xs">
            <span>Tax:</span>
            <span>{formatCurrency(data.taxTotal)}</span>
          </div>
          {data.tipTotal > 0 && (
            <div className="flex justify-between text-xs">
              <span>Tip:</span>
              <span>{formatCurrency(data.tipTotal)}</span>
            </div>
          )}
          <div className="flex justify-between font-bold mt-2 pt-2 border-t border-gray-300">
            <span>TOTAL:</span>
            <span>{formatCurrency(data.total)}</span>
          </div>
        </div>
      )}

      {/* Payments */}
      {showPrices && data.payments.length > 0 && (
        <div className="border-b border-dashed border-gray-400 pb-3 mb-3 text-xs">
          <div className="font-bold mb-1">Payment:</div>
          {data.payments.map((payment, index) => {
            const transactionDisplay = getTransactionDisplay(payment)
            return (
            <div key={index} className="ml-2">
              <div className="flex justify-between">
                <span>
                  {PAYMENT_METHOD_LABELS[payment.method] || payment.method}
                  {transactionDisplay && ` ${transactionDisplay}`}
                </span>
                <span>{formatCurrency(payment.totalAmount)}</span>
              </div>
              {payment.method === 'cash' && payment.amountTendered && (
                <>
                  <div className="flex justify-between text-gray-500">
                    <span>Tendered:</span>
                    <span>{formatCurrency(payment.amountTendered)}</span>
                  </div>
                  {payment.changeGiven && payment.changeGiven > 0 && (
                    <div className="flex justify-between text-gray-500">
                      <span>Change:</span>
                      <span>{formatCurrency(payment.changeGiven)}</span>
                    </div>
                  )}
                </>
              )}
            </div>
            )
          })}
        </div>
      )}

      {/* Loyalty Points */}
      {showPrices && data.customer && (data.loyaltyPointsEarned || data.loyaltyPointsRedeemed) && (
        <div className="border-b border-dashed border-gray-400 pb-3 mb-3 text-xs">
          <div className="font-bold mb-1 text-blue-600">Loyalty Rewards:</div>
          <div className="ml-2">
            <div className="flex justify-between">
              <span>Member:</span>
              <span>{data.customer.name}</span>
            </div>
            {data.loyaltyPointsRedeemed && data.loyaltyPointsRedeemed > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Points Redeemed:</span>
                <span>-{data.loyaltyPointsRedeemed} pts</span>
              </div>
            )}
            {data.loyaltyPointsEarned && data.loyaltyPointsEarned > 0 && (
              <div className="flex justify-between text-blue-600">
                <span>Points Earned:</span>
                <span>+{data.loyaltyPointsEarned} pts</span>
              </div>
            )}
            <div className="flex justify-between font-medium mt-1 pt-1 border-t border-gray-300">
              <span>New Balance:</span>
              <span>{data.customer.loyaltyPoints} pts</span>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="text-center text-xs text-gray-600">
        {receiptSettings.headerText && (
          <p className="font-medium">{receiptSettings.headerText}</p>
        )}
        {receiptSettings.footerText && (
          <p className="mt-1">{receiptSettings.footerText}</p>
        )}
        {data.paidAt && (
          <p className="mt-2 text-gray-400">
            Paid: {formatDate(data.paidAt)} {formatTime(data.paidAt)}
          </p>
        )}
      </div>
    </div>
  )
}
