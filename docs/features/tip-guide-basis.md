# Feature: Configurable Tip Guide Basis

## Priority: High
**Requested by:** Operations (server complaints)
**Status:** Planned

## Problem Statement

Servers are receiving lower tips when discounts, promos, or gift cards are applied to orders. The current tip guide calculates suggested tips based on the **net total** (after adjustments), but guests rely on these suggestions without realizing the original bill was higher.

**Example:**
- Original subtotal: $100.00
- 20% discount applied: -$20.00
- Net total: $80.00
- Current 20% tip suggestion: $16.00 (based on $80)
- Expected 20% tip: $20.00 (based on $100)

Servers lose $4 per table through no fault of their own.

## Solution

Add a configurable **Tip Guide Basis** setting that allows the restaurant to choose how suggested tips are calculated.

---

## Settings Schema

Add to `LocationSettings` or create new `TipGuideSettings`:

```prisma
// In Location model or Settings JSON
tipGuideSettings: {
  basis: 'net_total' | 'pre_discount' | 'gross_subtotal' | 'custom'

  // For 'custom' basis - which adjustments to EXCLUDE from tip calculation
  excludeDiscounts: boolean      // Manager/house discounts
  excludePromos: boolean         // Promotional discounts
  excludeGiftCards: boolean      // Gift card partial payments
  excludeComps: boolean          // Comped items
  excludeLoyaltyRewards: boolean // Loyalty point redemptions

  // Display options
  showBasisExplanation: boolean  // Show "(on $X pre-discount)" text
  basisExplanationText: string   // Custom text, default: "on pre-discount total"
}
```

## Basis Options

| Option | Description | Tip Calculated On |
|--------|-------------|-------------------|
| `net_total` | Current behavior | Final amount due after all adjustments |
| `pre_discount` | Before discounts | Subtotal before discounts, after tax |
| `gross_subtotal` | Original subtotal | Item subtotal before any adjustments |
| `custom` | Selective exclusions | Based on checkbox selections |

## Implementation

### 1. Database Changes

```prisma
// Option A: Add to Location model
model Location {
  // ... existing fields
  tipGuideSettings Json? // TipGuideSettings object
}

// Option B: Add to existing Settings table
// Settings.tipGuide = JSON object
```

### 2. Tip Calculation Function

```typescript
// src/lib/tip-calculator.ts

interface TipGuideSettings {
  basis: 'net_total' | 'pre_discount' | 'gross_subtotal' | 'custom'
  excludeDiscounts?: boolean
  excludePromos?: boolean
  excludeGiftCards?: boolean
  excludeComps?: boolean
  excludeLoyaltyRewards?: boolean
  showBasisExplanation?: boolean
  basisExplanationText?: string
}

interface TipCalculationResult {
  basisAmount: number           // Amount tips are calculated on
  suggestions: {
    percent: number
    amount: number
  }[]
  explanationText: string | null // "(on $100.00 pre-discount)"
}

export function calculateTipSuggestions(
  order: {
    subtotal: number
    discountTotal: number
    promoTotal: number
    giftCardPayments: number
    compTotal: number
    loyaltyRedemption: number
    taxTotal: number
    total: number
  },
  settings: TipGuideSettings,
  percentages: number[] = [15, 18, 20, 25]
): TipCalculationResult {
  let basisAmount: number

  switch (settings.basis) {
    case 'gross_subtotal':
      // Original subtotal before anything
      basisAmount = order.subtotal
      break

    case 'pre_discount':
      // Subtotal + tax, before discounts
      basisAmount = order.subtotal + order.taxTotal
      break

    case 'custom':
      // Start with net total, add back excluded items
      basisAmount = order.total
      if (settings.excludeDiscounts) basisAmount += order.discountTotal
      if (settings.excludePromos) basisAmount += order.promoTotal
      if (settings.excludeGiftCards) basisAmount += order.giftCardPayments
      if (settings.excludeComps) basisAmount += order.compTotal
      if (settings.excludeLoyaltyRewards) basisAmount += order.loyaltyRedemption
      break

    case 'net_total':
    default:
      basisAmount = order.total
  }

  const suggestions = percentages.map(percent => ({
    percent,
    amount: Math.round(basisAmount * (percent / 100) * 100) / 100
  }))

  const showExplanation = settings.showBasisExplanation &&
    basisAmount !== order.total

  return {
    basisAmount,
    suggestions,
    explanationText: showExplanation
      ? `(${settings.basisExplanationText || 'on pre-discount total'} $${basisAmount.toFixed(2)})`
      : null
  }
}
```

### 3. UI Updates

#### Payment Screen / Receipt

```
─────────────────────────────────
Subtotal:              $100.00
20% Off Promo:         -$20.00
Tax:                     $6.40
─────────────────────────────────
Total:                  $86.40

Suggested Tips (on $106.40 pre-discount):
  15% = $15.96
  18% = $19.15
  20% = $21.28 ✓
  25% = $26.60
─────────────────────────────────
```

#### Settings Page (/settings/tips or /settings/payments)

```
┌─────────────────────────────────────────────────┐
│ TIP GUIDE SETTINGS                              │
├─────────────────────────────────────────────────┤
│                                                 │
│ Calculate suggested tips based on:              │
│                                                 │
│ ○ Net Total (after all adjustments)             │
│ ○ Pre-Discount Total (before discounts + tax)   │
│ ● Gross Subtotal (original item total)          │
│ ○ Custom (select which to exclude)              │
│                                                 │
│ ┌─ Custom Options ─────────────────────────┐    │
│ │ Exclude from tip calculation:            │    │
│ │ ☑ Discounts (manager/house discounts)    │    │
│ │ ☑ Promos (promotional discounts)         │    │
│ │ ☑ Gift Card payments                     │    │
│ │ ☐ Comps                                  │    │
│ │ ☐ Loyalty rewards                        │    │
│ └──────────────────────────────────────────┘    │
│                                                 │
│ ☑ Show explanation on receipt                   │
│   Text: "on pre-discount total"                 │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 4. Files to Create/Modify

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add tipGuideSettings to Location |
| `src/lib/tip-calculator.ts` | New: Tip calculation logic |
| `src/types/settings.ts` | Add TipGuideSettings interface |
| `src/app/(admin)/settings/tips/page.tsx` | New: Settings UI |
| `src/components/payment/TipSelector.tsx` | Use new calculation |
| `src/components/receipts/Receipt.tsx` | Display explanation text |
| `src/app/api/settings/tips/route.ts` | New: CRUD for settings |

---

## Edge Cases

1. **Split checks**: Each split should use its proportional share of the original subtotal
2. **Partial payments**: If $50 gift card on $100 bill, tip guide should still be based on $100
3. **Multiple discounts**: Stack all discount types appropriately
4. **Negative totals**: If comps/discounts exceed subtotal, use subtotal as minimum basis

## Testing Scenarios

1. $100 order, 20% discount → Tip guide shows tips on $100
2. $100 order, $50 gift card payment → Tip guide shows tips on $100
3. $100 order, $20 comp + 10% discount → Tip guide shows tips on $100
4. Split check 50/50 on $100 discounted order → Each half shows tips on $50
5. Settings change → Existing open orders use new setting immediately

## Success Metrics

- Server tip average increases after rollout
- Fewer complaints from servers about tip guide
- Guest understanding (optional survey)

---

## Notes

- Default for new locations should be `gross_subtotal` (industry best practice)
- Existing locations default to `net_total` (no change in behavior)
- Consider adding a "tip guide preview" in settings to show example calculations
