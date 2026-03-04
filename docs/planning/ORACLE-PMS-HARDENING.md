# Oracle PMS Integration — Security Hardening

> **Status:** Implemented (2026-03-04) — P0.5 idempotency added (2026-03-04)
> **Skill:** SPEC-484 (Oracle OPERA PMS)
> **Complements:** `docs/features/hotel-pms.md`, `docs/skills/SPEC-484-ORACLE-OPERA-PMS.md`

This document describes the security hardening sprint applied to the Oracle PMS integration before go-live. P0 items must be resolved before enabling the integration in production. P1 items are important security improvements. P2 items are nice-to-have polish.

---

## P0 — Blocking (Must Fix Before Go-Live)

### P0.1 — Write-Only Secrets ✅ DONE

**Problem:** `GET /api/settings` returned the full settings object including `hotelPms.clientSecret` and `hotelPms.appKey` — sensitive credentials that the browser should never see.

**Fix:**
- **GET:** After building the settings response, strips `clientSecret`/`appKey` (replaces with empty string), adds `hasClientSecret`/`hasAppKey` booleans so the UI can show "✓ Configured" status.
- **PUT:** If incoming `clientSecret`/`appKey` is empty/whitespace → preserves the existing value. Never overwrites a secret with an empty string.
- **UI:** `oracle-pms/page.tsx` uses write-only "Replace secret" inputs. Shows "✓ Secret configured" badge when a secret is stored. Only submits non-empty values on save.

**Files:** `src/app/api/settings/route.ts`, `src/app/(admin)/settings/integrations/oracle-pms/page.tsx`

---

### P0.2 — `postCharge()` Success Detection ✅ DONE

**Problem:** Some OPERA environments return `{"transactionNo": "POSTED"}` or similar placeholders on success. The original code accepted any non-empty `transactionNo`, meaning a phantom success could result in a payment record with no real OPERA transaction.

**Fix:** `extractTransactionId()` validates strictly:
- Non-empty string
- Length ≥ 4
- Not equal to any known placeholder (`POSTED`, `OK`, `SUCCESS`, `PENDING`, `UNKNOWN`)
- Both numeric IDs (e.g. `12345678`) and alphanumeric IDs (e.g. `TRX-123456`, `FOLIO-987`) are accepted
- If no valid ID found → `postCharge()` throws, no payment record is created

**File:** `src/lib/oracle-pms-client.ts`

---

### P0.3 — `/pay` Route Error Sanitization ✅ DONE

**Problem:** The `catch` block in the room_charge handler returned `err.message` directly to the client, potentially exposing raw OPERA error bodies (which may contain internal system details).

**Fix:** Logs the real error server-side (`console.error`) and returns a safe generic message to the client: `"Failed to post charge to hotel room. Please verify the room and try again."`

**File:** `src/app/api/orders/[id]/pay/route.ts`

---

### P0.4 — Idempotency for Room Charge ✅ DONE

**Problem:** A network timeout after OPERA posts but before the payment is recorded could cause a cashier retry that double-charges the guest.

**Fix:** Before calling `postCharge()`, the server checks for an existing `completed` payment with the same `pmsReservationId` + `orderId`. If found → returns 409 with message `"This reservation has already been charged for this order."` — no second OPERA call is made.

> **Note on full idempotency:** This covers the most common retry scenario. For complete durability (covering the gap between OPERA confirmation and DB write), a `pending`→`completed` payment state transition with an attempt log table would be needed. This can be added using the existing `Payment` model with a status enum if the migration budget allows.

**File:** `src/app/api/orders/[id]/pay/route.ts`

---

### P0.5 — Crash-Safe Idempotency (PmsChargeAttempt Table) ✅ DONE

**Problem:** P0.4 covered the "retry after known-completed charge" case, but not the crash window between OPERA confirming the charge and the `db.payment.create` write completing. A crash in that window left the guest charged in OPERA with no POS record, and a subsequent retry would double-charge.

**Fix:**
- New `PmsChargeAttempt` model with `PENDING | COMPLETED | FAILED` status and a unique `idempotencyKey` (`{orderId}:{reservationId}:{amountCents}:{chargeCode}`).
- Before calling OPERA: create attempt record (`PENDING`).
- After OPERA succeeds and payment is durably written to DB: mark attempt `COMPLETED` with `operaTransactionId`.
- If OPERA throws: mark attempt `FAILED` (cashier can retry cleanly — new attempt created).
- On any retry, consult attempt status:
  - `COMPLETED` → return 200 with stored `transactionNo` (idempotent success, no OPERA call)
  - `FAILED` → return 502 (allow fresh retry)
  - `PENDING` < 60s → return 409 "in progress" (likely concurrent request)
  - `PENDING` ≥ 60s → stale crash recovery: retry OPERA using same `idempotencyKey` (OHIP deduplicates via `Idempotency-Key` header)
- idempotency key includes `amountCents` + `chargeCode` so a legitimate second charge for a different amount is not blocked.

**Files:** `prisma/schema.prisma`, `scripts/nuc-pre-migrate.js`, `src/lib/oracle-pms-client.ts`, `src/app/api/orders/[id]/pay/route.ts`

---

### P0.6 — Fetch Timeouts + Sanitized Error Messages ✅ DONE

**Problem:** No timeouts on OPERA API calls — a hung connection would block the NUC process indefinitely. Raw OPERA error bodies were logged without truncation.

**Fix:**
- All fetch calls use `AbortController` with explicit timeouts: **8s auth**, **12s guest lookup**, **15s charge post**
- `sanitizeForLog()`: truncates response body to 500 chars with `[OPERA {status}]` prefix for server logs
- `detectOperaError()`: handles OPERA 200-with-error payloads (checks `message`, `error`, `errors[]`, `title`+`status≥400`)

**File:** `src/lib/oracle-pms-client.ts`

---

### P0.7 — Room Lookup Validation + Rate Limiting ✅ DONE

**Problem:** No server-side validation of search query format. No rate limiting on the guest lookup endpoint — any authenticated request could enumerate room numbers or brute-force guest names.

**Fix:**
- **Input validation:** max 40 chars; room numbers allow `[A-Za-z0-9\s\-]+`; names require min 2 chars and allow `[A-Za-zÀ-ÿ\s\-']+`
- **In-memory rate limit:** 10 lookups per employee per minute. Rate key: `employee:{id}` or `ip:{x-forwarded-for}` for anonymous. Returns 429 when exceeded.

**File:** `src/app/api/integrations/oracle-pms/room-lookup/route.ts`

---

## P1 — Important Security Improvements

### P1.1 — Server-Trusted Guest Selection (selectionId Pattern) ✅ DONE

**Problem:** After guest lookup, the client sent raw OPERA reservation IDs (`pmsReservationId`, `roomNumber`, `guestName`) directly to `/pay`. A malicious or manipulated client could supply arbitrary reservation IDs and charge any guest's folio.

**Fix:**
- After a successful guest lookup, the server creates a short-lived in-memory selection token (`room-charge-selections.ts`): 48-hex random ID, 10-minute TTL, one-time use.
- The client stores and sends only the `selectionId` to `/pay` — never raw OPERA IDs.
- `/pay` calls `consumeRoomChargeSelection(selectionId, locationId)` which validates TTL, locationId binding, and deletes on first use (prevents replay).
- If `selectionId` is missing, expired, or invalid → 400 error, no OPERA call.

**Files:** `src/lib/room-charge-selections.ts` (new), `src/app/api/integrations/oracle-pms/room-lookup/route.ts`, `src/app/api/orders/[id]/pay/route.ts`, `src/components/payment/PaymentModal.tsx`

---

### P1.2 — SSRF Guardrails on `baseUrl` ✅ DONE

**Problem:** No validation of the `hotelPms.baseUrl` field — a malicious actor with Settings Edit permission could set it to an internal address and use the NUC as a proxy to probe the internal network.

**Fix:** `validatePmsBaseUrl()` in `settings/route.ts`:
- Must be a valid URL
- Must use `https:` protocol
- Blocks: `localhost`, `127.x`, `10.x`, `172.16-31.x`, `192.168.x`, `0.0.0.0`, `::1`
- Returns 400 with descriptive error if validation fails

**File:** `src/app/api/settings/route.ts`

---

### P1.3 — Test Endpoint Permission Gate ✅ DONE

**Problem:** `POST /api/integrations/oracle-pms/test` had no auth check — any unauthenticated request could probe OPERA credentials.

**Fix:** Route now accepts `{ employeeId }` in the request body and calls `requirePermission(employeeId, locationId, PERMISSIONS.SETTINGS_EDIT)`. Returns 401/403 if unauthorized. Real error logged server-side; generic safe message returned to client.

The admin page test button now passes `employeeId` in the request body.

**Files:** `src/app/api/integrations/oracle-pms/test/route.ts`, `src/app/(admin)/settings/integrations/oracle-pms/page.tsx`

---

## P2 — Nice to Have (Deferred)

| Item | Description | Priority |
|------|-------------|----------|
| Distributed rate limiting | Move rate limiter from in-memory Map to Redis or DB-backed storage for multi-NUC deployments | Low — single NUC per venue |
| Full idempotency log | ✅ Promoted to P0.5 and implemented | Done |
| Auto-reverse on void | When a room_charge payment is voided, post a reverse charge to OPERA | Low — hotel staff reconcile manually |
| Mission Control visibility | Surface Oracle PMS connection health in Mission Control dashboard | Low |
| OPERA webhook support | Receive reservation status events from OPERA (in-house vs departed) | Low — polling not needed at low volume |

---

## Security Architecture Summary

```
Browser                     NUC Server                 OPERA Cloud
  │                              │                           │
  │ 1. GET /room-lookup          │                           │
  │──────────────────────────────▶ validate input            │
  │                              │ rate-limit check          │
  │                              │─────────────────────────▶ │ GET reservations
  │                              │◀─────────────────────────  guest list
  │                              │ createRoomChargeSelection │
  │◀────────────────────── guests + selectionId              │
  │                              │                           │
  │ 2. POST /pay                 │                           │
  │    { selectionId }           │                           │
  │──────────────────────────────▶ consumeRoomChargeSelection│
  │                              │ (validates + deletes)     │
  │                              │ idempotency check (DB)    │
  │                              │─────────────────────────▶ │ POST folio/transactions
  │                              │◀─────────────────────────  transactionNo
  │                              │ record Payment (DB)       │
  │◀──────────────────────── { success, transactionNo }      │
```

**Key security properties:**
- Browser never sees `clientSecret` or `appKey`
- Browser never sends raw OPERA IDs to `/pay` — only a short-lived one-time token
- OPERA errors never reach the browser (log-then-throw-generic pattern throughout)
- Rate limiting key is server-validated (only real employees get per-employee limits)
- SSRF blocked at save time
- Test endpoint requires SETTINGS_EDIT permission

---

## Go-Live Checklist

Before switching the integration to Production, verify every item below.

### Credential & Connection
- [ ] Client ID, Client Secret, App Key entered and saved in Settings → Oracle Hotel PMS
- [ ] API Base URL points to your OPERA Cloud instance (HTTPS, no trailing slash)
- [ ] Hotel ID matches the property code in OPERA (used as `x-hotelid`)
- [ ] F&B Charge Code confirmed with hotel OPERA admin (e.g. `REST01`)
- [ ] Environment set to **Cert/Sandbox** for initial testing
- [ ] "Test Connection" button returns success in Cert environment
- [ ] At least one real guest lookup tested in Cert (room number + name)
- [ ] At least one test charge posted to Cert folio and visible in OPERA back-office
- [ ] Environment switched to **Production** and connection re-tested

### Permissions & Access
- [ ] OHIP app registration approved by hotel OPERA administrator
- [ ] Cashiering API module enabled by OPERA admin for your app
- [ ] App granted permission to POST folio transactions (not read-only)
- [ ] Bill to Room toggle enabled in Settings → Payments
- [ ] Oracle PMS integration enabled in Settings → Oracle Hotel PMS

### Functional Verification (Production)
- [ ] Room number lookup returns correct in-house guest(s)
- [ ] Last name lookup returns correct results (if `allowGuestLookup` enabled)
- [ ] Charge of a known test amount posts to OPERA folio and shows OPERA transaction number in POS payment record
- [ ] Order marked as paid; receipt shows "Bill to Room — Room [X]"
- [ ] OPERA folio shows charge under correct transaction code with POS order reference

### Known Limitations to Brief Hotel Staff On
- No auto-reverse on void or refund — hotel staff must manually credit OPERA folio if a charge is voided in POS
- Departed guests cannot be charged (INHOUSE filter only)
- If OPERA is unreachable at payment time, Bill to Room is unavailable — use alternate payment method
- Selection tokens expire after 10 minutes — if cashier pauses too long after guest lookup, they must search again

### Remaining P2 Items (post-launch)
- [x] Crash-safe idempotency: `PmsChargeAttempt` table with `PENDING`→`COMPLETED` state machine — promoted from P2 to P0.5 and implemented ✅
- [ ] Mission Control health visibility: surface Oracle PMS connection status in fleet dashboard
- [ ] Auto-reverse on void: when a room_charge payment is voided, post a credit to OPERA folio
