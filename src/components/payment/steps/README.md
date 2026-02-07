# Payment Modal Steps

This directory contains modular step components extracted from the monolithic PaymentModal (originally 927 lines).

## Architecture

```
┌─────────────────────────────────────┐
│      PaymentModal (Orchestrator)    │
│      - Manages state                │
│      - Handles navigation           │
│      - Processes payments           │
└────────────┬────────────────────────┘
             │
             ├─► PaymentMethodStep
             ├─► TipEntryStep
             ├─► CashEntryStep
             ├─► CardProcessingStep
             ├─► GiftCardStep
             └─► HouseAccountStep
```

## Components

### 1. PaymentMethodStep
Payment method selection with visual buttons.

**Props:**
- `remainingAmount` - Amount left to pay (for split payments)
- `selectedMethod` - Currently selected method
- `onSelectMethod` - Method selection callback
- `enabledMethods` - Which methods to show

**Usage:**
```tsx
<PaymentMethodStep
  remainingAmount={25.50}
  selectedMethod={selectedMethod}
  onSelectMethod={setSelectedMethod}
  enabledMethods={{
    cash: true,
    credit: true,
    debit: true,
    giftCard: true,
    houseAccount: false, // Disabled
  }}
/>
```

### 2. TipEntryStep
Tip percentage buttons and custom tip input.

**Props:**
- `subtotal` - Order subtotal for tip calculation
- `tipAmount` - Current tip amount
- `customTip` - Custom tip input value
- `onSetTipAmount` - Tip amount setter
- `onSetCustomTip` - Custom tip input setter
- `onContinue` / `onBack` - Navigation callbacks
- `tipPercentages` - Percentage buttons (default: [15, 18, 20, 25])
- `calculateOn` - Calculate on 'subtotal' or 'total'

**Usage:**
```tsx
<TipEntryStep
  subtotal={100.00}
  tipAmount={tipAmount}
  customTip={customTip}
  onSetTipAmount={setTipAmount}
  onSetCustomTip={setCustomTip}
  onContinue={handleContinue}
  onBack={handleBack}
  tipPercentages={[18, 20, 22, 25]}
/>
```

### 3. CashEntryStep
Cash amount entry with quick buttons and change calculation.

**Props:**
- `amountDue` - Total amount due
- `amountTendered` - Amount customer is tendering
- `customCashAmount` - Custom amount input
- `onSetAmountTendered` - Amount setter
- `onSetCustomCashAmount` - Custom amount setter
- `onComplete` / `onBack` - Navigation callbacks
- `quickCashAmounts` - Quick select amounts

**Usage:**
```tsx
<CashEntryStep
  amountDue={42.75}
  amountTendered={amountTendered}
  customCashAmount={customCashAmount}
  onSetAmountTendered={setAmountTendered}
  onSetCustomCashAmount={setCustomCashAmount}
  onComplete={handleComplete}
  onBack={handleBack}
/>
```

### 4. CardProcessingStep
Card processing UI with terminal instructions.

**Props:**
- `isProcessing` - Whether payment is processing
- `amount` - Amount being charged
- `terminalId` - Payment terminal ID
- `onCancel` - Cancel callback
- `instructions` - Custom instructions text

**Usage:**
```tsx
<CardProcessingStep
  isProcessing={isProcessing}
  amount={50.00}
  terminalId="TERMINAL-001"
  onCancel={handleCancel}
  instructions="Please insert, tap, or swipe your card"
/>
```

### 5. GiftCardStep
Gift card entry, balance lookup, and payment.

**Props:**
- `amountDue` - Amount to charge
- `giftCardNumber` - Card number input
- `giftCardInfo` - Card information (balance, status)
- `isLoading` - Balance lookup loading state
- `error` - Error message
- `onSetGiftCardNumber` - Card number setter
- `onCheckBalance` - Balance check callback
- `onComplete` / `onBack` - Navigation callbacks

**Usage:**
```tsx
<GiftCardStep
  amountDue={35.00}
  giftCardNumber={giftCardNumber}
  giftCardInfo={giftCardInfo}
  isLoading={isLoading}
  error={error}
  onSetGiftCardNumber={setGiftCardNumber}
  onCheckBalance={handleCheckBalance}
  onComplete={handleComplete}
  onBack={handleBack}
/>
```

### 6. HouseAccountStep
House account selection and charging.

**Props:**
- `amountDue` - Amount to charge
- `accounts` - Available house accounts
- `selectedAccount` - Selected account
- `searchQuery` - Search input value
- `isLoading` - Accounts loading state
- `onSetSearchQuery` - Search setter
- `onSelectAccount` - Account selection callback
- `onComplete` / `onBack` - Navigation callbacks

**Usage:**
```tsx
<HouseAccountStep
  amountDue={125.00}
  accounts={houseAccounts}
  selectedAccount={selectedAccount}
  searchQuery={searchQuery}
  isLoading={isLoading}
  onSetSearchQuery={setSearchQuery}
  onSelectAccount={setSelectedAccount}
  onComplete={handleComplete}
  onBack={handleBack}
/>
```

## Benefits of Modular Steps

### 1. Testability
Each step can be tested independently:
```tsx
import { render, fireEvent } from '@testing-library/react'
import { PaymentMethodStep } from './PaymentMethodStep'

test('selects payment method', () => {
  const onSelect = jest.fn()
  const { getByText } = render(
    <PaymentMethodStep
      remainingAmount={50}
      selectedMethod={null}
      onSelectMethod={onSelect}
    />
  )
  fireEvent.click(getByText('Cash'))
  expect(onSelect).toHaveBeenCalledWith('cash')
})
```

### 2. Reusability
Steps can be used in different contexts:
- Main payment modal
- Quick pay modal
- Split payment flow
- Mobile payment screen

### 3. Maintainability
- Each step is ~100-200 lines (vs 927 line monolith)
- Clear responsibilities and boundaries
- Easier to understand and modify
- Independent updates without affecting other steps

### 4. Performance
- Can memoize individual steps
- Lazy load steps as needed
- Reduce re-renders with isolated state

## Migration Guide

### Before (Monolithic)
```tsx
// PaymentModal.tsx - 927 lines
export function PaymentModal({ ... }) {
  // All state management
  // All UI rendering
  // All business logic
  // 927 lines of code
}
```

### After (Modular)
```tsx
// PaymentModal.tsx - Orchestrator
import {
  PaymentMethodStep,
  TipEntryStep,
  CashEntryStep,
  // ... other steps
} from './steps'

export function PaymentModal({ ... }) {
  // State management only
  // Step navigation logic

  return (
    <div>
      {step === 'method' && <PaymentMethodStep {...methodProps} />}
      {step === 'tip' && <TipEntryStep {...tipProps} />}
      {step === 'cash' && <CashEntryStep {...cashProps} />}
      {/* ... other steps */}
    </div>
  )
}
```

## Future Enhancements

- [ ] Add form validation library (Zod/React Hook Form)
- [ ] Add keyboard navigation support
- [ ] Add accessibility improvements (ARIA labels)
- [ ] Add mobile-optimized layouts
- [ ] Add animation transitions between steps
- [ ] Add step progress indicator
- [ ] Add unit tests for each step
- [ ] Add Storybook stories for visual testing
