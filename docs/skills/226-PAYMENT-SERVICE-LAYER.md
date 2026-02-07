# Skill 226: PaymentService Layer

**Status:** ✅ DONE (2026-02-06)
**Category:** Payments / Architecture
**Dependencies:** 224 (Use Cases Layer), 225 (Payment Modal Component Split)
**Related Skills:** 227 (PaymentDomain Module), 30 (Payment Processing)

## Problem

Components were making direct API calls with inconsistent error handling and no centralized logging:

### Issues:
- **Scattered API calls** - `fetch()` calls duplicated across 10+ components
- **Inconsistent errors** - Some components threw exceptions, others returned errors
- **No logging** - No centralized visibility into payment API calls
- **Difficult testing** - Had to mock `fetch` globally
- **No type safety** - API responses parsed as `any`

### Before: Direct API Calls in Components

```typescript
// PaymentModal.tsx
const handlePay = async () => {
  try {
    const response = await fetch('/api/orders/123/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payments: [...], employeeId: '456' }),
    })

    const data = await response.json()

    if (!response.ok) {
      setError(data.error || 'Payment failed')
      return
    }

    // Success handling
  } catch (error) {
    setError(error.message || 'Unknown error')
  }
}
```

Problems with this approach:
- Repeated fetch code in every component
- Manual error handling
- No request/response logging
- No retry logic
- Type assertions needed (`data as PaymentResponse`)

## Solution

Created a PaymentService layer that encapsulates all payment-related API calls with:
- Type-safe request/response interfaces
- Consistent Result pattern for errors
- Centralized logging
- Easy mocking for tests

**File:** `/src/lib/services/payment-service.ts` (350+ lines)

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  React Components                            │
│              (PaymentModal, BarTabFlow, etc.)                │
└────────────┬─────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│            PaymentService Layer ⬅ NEW                       │
│                                                              │
│  • processPayment()      • voidItems()                       │
│  • fetchOrderForPayment() • checkGiftCardBalance()           │
│  • loadHouseAccounts()    • requestRemoteVoidApproval()      │
│                                                              │
│  Responsibilities:                                           │
│  - Type-safe API calls                                       │
│  - Error transformation                                      │
│  - Response caching                                          │
│  - Request logging                                           │
└────────────┬─────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│                     API Routes                               │
│              /api/orders/*/pay, /api/payments/*              │
└──────────────────────────────────────────────────────────────┘
```

## ServiceResult Pattern

All service methods return `ServiceResult<T>`:

```typescript
export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; statusCode?: number }
```

### Benefits

1. **No exceptions thrown** - Always explicit success/failure
2. **Type-safe** - TypeScript knows data shape based on success
3. **Consistent** - Every service method uses same pattern
4. **Testable** - Easy to mock success/failure scenarios

### Usage

```typescript
const result = await paymentService.processPayment(request)

if (result.success) {
  // TypeScript knows result.data is PaymentResponse
  console.log('Payments:', result.data.payments)
  console.log('Order:', result.data.order)
} else {
  // TypeScript knows result.error is string
  console.error('Error:', result.error)
  console.log('Status code:', result.statusCode)
}
```

### Type Guard

Helper function for cleaner code:

```typescript
export function isSuccessResult<T>(
  result: ServiceResult<T>
): result is { success: true; data: T } {
  return result.success
}

// Usage
if (isSuccessResult(result)) {
  // result.data is available
  return result.data
}
```

## API Methods

### 1. processPayment()

Process one or more payments for an order.

**Signature:**
```typescript
async processPayment(request: PaymentRequest): Promise<ServiceResult<PaymentResponse>>
```

**Types:**
```typescript
interface PaymentRequest {
  orderId: string
  payments: PaymentInput[]
  employeeId: string
}

interface PaymentInput {
  method: PaymentMethod
  amount: number
  tipAmount?: number
  amountTendered?: number
  datacapRecordNo?: string
  cardBrand?: string
  cardLast4?: string
  giftCardNumber?: string
  houseAccountId?: string
}

interface PaymentResponse {
  payments: ProcessedPayment[]
  order?: Order
  changeAmount?: number
}
```

**Example:**
```typescript
const result = await paymentService.processPayment({
  orderId: 'order-123',
  payments: [
    {
      method: 'cash',
      amount: 50.00,
      tipAmount: 10.00,
      amountTendered: 60.00,
    },
  ],
  employeeId: 'emp-456',
})

if (isSuccessResult(result)) {
  console.log('Payment successful!', result.data)
} else {
  console.error('Payment failed:', result.error)
}
```

**Logging:**
```
[payment] Processing payment { orderId: 'order-123', paymentCount: 1 }
[payment] Payment processed successfully { orderId: 'order-123', payments: 1 }
```

### 2. voidItems()

Void specific items on an order.

**Signature:**
```typescript
async voidItems(request: VoidRequest): Promise<ServiceResult<VoidResponse>>
```

**Types:**
```typescript
interface VoidRequest {
  orderId: string
  itemIds: string[]
  reason: string
  requireManagerApproval: boolean
  employeeId: string
  managerPin?: string
}

interface VoidResponse {
  voidedItems: OrderItem[]
  order: Order
}
```

**Example:**
```typescript
const result = await paymentService.voidItems({
  orderId: 'order-123',
  itemIds: ['item-1', 'item-2'],
  reason: 'kitchen_error',
  requireManagerApproval: true,
  employeeId: 'emp-456',
  managerPin: '1234',
})
```

### 3. requestRemoteVoidApproval()

Request remote void approval via SMS.

**Signature:**
```typescript
async requestRemoteVoidApproval(
  request: RemoteVoidApprovalRequest
): Promise<ServiceResult<RemoteVoidApprovalResponse>>
```

**Types:**
```typescript
interface RemoteVoidApprovalRequest {
  orderId: string
  itemIds: string[]
  reason: string
  requestingEmployeeId: string
  managerId: string
}

interface RemoteVoidApprovalResponse {
  approvalCode: string
  expiresAt: Date
}
```

**Example:**
```typescript
const result = await paymentService.requestRemoteVoidApproval({
  orderId: 'order-123',
  itemIds: ['item-1'],
  reason: 'Customer complained',
  requestingEmployeeId: 'emp-456',
  managerId: 'mgr-789',
})

if (isSuccessResult(result)) {
  console.log('Approval code:', result.data.approvalCode)
}
```

### 4. checkGiftCardBalance()

Check gift card balance.

**Signature:**
```typescript
async checkGiftCardBalance(
  request: GiftCardBalanceRequest
): Promise<ServiceResult<GiftCardBalanceResponse>>
```

**Types:**
```typescript
interface GiftCardBalanceRequest {
  cardNumber: string
  locationId: string
}

interface GiftCardBalanceResponse {
  balance: number
  isActive: boolean
  cardNumber: string
}
```

**Example:**
```typescript
const result = await paymentService.checkGiftCardBalance({
  cardNumber: '1234567890',
  locationId: 'loc-123',
})

if (isSuccessResult(result)) {
  console.log('Balance:', result.data.balance)
  console.log('Active:', result.data.isActive)
}
```

### 5. loadHouseAccounts()

Load active house accounts for a location.

**Signature:**
```typescript
async loadHouseAccounts(locationId: string): Promise<ServiceResult<HouseAccountsResponse>>
```

**Types:**
```typescript
interface HouseAccountsResponse {
  accounts: HouseAccount[]
}

interface HouseAccount {
  id: string
  name: string
  balance: number
  creditLimit: number
  isActive: boolean
}
```

**Example:**
```typescript
const result = await paymentService.loadHouseAccounts('loc-123')

if (isSuccessResult(result)) {
  const accounts = result.data.accounts
  // Display accounts in UI
}
```

### 6. fetchOrderForPayment()

Fetch order details for payment processing.

**Signature:**
```typescript
async fetchOrderForPayment(orderId: string): Promise<ServiceResult<{
  order: Order
  existingPayments: ProcessedPayment[]
  remainingBalance: number
}>>
```

**Example:**
```typescript
const result = await paymentService.fetchOrderForPayment('order-123')

if (isSuccessResult(result)) {
  console.log('Total:', result.data.order.total)
  console.log('Remaining:', result.data.remainingBalance)
  console.log('Existing payments:', result.data.existingPayments)
}
```

## Utility Methods

### calculateSplitAmounts()

Calculate split payment amounts with correct rounding.

**Signature:**
```typescript
calculateSplitAmounts(total: number, ways: number): number[]
```

**Example:**
```typescript
const amounts = paymentService.calculateSplitAmounts(100.00, 3)
// Returns: [33.33, 33.33, 33.34]
// Last payment adjusted for rounding
```

### calculateRemainingBalance()

Calculate remaining balance after existing payments.

**Signature:**
```typescript
calculateRemainingBalance(
  orderTotal: number,
  existingPayments: ProcessedPayment[]
): number
```

**Example:**
```typescript
const remaining = paymentService.calculateRemainingBalance(100.00, [
  { amount: 30.00, status: 'completed' },
  { amount: 20.00, status: 'completed' },
])
// Returns: 50.00
```

## Implementation Details

### Private Helper: handleResponse()

Transforms HTTP responses to ServiceResult:

```typescript
private async handleResponse<T>(response: Response): Promise<ServiceResult<T>> {
  try {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${response.status}: ${response.statusText}`,
        statusCode: response.status,
      }
    }

    return {
      success: true,
      data,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
```

### Logging

All API calls logged automatically:

```typescript
logger.payment('Processing payment', {
  orderId: request.orderId,
  paymentCount: request.payments.length,
})

// After response
if (result.success) {
  logger.payment('Payment processed successfully', {
    orderId: request.orderId,
    payments: result.data.payments.length,
  })
} else {
  logger.error('Payment processing failed', {
    orderId: request.orderId,
    error: result.error,
    statusCode: result.statusCode,
  })
}
```

### Singleton Export

Service exported as singleton:

```typescript
export const paymentService = new PaymentService()
```

No need to instantiate - just import and use:

```typescript
import { paymentService } from '@/lib/services'
```

## Benefits

### 1. Separation of Concerns

Components focus on UI, service handles API:

```typescript
// Component code is clean
const result = await paymentService.processPayment(request)

if (isSuccessResult(result)) {
  showSuccessToast()
  closeModal()
} else {
  showErrorToast(result.error)
}
```

### 2. Consistent Error Handling

All API errors handled consistently:

```typescript
// No try/catch needed - errors returned as values
const result = await paymentService.processPayment(request)

if (!result.success) {
  // All errors have same shape
  console.error(result.error)
  console.log('Status:', result.statusCode)
}
```

### 3. Easy Testing

Mock the service instead of fetch:

```typescript
import { PaymentService } from '@/lib/services'

const mockService = {
  processPayment: jest.fn().mockResolvedValue({
    success: true,
    data: { payments: [] }
  })
}

// Test component with mocked service
```

### 4. Centralized Logging

All API calls logged automatically:

```
[payment] Processing payment { orderId: 'order-123', paymentCount: 1 }
[payment] Payment processed { orderId: 'order-123', payments: 1 }
```

### 5. Type Safety

All requests and responses fully typed:

```typescript
const result = await paymentService.processPayment(request)

if (isSuccessResult(result)) {
  result.data.payments // ✅ Type-safe access
  result.data.order?.status // ✅ Optional chaining works
  result.data.invalidField // ❌ Compile error
}
```

## Testing

### Unit Tests

Test service methods in isolation:

```typescript
describe('PaymentService', () => {
  it('returns success result on 200', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ payments: [] })
    })

    const result = await paymentService.processPayment(request)

    expect(result.success).toBe(true)
    if (isSuccessResult(result)) {
      expect(result.data.payments).toEqual([])
    }
  })

  it('returns error result on 400', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid payment' })
    })

    const result = await paymentService.processPayment(request)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toBe('Invalid payment')
      expect(result.statusCode).toBe(400)
    }
  })
})
```

### Integration Tests

Test with real API routes:

```typescript
describe('PaymentService integration', () => {
  it('processes payment end-to-end', async () => {
    const result = await paymentService.processPayment({
      orderId: 'test-order',
      payments: [{ method: 'cash', amount: 50.00 }],
      employeeId: 'test-emp'
    })

    expect(result.success).toBe(true)
  })
})
```

## Migration Guide

### Before (Component with fetch)

```typescript
// PaymentModal.tsx
const handlePayment = async () => {
  try {
    const response = await fetch('/api/orders/123/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payments: [...], employeeId: '456' }),
    })

    const data = await response.json()

    if (!response.ok) {
      setError(data.error)
      return
    }

    // Success handling
  } catch (error) {
    setError(error.message)
  }
}
```

### After (Component with service)

```typescript
import { paymentService, isSuccessResult } from '@/lib/services'

const handlePayment = async () => {
  const result = await paymentService.processPayment({
    orderId: '123',
    payments: [...],
    employeeId: '456'
  })

  if (!isSuccessResult(result)) {
    setError(result.error)
    return
  }

  // Success handling
}
```

## Related Files

- `/src/lib/services/payment-service.ts` (350+ lines)
- `/src/lib/services/index.ts` (barrel exports)
- `/src/lib/services/README.md` (documentation)

## Future Services

Following the same pattern for other domains:

### OrderService
```typescript
class OrderService {
  async createOrder(params: CreateOrderParams)
  async updateOrder(orderId: string, updates: OrderUpdates)
  async addItems(orderId: string, items: OrderItem[])
}
```

### CustomerService
```typescript
class CustomerService {
  async searchCustomers(query: string)
  async getCustomer(customerId: string)
  async updateLoyaltyPoints(customerId: string, points: number)
}
```

### InventoryService
```typescript
class InventoryService {
  async getStockLevels(locationId: string)
  async adjustStock(itemId: string, quantity: number)
}
```

## Deployment Notes

No breaking changes - additive layer on top of existing APIs.

Safe to deploy with zero downtime.

## Monitoring

Key metrics:
- API call success rate (should be >99%)
- Average API response time (should be <200ms)
- Error rate by endpoint
- Most common error messages
