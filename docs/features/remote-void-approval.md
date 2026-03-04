# Feature: Remote Void Approval

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary

Remote Void Approval solves the problem of a manager who is not physically present at the venue but whose authorization is still required to void or comp an order item. When a server triggers a void and no manager is on-site to enter their PIN, the server selects a manager from a list and requests remote approval. The POS sends an SMS (via Twilio) to that manager's phone containing a unique link. The manager opens the link on their phone, reviews the order details, and either approves or rejects. On approval, a 6-digit code is generated and pushed back to the POS terminal via socket. The server enters the code and the void proceeds as if a manager had been physically present.

## Status

`Active`

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, SMS dispatch, web approval page, socket notifications | Full |
| `gwi-android-register` | Syncs voided item state after approval; does not initiate remote approval | Partial |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | None | None |
| `gwi-mission-control` | None | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | Order detail panel → item void modal → "Request Remote Approval" button | Servers, Bartenders |
| POS Web | `/voids/remote-approval/[token]` | Off-site manager (mobile browser, no login required) |

The "Request Remote Approval" button appears inside the void/comp modal (`POST /api/orders/[id]/comp-void`) when the acting employee does not have a manager PIN available on-site. The `/voids/remote-approval/[token]` page is a public-facing web page that the manager opens from the SMS link — it does not require a GWI POS login.

---

## Code Locations

### gwi-pos

| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/voids/remote-approval/request/route.ts` | `POST` — creates approval record, sends SMS to manager |
| `src/app/api/voids/remote-approval/managers/route.ts` | `GET` — returns list of managers with void permission and phone on file |
| `src/app/api/voids/remote-approval/[token]/route.ts` | `GET` — fetches approval details for the manager's web page (by token) |
| `src/app/api/voids/remote-approval/[token]/approve/route.ts` | `POST` — manager approves; generates 6-digit code, fires socket event |
| `src/app/api/voids/remote-approval/[token]/reject/route.ts` | `POST` — manager rejects; fires socket event |
| `src/app/api/voids/remote-approval/[token]/status/route.ts` | `GET` — POS polls approval status by approval record ID (fallback when socket unavailable) |
| `src/app/api/voids/remote-approval/validate-code/route.ts` | `POST` — validates 6-digit code entered at POS; marks record as `used` |
| `src/lib/twilio.ts` | `sendVoidApprovalSMS()`, `sendApprovalCodeSMS()`, `generateApprovalToken()`, `generateApprovalCode()`, `maskPhone()` |
| `src/lib/socket-dispatch.ts` | `dispatchVoidApprovalUpdate()` — emits `void:approval-update` to POS terminal |
| `src/lib/rate-limiter.ts` | `createRateLimiter()` — enforces 5 SMS per manager phone per 15 minutes |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/voids/remote-approval/managers` | Employee PIN | Returns managers with void permission and a phone number on file |
| `POST` | `/api/voids/remote-approval/request` | `MGR_VOID_ITEMS` permission (requester) | Creates approval record and sends SMS to selected manager |
| `GET` | `/api/voids/remote-approval/[token]` | Token in URL (no login) | Returns approval details for the manager's mobile web page |
| `POST` | `/api/voids/remote-approval/[token]/approve` | Token in URL (no login) | Manager approves; generates 6-digit code, fires `void:approval-update` socket event |
| `POST` | `/api/voids/remote-approval/[token]/reject` | Token in URL (no login) | Manager rejects; fires `void:approval-update` socket event |
| `GET` | `/api/voids/remote-approval/[token]/status` | Employee PIN (polling fallback) | Returns current status and code (if approved and unexpired) by approval record ID |
| `POST` | `/api/voids/remote-approval/validate-code` | Employee PIN | Validates 6-digit code at POS; marks record as `used` on success |

### POST /api/voids/remote-approval/request — request body

```json
{
  "locationId": "loc_abc",
  "orderId": "ord_xyz",
  "orderItemId": "oi_123",
  "voidType": "item",
  "managerId": "emp_mgr1",
  "voidReason": "Customer complaint",
  "amount": 12.50,
  "itemName": "Ribeye Steak",
  "requestedById": "emp_srv1",
  "terminalId": "term_01"
}
```

### POST /api/voids/remote-approval/validate-code — request body

```json
{
  "orderId": "ord_xyz",
  "orderItemId": "oi_123",
  "code": "847291",
  "employeeId": "emp_srv1"
}
```

---

## Socket Events

### Emitted (POS → Clients)

| Event | Payload | Trigger |
|-------|---------|---------|
| `void:approval-update` | `{ type: 'approved' \| 'rejected', approvalId, terminalId?, approvalCode?, managerName }` | Manager approves or rejects via SMS link |

The socket event targets the specific terminal that made the request (`requestingTerminalId`). If no terminal ID is on record, the event is broadcast to the entire location. The POS void modal listens for this event and updates in real time. The polling endpoint (`/status`) serves as a fallback when the socket connection is unavailable.

### Received (Clients → POS)

None. The manager interacts via a public web page, not a socket client.

---

## Data Model

### RemoteVoidApproval

```
RemoteVoidApproval {
  id                   String                    // cuid
  locationId           String                    // always filter by this

  // Request details
  orderId              String
  orderItemId          String?                   // null = full order void
  requestedById        String                    // Employee who triggered the request
  voidReason           String
  voidType             String                    // "item" | "order" | "comp"
  amount               Decimal
  itemName             String                    // cached for SMS display
  orderNumber          Int                       // cached for SMS display

  // Manager assignment
  managerId            String
  managerPhone         String                    // cached at request time

  // SMS tracking
  twilioMessageSid     String?                   // Twilio SID for delivery tracking
  approvalToken        String    @unique         // 32 hex chars (128-bit entropy)
  approvalTokenExpiry  DateTime                  // 30 minutes after creation

  // Approval code (populated when manager approves)
  approvalCode         String?                   // 6-digit numeric code
  approvalCodeExpiry   DateTime?                 // 5 minutes after approval

  // Status lifecycle
  status               RemoteVoidApprovalStatus  // pending | approved | rejected | expired | used
  approvedAt           DateTime?
  rejectedAt           DateTime?
  rejectionReason      String?
  usedAt               DateTime?                 // when server entered the code successfully

  // Terminal tracking for targeted socket notifications
  requestingTerminalId String?

  createdAt            DateTime  @default(now())
}
```

### RemoteVoidApprovalStatus (enum)

```
pending    // created, SMS sent, waiting for manager response
approved   // manager tapped approve; 6-digit code generated
rejected   // manager tapped reject
expired    // 30-min token window elapsed without response; OR 5-min code window elapsed
used       // 6-digit code was validated at POS; void has been executed
```

---

## Business Logic

### When Remote Approval Is Triggered

The server opens the void/comp modal on an order item. If no on-site manager is available to enter a PIN, the server taps "Request Remote Approval." The system does NOT enforce a dollar-amount threshold in the current implementation — the option is available for any item/order void or comp.

### Primary Flow

1. Server selects a manager from the dropdown (populated by `GET /api/voids/remote-approval/managers` — only managers with `MGR_VOID_ITEMS` or `MGR_VOID_ORDERS` permission and a phone number on file appear).
2. Server submits the request. The `POST /request` route:
   - Validates the requester has `MGR_VOID_ITEMS` permission.
   - Checks for an existing non-expired pending request for the same order item (HTTP 409 if found — prevents double-SMS).
   - Generates a 32-hex-character approval token (`crypto.randomBytes(16).toString('hex')`).
   - Creates the `RemoteVoidApproval` record with `status: pending` and a 30-minute expiry.
   - Calls `sendVoidApprovalSMS()` via Twilio with the approval link (`/voids/remote-approval/{token}`).
   - Stores the Twilio `messageSid` on the record for delivery tracking.
3. The POS void modal enters a "waiting" state, listening on the `void:approval-update` socket event and optionally polling `GET /[token]/status`.
4. Manager receives the SMS, taps the link, opens the approval page in their mobile browser (no login required).
5. The page calls `GET /api/voids/remote-approval/[token]` to render the request summary: server name, item name, amount, void reason, order number, table/tab name.
6. Manager taps **Approve**:
   - `POST /[token]/approve` generates a 6-digit numeric code (`Math.floor(100000 + Math.random() * 900000)`).
   - Sets `status: approved`, `approvalCode`, `approvalCodeExpiry` (5 minutes from now), `approvedAt`.
   - Sends the code via a second SMS to the manager's phone (so the manager can verbally relay it to the server if needed).
   - Calls `dispatchVoidApprovalUpdate()` to emit `void:approval-update` with `type: 'approved'` and the code to the requesting terminal.
7. The POS terminal receives the socket event; the void modal auto-populates the code field or displays it for the server to enter.
8. Server enters the 6-digit code. `POST /validate-code`:
   - Finds the `RemoteVoidApproval` record matching `orderId + approvalCode + status: approved`.
   - Checks the 5-minute code expiry.
   - Sets `status: used`, `usedAt`.
   - Returns `{ valid: true, managerId, voidType, voidReason, amount }`.
9. The void/comp proceeds via `POST /api/orders/[id]/comp-void` with the validated approval context.

### Rejection Flow

Manager taps **Reject** (optionally providing a reason):
- `POST /[token]/reject` sets `status: rejected`, `rejectedAt`, `rejectionReason`.
- `dispatchVoidApprovalUpdate()` emits `void:approval-update` with `type: 'rejected'`.
- The POS modal shows the rejection reason and closes.

### Expiry

- The 30-minute token window is checked on every `GET /[token]` and `POST /[token]/approve|reject` call.
- The 5-minute code window is checked on every `GET /[token]/status` and `POST /validate-code` call.
- The `/status` polling endpoint eagerly marks the record `status: expired` when either window has elapsed.
- Once a record is `expired`, the manager's link becomes invalid. The server must create a new request.

### Security

- **Token entropy:** 32 hex characters = 128 bits. Brute-forcing is not feasible.
- **Single-use codes:** The `validate-code` endpoint immediately sets `status: used` on success. Replaying the same code returns HTTP 400 with "code already used."
- **Rate limiting:** `POST /request` enforces a maximum of 5 SMS per manager phone number per 15-minute window (HTTP 429 with `Retry-After` header if exceeded).
- **Duplicate guard:** An existing non-expired pending request for the same order item blocks a new request (HTTP 409). The server must wait for the existing request to expire or be resolved.
- **No-login approval page:** The token in the URL is the only credential. Short expiry (30 min) limits exposure if the SMS is intercepted.
- **Phone masking:** `GET /managers` returns `phoneMasked` (e.g., `***-***-1234`) for display; the full phone is only used server-side for SMS delivery.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:

| Feature | How / Why |
|---------|-----------|
| Refund & Void | Provides the remote authorization path for `POST /api/orders/[id]/comp-void`; the void does not execute until the approval code is validated |
| Roles & Permissions | Reads `MGR_VOID_ITEMS` / `MGR_VOID_ORDERS` to filter the manager list and gate the request |

### These features MODIFY this feature:

| Feature | How / Why |
|---------|-----------|
| Roles & Permissions | If void permissions are renamed or restructured, the `hasPermission` checks in both `request/route.ts` and `managers/route.ts` must be updated |
| Settings | If Twilio credentials are not configured, SMS is skipped and the approval degrades to code-only flow (manager must be contacted separately) |

### BEFORE CHANGING THIS FEATURE, VERIFY:

- [ ] **Refund & Void** — the `validate-code` endpoint must return the correct `managerId` so the comp-void route can record the approving manager
- [ ] **Permissions** — `MGR_VOID_ITEMS` and `MGR_VOID_ORDERS` keys must remain in the permission registry; changing them breaks the manager filter and the request guard
- [ ] **Socket** — `void:approval-update` event name must remain stable; the POS void modal subscribes to this exact string
- [ ] **Offline** — remote approval is not possible offline (requires SMS delivery + manager web page); the POS should surface a clear error if attempted when the NUC cannot reach Twilio
- [ ] **Reports** — no direct report impact; audit trail is via `AuditLog` entries on the comp-void route itself, not on this feature

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Request remote approval (initiate) | `MGR_VOID_ITEMS` | High |
| Appear in manager selection list | `MGR_VOID_ITEMS` or `MGR_VOID_ORDERS` | High |
| Approve / reject via SMS link | Token in URL (no system permission) | — |
| Validate code at POS | Employee PIN (any) | Standard |

---

## Known Constraints & Limits

- **Twilio dependency:** SMS delivery requires `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` environment variables. If not configured, the approval record is created but no SMS is sent. The code can still be retrieved via the polling endpoint or socket, but the manager will not receive a link.
- **Manager must have a phone number:** Managers without a `phone` value on their Employee record do not appear in the selection list. There is no fallback for managers with no phone.
- **One active request per item:** Duplicate requests for the same `orderId + orderItemId` while a pending request exists are rejected with HTTP 409.
- **Rate limit:** 5 SMS per manager phone per 15 minutes. High-volume void scenarios (e.g., multiple servers requesting approval from the same manager) will hit this limit.
- **No audit UI:** There is no admin page listing all `RemoteVoidApproval` records. Audit information is accessible only via direct DB query or the `AuditLog` entries written by the comp-void route.
- **Android does not initiate remote approval:** The feature is POS-web-only on the requester side. Android syncs the resulting voided item state after the void completes.

---

## Android-Specific Notes

Android does not have a "Request Remote Approval" flow. When an Android terminal operator needs to void an item, they must either:
1. Have a manager present to enter their PIN on-screen, or
2. Switch to the web POS to use the remote approval flow.

The resulting `OrderItem.status = 'voided'` change is synced to Android via the standard order event stream after the comp-void completes.

---

## Related Docs

- **Feature doc:** `docs/features/refund-void.md`
- **Architecture guide:** `docs/guides/PAYMENTS-RULES.md`
- **Skills:** Skill 121–122 (see `docs/skills/SKILLS-INDEX.md`)

---

*Last updated: 2026-03-03*
