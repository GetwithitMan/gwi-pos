# Payment Processing

**Version:** 1.0
**Updated:** January 30, 2026
**Status:** Reference Documentation

---

## Table of Contents

1. [Payment Flow Overview](#1-payment-flow-overview)
2. [Payment Types](#2-payment-types)
3. [Dual Pricing (Cash Discount Program)](#3-dual-pricing-cash-discount-program)
4. [Payment Terminal Integration](#4-payment-terminal-integration)
5. [Offline Payment Handling](#5-offline-payment-handling)
6. [Tip Capture Flow](#6-tip-capture-flow)
7. [PCI Compliance Requirements](#7-pci-compliance-requirements)
8. [Refund/Void Processing](#8-refundvoid-processing)

---

## 1. Payment Flow Overview

### Payment Lifecycle Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PAYMENT LIFECYCLE                                    │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────┐
                              │  ORDER   │
                              │  READY   │
                              └────┬─────┘
                                   │
                                   ▼
                         ┌─────────────────┐
                         │ PAYMENT STARTED │
                         │    (pending)    │
                         └────────┬────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
       ┌────────────┐     ┌────────────┐     ┌────────────┐
       │   CASH     │     │   CARD     │     │   OTHER    │
       │  PAYMENT   │     │  PAYMENT   │     │ (gift/HA)  │
       └─────┬──────┘     └─────┬──────┘     └─────┬──────┘
             │                  │                   │
             │            ┌─────┴─────┐            │
             │            │           │            │
             │            ▼           ▼            │
             │     ┌──────────┐ ┌──────────┐      │
             │     │ PRE-AUTH │ │ CAPTURE  │      │
             │     │(bar tabs)│ │ PAYMENT  │      │
             │     └────┬─────┘ └────┬─────┘      │
             │          │            │            │
             │          ▼            │            │
             │    ┌──────────┐       │            │
             │    │ TIP ADJ  │       │            │
             │    │(if tips) │       │            │
             │    └────┬─────┘       │            │
             │         │             │            │
             └─────────┼─────────────┼────────────┘
                       │             │
                       ▼             ▼
              ┌─────────────────────────────┐
              │        PROCESSING           │
              │  (validate, authorize)      │
              └────────────┬────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
  ┌────────────┐    ┌────────────┐    ┌────────────┐
  │ COMPLETED  │    │   FAILED   │    │   VOIDED   │
  │   ✓        │    │     ✗      │    │   (void)   │
  └─────┬──────┘    └────────────┘    └────────────┘
        │
        ▼
  ┌────────────┐
  │  REFUNDED  │ (partial or full, after settlement)
  │   ↩        │
  └────────────┘
```

### Payment States

| State | Description | Transitions |
|-------|-------------|-------------|
| `pending` | Payment initiated but not processed | → processing, → voided |
| `processing` | Being validated/authorized | → completed, → failed |
| `completed` | Successfully processed and settled | → refunded (partial/full) |
| `failed` | Authorization or processing failed | Order remains unpaid |
| `voided` | Cancelled before settlement (same day) | - |
| `refunded` | Money returned after settlement | - |

### Integration Points

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PAYMENT INTEGRATION POINTS                            │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌─────────┐     ┌─────────────┐     ┌────────────┐     ┌──────────────┐
  │  ORDER  │────▶│   PAYMENT   │────▶│    TIP     │────▶│   EMPLOYEE   │
  │         │     │             │     │  (capture) │     │  (tip track) │
  └─────────┘     └──────┬──────┘     └────────────┘     └──────────────┘
                         │
         ┌───────────────┼───────────────┬───────────────┐
         ▼               ▼               ▼               ▼
   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │ GIFT     │   │  HOUSE   │   │ LOYALTY  │   │ DRAWER   │
   │ CARD     │   │ ACCOUNT  │   │ POINTS   │   │ (cash)   │
   │ Balance  │   │ Balance  │   │ Balance  │   │ Tracking │
   └──────────┘   └──────────┘   └──────────┘   └──────────┘
```

### Order Status Flow

1. `open` → Order in progress, items being added
2. `partial` → One or more payments received, balance remaining
3. `paid` → Fully paid, all payments completed
4. `closed` → Closed out, finalized for reporting

---

## 2. Payment Types

### Cash Payment

**Flow:**
1. Server selects "Cash" payment method
2. System displays quick cash amounts ($5, $10, $20, $50, $100)
3. Server enters amount tendered
4. System calculates change
5. Drawer opens (if connected)
6. Payment recorded

**Data Captured:**
```typescript
{
  paymentMethod: "cash",
  amount: 25.00,           // Order amount
  tipAmount: 5.00,         // Cash tip declared
  totalAmount: 30.00,      // Total payment
  amountTendered: 40.00,   // Cash received
  changeGiven: 10.00,      // Change returned
  roundingAdjustment: 0.02 // If rounding enabled
}
```

**Cash Rounding Options:**
- `none` - No rounding
- `nickel` - Round to nearest $0.05
- `dime` - Round to nearest $0.10
- `quarter` - Round to nearest $0.25
- `dollar` - Round to nearest $1.00

**Rounding Direction:**
- `nearest` - Standard rounding
- `up` - Always round up
- `down` - Always round down

**Drawer Operations:**
- Opens automatically on cash payment completion
- Manual "No Sale" requires manager permission
- Cash drops tracked separately via `PaidInOut` model

---

### Card Payment (Credit/Debit)

**Currently:** Simulated for development (generates fake auth codes)

**Future Integration:** Payment terminal SDK (processor TBD)

**Flow:**
1. Server selects "Credit" or "Debit" payment method
2. Customer swipes/taps/inserts card on terminal
3. Terminal sends payment intent to processor
4. Authorization received (or declined)
5. Payment recorded with card details

**Data Captured:**
```typescript
{
  paymentMethod: "credit",  // or "debit"
  amount: 25.00,
  tipAmount: 5.00,
  totalAmount: 30.00,
  cardBrand: "visa",        // visa, mastercard, amex, discover
  cardLast4: "1234",        // Last 4 digits only
  authCode: "ABC123",       // From processor
  transactionId: "txn_xxx"  // Processor reference
}
```

**Supported Card Brands:**
- Visa
- Mastercard
- American Express
- Discover

---

### Split Payments

Support for paying an order with multiple payment methods.

**Split Types:**

1. **By Item** - Assign specific items to each party
2. **Evenly** - Divide total equally among N people
3. **Custom Amount** - Each party pays a specified amount
4. **Split Tender** - One check, multiple payment types

**Example: Split Tender**
```json
{
  "payments": [
    { "method": "gift_card", "amount": 15.00, "giftCardNumber": "GC-XXXX" },
    { "method": "cash", "amount": 20.00, "amountTendered": 20.00 }
  ]
}
```

**Split Check Flow:**
1. Server opens "Split Check" from order actions
2. Selects split method (by item, evenly, custom)
3. System creates child orders linked to parent
4. Each child order paid independently
5. Parent order marked paid when all children paid

---

### Gift Cards

**Activation Flow:**
1. Sell gift card as menu item
2. System generates unique card number (`GC-XXXX-XXXX-XXXX`)
3. Card activated with initial balance
4. Physical card printed or eGift emailed

**Redemption Flow:**
1. Server selects "Gift Card" payment
2. Enter/scan card number
3. Enter PIN (if required)
4. System validates balance
5. Balance deducted, payment recorded

**Data Model:**
```typescript
GiftCard {
  cardNumber: string      // Unique identifier
  initialBalance: number  // Original value
  currentBalance: number  // Available balance
  status: 'active' | 'depleted' | 'expired' | 'frozen'
  expiresAt?: Date
}
```

**Business Rules:**
- Cannot redeem more than balance
- No cash back on gift cards
- Partial redemption supported (balance carries forward)
- Expired cards honored per state law requirements

---

### House Accounts

Charge-to-account for trusted customers/businesses.

**Setup:**
- Admin creates house account with credit limit
- Links to customer profile (optional)
- Sets payment terms (default: Net 30)

**Charge Flow:**
1. Server selects "House Account" payment
2. Select/search for account
3. System validates credit limit
4. Charge posted to account balance
5. Statement generated on billing cycle

**Data Model:**
```typescript
HouseAccount {
  name: string           // Account holder
  creditLimit: number    // Max allowed balance (0 = unlimited)
  currentBalance: number // Amount owed
  paymentTerms: number   // Days until due (default: 30)
  status: 'active' | 'suspended' | 'closed'
}
```

**Credit Limit Validation:**
```typescript
// Check before authorizing charge
if (creditLimit > 0 && newBalance > creditLimit) {
  // Reject: "Charge would exceed credit limit"
  return { availableCredit: creditLimit - currentBalance }
}
```

---

### Loyalty Points Redemption

**Configuration:**
```typescript
LoyaltySettings {
  pointsPerDollar: 1,           // Earn 1 point per $1
  pointsPerDollarRedemption: 100, // 100 points = $1
  minimumRedemptionPoints: 100,   // Min 100 points to redeem
  maximumRedemptionPercent: 50    // Max 50% of order with points
}
```

**Redemption Flow:**
1. Customer attached to order
2. Server selects "Loyalty Points" payment
3. Enter points to redeem
4. System calculates dollar value
5. Points deducted from customer balance

**Validation:**
- Customer must be attached to order
- Minimum points required
- Cannot exceed maximum redemption percentage
- Cannot exceed customer's available points

---

## 3. Dual Pricing (Cash Discount Program)

### How It Works

GWI POS supports dual pricing where cash customers receive a discount while card customers pay the posted price. This is a **cash discount program** (not a credit card surcharge) for compliance purposes.

```
┌─────────────────────────────────────────────────────────────────┐
│                    DUAL PRICING MODEL                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  POSTED PRICE (Menu/Display): $10.00  ◄── Card Price            │
│                                                                  │
│  CASH PRICE:                  $9.60   ◄── 4% Cash Discount       │
│                                                                  │
│  "Save $0.40 by paying with cash!"                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Configuration

```typescript
DualPricingSettings {
  enabled: boolean              // Master toggle
  cashDiscountPercent: number   // Discount % (e.g., 4.0 = 4%)
  applyToCredit: boolean        // Apply card price to credit
  applyToDebit: boolean         // Apply card price to debit
  showSavingsMessage: boolean   // Display savings message
}
```

**Default:** 4% cash discount enabled

### Display Requirements for Compliance

To comply with card network rules and avoid being classified as a surcharge:

1. **Posted prices ARE card prices** - Menu items display the card price
2. **Cash discount disclosed** - Signage indicates cash discount available
3. **Receipt shows discount** - Cash receipts show the discount applied
4. **Equal treatment** - Discount available to all cash customers

**Required Signage:**
> "We offer a 4% discount for cash payments. Posted prices reflect card pricing."

### Calculation

```typescript
function calculateCashPrice(cardPrice: number, discountPercent: number): number {
  return cardPrice * (1 - discountPercent / 100)
}

// Example: 4% discount on $10.00
// Cash price = $10.00 × (1 - 0.04) = $9.60
```

### Receipt Requirements

**Card Receipt:**
```
Subtotal:          $45.00
Tax (8%):           $3.60
------------------------
Total:             $48.60
Paid (Visa ****1234)
```

**Cash Receipt:**
```
Subtotal:          $45.00
Cash Discount (4%): -$1.80
Adjusted Subtotal: $43.20
Tax (8%):           $3.46
------------------------
Total:             $46.66
Cash Tendered:     $50.00
Change:             $3.34

You saved $1.94 by paying with cash!
```

---

## 4. Payment Terminal Integration

### Supported Processors

| Processor | Status | Use Case |
|-----------|--------|----------|
| Square Terminal | Planned | Primary integration |
| MagTek | Research | Legacy/direct support |
| None (Simulated) | Current | Development/testing |

### Terminal Integration (Planned)

**General Payment Flow:**
```
1. Create Payment Intent (server-side)
   POST /api/payments/create-intent
   { amount: 3000, currency: 'usd' }

2. Collect Payment Method (terminal)
   terminal.collectPaymentMethod(clientSecret)

3. Process Payment (terminal)
   terminal.processPayment(paymentIntent)

4. Capture or Cancel (server-side)
   - On success: Capture and record
   - On failure: Cancel and notify
```

### Capture vs Authorize

**Authorize Only (Pre-Auth):**
- Places hold on customer's card
- Does NOT transfer funds
- Used for bar tabs, pre-auth amounts
- Can be captured for final amount later
- Expires after configurable days (default: 7)

**Capture (Auth + Capture):**
- Authorizes AND captures funds immediately
- Used for standard transactions
- Amount is final at capture time

**Pre-Auth Configuration:**
```typescript
PaymentSettings {
  enablePreAuth: boolean           // Allow pre-auth for tabs
  defaultPreAuthAmount: number     // Default hold amount ($100)
  preAuthExpirationDays: number    // Days before expiration (7)
}
```

### Pre-Auth for Bar Tabs

**Open Tab Flow:**
1. Customer opens tab with credit card
2. System creates pre-auth for `defaultPreAuthAmount`
3. Card token stored for final capture
4. Orders added to tab throughout session
5. At closeout: capture actual total + tip

**Pre-Auth Adjustment:**
```typescript
// Tab total exceeds pre-auth
if (tabTotal > preAuthAmount) {
  // Create new auth for difference
  const additionalAuth = await createPaymentIntent({
    amount: tabTotal - preAuthAmount,
    capture_method: 'manual'
  })
}

// Final capture with tip
await capturePaymentIntent(paymentIntentId, {
  amount_to_capture: tabTotal + tipAmount
})
```

### Refund Processing

**Full Refund:**
```typescript
await paymentProcessor.refund({
  transactionId: 'txn_xxx',
  // Defaults to full amount
})
```

**Partial Refund:**
```typescript
await paymentProcessor.refund({
  transactionId: 'txn_xxx',
  amount: 1500, // $15.00 in cents
})
```

---

## 5. Offline Payment Handling

### Architecture Overview

GWI POS uses local servers for speed and offline capability. When internet connectivity is lost, the system continues operating with store-and-forward for card payments.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      OFFLINE PAYMENT HANDLING                                │
└─────────────────────────────────────────────────────────────────────────────┘

ONLINE MODE:                          OFFLINE MODE:
┌────────────┐                        ┌────────────┐
│ Terminal   │                        │ Terminal   │
└─────┬──────┘                        └─────┬──────┘
      │                                     │
      ▼                                     ▼
┌────────────┐                        ┌────────────┐
│ Local      │                        │ Local      │
│ Server     │                        │ Server     │
└─────┬──────┘                        └─────┬──────┘
      │                                     │
      ▼                                     ▼
┌────────────┐                        ┌────────────┐
│ Payment    │ ◄── Real-time          │ Offline    │ ◄── Queue for later
│ Processor  │                        │ Queue      │
└────────────┘                        └────────────┘
                                           │
                                      (When online)
                                           │
                                           ▼
                                      ┌────────────┐
                                      │ Batch      │
                                      │ Process    │
                                      └────────────┘
```

### Store-and-Forward

When processing payments offline:

1. **Card payment attempted** during outage
2. **System queues** the payment with encrypted card data
3. **Risk assessment** applied (see limits below)
4. **Payment recorded** as "pending" locally
5. **When online**: Queue processes automatically
6. **Failures handled**: Staff notified of any declines

### Risk Assessment (Amount Limits)

Offline payments carry risk of chargebacks if the card is declined later.

**Recommended Limits:**
| Tier | Max Amount | Use Case |
|------|------------|----------|
| Low Risk | $50 | Regular customers, small tabs |
| Medium Risk | $150 | Known customers, average tabs |
| High Risk | $500 | VIP customers, manager approval |
| Declined | >$500 | Require online authorization |

**Configuration:**
```typescript
OfflinePaymentSettings {
  enabled: boolean
  maxOfflineAmount: number       // Max single payment ($50 default)
  maxDailyOfflineTotal: number   // Max daily offline total ($500)
  requireManagerApproval: number // Require approval above this amount
}
```

### Queue Management

**Queue Record:**
```typescript
OfflinePaymentQueue {
  id: string
  orderId: string
  amount: number
  encryptedCardData: string    // Encrypted, PCI compliant
  queuedAt: Date
  attempts: number             // Processing attempts
  status: 'pending' | 'processing' | 'completed' | 'failed'
  failureReason?: string
}
```

**Processing Logic:**
```typescript
async function processOfflineQueue() {
  const pending = await getQueuedPayments()

  for (const payment of pending) {
    try {
      const result = await processPayment(payment)
      await markCompleted(payment.id, result.transactionId)
    } catch (error) {
      await incrementAttempts(payment.id)
      if (payment.attempts >= MAX_ATTEMPTS) {
        await markFailed(payment.id, error.message)
        await notifyManager(payment)
      }
    }
  }
}
```

### Failure Handling When Connectivity Returns

**Scenario: Card Declined After Offline Acceptance**

1. Customer has already left with goods/service
2. System alerts manager of declined payment
3. Options:
   - Contact customer for alternative payment
   - Write off as bad debt
   - Mark as receivable (house account)

**Notification Flow:**
```
Queue processing fails
         │
         ▼
┌─────────────────────┐
│ Manager Alert       │
│ "Offline payment    │
│ declined for        │
│ Order #1234"        │
│                     │
│ Amount: $45.67      │
│ Card: ****1234      │
│ Reason: Insufficient│
│         funds       │
│                     │
│ [View Order] [Call] │
└─────────────────────┘
```

---

## 6. Tip Capture Flow

### Pre-Auth Adjustment

For bar tabs and table service where tip is added after initial authorization:

**Flow:**
```
1. Initial Pre-Auth: $50.00 (estimated tab total)
2. Customer signs receipt: Tab $45.00 + Tip $9.00 = $54.00
3. Capture for final amount: $54.00
```

**Implementation:**
```typescript
// Adjust pre-auth to include tip
async function captureWithTip(transactionId: string, orderTotal: number, tipAmount: number) {
  const finalAmount = orderTotal + tipAmount

  await paymentProcessor.capture(transactionId, {
    amount: Math.round(finalAmount * 100)
  })

  // Record tip
  await db.payment.update({
    where: { transactionId },
    data: {
      tipAmount,
      totalAmount: finalAmount
    }
  })
}
```

### Tip Suggestion Percentages

**Configuration:**
```typescript
TipSettings {
  enabled: boolean
  suggestedPercentages: [18, 20, 22, 25]  // Default suggestions
  calculateOn: 'subtotal' | 'total'        // Before or after tax
}
```

**Display on Customer Screen:**
```
┌─────────────────────────────────────────────────────┐
│  Add a tip?                                         │
│                                                     │
│  Subtotal: $45.00                                  │
│                                                     │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │
│  │  18%   │ │  20%   │ │  22%   │ │  25%   │      │
│  │ $8.10  │ │ $9.00  │ │ $9.90  │ │$11.25  │      │
│  └────────┘ └────────┘ └────────┘ └────────┘      │
│                                                     │
│  [Custom Amount]           [No Tip]                │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Tip Calculation Functions

```typescript
// Calculate tip from percentage
function calculateTip(base: number, tipPercent: number): number {
  return Math.round(base * (tipPercent / 100) * 100) / 100
}

// Calculate percentage from amount
function calculateTipPercent(tipAmount: number, base: number): number {
  if (base === 0) return 0
  return Math.round((tipAmount / base) * 100 * 10) / 10
}
```

### Tip-Out Integration

Tips flow into the tip distribution system at shift closeout:

```
Payment with Tip
      │
      ▼
┌─────────────────┐
│ Order Record    │
│ tipTotal: $9.00 │
└────────┬────────┘
         │
         │ (At shift closeout)
         ▼
┌─────────────────┐      ┌─────────────────┐
│ Tip-Out Rules   │──────│ TipShare        │
│ Server → Busser │      │ Records Created │
│ 3% of tips      │      │ $0.27 to Busser │
└─────────────────┘      └─────────────────┘
```

See `/docs/skills/06-TIPPING.md` for complete tip pooling documentation.

---

## 7. PCI Compliance Requirements

### What We Can/Cannot Store

| Data Element | Can Store | Notes |
|--------------|-----------|-------|
| Card last 4 digits | ✅ Yes | For receipts/identification |
| Card brand | ✅ Yes | Visa, MC, Amex, Discover |
| Authorization code | ✅ Yes | From processor |
| Transaction ID | ✅ Yes | Reference for disputes |
| Full card number | ❌ Never | PCI violation |
| CVV/CVC | ❌ Never | PCI violation |
| Magnetic stripe data | ❌ Never | PCI violation |
| Expiration date | ❌ Never | Unless tokenized |

### Tokenization Requirements

**All card data must be tokenized:**
- Physical card → Terminal encrypts → Processor tokenizes
- Token stored locally, never raw card data
- Token used for subsequent operations (capture, refund)

**Tokenization Flow:**
```
Card Swipe/Tap
      │
      ▼
┌─────────────────┐
│ Terminal SDK    │──────▶ Encrypted at hardware level
└─────────────────┘
      │
      ▼
┌─────────────────┐
│ Processor API   │──────▶ Returns payment token
└─────────────────┘
      │
      ▼
┌─────────────────┐
│ Local Database  │──────▶ Store only: token reference
└─────────────────┘
```

### Encryption Standards

| Layer | Encryption | Standard |
|-------|------------|----------|
| Card to Terminal | P2PE | Point-to-Point Encryption |
| Terminal to Processor | TLS 1.3 | Transport Security |
| Database at Rest | AES-256 | Local data protection |
| Offline Queue | AES-256 | Pending payment data |

### Audit Logging

Every payment-related action is logged:

```typescript
AuditLog {
  id: string
  locationId: string
  employeeId: string
  deviceId: string
  action: string        // 'payment_processed', 'refund_issued', 'void_requested'
  details: JSON         // { orderId, amount, method, etc. }
  timestamp: Date
}
```

**Required Audit Events:**
- Payment processed (success/failure)
- Refund issued
- Void requested
- Tip adjusted
- Pre-auth created/captured
- Offline payment queued/processed
- Failed payment retried

### PCI DSS Compliance Checklist

| Requirement | Implementation |
|-------------|----------------|
| No card data storage | Token-only storage |
| Encrypted transmission | TLS 1.3 everywhere |
| Access controls | Role-based permissions |
| Audit trail | All actions logged |
| Vulnerability management | Regular updates via Watchtower |
| Network security | Local server isolation |
| Physical security | Headless server, SSH-only |

---

## 8. Refund/Void Processing

### Void vs Refund Distinction

| Operation | Void | Refund |
|-----------|------|--------|
| **Timing** | Same day, before settlement | After settlement |
| **Processing** | Cancels authorization | Reverses funds |
| **Customer sees** | No charge appears | Charge + credit |
| **Fees** | Usually no processing fee | May incur fees |
| **Use case** | Mistakes, cancellations | Returns, complaints |

### Time Windows

```
ORDER PLACED                              BATCH CLOSES
     │                                         │
     ▼                                         ▼
─────┬─────────────────────────────────────────┬──────────────────▶
     │◄───────── VOID WINDOW ────────────────►│◄── REFUND ONLY ──
     │           (same day)                    │    (after close)
```

**Typical Batch Close:** 10:00 PM - 11:59 PM (processor dependent)

### Void Processing

**Requirements:**
- Transaction not yet settled (same day)
- Manager permission (configurable)
- Reason required

**Flow:**
```typescript
async function voidPayment(paymentId: string, reason: string, managerId: string) {
  const payment = await db.payment.findUnique({ where: { id: paymentId } })

  // Check if still voidable (same day, not settled)
  if (!isVoidable(payment)) {
    throw new Error('Payment has settled. Use refund instead.')
  }

  // Cancel with processor
  await paymentProcessor.cancel(payment.transactionId)

  // Update local record
  await db.payment.update({
    where: { id: paymentId },
    data: {
      status: 'voided',
      refundReason: reason,
      refundedAt: new Date()
    }
  })

  // Log action
  await auditLog('payment_voided', { paymentId, reason, managerId })
}
```

### Refund Processing

**Full Refund:**
```typescript
async function processFullRefund(paymentId: string, reason: string) {
  const payment = await db.payment.findUnique({ where: { id: paymentId } })

  // Process with payment processor
  await paymentProcessor.refund({
    transactionId: payment.transactionId
  })

  // Update record
  await db.payment.update({
    where: { id: paymentId },
    data: {
      status: 'refunded',
      refundedAmount: payment.totalAmount,
      refundedAt: new Date(),
      refundReason: reason
    }
  })
}
```

### Partial Refunds

**Use Cases:**
- Return of some items, not all
- Service complaint, partial compensation
- Price adjustment after sale

**Implementation:**
```typescript
async function processPartialRefund(
  paymentId: string,
  refundAmount: number,
  reason: string
) {
  const payment = await db.payment.findUnique({ where: { id: paymentId } })

  // Validate amount
  const totalRefundable = Number(payment.totalAmount) - Number(payment.refundedAmount)
  if (refundAmount > totalRefundable) {
    throw new Error(`Cannot refund more than $${totalRefundable.toFixed(2)}`)
  }

  // Process partial refund
  await paymentProcessor.refund({
    transactionId: payment.transactionId,
    amount: Math.round(refundAmount * 100) // Convert to cents
  })

  // Update cumulative refunded amount
  await db.payment.update({
    where: { id: paymentId },
    data: {
      refundedAmount: { increment: refundAmount },
      // Only mark as refunded if fully refunded
      status: (Number(payment.refundedAmount) + refundAmount >= Number(payment.totalAmount))
        ? 'refunded'
        : 'completed',
      refundReason: reason,
      refundedAt: new Date()
    }
  })
}
```

### Manager Authorization

**Permission Required For:**
| Action | Permission Key |
|--------|----------------|
| Void any payment | `payments.void` |
| Issue refund | `payments.refund` |
| Override void window | `payments.override_void_window` |
| Refund above $X | `payments.refund_large` |

**Authorization Flow:**
```
Employee requests void/refund
            │
            ▼
   ┌─────────────────┐
   │ Check employee  │
   │ permissions     │
   └────────┬────────┘
            │
     Has permission?
      /          \
    Yes           No
     │             │
     ▼             ▼
┌──────────┐  ┌──────────────────┐
│ Process  │  │ Request manager  │
│ action   │  │ PIN/approval     │
└──────────┘  └────────┬─────────┘
                       │
                Manager approves?
                 /          \
               Yes           No
                │             │
                ▼             ▼
           ┌──────────┐  ┌──────────┐
           │ Process  │  │ Denied   │
           │ action   │  │          │
           └──────────┘  └──────────┘
```

---

## API Reference

### Payment Endpoint

```
POST /api/orders/{orderId}/pay
```

**Request:**
```json
{
  "employeeId": "emp_xxx",
  "payments": [
    {
      "method": "cash",
      "amount": 25.00,
      "tipAmount": 5.00,
      "amountTendered": 40.00
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "payments": [
    {
      "id": "pay_xxx",
      "method": "cash",
      "amount": 25.00,
      "tipAmount": 5.00,
      "totalAmount": 30.00,
      "changeGiven": 10.00
    }
  ],
  "orderStatus": "paid",
  "remainingBalance": 0,
  "loyaltyPointsEarned": 25
}
```

### Key Files

| File | Purpose |
|------|---------|
| `src/app/api/orders/[id]/pay/route.ts` | Payment processing API |
| `src/lib/payment.ts` | Payment utilities (rounding, change) |
| `src/lib/settings.ts` | Payment & dual pricing settings |
| `src/components/payment/PaymentModal.tsx` | Payment UI |
| `prisma/schema.prisma` | Payment, GiftCard, HouseAccount models |

---

## Configuration Summary

```typescript
// Location Settings → Payments
PaymentSettings {
  // Accepted methods
  acceptCash: true,
  acceptCredit: true,
  acceptDebit: true,
  acceptGiftCards: false,      // Enable when ready
  acceptHouseAccounts: false,  // Enable when ready

  // Cash rounding
  cashRounding: 'none',        // 'nickel' | 'dime' | 'quarter' | 'dollar'
  roundingDirection: 'nearest', // 'up' | 'down'

  // Bar tabs / pre-auth
  enablePreAuth: true,
  defaultPreAuthAmount: 100.00,
  preAuthExpirationDays: 7,

  // Processor integration
  processor: 'none',           // 'square' | 'magtek'
  testMode: true
}

// Dual Pricing
DualPricingSettings {
  enabled: true,
  cashDiscountPercent: 4.0,
  applyToCredit: true,
  applyToDebit: true,
  showSavingsMessage: true
}
```

---

## Open Questions / Future Considerations

1. **Payment Processor Selection**
   - Square Terminal vs MagTek direct integration
   - Terminal hardware selection and compatibility

2. **Offline Limits**
   - What maximum offline amount is acceptable risk?
   - Should limits vary by customer history?

3. **Tip Pooling on Partial Refunds**
   - If a tip is refunded, how does it affect tip-out calculations?

4. **Multi-Currency Support**
   - Is this needed for any planned locations?

5. **Contactless/NFC**
   - Apple Pay / Google Pay terminal support timeline

---

*This document is the source of truth for GWI POS payment processing.*
*Last Updated: January 30, 2026*
