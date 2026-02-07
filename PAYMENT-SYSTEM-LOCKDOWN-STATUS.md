# Payment System Lockdown - Implementation Status

**Generated:** 2026-02-06
**Goal:** Lock down payment system to A++ production-ready code quality

## ✅ COMPLETED (8/21 tasks - 38%)

### Critical Safety & Validation (4/4 - 100% Complete)

#### ✅ Task #1: Amount Validation
**Status:** COMPLETE
**File:** `src/app/api/orders/[id]/pay/route.ts`

**What was added:**
- Validation for NaN and negative amounts
- Maximum payment limit (150% of order total) to catch UI bugs
- Clear error messages with actual values

**Protection against:** Financial errors, negative charges, UI calculation bugs

---

#### ✅ Task #2: Datacap Field Mutual Exclusivity
**Status:** COMPLETE
**File:** `src/app/api/orders/[id]/pay/route.ts`

**What was added:**
- Enforcement: Either ALL Datacap fields or NONE
- Checks for partial Datacap data (corrupted records)
- Detailed error response showing which fields are present

**Protection against:** Corrupted payment records mixing real and simulated data

---

#### ✅ Task #3: PaymentIntentManager Concurrency Guard
**Status:** COMPLETE
**File:** `src/lib/payment-intent-manager.ts`

**What was added:**
- Generation counter pattern to prevent race conditions
- Protection when interval and online event fire simultaneously
- Only latest generation clears processing flag

**Protection against:** Double-charges, corrupted intent status, race conditions

---

#### ✅ Task #4: Idempotency Key Includes Amount
**Status:** COMPLETE
**File:** `src/lib/payment-intent-manager.ts`

**What was changed:**
- Format: `${terminalId}-${orderId}-${amountCents}-${timestamp}-${uuid}`
- Detects mismatched replays (same order, different amount)

**Protection against:** Duplicate charges with different amounts

---

### Infrastructure (4/4 - 100% Complete)

#### ✅ Task #5: Typed DatacapError Result Contract
**Status:** COMPLETE
**File:** `src/lib/datacap/types.ts`

**What was added:**
```typescript
export type DatacapResult<T = DatacapResponse> =
  | { success: true; response: T; error: null }
  | { success: false; response: null; error: DatacapError }
```

**Next step:** Update DatacapClient methods to return `DatacapResult` (see Task #6)

**Benefits:** Explicit error handling, type-safe error checking, clearer code

---

#### ✅ Task #7: Centralized Logging
**Status:** COMPLETE
**File:** `src/lib/logger.ts`

**What was added:**
- Structured logging with subsystem tagging
- Correlation IDs (readerId, orderId, seqNo, etc.)
- Methods: `logger.datacap()`, `logger.payment()`, `logger.error()`, etc.

**Usage:**
```typescript
import { logger } from '@/lib/logger'
logger.datacap('EMVSale initiated', { readerId, orderId, amount })
logger.error('datacap', 'Connection failed', error, { readerId })
```

**Next step:** Replace all `console.log/error` in datacap and payment code

---

#### ✅ Task #8: Zod Request Validation
**Status:** COMPLETE
**File:** `src/app/api/orders/[id]/pay/route.ts`

**What was added:**
- `PaymentInputSchema` with field validation
- `PaymentRequestSchema` for complete request
- Automatic validation with clear error messages

**Protection against:** Malformed requests, invalid data types, missing required fields

---

#### ✅ Task #9: Narrow Error Types
**Status:** COMPLETE
**File:** `src/lib/errors.ts`

**What was added:**
- `POSError` base class with httpStatus and isRetryable
- Specific errors: `LocationNotFoundError`, `ReaderNotFoundError`, `PaymentProcessorNotConfiguredError`, `DatacapTimeoutError`, `DatacapNetworkError`, etc.
- `errorToResponse()` and `getErrorStatus()` helpers

**Usage:**
```typescript
throw new DatacapTimeoutError('EMVSale', 60000, readerId)
// Automatically maps to HTTP 504, isRetryable: true
```

---

## 🔄 IN PROGRESS (0/21 tasks)

None currently in progress.

---

## ⏳ REMAINING (13/21 tasks - 62%)

### High Priority - Datacap Client Improvements

#### Task #6: Add Network Error Classification
**Effort:** Medium (2-3 hours)
**Files:** `src/lib/datacap/client.ts`

**What to do:**
1. In `sendLocal()` and `sendCloud()`, catch specific error codes
2. Map to DatacapNetworkError with isRetryable flag:
   - ECONNREFUSED → retryable
   - ENETUNREACH → retryable
   - ETIMEDOUT → retryable
   - ENOTFOUND → not retryable
3. Wrap all DatacapClient methods to return `DatacapResult<T>`
4. Update all callers to check `result.success`

**Example:**
```typescript
async sale(params: SaleParams): Promise<DatacapResult<DatacapResponse>> {
  try {
    const response = await this.send(...)
    const error = parseError(response)
    if (error) {
      return { success: false, response: null, error }
    }
    return { success: true, response, error: null }
  } catch (err) {
    const error = classifyNetworkError(err)
    return { success: false, response: null, error }
  }
}
```

---

#### Task #15: Make Communication Mode Data-Driven
**Effort:** Medium (2 hours)
**Files:** `src/lib/datacap/client.ts`

**What to do:**
1. Create `processorMode → communicationMode` mapping
2. Validate `datacapMerchantId` and required config upfront
3. Replace string comparisons with discriminated union
4. Throw clear configuration errors

**Current problem:**
```typescript
communicationMode: payments.processor === 'simulated' ? 'local' : 'local'
// Never yields 'cloud' or 'local_with_cloud_fallback'
```

---

#### Task #16: Improve XML Builder Type Safety
**Effort:** Medium (3-4 hours)
**Files:** `src/lib/datacap/xml-builder.ts`, `src/lib/datacap/types.ts`

**What to do:**
1. Create `DatacapRequiredFields` type
2. Builder enforces required fields at compile time
3. Ensure consistent `escapeXml` usage
4. Verify boolean conversion (Datacap wants "Y"/"N" or "Yes"/"No"?)

---

#### Task #17: Optimize XML Parser Performance
**Effort:** Low (1-2 hours)
**Files:** `src/lib/datacap/xml-parser.ts`

**What to do:**
1. Prebuild regexes for common tags (instead of `new RegExp` each call)
2. Consider SAX-style parse for high throughput
3. Add JSDoc clarifying raw vs normalized fields

**Low priority** unless performance becomes an issue.

---

### High Priority - Architecture

#### Task #10: Extract PaymentService Client Layer
**Effort:** High (4-6 hours)
**Files:** Create `src/lib/payment-service.ts`, update components

**What to do:**
1. Create `PaymentService` class with methods:
   - `processPayment(orderId, payments)`
   - `voidPayment(orderId, paymentId)`
   - `refundPayment(orderId, paymentId)`
2. Move API call logic from PaymentModal to service
3. Handle request/response transformation in service
4. Components call service instead of direct API calls

**Benefits:** Clean separation, easier testing, reusable logic

---

#### Task #11: Create PaymentDomain Server Module
**Effort:** High (6-8 hours)
**Files:** Create `src/lib/payment-domain/*`, update API routes

**What to do:**
1. Create domain modules:
   - `rounding.ts` - Pure rounding functions (see Task #19)
   - `loyalty.ts` - Loyalty point calculations
   - `dual-pricing.ts` - Dual pricing logic
   - `validation.ts` - Business rule validations
2. Move logic from API routes to domain modules
3. Keep API routes as thin adapters

**Benefits:** Testable business logic, consistent rules, easier maintenance

---

#### Task #12: Create DatacapPaymentUseCases Layer
**Effort:** Medium (3-4 hours)
**Files:** Create `src/lib/datacap/use-cases.ts`, update callers

**What to do:**
1. Create `DatacapPaymentUseCases` that composes `DatacapClient`
2. Move POS-specific behaviors:
   - Tip mode handling
   - Frequency settings
   - CardHolderId policy
3. Keep `DatacapClient` purely about XML/HTTP/simulator

**Benefits:** Clear separation of transport vs business logic

---

### Medium Priority - Component Refactoring

#### Task #13: Split PaymentModal into Smaller Components
**Effort:** High (6-8 hours)
**Files:** Create `src/components/payment/steps/*`, update PaymentModal

**What to do:**
1. Create step components:
   - `PaymentMethodStep.tsx` - Method selection
   - `TipStep.tsx` - Tip calculation
   - `CashStep.tsx` - Cash payment
   - `GiftCardStep.tsx` - Gift card
   - `HouseAccountStep.tsx` - House account
   - `DatacapCardStep.tsx` - Card payment wrapper
2. Keep `PaymentModal` as coordinator with minimal props
3. Each step component handles its own state/logic

**Benefits:** Easier maintenance, better testing, clearer code

---

#### Task #14: Add useMemo to PaymentModal Derived Values
**Effort:** Low (1 hour)
**Files:** `src/components/payment/PaymentModal.tsx` (or new step components)

**What to do:**
1. Wrap derived calculations in `useMemo`:
   - `alreadyPaid`, `pendingTotal`, `remainingBeforeTip`
   - `cashTotal`, `cardTotal`, `currentTotal`, `totalWithTip`
   - `quickAmounts`
2. Add proper dependency arrays
3. Prevent unnecessary recalculations and rerenders

---

#### Task #21: Strengthen PaymentModal Safety Checks
**Effort:** Low (1-2 hours)
**Files:** `src/components/payment/PaymentModal.tsx`

**What to do:**
1. Validate `orderId` is not null before payment steps
2. Validate `terminalId` exists before Datacap processing
3. Validate `selectedMethod` in `handleDatacapSuccess`
4. Add controlled error states for missing config

---

### Medium Priority - Production Readiness

#### Task #18: Add Batch Sync Backoff Logic
**Effort:** Medium (2-3 hours)
**Files:** `src/lib/payment-intent-manager.ts`

**What to do:**
1. Detect full batch failures (HTTP 500, network errors)
2. Implement exponential backoff: 15s, 30s, 60s, 120s
3. Add max retry count per intent
4. Flag as `failed` after max retries with reason

**Benefits:** Prevents hammering server during outages

---

#### Task #19: Extract Cash Rounding to Pure Functions
**Effort:** Low (1-2 hours)
**Files:** Create `src/lib/payment-domain/rounding.ts`, tests, update payment route

**What to do:**
1. Move `calculateRoundingAdjustment` and `roundAmount` to dedicated module
2. Add comprehensive tests for all rounding modes
3. Make functions pure with clear inputs/outputs

**Benefits:** Testable, predictable, prevents cash errors

---

#### Task #20: Add JSDoc to All Exported Functions
**Effort:** Medium (3-4 hours)
**Files:** All `src/lib/datacap/*`, `src/lib/payment*.ts`

**What to do:**
1. Add JSDoc to all exported functions
2. Document side-effects, invariants, return types
3. Example: Document `withPadReset` guarantee

**Benefits:** Better code navigation, clearer API contracts

---

## 📊 Summary

| Category | Complete | Remaining | Progress |
|----------|----------|-----------|----------|
| Critical Safety | 4/4 | 0 | 100% ✅ |
| Infrastructure | 4/4 | 0 | 100% ✅ |
| Datacap Client | 0/4 | 4 | 0% ⏳ |
| Architecture | 0/3 | 3 | 0% ⏳ |
| Components | 0/2 | 2 | 0% ⏳ |
| Production | 0/2 | 2 | 0% ⏳ |
| Documentation | 0/1 | 1 | 0% ⏳ |
| **TOTAL** | **8/21** | **13** | **38%** ✅ |

---

## 🎯 Recommended Next Steps

### Week 1 (This Week) - DONE ✅
- [x] Amount validation
- [x] Datacap field mutual exclusivity
- [x] PaymentIntentManager concurrency
- [x] Idempotency key with amount
- [x] Logging infrastructure
- [x] Error types
- [x] Zod validation
- [x] Result type pattern

### Week 2 (Next Priority)
- [ ] Task #6: Network error classification + DatacapResult implementation
- [ ] Task #19: Extract rounding to pure functions
- [ ] Task #21: PaymentModal safety checks
- [ ] Task #14: useMemo optimizations

### Week 3 (Architecture)
- [ ] Task #10: PaymentService extraction
- [ ] Task #11: PaymentDomain module
- [ ] Task #12: DatacapPaymentUseCases

### Week 4 (Polish)
- [ ] Task #13: Split PaymentModal
- [ ] Task #15: Communication mode
- [ ] Task #16: XML builder type safety
- [ ] Task #18: Batch sync backoff
- [ ] Task #20: JSDoc documentation

---

## 🚀 How to Continue

All tasks are tracked in the task list. To resume:

```bash
# View task list
/tasks

# Update task status when working
# (Example: Start task #6)
# Task #6 is now "in_progress"

# Mark complete when done
# Task #6 is now "completed"
```

---

## 📝 Code Changes Made

### New Files Created
1. `src/lib/logger.ts` - Centralized logging utility
2. `src/lib/errors.ts` - Narrow error type definitions

### Modified Files
1. `src/app/api/orders/[id]/pay/route.ts`
   - Added amount validation
   - Added Datacap field mutual exclusivity
   - Added Zod request validation

2. `src/lib/payment-intent-manager.ts`
   - Added generation counter for concurrency
   - Updated idempotency key to include amount

3. `src/lib/datacap/types.ts`
   - Added `DatacapResult<T>` type pattern

---

## 🔧 Testing Checklist

After implementing remaining tasks, test:

- [ ] Payment validation catches invalid amounts
- [ ] Partial Datacap data returns 400 error
- [ ] Concurrent processPendingIntents doesn't cause race conditions
- [ ] Idempotency keys differ when amounts differ
- [ ] Logger outputs include correlation IDs
- [ ] Zod validation rejects malformed requests
- [ ] Network errors are properly classified and retryable
- [ ] PaymentModal safety checks prevent invalid states

---

**Status:** 38% complete. Critical safety layer is 100% complete. Architecture refactoring remains.
