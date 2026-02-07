# Services Layer

Service classes that encapsulate API calls and provide clean interfaces for components.

## Architecture

```
┌─────────────────────────────────┐
│      React Components           │
│      (UI Logic Only)            │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│      Services Layer             │
│      - PaymentService           │
│      - OrderService (future)    │
│      - CustomerService (future) │
│                                 │
│   Handles:                      │
│   • API calls                   │
│   • Error transformation        │
│   • Response caching            │
│   • Request validation          │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│      API Routes                 │
│      /api/orders/*              │
│      /api/payments/*            │
└─────────────────────────────────┘
```

## PaymentService

### Usage

```typescript
import { paymentService, isSuccessResult } from '@/lib/services'

// Process payment
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

### API Methods

#### processPayment()
Process one or more payments for an order.

```typescript
const result = await paymentService.processPayment({
  orderId: 'order-123',
  payments: [
    {
      method: 'credit',
      amount: 75.50,
      datacapRecordNo: '123456',
      cardBrand: 'visa',
      cardLast4: '4242',
    },
  ],
  employeeId: 'emp-456',
})
```

#### voidItems()
Void specific items on an order.

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

#### requestRemoteVoidApproval()
Request remote void approval via SMS.

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

#### checkGiftCardBalance()
Check gift card balance.

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

#### loadHouseAccounts()
Load active house accounts for a location.

```typescript
const result = await paymentService.loadHouseAccounts('loc-123')

if (isSuccessResult(result)) {
  const accounts = result.data.accounts
  // Display accounts in UI
}
```

#### fetchOrderForPayment()
Fetch order details for payment processing.

```typescript
const result = await paymentService.fetchOrderForPayment('order-123')

if (isSuccessResult(result)) {
  console.log('Total:', result.data.total)
  console.log('Existing payments:', result.data.existingPayments)
}
```

### Utility Methods

#### calculateSplitAmounts()
Calculate split payment amounts with correct rounding.

```typescript
const amounts = paymentService.calculateSplitAmounts(100.00, 3)
// Returns: [33.33, 33.33, 33.34] (last payment adjusted for rounding)
```

#### calculateRemainingBalance()
Calculate remaining balance after existing payments.

```typescript
const remaining = paymentService.calculateRemainingBalance(100.00, existingPayments)
console.log('Still owe:', remaining)
```

## Benefits

### 1. Separation of Concerns
Components focus on UI logic:
```tsx
// Before (component handles API calls)
function PaymentModal() {
  const handlePay = async () => {
    try {
      const response = await fetch('/api/orders/123/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ... }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error)
        return
      }
      // Handle success
    } catch (error) {
      setError(error.message)
    }
  }
}

// After (component uses service)
function PaymentModal() {
  const handlePay = async () => {
    const result = await paymentService.processPayment({ ... })

    if (!isSuccessResult(result)) {
      setError(result.error)
      return
    }

    // Handle success
  }
}
```

### 2. Consistent Error Handling
All service methods return `ServiceResult<T>`:
```typescript
type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; statusCode?: number }
```

### 3. Easier Testing
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
```typescript
logger.payment('Processing payment', {
  orderId: request.orderId,
  paymentCount: request.payments.length,
})
```

### 5. Type Safety
All requests and responses are fully typed:
```typescript
// TypeScript knows the shape of the data
const result = await paymentService.processPayment(request)
if (isSuccessResult(result)) {
  result.data.payments // ✅ Type-safe access
  result.data.order?.status // ✅ Optional chaining works
}
```

## Future Services

### OrderService
```typescript
class OrderService {
  async createOrder(params: CreateOrderParams)
  async updateOrder(orderId: string, updates: OrderUpdates)
  async addItems(orderId: string, items: OrderItem[])
  async sendToKitchen(orderId: string)
  async closeOrder(orderId: string)
}
```

### CustomerService
```typescript
class CustomerService {
  async searchCustomers(query: string)
  async getCustomer(customerId: string)
  async createCustomer(data: CustomerData)
  async updateLoyaltyPoints(customerId: string, points: number)
}
```

### InventoryService
```typescript
class InventoryService {
  async getStockLevels(locationId: string)
  async adjustStock(itemId: string, quantity: number)
  async recordWaste(itemId: string, quantity: number, reason: string)
}
```

## Migration Guide

### Step 1: Install Service
```typescript
import { paymentService } from '@/lib/services'
```

### Step 2: Replace Fetch Calls
```typescript
// Before
const response = await fetch('/api/orders/123/pay', { ... })
const data = await response.json()

// After
const result = await paymentService.processPayment({ ... })
```

### Step 3: Update Error Handling
```typescript
// Before
if (!response.ok) {
  setError(data.error)
}

// After
if (!isSuccessResult(result)) {
  setError(result.error)
}
```

### Step 4: Use Type-Safe Data
```typescript
// Before
const payments = data.payments as Payment[]

// After
if (isSuccessResult(result)) {
  const payments = result.data.payments // ✅ Already typed
}
```
