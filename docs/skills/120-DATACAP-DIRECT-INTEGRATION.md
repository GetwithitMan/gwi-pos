# Skill 120: Datacap Direct Payment Integration

## Overview

Integrates Datacap Direct semi-integrated payment processing into GWI POS. The POS sends transaction details to local card readers; readers handle sensitive card data and return authorization tokens. This eliminates cloud latency while maintaining PCI compliance.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GWI POS (Local Server)                    │
│  • Sends Amount, Invoice to reader                          │
│  • Receives authCode, cardLast4 only (no raw card data)     │
│  • Out of PCI scope                                         │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ HTTP (local network, 15-30ms)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Datacap Direct Reader                       │
│  IP: 192.168.1.50:8080                                      │
│  • Handles card tap/insert/swipe                            │
│  • Communicates with processor                              │
│  • Returns token only                                       │
└─────────────────────────────────────────────────────────────┘
```

## Database Models

### PaymentReader

Tracks Datacap card readers as independent devices:

```prisma
model PaymentReader {
  id               String    @id @default(cuid())
  locationId       String
  name             String    // "Bar Reader", "Lobby Reader"
  serialNumber     String    @unique
  ipAddress        String
  port             Int       @default(8080)
  verificationType String    @default("SERIAL_HANDSHAKE")
  isActive         Boolean   @default(true)
  isOnline         Boolean   @default(false)
  lastSeenAt       DateTime?
  lastError        String?
  avgResponseTime  Int?
  successRate      Decimal?
}
```

### Terminal Additions

```prisma
// Added to Terminal model
paymentReaderId       String?        // Primary reader binding
paymentReader         PaymentReader?
paymentProvider       String         @default("SIMULATED")
backupPaymentReaderId String?        // Failover reader
backupPaymentReader   PaymentReader?
readerFailoverTimeout Int            @default(10000)
```

### Payment Additions

```prisma
// Added to Payment model
paymentReaderId  String?  // Which reader processed this
datacapRefNumber String?  // Datacap reference for voids/refunds
entryMethod      String?  // "Chip" | "Tap" | "Swipe" | "Manual"
```

## API Endpoints

### Payment Reader Management

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/hardware/payment-readers` | GET | List all readers |
| `/api/hardware/payment-readers` | POST | Add new reader |
| `/api/hardware/payment-readers/[id]` | GET | Get reader details |
| `/api/hardware/payment-readers/[id]` | PUT | Update reader |
| `/api/hardware/payment-readers/[id]` | DELETE | Soft delete reader |
| `/api/hardware/payment-readers/[id]/ping` | POST | Check connectivity |
| `/api/hardware/payment-readers/[id]/verify` | POST | Serial handshake + beep |

### Terminal Reader Binding

Update terminal to bind/unbind readers:
```
PUT /api/hardware/terminals/[id]
{
  "paymentReaderId": "reader-123",
  "backupPaymentReaderId": "reader-456",
  "paymentProvider": "DATACAP_DIRECT"
}
```

## Hook: useDatacap

Located at `src/hooks/useDatacap.ts`

### Interface

```typescript
interface UseDatacapReturn {
  reader: PaymentReader | null
  backupReader: PaymentReader | null
  isReaderOnline: boolean
  isProcessing: boolean
  processingStatus: 'idle' | 'checking_reader' | 'waiting_card' | 'authorizing' | 'approved' | 'declined' | 'error'
  error: string | null

  processPayment: (params: {
    orderId: string
    amount: number
    tipAmount?: number
  }) => Promise<DatacapResult | null>

  cancelTransaction: () => Promise<void>
  checkReaderStatus: () => Promise<boolean>
  swapToBackup: () => void
  triggerBeep: () => Promise<void>
}
```

### DatacapResult Interface

```typescript
interface DatacapResult {
  approved: boolean
  authCode?: string
  refNumber?: string
  cardBrand?: string
  cardLast4?: string
  entryMethod?: 'Chip' | 'Tap' | 'Swipe' | 'Manual'
  responseCode?: string
  responseMessage?: string

  // Partial Approvals (card may have insufficient funds)
  amountRequested: number
  amountAuthorized: number
  isPartialApproval: boolean

  // Signature (chargeback defense)
  signatureData?: string // Base64 signature from reader
}
```

### Transaction Flow

1. **Pre-flight**: GET `http://{ip}:{port}/v1/device/info` → verify serial
2. **Transaction**: POST `http://{ip}:{port}/v1/process` with:
   - `Amount`, `TranType`, `Invoice`
   - `TipRequest: "True"` - EMV-level tip prompting
   - `SignatureRequest: "True"` - Capture signature for chargeback defense
   - `PartialAuth: "True"` - Allow partial approvals
3. **On timeout**: Trigger swap to backup reader

### Partial Approval Handling

When a card has insufficient funds:
1. Transaction approved for available balance (e.g., $10 of $50)
2. `isPartialApproval: true` in result
3. UI shows approved amount and remaining balance
4. Server can "Accept Partial" (keep order open) or "Void & Retry"
5. Remaining balance collected via another payment method

## Components

### DatacapPaymentProcessor

Main card payment UI component with:
- Tip selection (quick percentages + custom)
- Reader status indicator
- "Swap Reader" button
- "COLLECT PAYMENT" action button
- Processing overlay with status
- Success/declined overlays

### SwapConfirmationModal

Shown when swapping readers:
- Displays last 6 digits of serial number
- "PING READER (BEEP)" button for physical verification
- "YES, I HAVE THIS READER" confirmation

### ReaderStatusIndicator

Shows reader status:
- Green dot + IP when online
- Red dot + "Offline" when unreachable
- Swap link when backup available

## PaymentModal Integration

When `paymentSettings.processor === 'datacap'`:
1. Card payment routes to `datacap_card` step
2. DatacapPaymentProcessor handles the transaction
3. On success, payment is processed normally

```typescript
// In PaymentModal.tsx
if ((selectedMethod === 'credit' || selectedMethod === 'debit') &&
    paymentSettings.processor === 'datacap') {
  setStep('datacap_card')
}
```

## Admin UI

### Payment Readers Page

Located at `/settings/hardware/payment-readers`:
- Card grid of all readers
- Add/Edit modal with fields:
  - Name, Serial Number, IP Address, Port
  - Verification Type (Serial Handshake / IP Only)
- Actions per reader:
  - Ping (check connectivity)
  - Verify (serial handshake + beep)
  - Edit, Delete

### Hardware Dashboard

Payment Readers section added showing:
- Reader count and status
- Quick status cards
- "Manage Readers" link

### Terminal Page

Enhanced with "Payment Terminal Binding" section:
- Primary Reader dropdown
- Backup Reader dropdown
- Payment Provider selector (Datacap / Simulated)

## Configuration

### PaymentSettings

```typescript
interface PaymentSettings {
  // ... existing fields ...

  processor: 'none' | 'simulated' | 'datacap'
  testMode: boolean
  datacapMerchantId?: string
  readerTimeoutSeconds: number     // Default: 30
  autoSwapOnFailure: boolean       // Default: true
}
```

### Enabling Datacap

Set in location settings:
```json
{
  "payments": {
    "processor": "datacap",
    "readerTimeoutSeconds": 30,
    "autoSwapOnFailure": true
  }
}
```

## Verification Types

| Type | Description |
|------|-------------|
| SERIAL_HANDSHAKE | Verifies serial number matches before each transaction. Prevents accidental cross-pairing. |
| IP_ONLY | Faster - trusts IP address only. Use in trusted environments. |

## Failover Logic

1. Primary reader times out (default 10s)
2. SwapConfirmationModal appears
3. User verifies backup reader serial
4. Reader beeps for physical confirmation
5. User confirms → swap completes
6. Transaction retries on backup

## Key Files

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | PaymentReader model + Terminal fields |
| `src/hooks/useDatacap.ts` | Datacap communication hook |
| `src/components/payment/DatacapPaymentProcessor.tsx` | Main payment UI |
| `src/components/payment/SwapConfirmationModal.tsx` | Swap verification |
| `src/components/payment/ReaderStatusIndicator.tsx` | Status display |
| `src/app/api/hardware/payment-readers/` | CRUD + ping/verify APIs |
| `src/app/(admin)/settings/hardware/payment-readers/page.tsx` | Admin page |
| `src/lib/settings.ts` | PaymentSettings with Datacap config |

## Security Considerations

- **PCI Compliance**: POS never handles raw card data - out of PCI scope
- **Serial Handshake**: Prevents wrong-reader pairing
- **Local Network Only**: Reader communication stays on local subnet
- **No Card Storage**: Only last 4 digits and card brand stored

## Chargeback Defense

The integration includes signature capture for "Service Not Rendered" chargeback defense:

### Payment Schema Fields

```prisma
// Added to Payment model
amountRequested  Decimal? // Original amount requested
amountAuthorized Decimal? // Actual amount approved (may be less for partial)
signatureData    String?  // Base64 signature from reader
```

### How It Works

1. Transaction request includes `SignatureRequest: "True"`
2. Reader prompts customer for signature (stylus or finger)
3. Signature returned as Base64 string in `signatureData`
4. Stored in Payment record for dispute resolution

### Partial Approval Storage

When a card has insufficient funds:
- `amountRequested` = What server tried to charge
- `amountAuthorized` = What the card actually approved
- Remaining balance can be collected via another method

## Status: Complete

- Schema and migrations
- API endpoints with ping/verify
- useDatacap hook with failover
- Payment components with partial approval UI
- Signature capture for chargeback defense
- Admin UI
- PaymentModal integration
