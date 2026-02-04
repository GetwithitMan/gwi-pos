# Skill 122: Remote Void Approval via SMS

## Overview

Enables servers to request void/comp approvals from off-site managers via SMS when no manager is physically present. Manager can approve by replying "YES" to the SMS or clicking a link to approve via mobile web page.

## User Flow

```
1. Server needs to void/comp → No manager present
2. Server opens CompVoidModal → Selects action (Comp/Void) → Enters reason
3. Server clicks "Request Remote Manager Approval"
4. Server selects manager from dropdown (managers with void permission + phone)
5. SMS sent to manager with void details + approval link
6. Manager approves via:
   - Reply "YES" or "APPROVE" to SMS
   - Click link → mobile approval page → tap Approve
7. System generates 6-digit code (5-min expiry)
8. Code sent to POS via socket + displayed on manager's phone/page
9. Server enters code (auto-filled via socket) → Void completes
```

---

## Schema

### RemoteVoidApproval Model

```prisma
model RemoteVoidApproval {
  id              String    @id @default(cuid())
  locationId      String
  location        Location  @relation(fields: [locationId], references: [id])

  // Request Details
  orderId         String
  order           Order     @relation(fields: [orderId], references: [id])
  orderItemId     String?
  requestedById   String
  requestedBy     Employee  @relation("VoidRequester", fields: [requestedById], references: [id])
  voidReason      String
  voidType        String    // "item" | "order" | "comp"
  amount          Decimal
  itemName        String    // Cached for SMS
  orderNumber     Int       // Cached for SMS

  // Manager Assignment
  managerId       String
  manager         Employee  @relation("VoidApprover", fields: [managerId], references: [id])
  managerPhone    String    // Cached phone

  // SMS Tracking
  twilioMessageSid    String?
  approvalToken       String    @unique  // 32 hex chars for web link
  approvalTokenExpiry DateTime           // 30 minutes

  // Approval Code (generated after approval)
  approvalCode       String?   // 6-digit code
  approvalCodeExpiry DateTime? // 5 minutes after approval

  // Status
  status          String    @default("pending")  // pending | approved | rejected | expired | used
  approvedAt      DateTime?
  rejectedAt      DateTime?
  rejectionReason String?
  usedAt          DateTime?

  // Terminal tracking for socket
  requestingTerminalId String?

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?
  syncedAt        DateTime?

  voidLogs        VoidLog[]

  @@index([locationId])
  @@index([status])
  @@index([approvalToken])
  @@index([approvalCode, status])
  @@index([managerPhone, status])
}
```

### VoidLog Modification

Added `remoteApprovalId` field to link void logs to their remote approval.

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/voids/remote-approval/managers` | GET | List managers with void permission + phone |
| `/api/voids/remote-approval/request` | POST | Create approval request, send SMS |
| `/api/voids/remote-approval/[id]/status` | GET | Check approval status (polling fallback) |
| `/api/voids/remote-approval/validate-code` | POST | Validate 6-digit code |
| `/api/webhooks/twilio/sms` | POST | Twilio reply webhook |
| `/api/voids/remote-approval/[token]` | GET | Web approval page data |
| `/api/voids/remote-approval/[token]/approve` | POST | Web approve action |
| `/api/voids/remote-approval/[token]/reject` | POST | Web reject action |

### Modified Endpoint

| Endpoint | Change |
|----------|--------|
| `/api/orders/[id]/comp-void` | Accepts `remoteApprovalCode` parameter, validates code, marks as used |

---

## Twilio Integration

### Library: `src/lib/twilio.ts`

```typescript
// Check if Twilio is configured
export function isTwilioConfigured(): boolean

// Send void approval request SMS
export async function sendVoidApprovalSMS(params: {
  to: string
  serverName: string
  itemName: string
  amount: number
  reason: string
  orderNumber: number
  approvalToken: string
}): Promise<{ success: boolean; messageSid?: string }>

// Send approval code after approval
export async function sendApprovalCodeSMS(params: {
  to: string
  code: string
  serverName: string
}): Promise<{ success: boolean }>

// Validate Twilio webhook signature
export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string
): boolean

// Parse SMS reply (YES/NO)
export function parseSMSReply(body: string): 'approve' | 'reject' | 'unknown'

// Generate 6-digit approval code
export function generateApprovalCode(): string

// Generate 32-char hex token
export function generateApprovalToken(): string

// Format phone to E.164
export function formatPhoneE164(phone: string): string
```

### SMS Templates

**Request SMS:**
```
[GWI POS] VOID REQUEST

Server: {serverName}
Item: {itemName} (${amount})
Reason: {reason}
Order #{orderNumber}

Reply YES to approve or NO to reject.

Or tap: {approvalUrl}

Expires in 30 min.
```

**Approval SMS:**
```
[GWI POS] APPROVED

Code: {code}

Give to {serverName}. Valid 5 min.
```

---

## Socket Events

### Dispatch Function

```typescript
// In src/lib/socket-dispatch.ts
export async function dispatchVoidApprovalUpdate(
  locationId: string,
  payload: {
    type: 'approved' | 'rejected' | 'expired'
    approvalId: string
    terminalId?: string
    approvalCode?: string
    managerName: string
  }
)
```

### Event: `void:approval-update`

Sent to requesting terminal when approval status changes. POS auto-fills code field when received.

---

## UI Components

### RemoteVoidApprovalModal

Located: `src/components/orders/RemoteVoidApprovalModal.tsx`

**States:**
1. **Manager Selection** - Dropdown of managers with void permission + phone
2. **Reason Entry** - Displays selected manager, reason already captured
3. **Pending** - Countdown timer, socket listener for approval
4. **Code Entry** - 6-digit input (auto-filled via socket)
5. **Success/Error** - Feedback message

**Features:**
- Real-time status via socket connection
- Auto-fill code when socket notification received
- Timer showing request expiry (30 min)
- Polling fallback every 3 seconds
- Cancel/retry options

### Mobile Approval Page

Located: `src/app/(public)/approve-void/[token]/page.tsx`

**Design:**
- Mobile-first, large touch targets
- Dark theme matching POS aesthetic
- Large Approve/Reject buttons (green/red)
- Clear void details display
- Countdown timer for expiry
- Success state shows large approval code with copy button

### CompVoidModal Integration

Added to `src/components/orders/CompVoidModal.tsx`:

- "Request Remote Manager Approval" button appears after selecting action and reason
- Opens RemoteVoidApprovalModal on click
- On code validation success, completes void with manager approval tracked

---

## Environment Variables

```env
# Twilio Configuration
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+15551234567

# App URL for approval links
NEXT_PUBLIC_BASE_URL=https://pos.example.com
```

---

## Security

| Concern | Mitigation |
|---------|------------|
| Token guessing | 32 hex chars (128-bit entropy) |
| Code brute force | 6 digits + 5 min expiry + single use |
| Webhook spoofing | Twilio signature validation in production |
| Replay attacks | Single-use codes (status → "used") |
| Phone exposure | Masked in UI (***-***-1234) |

---

## Files Created

| File | Purpose |
|------|---------|
| `src/lib/twilio.ts` | Twilio SMS service |
| `src/app/api/voids/remote-approval/managers/route.ts` | List managers |
| `src/app/api/voids/remote-approval/request/route.ts` | Create request + send SMS |
| `src/app/api/voids/remote-approval/[id]/status/route.ts` | Check status (polling) |
| `src/app/api/voids/remote-approval/validate-code/route.ts` | Validate code |
| `src/app/api/webhooks/twilio/sms/route.ts` | Twilio webhook |
| `src/app/api/voids/remote-approval/[token]/route.ts` | Web approval data |
| `src/app/api/voids/remote-approval/[token]/approve/route.ts` | Web approve |
| `src/app/api/voids/remote-approval/[token]/reject/route.ts` | Web reject |
| `src/components/orders/RemoteVoidApprovalModal.tsx` | POS modal |
| `src/app/(public)/approve-void/[token]/page.tsx` | Mobile approval page |

## Files Modified

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Added RemoteVoidApproval model, VoidLog relation |
| `src/app/api/orders/[id]/comp-void/route.ts` | Accept `remoteApprovalCode` parameter |
| `src/lib/socket-dispatch.ts` | Added `dispatchVoidApprovalUpdate` |
| `src/app/api/internal/socket/broadcast/route.ts` | Added VOID_APPROVAL case |
| `src/components/orders/CompVoidModal.tsx` | Added "Request Remote Approval" button |
| `src/app/(pos)/orders/page.tsx` | Pass locationId to CompVoidModal |

---

## Dependencies

```bash
npm install twilio
```

- Twilio account with SMS capability
- Public webhook URL (HTTPS) for Twilio replies
- Phone numbers on manager Employee records

---

## Related Skills

- **Skill 34**: Comps & Voids - Existing void system
- **Skill 102**: KDS Device Security - Pattern for 6-digit codes with expiry
- **Skill 202**: Socket.io Real-Time - Dispatch pattern for notifications

---

## Testing Checklist

- [ ] Request approval → SMS received by manager
- [ ] Manager replies "YES" → Code generated, socket fires, POS shows code
- [ ] Manager clicks link → Mobile page loads correctly
- [ ] Manager approves via web → Code displayed, socket fires
- [ ] Code entered at POS → Void completes, VoidLog created with remoteApprovalId
- [ ] Expired code (>5 min) → Error "Code expired"
- [ ] Wrong code → Error "Invalid code"
- [ ] Manager replies "NO" → Status rejected, socket fires
- [ ] Request expires (>30 min) → Status expired
- [ ] Code reuse attempt → Error "Code already used"
