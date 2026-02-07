# Skill 228: Card Token-Based Loyalty Program

**Status:** 📋 TODO
**Category:** Payments / Customer Features
**Dependencies:** 120 (Datacap Direct Integration), 52 (Loyalty Program - Basic)
**Related Skills:** 227 (PaymentDomain - Loyalty Points Module), 51 (Customer Profiles)

## Problem

Current loyalty program requires customers to manually identify themselves (lookup by phone or scan barcode) on every visit, creating checkout friction and reducing participation rates.

### Current Flow (Manual)
```
Customer arrives → Makes order → Checkout
  → "Are you in our loyalty program?"
  → Customer: "Yes, phone is 555-1234"
  → Server enters phone → Looks up customer → Applies points
  → Total time: 15-30 seconds of friction
```

### Issues:
- **Friction** - Requires customer input every visit
- **Slow** - Adds 15-30 seconds to every checkout
- **Error-prone** - Phone number typos cause failed lookups
- **Low participation** - Customers forget or skip it when busy
- **No auto-apply** - Can't automatically apply loyalty discounts

## Solution

Implement card token-based automatic customer recognition using processor-provided persistent tokens.

### New Flow (Automatic)
```
Customer arrives → Makes order → Checkout → Card tap
  → Token recognized → Customer auto-loaded
  → Display: "Welcome back, Sarah! You have 250 points"
  → Auto-apply loyalty discount
  → Total time: 0 seconds (instant recognition)
```

## Architecture

### Hybrid Recognition System

```
┌─────────────────────────────────────────────────────────────┐
│                    Payment Processing                        │
│              (Customer taps/inserts card)                    │
└────────────┬─────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│              Datacap Response with Token                     │
│         { cardToken: "tok_abc123", last4: "1234" }          │
└────────────┬─────────────────────────────────────────────────┘
             │
             ▼
      ┌──────────────┐
      │ Token Match? │
      └──────┬───────┘
             │
      ┌──────┴──────┐
      │             │
      ▼             ▼
   ✅ YES         ❌ NO
      │             │
      │             ▼
      │      ┌─────────────────┐
      │      │ First-Time Flow │
      │      │ Ask for phone   │
      │      │ Create profile  │
      │      │ Link token      │
      │      └────────┬────────┘
      │               │
      └───────┬───────┘
              │
              ▼
   ┌──────────────────────┐
   │ Load Customer Profile │
   │ Apply loyalty points  │
   │ Auto-apply discounts  │
   │ Display welcome       │
   └──────────────────────┘
```

## Schema Design

### Customer (Primary Profile)

```prisma
model Customer {
  id                String         @id @default(cuid())
  locationId        String
  location          Location       @relation(fields: [locationId], references: [id])

  // Contact Info
  phone             String?        @unique
  email             String?
  firstName         String?
  lastName          String?

  // Loyalty
  loyaltyPoints     Int            @default(0)
  lifetimePoints    Int            @default(0)
  tierLevel         String         @default("Bronze")

  // Cards linked to this customer
  cardProfiles      CardProfile[]

  // Purchases
  orders            Order[]

  // Metadata
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt
  lastVisitAt       DateTime?
  visitCount        Int            @default(0)

  // Sync fields
  deletedAt         DateTime?
  syncedAt          DateTime?

  @@index([locationId])
  @@index([phone])
  @@index([email])
}
```

### CardProfile (Token → Customer Link)

```prisma
model CardProfile {
  id                String         @id @default(cuid())
  locationId        String
  location          Location       @relation(fields: [locationId], references: [id])

  customerId        String
  customer          Customer       @relation(fields: [customerId], references: [id])

  // Token from processor (persistent identifier)
  cardToken         String         @unique

  // Display info (for UI only - NOT for recognition)
  cardLast4         String
  cardBrand         String         // VISA, MASTERCARD, AMEX, DISCOVER
  cardholderName    String?

  // Metadata
  isDefault         Boolean        @default(false)
  firstUsedAt       DateTime       @default(now())
  lastUsedAt        DateTime       @default(now())
  useCount          Int            @default(0)

  // Sync fields
  deletedAt         DateTime?
  syncedAt          DateTime?

  @@index([locationId])
  @@index([customerId])
  @@index([cardToken])
}
```

## Implementation Phases

### Phase 1: Token Verification (Critical First Step)

**Goal:** Verify your processor returns persistent tokens

**Tasks:**
1. Process transaction with real Datacap hardware
2. Capture XML response, extract `Token` or `CardToken` field
3. Process second transaction with same card
4. Compare token values
5. Document findings

**Decision Point:**
- ✅ Tokens match → Proceed to Phase 2
- ❌ Tokens differ → Contact processor to enable tokenization

**Code for Testing:**
```typescript
// Test script: process-token-test.ts
import { datacapClient } from '@/lib/datacap'

async function testTokenPersistence() {
  console.log('Transaction 1: Tap card now...')
  const result1 = await datacapClient.sale({
    purchase: 1.00,
    invoice: 'TOKEN-TEST-1'
  })

  if (result1.approved) {
    console.log('Token from transaction 1:', result1.cardToken)
    console.log('Last 4:', result1.cardLast4)

    console.log('\nTransaction 2: Tap SAME card again...')
    const result2 = await datacapClient.sale({
      purchase: 1.00,
      invoice: 'TOKEN-TEST-2'
    })

    if (result2.approved) {
      console.log('Token from transaction 2:', result2.cardToken)
      console.log('Last 4:', result2.cardLast4)

      if (result1.cardToken === result2.cardToken) {
        console.log('\n✅ SUCCESS! Tokens match - persistence confirmed')
      } else {
        console.log('\n❌ FAIL! Tokens differ - contact processor')
      }
    }
  }
}
```

### Phase 2: Schema & API (Foundation)

**Create Customer & CardProfile models:**
- Add to `prisma/schema.prisma`
- Run migration
- Seed with test data

**Create API routes:**
```
POST   /api/customers                    Create customer
GET    /api/customers/search?phone=      Lookup by phone
GET    /api/customers/[id]               Get customer details
PUT    /api/customers/[id]               Update customer
DELETE /api/customers/[id]               Soft delete

POST   /api/customers/[id]/cards         Link card token to customer
GET    /api/customers/[id]/cards         List customer's cards
DELETE /api/customers/[id]/cards/[cardId] Remove card link

GET    /api/customers/by-token/[token]   Lookup customer by card token
```

### Phase 3: First-Visit Flow (Enrollment)

**UI Components:**

**LoyaltyEnrollmentModal.tsx**
```typescript
interface LoyaltyEnrollmentModalProps {
  cardToken: string
  cardLast4: string
  cardBrand: string
  cardholderName?: string
  onComplete: (customer: Customer) => void
  onSkip: () => void
}

// Modal shows:
// - "Join our loyalty program!"
// - Phone number input (required)
// - Email input (optional)
// - First/last name inputs (optional, pre-filled from cardholder name if available)
// - Sign-up bonus: "Get 50 points just for joining!"
```

**Integration in PaymentModal:**
```typescript
// After card payment processes successfully
if (datacapResult.approved) {
  const { cardToken, cardLast4, cardBrand } = datacapResult

  // Check if token exists
  const existingCustomer = await fetchCustomerByToken(cardToken)

  if (existingCustomer) {
    // Existing customer - auto-load
    setCustomer(existingCustomer)
    toast.success(`Welcome back, ${existingCustomer.firstName}!`)
  } else {
    // New customer - show enrollment modal
    setShowEnrollmentModal(true)
  }
}
```

### Phase 4: Repeat Visit Flow (Recognition)

**Auto-recognition on card tap:**
```typescript
// In payment processing
const { cardToken } = datacapResponse

// Instant lookup
const customer = await db.cardProfile.findUnique({
  where: { cardToken },
  include: { customer: true }
})

if (customer) {
  // Update metadata
  await db.cardProfile.update({
    where: { cardToken },
    data: {
      lastUsedAt: new Date(),
      useCount: { increment: 1 }
    }
  })

  await db.customer.update({
    where: { id: customer.customerId },
    data: {
      lastVisitAt: new Date(),
      visitCount: { increment: 1 }
    }
  })

  // Calculate points earned
  const pointsEarned = calculateLoyaltyPoints(orderTotal, loyaltySettings, context)

  // Display to user
  return {
    recognized: true,
    customer: customer.customer,
    pointsEarned,
    currentPoints: customer.customer.loyaltyPoints,
    tierLevel: customer.customer.tierLevel
  }
}
```

### Phase 5: Multi-Card Linking

**Scenario:** Customer uses different card (expired/lost/new card)

**Flow:**
```
1. Customer taps card B (token not recognized)
2. POS: "Enter phone number for loyalty"
3. Customer enters phone
4. System finds existing customer
5. Ask: "Link this card ending in 5678 to your account?"
6. Create new CardProfile linking token B → customer
7. Future uses of card B → auto-recognized
```

**UI Component:**

**LinkCardModal.tsx**
```typescript
interface LinkCardModalProps {
  customer: Customer          // Found by phone
  cardToken: string           // New token to link
  cardLast4: string
  cardBrand: string
  onConfirm: () => void
  onCancel: () => void
}

// Modal shows:
// - "Found your account: Sarah Smith"
// - "Do you want to link Visa ending in 5678?"
// - Shows other cards already linked
// - Confirm / Cancel buttons
```

### Phase 6: Customer Management UI

**Admin page at `/customers`:**
- List customers with search/filter
- Customer detail view with:
  - Contact info
  - Loyalty points, tier level
  - All linked cards
  - Order history
  - Points history

**Customer Portal (Future):**
- `/customer-portal` - Customer self-service
- View points balance
- View/manage linked cards
- Set default card for online ordering
- View order history

### Phase 7: Advanced Features

**Auto-Apply Loyalty Discounts:**
```typescript
// When customer recognized
if (customer.tierLevel === 'Gold') {
  // Auto-apply 10% discount
  applyDiscount(orderId, {
    type: 'percentage',
    value: 10,
    reason: 'Gold tier member discount'
  })
}
```

**Predictive Ordering:**
```typescript
// Get customer's most-ordered items
const favoriteItems = await db.orderItem.groupBy({
  by: ['menuItemId'],
  where: {
    order: { customerId: customer.id }
  },
  _count: true,
  orderBy: { _count: { menuItemId: 'desc' } },
  take: 3
})

// Display: "Your usual? [Margarita] [Nachos] [Wings]"
```

**Birthday Rewards:**
```typescript
// Check if today is customer's birthday
if (isBirthday(customer.birthdate)) {
  await awardBirthdayBonus(customer.id, 100) // 100 bonus points
  toast.success('🎉 Happy Birthday! We added 100 bonus points!')
}
```

## Key Benefits

### For Customers
- ✅ **Zero friction** - No need to provide phone every visit
- ✅ **Instant recognition** - "Welcome back, Sarah!"
- ✅ **Never forget** - Auto-applied on every card tap
- ✅ **Multi-card support** - All their cards linked to one profile
- ✅ **Auto-discounts** - Tier benefits applied automatically

### For Business
- ✅ **Higher participation** - No friction = more signups
- ✅ **Faster checkout** - Save 15-30 seconds per transaction
- ✅ **Better data** - Track customer purchase patterns
- ✅ **Increased loyalty** - Seamless experience drives repeat visits
- ✅ **Marketing insights** - Know your best customers

### For Staff
- ✅ **Less data entry** - No manual phone lookups
- ✅ **Fewer errors** - No phone number typos
- ✅ **Simpler workflow** - Just tap card, system handles the rest

## Edge Cases & Solutions

### 1. Card Expires/Replaced

**Problem:** Customer gets new card with different token

**Solution:**
- Phone number link creates new CardProfile
- Old card profile remains (historical record)
- Mark old card as inactive after 6 months of non-use

### 2. Shared Cards (Family)

**Problem:** Multiple people using same card

**Solution:**
- Card links to primary customer
- Option to create sub-accounts under primary
- Or: Ask "Is this for Sarah?" on each visit

### 3. Corporate Cards

**Problem:** Employee using company card (token same, but different people)

**Solution:**
- Don't link corporate cards automatically
- Option to manually link with employee PIN or ID
- Or: Skip loyalty for corporate card transactions

### 4. Duplicate Phone Numbers

**Problem:** Customer tries to create account with phone already in use

**Solution:**
```typescript
const existingCustomer = await db.customer.findUnique({
  where: { phone }
})

if (existingCustomer) {
  // Show: "This phone is already registered. Is this your account?"
  // If yes: Link new card to existing customer
  // If no: Ask for different phone or email
}
```

### 5. No Token Returned

**Problem:** Datacap doesn't return token (processor issue)

**Solution:**
- Fallback to phone number lookup
- Log error for investigation
- Consider manual card entry as last resort

### 6. Privacy Concerns

**Problem:** Customer doesn't want card tracked

**Solution:**
- Always show "Skip" button on enrollment
- Guest checkout option (no loyalty)
- Opt-out mechanism in customer portal
- Clear privacy policy disclosure

## Testing Strategy

### Unit Tests
```typescript
describe('Card Token Loyalty', () => {
  it('creates customer with card profile on first visit', async () => {
    const result = await enrollCustomer({
      phone: '555-1234',
      cardToken: 'tok_test123',
      cardLast4: '1234',
      cardBrand: 'VISA'
    })

    expect(result.customer).toBeDefined()
    expect(result.customer.cardProfiles).toHaveLength(1)
    expect(result.customer.cardProfiles[0].cardToken).toBe('tok_test123')
  })

  it('recognizes customer on repeat visit', async () => {
    const customer = await recognizeCustomerByToken('tok_test123')

    expect(customer).toBeDefined()
    expect(customer.phone).toBe('555-1234')
  })

  it('links new card to existing customer', async () => {
    await linkCardToCustomer(customerId, {
      cardToken: 'tok_test456',
      cardLast4: '5678',
      cardBrand: 'MASTERCARD'
    })

    const cards = await getCustomerCards(customerId)
    expect(cards).toHaveLength(2)
  })
})
```

### Integration Tests
```typescript
describe('E2E Loyalty Flow', () => {
  it('completes first-visit enrollment', async () => {
    // Process payment with new card
    const payment = await processPayment({ amount: 50.00 })
    expect(payment.cardToken).toBeDefined()

    // Enroll in loyalty
    const customer = await enrollCustomer({
      phone: '555-1234',
      cardToken: payment.cardToken
    })

    expect(customer.loyaltyPoints).toBe(50) // Sign-up bonus
  })

  it('auto-recognizes on second visit', async () => {
    // Process payment with same card token
    const payment = await processPayment({
      amount: 30.00,
      cardToken: 'tok_test123' // Same token as first visit
    })

    const recognition = await recognizeCustomer(payment.cardToken)
    expect(recognition.recognized).toBe(true)
    expect(recognition.customer.phone).toBe('555-1234')
  })
})
```

### Manual Test Plan

**Test 1: First Visit**
1. Process payment with real card
2. Note token from Datacap response
3. Enrollment modal should appear
4. Enter phone number
5. Verify customer created with card profile
6. Verify sign-up bonus awarded

**Test 2: Repeat Visit**
1. Process payment with same card
2. Verify same token returned
3. Verify customer auto-loaded (no prompt)
4. Verify "Welcome back" message
5. Verify points awarded

**Test 3: New Card**
1. Process payment with different card
2. Token not recognized
3. Enter phone number
4. Find existing customer
5. Confirm link new card
6. Verify new card profile created

**Test 4: Cash Payment**
1. Select cash payment
2. After payment, ask for loyalty lookup
3. Enter phone number
4. Load customer
5. Award points

## Performance Considerations

### Token Lookup Speed
```typescript
// Index on cardToken for O(1) lookup
@@index([cardToken])

// Typical query time: <5ms
const customer = await db.cardProfile.findUnique({
  where: { cardToken },
  include: { customer: true }
})
```

### Caching Strategy
```typescript
// Cache customer data for 5 minutes
const customerCache = new Map<string, { customer: Customer, expires: number }>()

async function getCachedCustomer(cardToken: string): Promise<Customer | null> {
  const cached = customerCache.get(cardToken)
  if (cached && cached.expires > Date.now()) {
    return cached.customer
  }

  const customer = await db.cardProfile.findUnique({ where: { cardToken } })
  if (customer) {
    customerCache.set(cardToken, {
      customer,
      expires: Date.now() + 5 * 60 * 1000 // 5 minutes
    })
  }

  return customer
}
```

## Security & Compliance

### PCI Compliance

**✅ Compliant:**
- Store processor tokens (not card numbers)
- Store masked card numbers (last 4 only)
- No CVV storage
- No expiry date storage (unless required and approved)

**❌ Non-Compliant:**
- Storing full card numbers
- Storing CVV/CVC codes
- Storing magnetic stripe data

### Privacy & GDPR

**Customer Rights:**
- Right to access data (customer portal)
- Right to deletion (soft delete + purge after 30 days)
- Right to data portability (export JSON)
- Right to opt-out (guest checkout always available)

**Data Retention:**
```typescript
// Purge deleted customers after 30 days
async function purgeDeletedCustomers() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  await db.customer.deleteMany({
    where: {
      deletedAt: { lt: thirtyDaysAgo }
    }
  })
}
```

## Monitoring & Analytics

### Key Metrics
- Loyalty enrollment rate (% of transactions)
- Token recognition rate (% of repeat visits auto-recognized)
- Average time to enrollment (should be <30 seconds)
- Multi-card link rate (% of customers with multiple cards)
- Points redemption rate

### Dashboards
```typescript
// Admin dashboard at /admin/loyalty-stats
{
  totalCustomers: 1247,
  activeLastMonth: 892,
  enrollmentRate: 0.68, // 68% of transactions enroll
  recognitionRate: 0.94, // 94% of repeat visits auto-recognized
  avgPointsPerCustomer: 234,
  topTier: { name: 'Gold', count: 47 }
}
```

## Future Enhancements

### Phase 8: Online Ordering Integration
- Card-on-file for online orders
- One-click checkout with saved card
- Auto-apply loyalty discount online

### Phase 9: Mobile App
- Customer app with digital loyalty card
- QR code for card-less recognition
- Push notifications for bonus offers

### Phase 10: Marketing Automation
- Automated email campaigns
- SMS for special offers
- Targeted promotions based on purchase history

### Phase 11: Third-Party Integrations
- Mailchimp for email campaigns
- Twilio for SMS
- Analytics platforms (Segment, Mixpanel)

## Related Files

**To Be Created:**
- `/prisma/migrations/XXX_add_loyalty_models.sql`
- `/src/app/api/customers/route.ts`
- `/src/app/api/customers/[id]/route.ts`
- `/src/app/api/customers/[id]/cards/route.ts`
- `/src/app/api/customers/by-token/[token]/route.ts`
- `/src/components/loyalty/LoyaltyEnrollmentModal.tsx`
- `/src/components/loyalty/LinkCardModal.tsx`
- `/src/components/loyalty/LoyaltyWelcomeToast.tsx`
- `/src/app/(admin)/customers/page.tsx`
- `/src/lib/loyalty/token-recognition.ts`

**Existing Files to Modify:**
- `/src/components/payment/PaymentModal.tsx` - Add token recognition flow
- `/src/lib/datacap/use-cases.ts` - Add customer lookup on payment
- `/src/app/api/orders/[id]/pay/route.ts` - Award loyalty points

## Dependencies

### Required Before Implementation
- ✅ Skill 120: Datacap Direct Integration (Done)
- ✅ Skill 227: PaymentDomain loyalty-points module (Done)
- ⬜ Token persistence verification (Phase 1 blocker)

### Nice to Have
- Customer Profiles (Skill 51) - Basic CRUD already exists
- Email/SMS integration - For marketing campaigns

## Estimated Effort

| Phase | Effort | Critical Path |
|-------|--------|---------------|
| Phase 1: Token Verification | 1 day | ✅ Must complete first |
| Phase 2: Schema & API | 3 days | After Phase 1 |
| Phase 3: First-Visit Flow | 2 days | After Phase 2 |
| Phase 4: Repeat Visit Flow | 2 days | After Phase 3 |
| Phase 5: Multi-Card Linking | 2 days | After Phase 4 |
| Phase 6: Customer Management UI | 3 days | Parallel to Phase 4-5 |
| Phase 7: Advanced Features | 5 days | After Phase 6 |
| **Total** | **18 days** | **~4 weeks** |

## Success Criteria

**Phase 1 Complete When:**
- ✅ Token persistence verified with real hardware
- ✅ Documentation of token field names
- ✅ Confirmation from processor that tokenization is enabled

**Phase 2-6 Complete When:**
- ✅ Customer can enroll on first visit (<30 seconds)
- ✅ Customer auto-recognized on repeat visit (instant)
- ✅ Customer can link multiple cards to one profile
- ✅ Admin can view customer list and details
- ✅ Points accurately awarded and tracked
- ✅ All unit and integration tests passing

**Production-Ready When:**
- ✅ 95%+ token recognition rate for repeat visits
- ✅ <30 second enrollment time (average)
- ✅ Zero PCI compliance violations
- ✅ GDPR-compliant data handling
- ✅ Error handling for all edge cases
- ✅ Monitoring dashboards operational

## Deployment Notes

### Phase 1 (Token Verification)
- No schema changes
- No production impact
- Can test in dev environment

### Phase 2 (Schema & API)
- Run migration (adds Customer + CardProfile tables)
- Backward compatible (existing orders unaffected)
- Zero downtime deployment

### Phase 3-7 (Features)
- Feature flag: `LOYALTY_ENABLED`
- Gradual rollout: Start with 10% of transactions
- Monitor enrollment rate and recognition rate
- Full rollout after 1 week of stable operation

## Questions to Answer Before Building

1. ✅ Does our processor support persistent card tokens? (Phase 1 verification)
2. What sign-up bonus should we offer? (50-100 points?)
3. What are the loyalty tier thresholds? (Bronze/Silver/Gold at what point totals?)
4. Should we offer email as alternative to phone number?
5. Do we want to track customer birthdays for birthday rewards?
6. What's our data retention policy for deleted customers?
7. Do we need parental consent for customers under 18?
8. What marketing emails/SMS should trigger automatically?

## Resources

**Processor Documentation:**
- TSYS Tokenization Guide
- First Data TransArmor Documentation
- Worldpay Token Service API

**PCI Compliance:**
- PCI DSS Requirements for Tokenization
- Card Brand Token Best Practices

**Privacy:**
- GDPR Compliance Checklist
- CCPA Requirements for Customer Data
