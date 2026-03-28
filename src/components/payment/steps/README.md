# Payment Modal Steps

Sub-components extracted from PaymentModal.tsx. Each step consumes shared state
via `PaymentContext` (no prop drilling). The orchestrator (`PaymentModal.tsx`) owns
all state and handlers; steps render UI and call context methods.

## Architecture

```
PaymentModal.tsx (500 lines - orchestrator)
  |-- PaymentContext.tsx (shared state via React Context)
  |-- payment-styles.ts (Tailwind class constants)
  |
  +-- steps/
       |-- OrderSummary.tsx      - Order totals, error/processing banners
       |-- PaymentMethodStep.tsx  - Method selection (cash, card, gift, etc.)
       |-- TipEntryStep.tsx       - Tip percentage + custom tip
       |-- CashEntryStep.tsx      - Cash bill entry + change-due screen
       |-- SplitPaymentStep.tsx   - Split payment between two methods
       |-- CardProcessingStep.tsx - Datacap EMV processor wrapper
       |-- GiftCardStep.tsx       - Gift card lookup + payment
       |-- HouseAccountStep.tsx   - House account search + charge
       |-- RoomChargeStep.tsx     - Hotel PMS room lookup + bill-to-room
```

Steps that manage local-only state (e.g., cash tendered, gift card number) keep
that state internally. Steps that need to modify shared payment flow state
(step navigation, pending payments, processing) use `usePaymentContext()`.
