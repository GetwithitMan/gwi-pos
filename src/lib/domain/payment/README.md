# Payment Domain Module

Pure business logic functions for payment-related operations. All functions are side-effect free, easily testable, and independent of UI or infrastructure concerns.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      React Components                            │
│                      (UI Logic Only)                             │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Services Layer                                 │
│              (API Calls & Side Effects)                          │
│                 - PaymentService                                 │
│                 - OrderService                                   │
└────────────┬─────────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Domain Layer ⬅ YOU ARE HERE                   │
│               (Pure Business Logic)                              │
│                                                                  │
│   • Tip Calculations      • Loyalty Points                       │
│   • Dual Pricing          • Validators                           │
│                                                                  │
│   All functions are:                                            │
│   ✓ Pure (no side effects)                                      │
│   ✓ Easily testable                                             │
│   ✓ Framework-agnostic                                          │
│   ✓ Reusable                                                    │
└──────────────────────────────────────────────────────────────────┘
```

## Modules

### Tip Calculations

Pure functions for tip calculations, tip-out rules, and tip distribution.

**Use Cases:**
- Calculate suggested tip amounts from percentages
- Apply auto-gratuity for large parties
- Validate tip amounts against settings
- Calculate tip-outs based on role rules
- Distribute tips across employees in a tip pool

**Example:**
```typescript
import { calculateTipAmount, getSuggestedTips, calculateTipOut } from '@/lib/domain/payment'

// Calculate suggested tips
const subtotal = 85.50
const suggestions = getSuggestedTips(subtotal, [15, 18, 20, 25])
// Returns: [12.83, 15.39, 17.10, 21.38]

// Calculate tip-out for server
const tipsEarned = 120.00
const tipOutRules = [
  { fromRole: 'server', toRole: 'busser', percentage: 3, isActive: true },
  { fromRole: 'server', toRole: 'host', percentage: 2, isActive: true },
]
const tipOut = calculateTipOut(tipsEarned, 'server', tipOutRules)
// Returns: 6.00 (5% of $120)
```

**Functions:**
- `calculateTipAmount(baseAmount, tipPercent)` - Calculate tip from percentage
- `calculateTipPercent(tipAmount, baseAmount)` - Calculate percentage from tip amount
- `getSuggestedTips(baseAmount, percentages)` - Get array of suggested tip amounts
- `shouldApplyAutoGratuity(partySize, subtotal, settings)` - Check if auto-grat applies
- `calculateAutoGratuity(subtotal, settings)` - Calculate auto-grat amount
- `validateTipAmount(tipAmount, baseAmount, settings)` - Validate tip against rules
- `calculateTipOut(tipsEarned, employeeRole, rules)` - Calculate tip-out amount
- `calculateTipDistribution(...)` - Full employee tip breakdown
- `calculateTipShares(tipsEarned, giverRole, rules)` - Map of recipient roles to amounts
- `calculateTipPool(totalPooledTips, participants)` - Distribute pooled tips by hours

**Types:**
- `TipSettings` - Tip configuration (default percentages, auto-grat rules, etc.)
- `TipOutRule` - Tip-out rule from one role to another
- `TipDistribution` - Employee tip breakdown (earned, out, received, net)

### Loyalty Points

Pure functions for loyalty points calculations, accrual rules, and redemption.

**Use Cases:**
- Calculate points earned from purchase amount
- Apply bonus multipliers (happy hour, category-specific, etc.)
- Determine customer tier based on lifetime points
- Calculate redemption value and validate redemption requests
- Track points expiration

**Example:**
```typescript
import { calculateLoyaltyPoints, calculateRedemption, determineTier } from '@/lib/domain/payment'

// Calculate points with multipliers
const accrual = calculateLoyaltyPoints(100.00, loyaltySettings, {
  timestamp: new Date(),
  purchaseAmount: 100.00,
  itemCategories: ['entrees']
})
// Returns: { basePoints: 100, bonusPoints: 50, totalPoints: 150, appliedMultipliers: ['Happy Hour'] }

// Validate redemption
const redemption = calculateRedemption(1000, 1500, 50.00, loyaltySettings)
if (redemption.canRedeem) {
  console.log('Redeem', redemption.pointsToRedeem, 'points for $', redemption.dollarValue)
  console.log('Remaining:', redemption.remainingPoints, 'points')
}

// Determine tier
const tier = determineTier(5000, loyaltySettings.tierLevels)
console.log('Customer is', tier?.name, 'tier')
```

**Functions:**
- `calculateBasePoints(purchaseAmount, settings)` - Base points before multipliers
- `multiplierApplies(multiplier, context)` - Check if bonus multiplier applies
- `calculateLoyaltyPoints(purchaseAmount, settings, context)` - Full accrual with bonuses
- `calculatePointsValue(points, settings)` - Convert points to dollar value
- `calculatePointsForDollars(dollarAmount, settings)` - Convert dollars to points
- `calculateRedemption(...)` - Validate and calculate redemption
- `determineTier(totalPoints, tierLevels)` - Get customer's current tier
- `pointsToNextTier(currentPoints, tierLevels)` - Points needed for next tier
- `arePointsExpired(pointsEarnedDate, settings)` - Check if points expired
- `calculateExpirationDate(earnedDate, settings)` - Get expiration date

**Types:**
- `LoyaltySettings` - Loyalty program configuration
- `BonusMultiplier` - Bonus multiplier rule (time-based, category-based, etc.)
- `TierLevel` - Loyalty tier with benefits
- `PointsAccrual` - Points calculation breakdown
- `RedemptionCalculation` - Redemption validation result

### Dual Pricing

Pure functions for dual pricing (cash discount / credit surcharge) calculations.

**Use Cases:**
- Calculate cash and credit prices for items
- Determine if dual pricing applies to an item
- Calculate order totals with dual pricing adjustments
- Format prices for display
- Validate compliance with card brand rules

**Example:**
```typescript
import { calculateDualPrice, calculateOrderPricing, validateDualPricingCompliance } from '@/lib/domain/payment'

// Calculate dual pricing for item
const pricing = calculateDualPrice(10.00, {
  enabled: true,
  mode: 'cash_discount',
  percentage: 3.5,
  displayMode: 'separate_prices'
})
// Returns: { basePrice: 10.00, cashPrice: 9.65, creditPrice: 10.00, difference: 0.35 }

// Calculate order totals
const breakdown = calculateOrderPricing(
  [
    { price: 10.00, category: 'food', quantity: 2 },
    { price: 5.00, category: 'drinks', quantity: 1 }
  ],
  'cash',
  0.0825,
  dualPricingSettings
)
console.log('Subtotal:', breakdown.subtotal)
console.log('Cash discount:', breakdown.adjustment)
console.log('Tax:', breakdown.tax)
console.log('Total:', breakdown.total)

// Validate compliance
const compliance = validateDualPricingCompliance(dualPricingSettings)
if (!compliance.valid) {
  console.warn('Compliance warnings:', compliance.warnings)
}
```

**Functions:**
- `calculateDualPrice(basePrice, settings)` - Calculate cash and credit prices
- `dualPricingApplies(itemPrice, itemCategory, settings)` - Check if applies to item
- `calculateOrderPricing(items, paymentMethod, taxRate, settings)` - Full order breakdown
- `formatPriceForDisplay(basePrice, settings)` - Format price string for UI
- `getAdjustmentLabel(paymentMethod, adjustmentAmount, settings)` - Label for receipt
- `validateDualPricingCompliance(settings)` - Check compliance with card brand rules

**Types:**
- `DualPricingSettings` - Dual pricing configuration
- `PricingCalculation` - Cash/credit price breakdown for item
- `OrderPricingBreakdown` - Full order totals with adjustment

### Validators

Domain validation functions with detailed error messages.

**Use Cases:**
- Validate payment inputs before processing
- Validate split payment configurations
- Validate refund requests
- Validate monetary amounts with business rules

**Example:**
```typescript
import { validatePayment, validatePayments, validateAmount, validateRefund } from '@/lib/domain/payment'

// Validate single payment
const paymentResult = validatePayment(
  {
    method: 'cash',
    amount: 50.00,
    tipAmount: 10.00,
    amountTendered: 60.00
  },
  45.00
)
if (!paymentResult.valid) {
  console.error('Payment validation failed:', paymentResult.errors)
}

// Validate multiple payments against order total
const paymentsResult = validatePayments(
  [
    { method: 'cash', amount: 30.00 },
    { method: 'credit', amount: 20.00 }
  ],
  50.00,
  [] // existing payments
)
if (!paymentsResult.valid) {
  console.error('Total validation failed:', paymentsResult.errors)
}

// Validate refund
const refundResult = validateRefund(25.00, 50.00, [10.00])
if (!refundResult.valid) {
  console.error('Cannot refund:', refundResult.errors)
}
```

**Functions:**
- `validatePayment(payment, orderTotal)` - Validate single payment
- `validatePayments(payments, orderTotal, existingPayments)` - Validate total payments
- `validateAmount(amount, fieldName, options)` - Validate monetary amount
- `validateSplitPayment(orderTotal, ways)` - Validate split configuration
- `validateRefund(refundAmount, originalPaymentAmount, previousRefunds)` - Validate refund
- `combineValidations(...results)` - Combine multiple validation results
- `isValid(result)` - Type guard for valid results

**Types:**
- `ValidationResult` - Validation result with errors array

## Benefits

### 1. Separation of Concerns

Business logic is completely separate from UI and infrastructure:
```typescript
// ✅ GOOD - Pure domain function
export function calculateTipAmount(baseAmount: number, tipPercent: number): number {
  return Math.round(baseAmount * (tipPercent / 100) * 100) / 100
}

// ❌ BAD - Mixed concerns
function calculateTipAmount(baseAmount: number, tipPercent: number): number {
  const amount = Math.round(baseAmount * (tipPercent / 100) * 100) / 100
  await db.tip.create({ amount }) // ❌ Database access
  toast.success('Tip calculated') // ❌ UI side effect
  return amount
}
```

### 2. Easy Testing

Pure functions are trivial to test:
```typescript
import { calculateTipAmount } from '@/lib/domain/payment'

describe('calculateTipAmount', () => {
  it('calculates 18% tip correctly', () => {
    expect(calculateTipAmount(100.00, 18)).toBe(18.00)
  })

  it('rounds to 2 decimal places', () => {
    expect(calculateTipAmount(87.50, 20)).toBe(17.50)
  })
})
```

No mocks, no setup, no teardown - just input → output.

### 3. Reusability

Domain functions can be used anywhere:
- React components
- API routes
- Background jobs
- CLI scripts
- Other services

### 4. Type Safety

All functions are fully typed:
```typescript
const accrual: PointsAccrual = calculateLoyaltyPoints(
  purchaseAmount,
  settings,
  context
)
// TypeScript knows exactly what properties are available
console.log(accrual.totalPoints) // ✅
console.log(accrual.invalidProp) // ❌ Compile error
```

### 5. Documentation Through Code

Functions are self-documenting with JSDoc:
```typescript
/**
 * Calculate tip amount from percentage
 *
 * @param baseAmount - Amount to calculate tip on (subtotal or total)
 * @param tipPercent - Tip percentage (e.g., 18 for 18%)
 * @returns Tip amount rounded to 2 decimal places
 *
 * @example
 * calculateTipAmount(100.00, 18) // Returns 18.00
 * calculateTipAmount(87.50, 20) // Returns 17.50
 */
```

## Migration Guide

### Before (Business Logic in Components)
```typescript
function PaymentModal() {
  const calculateTip = (amount: number, percent: number) => {
    return Math.round(amount * (percent / 100) * 100) / 100
  }

  const handlePayment = async () => {
    const tip = calculateTip(subtotal, 18)
    // ... payment logic
  }
}
```

### After (Using Domain Functions)
```typescript
import { calculateTipAmount } from '@/lib/domain/payment'

function PaymentModal() {
  const handlePayment = async () => {
    const tip = calculateTipAmount(subtotal, 18)
    // ... payment logic
  }
}
```

**Benefits:**
- Tip calculation is tested independently
- Same calculation used in receipts, reports, etc.
- No duplication across components

## Best Practices

### 1. Keep Functions Pure

**✅ DO:**
```typescript
export function calculateDiscount(
  subtotal: number,
  discountPercent: number
): number {
  return Math.round(subtotal * (discountPercent / 100) * 100) / 100
}
```

**❌ DON'T:**
```typescript
export function calculateDiscount(
  subtotal: number,
  discountPercent: number
): number {
  const amount = Math.round(subtotal * (discountPercent / 100) * 100) / 100
  localStorage.setItem('lastDiscount', amount.toString()) // ❌ Side effect
  return amount
}
```

### 2. Use Type Guards for Validation

```typescript
export function validateAmount(
  amount: number,
  fieldName: string
): ValidationResult {
  const errors: string[] = []

  if (typeof amount !== 'number' || isNaN(amount)) {
    errors.push(`${fieldName} must be a valid number`)
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

// Type guard
export function isValid(result: ValidationResult): result is { valid: true; errors: [] } {
  return result.valid
}
```

### 3. Provide Default Settings

```typescript
export const DEFAULT_TIP_SETTINGS: TipSettings = {
  defaultPercentages: [15, 18, 20, 25],
  calculateOn: 'subtotal',
  allowCustomTip: true,
  autoGratuityThreshold: 6,
  autoGratuityPercent: 18,
}
```

### 4. Document Edge Cases

```typescript
/**
 * Calculate tip amount from percentage
 *
 * @param baseAmount - Amount to calculate tip on
 * @param tipPercent - Tip percentage (e.g., 18 for 18%)
 * @returns Tip amount rounded to 2 decimal places
 *
 * @throws {Error} If baseAmount is negative
 * @throws {Error} If tipPercent is negative
 *
 * @example
 * calculateTipAmount(100.00, 18) // Returns 18.00
 */
export function calculateTipAmount(baseAmount: number, tipPercent: number): number {
  if (baseAmount < 0) {
    throw new Error('Base amount cannot be negative')
  }
  if (tipPercent < 0) {
    throw new Error('Tip percent cannot be negative')
  }

  return Math.round(baseAmount * (tipPercent / 100) * 100) / 100
}
```

## Related

- **Services Layer**: `/src/lib/services/` - API calls using domain functions
- **API Routes**: `/src/app/api/` - HTTP endpoints using domain functions
- **Components**: `/src/components/` - UI using domain functions via services
