# Feature: Hotel PMS Integration (Oracle OPERA Cloud)

> **Status: ACTIVE** — Built 2026-03-04. See `docs/skills/SPEC-484-ORACLE-OPERA-PMS.md` for full implementation detail.

---

## Summary

Connects GWI POS to Oracle OPERA Cloud via the OHIP (Oracle Hospitality Integration Platform) API. Guests can charge F&B orders directly to their hotel room. The cashier looks up the guest by room number or last name, confirms identity, and posts the charge — it posts to the guest's hotel folio in OPERA and is recorded locally as a `room_charge` payment.

Credentials are stored **per-venue in `Location.settings`** (not environment variables) so they are configurable from the admin UI without server restarts, and each venue can have its own OPERA connection.

---

## Status

`Active` — built 2026-03-04. Credential-ready; awaiting OHIP app registration and hotel OPERA admin setup before going live.

---

## Key Capabilities

- **Bill to Room** — `room_charge` payment method at checkout
- **Live Guest Lookup** — room number or last name search via OPERA Reservations API; only INHOUSE guests returned
- **Folio Posting** — `POST folio/transactions` with charge code, amount, and order reference
- **In-memory Token Cache** — 55-min TTL (tokens expire at 60m); automatic 401 retry
- **Per-venue credentials** — stored in `Location.settings.hotelPms`, never in env vars
- **Connection test** — "Test Connection" button in admin UI forces fresh token fetch

---

## Supported Platforms

**Oracle OPERA Cloud only** (via OHIP REST API).

Original planning spec (SPEC-57) discussed multi-PMS support (Mews, Cloudbeds, etc.) — this was scoped down to Oracle only for the initial build. Generic HTNG 2.0 remains a future option.

---

## Code Locations

### New Files

| File | Role |
|------|------|
| `src/lib/oracle-pms-client.ts` | Core API client: token cache, lookup, charge post, idempotency header, timeouts |
| `src/lib/room-charge-selections.ts` | Server-trusted one-time selection tokens (48-hex, 10-min TTL) |
| `src/app/api/integrations/oracle-pms/status/route.ts` | GET status for admin UI badge |
| `src/app/api/integrations/oracle-pms/test/route.ts` | POST connection test (requires SETTINGS_EDIT) |
| `src/app/api/integrations/oracle-pms/room-lookup/route.ts` | GET guest lookup with input validation, rate limiting, selectionId creation |
| `src/app/(admin)/settings/integrations/oracle-pms/page.tsx` | Admin settings page with write-only secret inputs |

### Key Modified Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | `room_charge` enum + 4 Payment fields + `PmsAttemptStatus` + `PmsChargeAttempt` model |
| `scripts/nuc-pre-migrate.js` | DDL for Payment columns, `room_charge` enum, PmsChargeAttempt table + indexes |
| `src/lib/settings.ts` | `HotelPmsSettings`, `acceptHotelRoomCharge`, `hotelPms` on LocationSettings |
| `src/app/api/settings/route.ts` | Deep-merge guard; write-only secret stripping (GET) + preservation (PUT); SSRF validation |
| `src/components/payment/PaymentModal.tsx` | `room_charge` step; `selectionId`-based flow (never sends raw OPERA IDs) |
| `src/app/api/orders/[id]/pay/route.ts` | `room_charge` handler: selectionId consumption, PmsChargeAttempt lifecycle, OPERA call |

---

## Business Logic

### Payment Flow

```
Cashier taps "Bill to Room"
  → GET /api/integrations/oracle-pms/room-lookup?q=...&type=room|name
      input validated + rate-limited (10/min per employee)
      returns guests + selectionId token (48-hex, 10-min TTL)
  → Cashier selects guest → confirms identity
  → POST /api/orders/[id]/pay  { method: 'room_charge', selectionId }
      server: consumeRoomChargeSelection(selectionId) → one-time use, validates TTL
      server: PmsChargeAttempt check (crash-safe idempotency)
      server: POST OPERA folio/transactions with Idempotency-Key header
      server: db.payment.create() → attempt marked COMPLETED
  → Order closes normally
```

### Token Lifecycle

```
First call: POST {baseUrl}/oauth/v1/tokens → access_token (60min)
Cache: Map<locationId, token> with 55min TTL
On 401: evict + re-fetch + retry once
After credential save: evictToken() clears stale cache
```

### Settings Gating

Bill to Room button in PaymentModal is only shown when:
1. `settings.payments.acceptHotelRoomCharge === true` (set in /settings/payments)
2. Which requires: `settings.hotelPms.enabled === true` (set in /settings/integrations/oracle-pms)

---

## Admin Configuration

**Path:** `/settings/integrations/oracle-pms`

**Required credentials:**
- API Base URL (e.g. `https://xxx.oraclehospitality.com`)
- Hotel ID (x-hotelid OPERA property code)
- Client ID (OAuth client ID from OHIP app registration)
- Client Secret (OAuth client secret)
- Application Key (x-app-key from OHIP registration)
- F&B Charge Code (OPERA transaction code, e.g. `REST01`)

**Environment:** Cert (sandbox) or Production (live)

**Workflow:** Enter credentials → Save → Test Connection → Enable toggle → go to Settings → Payments → enable Bill to Room

---

## Data Model

### Settings (`Location.settings.hotelPms`)

```typescript
interface HotelPmsSettings {
  enabled: boolean
  baseUrl: string           // validated HTTPS, SSRF-blocked at save time
  clientId: string
  clientSecret: string      // write-only: GET returns empty + hasClientSecret boolean
  appKey: string            // write-only: GET returns empty + hasAppKey boolean
  hotelId: string
  environment: 'cert' | 'production'
  chargeCode: string
  allowGuestLookup: boolean
}
```

### Payment Record

```
Payment.method           = 'room_charge'
Payment.roomNumber       String?  (e.g. "101")        -- from server-trusted selectionId
Payment.guestName        String?  (e.g. "John Smith") -- from server-trusted selectionId
Payment.pmsReservationId String?  (OPERA reservation ID)
Payment.pmsTransactionId String?  (OPERA folio transaction number)
Payment.transactionId    = pmsTransactionId
Payment.authCode         = pmsTransactionId
```

### PmsChargeAttempt (crash-safe idempotency)

```
PmsChargeAttempt.idempotencyKey    UNIQUE — "{orderId}:{reservationId}:{amountCents}:{chargeCode}"
PmsChargeAttempt.status            PENDING | COMPLETED | FAILED
PmsChargeAttempt.operaTransactionId String? — stored on COMPLETED for idempotent replay
PmsChargeAttempt.employeeId        String? — audit trail
PmsChargeAttempt.lastErrorMessage  String? — truncated 200 chars on FAILED
```

---

## Dependencies

| Feature | Why |
|---------|-----|
| **Payments** | room_charge is a payment method in the same modal and pay route |
| **Settings** | `HotelPmsSettings` stored in LocationSettings, consumed by SettingsNav + payments page |
| **Orders** | Charge posted at order close via `POST /api/orders/[id]/pay` |

---

## Security Hardening

Full hardening sprint applied before go-live. See `docs/planning/ORACLE-PMS-HARDENING.md` for complete detail.

| Item | What It Does |
|------|-------------|
| Write-only secrets | GET strips `clientSecret`/`appKey`; returns `hasClientSecret`/`hasAppKey` booleans only |
| selectionId pattern | Client sends one-time token (not raw OPERA IDs) to `/pay`; server resolves reservation data |
| PmsChargeAttempt | Crash-safe idempotency table — PENDING→COMPLETED state machine prevents double-charge |
| Rate limiting | 10 guest lookups/min per verified employee; IP fallback for unauthenticated |
| Input validation | Room: `[A-Za-z0-9\-]+`; Name: `[\p{L}\s\-'\u2019]+` (Unicode, iOS apostrophe) |
| SSRF blocking | `validatePmsBaseUrl()` requires HTTPS, blocks all RFC-1918 + localhost |
| Timeouts | 8s auth, 12s lookup, 15s charge post via AbortController |
| Error sanitization | OPERA errors logged server-side; generic safe message to client |
| Permission gate | Test endpoint requires `SETTINGS_EDIT` permission |

---

## Known Constraints

- **No SAF support** — If OPERA is offline, room charge fails. Cashier must use alternate payment.
- **No auto-reverse on void/refund** — Hotel adjusts folio manually for refunds.
- **Tips** — Add tips before submitting room charge (no Datacap adjust after the fact).
- **Single folio window** — Always posts to window 1. Multi-window routing is a future enhancement.
- **Credit limits** — OPERA enforces these server-side; if exceeded, the charge returns an error.
- **Processor rule exception** — `room_charge` bypasses Datacap (it's a PMS call, not a card transaction). The "Datacap only" processor rule applies to card-present payments only.
- **Selection token expiry** — Tokens expire after 10 minutes; cashier must re-search if paused too long.

---

## Cross-Feature Dependencies

- **Depended on by:** Payments (adds a method)
- **Depends on:** Settings (credentials + feature flag), Orders (payment recorded at close)
- **Does NOT affect:** Tips, KDS, Inventory, Floor Plan, Android (no Android changes)

---

## Pre-Go-Live Checklist

See `docs/planning/ORACLE-PMS-HARDENING.md` for the full 24-item checklist. Key items:

- [ ] OHIP app registration (Client ID + Secret + App Key)
- [ ] Hotel OPERA administrator enables Cashiering API module
- [ ] Hotel grants folio posting permission
- [ ] F&B charge code from OPERA (`chargeCode` field)
- [ ] Test in Cert environment — verify "Test Connection" succeeds
- [ ] Place a test order → Bill to Room → verify charge appears in OPERA folio
- [ ] Switch to Production + enable toggle

---

## Skill Doc

`docs/skills/SPEC-484-ORACLE-OPERA-PMS.md`

*Last updated: 2026-03-04*
