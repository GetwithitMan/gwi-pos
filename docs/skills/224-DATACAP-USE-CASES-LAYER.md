# Skill 224: Datacap Use Cases Layer

**Status:** ✅ DONE (2026-02-06)
**Category:** Payments / Architecture
**Dependencies:** 120 (Datacap Direct Integration), 221 (Payment Intent Backoff)
**Related Skills:** 225 (Payment Modal Component Split), 226 (PaymentService Layer)

## Problem

Business logic for payment operations was scattered across:
- UI components (PaymentModal)
- API routes
- Direct DatacapClient calls

This caused:
- **Duplicated logic** - Same payment flow implemented multiple times
- **Tight coupling** - UI directly dependent on Datacap internals
- **No offline support** - Failed payments lost forever
- **Difficult testing** - Had to mock UI and Datacap client together

## Solution

Created a use cases layer that encapsulates payment business logic with:
- PaymentIntentManager integration for offline resilience
- DatacapClient orchestration for card transactions
- Clear interfaces for each payment scenario
- Comprehensive error handling

**File:** `/src/lib/datacap/use-cases.ts` (392 lines)

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  UI Components                               │
│            (PaymentModal, BarTabFlow, etc.)                  │
└────────────┬─────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│              Use Cases Layer ⬅ NEW                          │
│                                                             │
│  • processSale()       • openBarTab()                       │
│  • closeBarTab()       • voidPayment()                      │
│  • adjustTip()         • capturePreAuth()                   │
│                                                             │
│  Responsibilities:                                          │
│  - Payment intent tracking                                  │
│  - DatacapClient orchestration                              │
│  - Offline capture/retry                                    │
│  - Error recovery                                           │
└────────────┬─────────────────────────────────────────────────┘
             │
             ├──────────────────┬──────────────────┐
             ▼                  ▼                  ▼
┌──────────────────┐  ┌──────────────────┐  ┌─────────────┐
│ PaymentIntent    │  │ DatacapClient    │  │  Database   │
│ Manager          │  │                  │  │             │
└──────────────────┘  └──────────────────┘  └─────────────┘
```

## Key Use Cases

### 1. processSale()

Process a card sale with offline support.

**Signature:**
```typescript
export async function processSale(
  client: DatacapClient,
  params: ProcessSaleParams
): Promise<SaleResult>
```

**Parameters:**
```typescript
interface ProcessSaleParams {
  orderId: string
  amount: number
  tipAmount?: number
  taxAmount?: number
  invoice?: string
  employeeId: string
}
```

**Flow:**
1. Create payment intent (for offline tracking)
2. Attempt Datacap sale via client.sale()
3. If approved:
   - Mark intent as synced
   - Return success with recordNo
4. If declined:
   - Mark intent as failed
   - Return decline reason
5. If network error:
   - Keep intent pending
   - PaymentIntentManager will retry with backoff

**Example:**
```typescript
const result = await processSale(datacapClient, {
  orderId: 'order-123',
  amount: 50.00,
  tipAmount: 10.00,
  invoice: 'INV-456',
  employeeId: 'emp-789'
})

if (result.success) {
  console.log('Sale approved!', result.data.recordNo)
} else {
  console.error('Sale failed:', result.error)
}
```

### 2. openBarTab()

Open a bar tab with card pre-authorization.

**Signature:**
```typescript
export async function openBarTab(
  client: DatacapClient,
  params: OpenBarTabParams
): Promise<SaleResult>
```

**Parameters:**
```typescript
interface OpenBarTabParams {
  orderId: string
  depositAmount: number
  tabName: string
  employeeId: string
}
```

**Flow:**
1. CollectCardData (read card)
2. PreAuth for deposit amount
3. Create payment intent for auth
4. Store recordNo for later capture

**Example:**
```typescript
const result = await openBarTab(datacapClient, {
  orderId: 'tab-123',
  depositAmount: 1.00, // $1 hold
  tabName: 'John Doe',
  employeeId: 'emp-789'
})

if (result.success) {
  // Tab opened, recordNo stored for capture
  console.log('Tab opened:', result.data.recordNo)
}
```

### 3. closeBarTab()

Close bar tab and capture final amount.

**Signature:**
```typescript
export async function closeBarTab(
  client: DatacapClient,
  params: CloseBarTabParams
): Promise<SaleResult>
```

**Parameters:**
```typescript
interface CloseBarTabParams {
  orderId: string
  recordNo: string      // From preAuth
  finalAmount: number   // Total with tip
  tipAmount?: number
  employeeId: string
}
```

**Flow:**
1. PreAuthCapture for final amount
2. Create payment intent for capture
3. Release original hold
4. Return capture result

**Example:**
```typescript
const result = await closeBarTab(datacapClient, {
  orderId: 'tab-123',
  recordNo: '12345',    // From openBarTab
  finalAmount: 75.50,
  tipAmount: 15.00,
  employeeId: 'emp-789'
})

if (result.success) {
  console.log('Tab closed, charged:', result.data.amount)
}
```

### 4. adjustTip()

Add tip to completed transaction.

**Signature:**
```typescript
export async function adjustTip(
  client: DatacapClient,
  params: AdjustTipParams
): Promise<SaleResult>
```

**Parameters:**
```typescript
interface AdjustTipParams {
  recordNo: string
  tipAmount: number
  employeeId: string
}
```

**Example:**
```typescript
const result = await adjustTip(datacapClient, {
  recordNo: '12345',
  tipAmount: 10.00,
  employeeId: 'emp-789'
})
```

### 5. voidPayment()

Void a transaction.

**Signature:**
```typescript
export async function voidPayment(
  client: DatacapClient,
  params: VoidPaymentParams
): Promise<SaleResult>
```

**Parameters:**
```typescript
interface VoidPaymentParams {
  recordNo: string
  reason?: string
  employeeId: string
}
```

**Example:**
```typescript
const result = await voidPayment(datacapClient, {
  recordNo: '12345',
  reason: 'Customer request',
  employeeId: 'emp-789'
})
```

### 6. capturePreAuth()

Capture an existing pre-authorization.

**Signature:**
```typescript
export async function capturePreAuth(
  client: DatacapClient,
  params: CapturePreAuthParams
): Promise<SaleResult>
```

**Parameters:**
```typescript
interface CapturePreAuthParams {
  recordNo: string
  amount: number
  tipAmount?: number
  employeeId: string
}
```

## Key Features

### 1. Payment Intent Tracking

Every transaction creates a PaymentIntent for offline resilience:

```typescript
// Create intent before transaction
const intent = await createPaymentIntent({
  orderId,
  amount,
  type: 'sale',
  employeeId
})

try {
  // Attempt transaction
  const result = await client.sale({ ... })

  if (result.approved) {
    // Mark as synced on success
    await markPaymentIntentSynced(intent.id, result.recordNo)
  } else {
    // Mark as failed on decline
    await markPaymentIntentFailed(intent.id, result.message)
  }
} catch (error) {
  // Network error - intent stays pending
  // PaymentIntentManager will retry with backoff
  logger.error('Sale failed, will retry', { intentId: intent.id })
}
```

### 2. Offline Capture

If network fails, intent is automatically retried:

```
1. Sale attempted → Network timeout
2. Intent status: pending
3. PaymentIntentManager detects pending intent
4. Retries with exponential backoff (15s → 30s → 1m → 2m)
5. Once network restored, sale completes
6. Intent marked as synced
```

### 3. Error Recovery

Three types of failures handled differently:

| Error Type | Response | Intent Status |
|------------|----------|---------------|
| **Declined** | Return decline reason | `failed` |
| **Network** | Retry with backoff | `pending` |
| **Server** | Return error | `failed` |

### 4. Comprehensive Logging

All operations logged for debugging:

```typescript
logger.payment('Processing sale', {
  orderId: params.orderId,
  amount: params.amount,
  intentId: intent.id
})

logger.payment('Sale approved', {
  recordNo: result.recordNo,
  amount: result.amount,
  intentId: intent.id
})
```

## Benefits

### 1. Separation of Concerns

UI components don't need to know about:
- PaymentIntent creation
- Datacap protocol details
- Retry logic
- Error handling

```typescript
// Component code is simple:
const result = await processSale(datacapClient, {
  orderId,
  amount,
  employeeId
})

if (result.success) {
  showSuccessToast()
} else {
  showErrorToast(result.error)
}
```

### 2. Testability

Use cases are easy to test independently:

```typescript
describe('processSale', () => {
  it('creates payment intent before sale', async () => {
    await processSale(mockClient, params)

    expect(createPaymentIntent).toHaveBeenCalledWith({
      orderId: 'order-123',
      amount: 50.00,
      type: 'sale',
      employeeId: 'emp-789'
    })
  })

  it('marks intent as synced on approval', async () => {
    mockClient.sale.mockResolvedValue({ approved: true, recordNo: '12345' })

    await processSale(mockClient, params)

    expect(markPaymentIntentSynced).toHaveBeenCalledWith(
      expect.any(String),
      '12345'
    )
  })
})
```

### 3. Reusability

Same use cases work across:
- PaymentModal (POS)
- Bar tab flow
- Pay-at-table
- Quick Pay
- Customer-facing display

### 4. Offline Resilience

Network issues don't lose transactions:
```
Bar closes for night → Router loses power → Sales pending

Morning:
Router restored → PaymentIntentManager runs → All sales sync → Batch closes
```

### 5. Audit Trail

Payment intents provide complete audit trail:
- When payment attempted
- How many retry attempts
- Final result (approved/declined/failed)
- Error messages

## Error Handling

### DatacapResult Pattern

All use cases return `DatacapResult<T>`:

```typescript
export type DatacapResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }
```

No exceptions thrown - always explicit success/failure:

```typescript
const result = await processSale(client, params)

if (result.success) {
  // TypeScript knows result.data is available
  const recordNo = result.data.recordNo
} else {
  // TypeScript knows result.error is available
  console.error(result.error)
}
```

### Error Types

| Error Code | Meaning | Recovery |
|------------|---------|----------|
| `DECLINED` | Card declined | Ask for another payment method |
| `NETWORK_ERROR` | Network timeout | Automatic retry via PaymentIntentManager |
| `INVALID_AMOUNT` | Bad parameters | Fix and retry |
| `DEVICE_ERROR` | Terminal offline | Check hardware |

## Related Files

- `/src/lib/datacap/use-cases.ts` - Main implementation (392 lines)
- `/src/lib/datacap/client.ts` - DatacapClient
- `/src/lib/payment-intent-manager.ts` - Offline tracking
- `/src/lib/datacap/index.ts` - Barrel exports

## Usage in Components

### Before (Direct DatacapClient)

```typescript
// PaymentModal.tsx - 927 lines of mixed concerns
const handlePayment = async () => {
  const client = new DatacapClient(config)
  const result = await client.sale({ amount: total })

  if (result.approved) {
    // Save to database
    await fetch('/api/payments', { ... })
    // Create payment intent? Maybe?
    // Log transaction? Forgot!
  }
}
```

### After (Use Cases Layer)

```typescript
// PaymentMethodStep.tsx - 123 lines, focused on UI
const handlePayment = async () => {
  const result = await processSale(datacapClient, {
    orderId,
    amount: total,
    employeeId
  })

  if (result.success) {
    onSuccess(result.data)
  } else {
    onError(result.error)
  }
}
```

## Future Enhancements

### 1. Transaction Queuing

Queue multiple transactions for batch processing:

```typescript
const queue = new TransactionQueue()

await queue.add(() => processSale(client, params))
await queue.add(() => closeBarTab(client, params))

await queue.processAll() // Process in order
```

### 2. Idempotency Keys

Add idempotency to prevent duplicate charges:

```typescript
const result = await processSale(client, {
  ...params,
  idempotencyKey: `order-${orderId}-${Date.now()}`
})
```

### 3. Multi-Tender Support

Handle split payments with multiple cards:

```typescript
const result = await processSplitSale(client, {
  orderId,
  tenders: [
    { method: 'card', amount: 50.00 },
    { method: 'cash', amount: 25.00 }
  ]
})
```

### 4. Refund Use Cases

Add refund operations:

```typescript
await processRefund(client, {
  recordNo: '12345',
  amount: 50.00,
  reason: 'Item returned'
})
```

## Testing Strategy

### Unit Tests

Test use cases in isolation with mocked dependencies:

```typescript
const mockClient = {
  sale: jest.fn(),
  preAuth: jest.fn(),
  preAuthCapture: jest.fn(),
}

const mockIntentManager = {
  createIntent: jest.fn(),
  markSynced: jest.fn(),
  markFailed: jest.fn(),
}
```

### Integration Tests

Test full flow with real DatacapClient in simulated mode:

```typescript
const client = new DatacapClient({
  communicationMode: 'simulated',
  merchantId: 'test',
  operatorId: 'test'
})

const result = await processSale(client, {
  orderId: 'test-order',
  amount: 10.00,
  employeeId: 'test-emp'
})

expect(result.success).toBe(true)
```

## Deployment Notes

No database migrations required - uses existing PaymentIntent schema.

Safe to deploy alongside existing payment code.

## Monitoring

Key metrics to track:
- Payment intent success rate (should be >99%)
- Average retry count before success (should be <2)
- Network error rate (tracks infrastructure health)
- Payment processing time (should be <3s for successful payments)
