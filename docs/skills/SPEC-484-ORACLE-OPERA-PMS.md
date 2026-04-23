# Skill 484 — Oracle OPERA Cloud PMS Integration

**Status:** DONE
**Domain:** Payments / Integrations
**Dependencies:** 30 (Payments), 09 (Settings), 33 (House Accounts pattern)
**Date:** 2026-03-04

---

## Summary

Full Oracle OPERA Cloud / OHIP integration enabling **Bill to Room** as a payment method. Guests can have F&B charges posted directly to their hotel folio. Cashier looks up the guest by room number or last name, confirms identity, and submits — charge posts to OPERA and is recorded locally.

Credentials are stored **per-venue in `Location.settings`** (not env vars) so they are manageable from the admin UI without server restarts.

---

## What Was Built

### New Files (6)

| File | Purpose |
|------|---------|
| `src/lib/oracle-pms-client.ts` | Core OPERA Cloud API client: token cache, room/name lookup, charge posting, connection test |
| `src/lib/room-charge-selections.ts` | Server-trusted selection token store — 48-hex one-time tokens (10-min TTL, locationId-bound); prevents client from sending raw OPERA IDs to /pay |
| `src/app/api/integrations/oracle-pms/status/route.ts` | GET — returns configured/enabled/environment/hotelId/chargeCode |
| `src/app/api/integrations/oracle-pms/test/route.ts` | POST — forces fresh token fetch; requires `SETTINGS_EDIT` permission |
| `src/app/api/integrations/oracle-pms/room-lookup/route.ts` | GET `?q=...&type=room|name` — validates input, rate-limits, creates selectionId tokens, returns guest list |
| `src/app/(admin)/settings/integrations/oracle-pms/page.tsx` | Admin settings page: write-only secret inputs, hasClientSecret badges, test connection |

### Modified Files (12)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | `room_charge` to `PaymentMethod`; 4 `Payment` fields; `PmsAttemptStatus` enum; `PmsChargeAttempt` model |
| `scripts/nuc-pre-migrate.js` | ALTER TABLE for 4 PMS columns; ALTER TYPE for `room_charge`; CREATE TABLE PmsChargeAttempt + enum type + 4 indexes |
| `src/lib/settings.ts` | `HotelPmsSettings` interface; `acceptHotelRoomCharge`; `hotelPms` on `LocationSettings`; `mergeWithDefaults()` |
| `src/app/api/settings/route.ts` | Deep-merge guard; GET strips `clientSecret`/`appKey` (returns `hasClientSecret`/`hasAppKey`); PUT preserves secrets on empty; `validatePmsBaseUrl()` SSRF guard |
| `src/app/api/integrations/status/route.ts` | `oraclePms: { configured }` added to general integrations status |
| `src/components/admin/SettingsNav.tsx` | Oracle Hotel PMS nav link under Integrations |
| `src/app/(admin)/settings/payments/page.tsx` | Bill to Room toggle (disabled until PMS enabled) |
| `src/components/payment/types.ts` | `room_charge` in `PaymentMethod` and `PaymentStep`; `selectionId` on `PendingPayment` |
| `src/components/payment/steps/PaymentMethodStep.tsx` | Bill to Room button (teal, conditional on `acceptHotelRoomCharge`) |
| `src/components/payment/PaymentModal.tsx` | Full `room_charge` step; stores `selectionId` from lookup; sends only `selectionId` to `/pay` (never raw OPERA IDs) |
| `src/app/api/orders/[id]/pay/route.ts` | `room_charge` handler: `consumeRoomChargeSelection()`, `PmsChargeAttempt` lifecycle (P0.5), OPERA call with idempotency key, payment creation + attempt COMPLETED |
| `src/hooks/useOrderSettings.ts` | `acceptHotelRoomCharge: false` added to `DEFAULT_PAYMENT_SETTINGS` mock |

---

## Architecture

### OAuth Token Cache

```
tokenCache: Map<locationId, { accessToken, expiresAt }>
TTL: 55 minutes (tokens expire at 60m — refresh 5m early)
On 401: evict cache → re-fetch token → retry request once
Multi-tenant safe: keyed by locationId
```

### API Call Pattern

```
pmsGet() / pmsPost()
  → Authorization: Bearer {token}
  → x-app-key: {config.appKey}
  → x-hotelid: {config.hotelId}
  → base: {config.baseUrl}/property/v1/{hotelId}/{path}
```

### Token Auth Endpoint

```
POST {baseUrl}/oauth/v1/tokens
Authorization: Basic {base64(clientId:clientSecret)}
x-app-key: {appKey}
body: grant_type=client_credentials
```

### Guest Lookup

```
GET .../reservations?roomNumber=101&reservationStatusType=INHOUSE
GET .../reservations?surname=Smith&reservationStatusType=INHOUSE
Returns: PmsGuestInfo[] (reservationId, roomNumber, guestName, checkInDate, checkOutDate)
```

`parseReservations()` normalizes OPERA's deeply nested response with multiple fallback paths for reservationId, roomId, and guest name (handles version-to-version API inconsistencies).

### Charge Posting

```
POST .../folio/transactions
{
  folioWindowNo: 1,
  transactionCode: config.chargeCode,  // e.g. "REST01"
  transactionDate: today,
  reservationId: ...,
  postingAmount: amountDollars,
  supplement: "Restaurant Charge",
  reference: "GWI-POS-Order-#1234"
}
Returns: { transactionNo } — stored on Payment record
```

### Payment Flow (Pay Route)

```
POST /api/orders/[id]/pay  { method: 'room_charge', selectionId }
  → validate settings.payments.acceptHotelRoomCharge
  → validate settings.hotelPms.enabled
  → consumeRoomChargeSelection(selectionId, locationId)
      validates TTL + locationId binding + deletes (one-time use)
      returns { reservationId, roomNumber, guestName, ... }
  → build idempotencyKey = "{orderId}:{reservationId}:{amountCents}:{chargeCode}"
  → PmsChargeAttempt lookup/create (PENDING)
      COMPLETED → return 200 with stored transactionNo (idempotent replay)
      FAILED    → return 502 (allow fresh retry)
      PENDING <60s → return 409 "in progress"
      PENDING ≥60s → stale crash recovery, retry OPERA
  → postCharge(reservationId, amountCents, ref, idempotencyKey)
      sends Idempotency-Key header to OPERA (OHIP deduplication)
  → paymentRecord fields set from server-trusted selection data
  → db.payment.create()
  → db.pmsChargeAttempt.update(COMPLETED, operaTransactionId)  [fire-and-forget]
```

### Security Architecture

```
Browser              NUC Server              OPERA Cloud
  │                       │                       │
  │ 1. GET /room-lookup   │                       │
  │──────────────────────▶ validate input          │
  │                       │ rate-limit (10/min)    │
  │                       │──────────────────────▶ │ GET reservations
  │                       │◀──────────────────────  guest list
  │                       │ createRoomChargeSelection (48-hex, 10min TTL)
  │◀─────── guests + selectionId                   │
  │                       │                       │
  │ 2. POST /pay          │                       │
  │    { selectionId }    │                       │
  │──────────────────────▶ consumeRoomChargeSelection (validates + deletes)
  │                       │ PmsChargeAttempt check │
  │                       │──────────────────────▶ │ POST folio/transactions
  │                       │                       │ Idempotency-Key: {key}
  │                       │◀──────────────────────  transactionNo
  │                       │ db.payment.create()    │
  │                       │ attempt → COMPLETED    │
  │◀───── { success }     │                       │
```

**Key security properties:**
- Browser never sees `clientSecret` or `appKey` (write-only fields, stripped on GET)
- Browser never sends raw OPERA IDs — only a short-lived one-time `selectionId`
- OPERA errors never reach the browser (log-then-throw-generic throughout)
- Rate limiting: 10 lookups/min per verified employee (IP fallback for unauthenticated)
- SSRF blocked: `validatePmsBaseUrl()` requires HTTPS, blocks all RFC-1918 ranges
- Test endpoint requires `SETTINGS_EDIT` permission
- Crash-safe: `PmsChargeAttempt` prevents double-charge across server restarts

### Settings Storage

Credentials stored in `Location.settings.hotelPms` JSON (local Postgres):
- Never sent to Neon cloud
- Never in environment variables
- Per-venue: each venue can have different OPERA credentials
- Protected by `hotelPms` explicit deep-merge in settings PUT route

### Payment Record Fields (DB)

```
Payment.roomNumber       String?   -- "101"
Payment.guestName        String?   -- "John Smith"
Payment.pmsReservationId String?   -- OPERA reservation ID
Payment.pmsTransactionId String?   -- OPERA folio transaction number
Payment.method           = 'room_charge'
Payment.transactionId    = pmsTransactionId (for reconciliation)
Payment.authCode         = pmsTransactionId
```

### PmsChargeAttempt Model (crash-safe idempotency)

```
PmsChargeAttempt.idempotencyKey   String UNIQUE  -- "{orderId}:{reservationId}:{amountCents}:{chargeCode}"
PmsChargeAttempt.status           PmsAttemptStatus -- PENDING | COMPLETED | FAILED
PmsChargeAttempt.operaTransactionId String?       -- set when COMPLETED
PmsChargeAttempt.reservationId    String
PmsChargeAttempt.amountCents      Int
PmsChargeAttempt.chargeCode       String
PmsChargeAttempt.employeeId       String?         -- audit trail
PmsChargeAttempt.lastErrorMessage String?         -- truncated to 200 chars on FAILED
```

Retry behavior:
- `COMPLETED` → return 200 with stored `operaTransactionId` (no OPERA call)
- `FAILED` → return 502, allow fresh attempt
- `PENDING` < 60s → return 409 "in progress"
- `PENDING` ≥ 60s → crash recovery: retry OPERA with same `idempotencyKey` (OHIP deduplicates)

---

## UI Flow (Cashier)

1. Order finalized → tap **Pay**
2. Method selection → tap **🏨 Bill to Room** (teal button; only shown when `acceptHotelRoomCharge` enabled)
3. Step: **room_charge**
   - Toggle: Room Number / Last Name
   - Type number or surname → tap **Look Up**
   - No result: "No in-house guest found in room X" error
   - Multiple results: scrollable list → tap to select
   - One result: auto-selects
   - Confirmed panel shows: guest name + room number
4. Tap **Charge Room 101** → payment processes → order closes

---

## Admin Configuration Flow

1. Go to **Settings → Integrations → Oracle Hotel PMS**
2. Enter: API Base URL, Hotel ID, Client ID, Client Secret, App Key, F&B Charge Code
3. Set Environment: Cert (sandbox) or Production (live)
4. Click **Save**
5. Click **Test Connection** — verify you get "Connected" message
6. Enable the integration toggle
7. Go to **Settings → Payments** → enable **Bill to Room (Oracle Hotel PMS)**
8. Switch environment to Production when ready for live charges

---

## Settings Schema

```typescript
interface HotelPmsSettings {
  enabled: boolean
  baseUrl: string               // "https://xxx.oraclehospitality.com"
  clientId: string              // OAuth client ID
  clientSecret: string          // OAuth client secret
  appKey: string                // x-app-key (OHIP app registration key)
  hotelId: string               // x-hotelid (OPERA property code)
  environment: 'cert' | 'production'
  chargeCode: string            // OPERA transaction code, e.g. "REST01"
  allowGuestLookup: boolean     // Allow last-name search (vs room# only)
}
```

---

## Waiting On (Before Go-Live)

- [ ] Oracle OHIP app registration (ClientID + ClientSecret + AppKey)
- [ ] Hotel OPERA administrator enables **Cashiering API module**
- [ ] Hotel grants folio posting permission to the OHIP app
- [ ] F&B charge code from OPERA setup (e.g. `REST01`)
- [ ] Test in Cert/Sandbox environment first
- [ ] Switch to Production + enable toggle when verified

---

## Known Constraints

- **Tips:** `room_charge` method does not support Datacap tip adjustment (no card on file). Tips should be added before submitting.
- **SAF:** Room charges are **not** queued for Store-and-Forward. If OPERA is unreachable, the payment will fail with a 502 error — cashier must use a different payment method.
- **Refunds:** No automatic reverse-posting to OPERA on void/refund. Hotel handles folio adjustments manually.
- **Multi-folio windows:** `folioWindowNo` defaults to 1. OPERA supports multiple windows (room, incidentals, etc.) — currently always posts to window 1.
- **Credit limits:** Not enforced — OPERA guest credit limit enforcement is handled server-side by OPERA; our code will receive an error if the limit is exceeded.
- **Selection token expiry:** Tokens expire after 10 minutes. If the cashier pauses too long after guest lookup, they must search again.
- **Multi-instance rate limiting:** Rate limiter is in-memory. For multi-NUC deployments, move to Redis/DB-backed store (P2 deferred — single NUC per venue).

---

## Related Docs

- `docs/features/hotel-pms.md` — Feature overview
- `docs/planning/ORACLE-PMS-HARDENING.md` — Full security hardening sprint (P0.1–P0.7, P1.1–P1.3, Go-Live Checklist)
- `docs/features/payments.md` — Payment method registry
- `docs/guides/PAYMENTS-RULES.md` — Payment rules (Datacap-only processor; room_charge bypasses Datacap)
