# Datacap Payment Use Cases

This layer provides high-level payment workflows that integrate PaymentIntentManager with DatacapClient.

## Architecture

```
┌─────────────────────────────────────────┐
│     POS UI / API Routes                 │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│   Use Cases Layer (use-cases.ts)        │
│   - processSale()                       │
│   - openBarTab()                        │
│   - closeBarTab()                       │
│   - voidPayment()                       │
│                                         │
│   Handles:                              │
│   • Payment intent tracking             │
│   • Error recovery                      │
│   • Offline queueing                    │
│   • Business logic orchestration        │
└────────────┬────────────┬───────────────┘
             │            │
             ▼            ▼
┌──────────────────┐  ┌────────────────────┐
│ DatacapClient    │  │ PaymentIntentMgr   │
│ (transport)      │  │ (offline tracking) │
└──────────────────┘  └────────────────────┘
```

## Why Use Cases?

**Without Use Cases:**
- API routes call DatacapClient directly
- No payment intent tracking (offline sync breaks)
- Business logic scattered across routes
- Error handling duplicated

**With Use Cases:**
- Centralized payment workflows
- Automatic intent tracking for offline resilience
- Consistent error handling
- Testable business logic

## Usage

### Sale Transaction

```typescript
import { DatacapClient } from '@/lib/datacap/client'
import { processSale } from '@/lib/datacap/use-cases'

// Create client
const client = new DatacapClient(config)

// Process sale with intent tracking
const result = await processSale(client, {
  readerId: 'reader-123',
  orderId: 'order-456',
  terminalId: 'terminal-1',
  employeeId: 'emp-789',
  amounts: {
    purchase: 25.00,
    gratuity: 5.00,
  },
  invoiceNo: 'INV-456',
  tipMode: 'suggestive',
})

if (result.success) {
  console.log('Approved!', result.response.authCode)
  console.log('Intent ID:', result.intentId)
} else {
  console.error('Declined:', result.error)
}
```

### Bar Tab Flow

```typescript
import { openBarTab, closeBarTab } from '@/lib/datacap/use-cases'

// Open tab (pre-auth)
const openResult = await openBarTab(client, {
  readerId: 'reader-123',
  orderId: 'order-789',
  terminalId: 'terminal-1',
  employeeId: 'emp-456',
  preAuthAmount: 50.00,
  invoiceNo: 'TAB-789',
})

if (openResult.success) {
  const recordNo = openResult.response!.recordNo

  // ... customer orders drinks ...

  // Close tab (capture)
  const closeResult = await closeBarTab(client, {
    readerId: 'reader-123',
    intentId: openResult.intentId,
    recordNo: recordNo!,
    finalAmount: 75.50,
    gratuityAmount: 15.00,
  })
}
```

### Void Payment

```typescript
import { voidPayment } from '@/lib/datacap/use-cases'

const voidResult = await voidPayment(client, {
  readerId: 'reader-123',
  intentId: 'intent-abc',
  recordNo: 'record-xyz',
})
```

## Offline Resilience

Use cases automatically handle network errors:

```typescript
const result = await processSale(client, params)

if (!result.success && result.error === 'Network error - queued for offline sync') {
  // Payment was authorized but couldn't be captured online
  // PaymentIntentManager will sync it when connection restored
  showToast('Payment queued - will sync automatically')
}
```

## Integration with Existing Routes

**Option A: Full Integration (Recommended for new routes)**
```typescript
// New route using use cases
export async function POST(request: NextRequest) {
  const client = await getDatacapClient(locationId)
  const result = await processSale(client, params)

  if (result.success) {
    // Update order, create payment record, etc.
  }

  return Response.json({ data: result })
}
```

**Option B: Gradual Migration (For existing routes)**
- Keep existing DatacapClient calls for now
- Add intent tracking manually if needed
- Migrate to use cases during refactors

**Option C: Direct Client Access (For testing/admin tools)**
- Use DatacapClient directly for ping, param download, batch operations
- Use cases layer not needed for non-monetary operations

## Testing

Use cases make testing easier by separating concerns:

```typescript
import { processSale } from '@/lib/datacap/use-cases'
import { DatacapClient } from '@/lib/datacap/client'

// Mock the client
const mockClient = {
  sale: jest.fn().mockResolvedValue({ cmdStatus: 'Approved', authCode: 'ABC123' })
}

// Test the use case
const result = await processSale(mockClient as any, testParams)
expect(result.success).toBe(true)
```

## Future Enhancements

- [ ] `processRefund()` use case
- [ ] `incrementalAuth()` use case for bottle service
- [ ] `adjustGratuity()` use case for tip adjustment
- [ ] Retry policies and backoff configuration
- [ ] Telemetry and analytics integration
