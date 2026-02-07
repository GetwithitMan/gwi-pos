# Skill 222: Datacap Communication Validation & JSDoc

**Status:** ✅ DONE (2026-02-06)
**Category:** Payments / Hardware
**Dependencies:** 120 (Datacap Direct Integration)
**Related Skills:** 221 (Payment Intent Backoff)

## Problem

The Datacap client lacked comprehensive input validation and documentation:

### Issues:
1. **No validation** - `communicationMode` could be set to invalid values causing runtime errors
2. **Missing mode** - 'simulated' mode wasn't part of the type definition
3. **Undocumented API** - 17 public methods had no JSDoc
4. **Mode bug** - Simulated mode incorrectly set to 'local' in helpers.ts
5. **Silent failures** - Invalid config passed validation, failed later at runtime

## Solution

### Part 1: Communication Mode Validation

Added comprehensive validation for `DatacapConfig` with mode-specific field requirements.

**File:** `/src/lib/datacap/types.ts`

#### Updated Type Definition

```typescript
export type CommunicationMode =
  | 'local'                      // Direct to reader on local network
  | 'cloud'                      // Via Datacap cloud gateway
  | 'local_with_cloud_fallback'  // Try local first, fallback to cloud
  | 'simulated'                  // Mock mode for development/testing
```

#### Validation Function

```typescript
export function validateDatacapConfig(config: DatacapConfig): void {
  const { communicationMode } = config

  // Validate mode
  const validModes: CommunicationMode[] = [
    'local',
    'cloud',
    'local_with_cloud_fallback',
    'simulated'
  ]

  if (!validModes.includes(communicationMode)) {
    throw new Error(
      `Invalid communication mode: ${communicationMode}. ` +
      `Must be one of: ${validModes.join(', ')}`
    )
  }

  // Validate mode-specific fields
  if (communicationMode === 'local' || communicationMode === 'local_with_cloud_fallback') {
    if (!config.ipAddress) {
      throw new Error(`ipAddress is required for ${communicationMode} mode`)
    }
    if (!config.port) {
      throw new Error(`port is required for ${communicationMode} mode`)
    }
  }

  if (communicationMode === 'cloud' || communicationMode === 'local_with_cloud_fallback') {
    if (!config.secureDevice) {
      throw new Error(`secureDevice is required for ${communicationMode} mode`)
    }
  }

  // Validate required merchant fields
  if (!config.merchantId) {
    throw new Error('merchantId is required')
  }

  if (!config.operatorId) {
    throw new Error('operatorId is required')
  }
}
```

### Mode-Specific Requirements

| Mode | Required Fields |
|------|----------------|
| `local` | ipAddress, port, merchantId, operatorId |
| `cloud` | secureDevice, merchantId, operatorId |
| `local_with_cloud_fallback` | ipAddress, port, secureDevice, merchantId, operatorId |
| `simulated` | merchantId, operatorId (others ignored) |

### Part 2: Bug Fix in Helpers

**File:** `/src/lib/datacap/helpers.ts`

**Before (Bug):**
```typescript
communicationMode: payments.processor === 'simulated' ? 'local' : 'local'
//                                                        ^^^^^^ Wrong!
```

**After (Fixed):**
```typescript
communicationMode: payments.processor === 'simulated' ? 'simulated' : 'local'
//                                                      ^^^^^^^^^^^ Correct!
```

### Part 3: DatacapClient Constructor Validation

**File:** `/src/lib/datacap/client.ts`

Added validation call in constructor:

```typescript
export class DatacapClient {
  constructor(config: DatacapConfig) {
    // Validate config on instantiation
    validateDatacapConfig(config)

    this.config = config
    this.sequenceManager = new SequenceManager()
  }

  // ... rest of class
}
```

Now throws immediately if config is invalid, rather than failing later during a transaction.

### Part 4: Comprehensive JSDoc Documentation

Added JSDoc to all 17 public methods in `DatacapClient`.

#### Example: Sale Method

```typescript
/**
 * Process a sale transaction (EMVSale).
 *
 * This is the primary method for charging a customer's card. The terminal
 * will prompt for card insertion/tap, amount confirmation, and PIN if required.
 *
 * @param params - Sale parameters
 * @param params.purchase - Total purchase amount in dollars (e.g., 10.50)
 * @param params.gratuity - Tip amount in dollars (optional)
 * @param params.tax - Tax amount in dollars (optional)
 * @param params.invoice - Invoice/order number for reference (optional)
 * @param params.refNo - Reference number for tracking (optional)
 * @param params.authKey - Authorization key for batch settlement (optional)
 *
 * @returns Sale result with approval status, record number, and receipt data
 *
 * @throws {Error} If communication fails or transaction is declined
 *
 * @example
 * ```typescript
 * const result = await client.sale({
 *   purchase: 25.50,
 *   gratuity: 5.00,
 *   invoice: 'ORDER-123'
 * })
 *
 * if (result.approved) {
 *   console.log('Payment approved! Record:', result.recordNo)
 * } else {
 *   console.error('Payment declined:', result.message)
 * }
 * ```
 */
async sale(params: SaleParams): Promise<DatacapResult<SaleResponse>>
```

#### Documented Methods (17 Total)

| Method | Purpose | JSDoc Added |
|--------|---------|------------|
| `sale()` | Process sale | ✅ |
| `preAuth()` | Card pre-authorization | ✅ |
| `preAuthCapture()` | Capture pre-auth | ✅ |
| `incrementalAuth()` | Increase auth amount | ✅ |
| `adjustGratuity()` | Add tip after payment | ✅ |
| `voidSale()` | Void by record number | ✅ |
| `voidReturn()` | Void a return | ✅ |
| `emvReturn()` | Process refund (card present) | ✅ |
| `collectCardData()` | Read card without charge | ✅ |
| `padReset()` | Reset terminal | ✅ |
| `paramDownload()` | Update terminal params | ✅ |
| `batchSummary()` | Get batch totals | ✅ |
| `batchClose()` | Close current batch | ✅ |
| `getSuggestiveTip()` | Display tip options | ✅ |
| `getSignature()` | Capture signature | ✅ |
| `getYesNo()` | Yes/no prompt | ✅ |
| `getMultipleChoice()` | Multiple choice prompt | ✅ |

Each method now includes:
- Purpose description
- Parameter documentation with types and examples
- Return value documentation
- Error conditions
- Usage example

## Benefits

### 1. Early Error Detection

Invalid config caught at instantiation:
```typescript
// Throws immediately with clear message
const client = new DatacapClient({
  communicationMode: 'local',
  // Missing ipAddress and port!
})
// Error: ipAddress is required for local mode
```

### 2. Type Safety

TypeScript now knows all valid modes:
```typescript
const mode: CommunicationMode = 'simulated' // ✅ Valid
const mode: CommunicationMode = 'invalid'   // ❌ Compile error
```

### 3. Better Developer Experience

IDE autocomplete and inline documentation:
```typescript
client.sale({
  purchase: 10.00,
  gratuity: 2.00, // <-- Hover shows: "Tip amount in dollars (optional)"
})
```

### 4. Simulated Mode Works

Bug fix ensures simulated mode actually uses simulated mode:
```typescript
// Before: Tried to connect to 127.0.0.1 even in simulated mode
// After: Uses in-memory simulator as intended
```

### 5. Reduced Support Burden

Clear error messages reduce debugging time:
- "Invalid communication mode: xyz" → User knows exactly what's wrong
- "ipAddress is required for local mode" → User knows what's missing

## Testing

### Test Suite: Config Validation

```typescript
describe('validateDatacapConfig', () => {
  it('throws on invalid mode', () => {
    expect(() => {
      validateDatacapConfig({
        communicationMode: 'invalid',
        merchantId: '123',
        operatorId: '456'
      })
    }).toThrow('Invalid communication mode')
  })

  it('throws when ipAddress missing in local mode', () => {
    expect(() => {
      validateDatacapConfig({
        communicationMode: 'local',
        merchantId: '123',
        operatorId: '456'
        // Missing ipAddress
      })
    }).toThrow('ipAddress is required for local mode')
  })

  it('accepts valid local config', () => {
    expect(() => {
      validateDatacapConfig({
        communicationMode: 'local',
        ipAddress: '192.168.1.100',
        port: 8080,
        merchantId: '123',
        operatorId: '456'
      })
    }).not.toThrow()
  })

  it('accepts simulated mode without ipAddress', () => {
    expect(() => {
      validateDatacapConfig({
        communicationMode: 'simulated',
        merchantId: '123',
        operatorId: '456'
      })
    }).not.toThrow()
  })
})
```

## Migration Guide

### For Existing Code

No migration needed - validation is additive. If your config was valid before, it remains valid.

### For New Integrations

Always validate config before use:
```typescript
import { DatacapClient, validateDatacapConfig } from '@/lib/datacap'

const config = {
  communicationMode: 'local',
  ipAddress: settings.datacap.ip,
  port: settings.datacap.port,
  merchantId: settings.datacap.merchantId,
  operatorId: employeeId,
}

// Validate before creating client (optional - constructor does this)
validateDatacapConfig(config)

const client = new DatacapClient(config)
```

## Related Files

- `/src/lib/datacap/types.ts` - Type definitions + validation
- `/src/lib/datacap/client.ts` - Client class with JSDoc
- `/src/lib/datacap/helpers.ts` - Bug fix for simulated mode

## Future Enhancements

### 1. Zod Schema

Replace manual validation with Zod:
```typescript
const DatacapConfigSchema = z.object({
  communicationMode: z.enum(['local', 'cloud', 'local_with_cloud_fallback', 'simulated']),
  ipAddress: z.string().optional(),
  port: z.number().optional(),
  // ...
}).refine(/* mode-specific validation */)
```

### 2. Config Builder

Fluent API for building configs:
```typescript
const config = DatacapConfig.builder()
  .local('192.168.1.100', 8080)
  .merchant('123', '456')
  .build()
```

### 3. Runtime Mode Switching

Allow switching modes without recreating client:
```typescript
client.setMode('cloud') // Fallback to cloud if local fails
```

## Deployment Notes

No schema changes - purely additive validation and documentation.

Safe to deploy with zero downtime.
