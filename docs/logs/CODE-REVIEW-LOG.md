# GWI POS — Code Review Log

Companion to `docs/CODE-REVIEW-CHECKLIST.md`.
Records every review session: files covered, status per file, and all findings with severity.

**Reviewer:** Brian Lewis + Claude Code
**Started:** 2026-02-21
**Checklist:** `docs/CODE-REVIEW-CHECKLIST.md` (284 files, 9 tiers)

---

## Cross-References

| Document | Location | What It Covers |
|----------|----------|----------------|
| **Forensic Audit** (10-agent, Feb 18) | `docs/audits/FORENSIC-AUDIT-2026-02-18.md` | Pre-existing audit: hard deletes, missing filters, N+1s, sockets, performance — Waves 1–6H complete |
| **Forensic Audit Resume** | `docs/audits/FORENSIC-AUDIT-RESUME.md` | State summary for resuming the forensic audit |
| **Living Log** | `docs/logs/LIVING-LOG.md` | Session-by-session development record (commits, deploys, features, bugs) |
| **Code Review Checklist** | `docs/CODE-REVIEW-CHECKLIST.md` | All 284 files organized into 9 priority tiers |
| **This Log** | `docs/logs/CODE-REVIEW-LOG.md` | Manual code review trail — findings, owners, remediations |

> **Note for new engineers:** Start with the Forensic Audit for the macro picture (what was already found and fixed system-wide), then use this log for the file-by-file deep review. The Living Log tells you what changed and when.

---

## Open Issues Tracker

All findings across all sessions. Cleared when resolved.

| # | Severity | File | Issue | Owner | Remediation | Status |
|---|----------|------|-------|-------|-------------|--------|
| 001 | ⚠️ Medium | `src/middleware.ts` | `PROVISION_API_KEY` falls back to empty string `''` if env var is missing. `verifyCloudToken()` would accept JWTs signed with an empty key in that scenario. | Infra | Add hard startup guard in prod: `if (!process.env.PROVISION_API_KEY && process.env.NODE_ENV === 'production') throw new Error(...)` | Open |
| 002 | ⚠️ Medium | `src/lib/api-auth.ts` | Soft-mode bypass (lines 38–46) skips auth entirely when no `employeeId` is provided and `options.soft` is true. Downstream code checking only `authorized: true` without inspecting permissions is unguarded. | BE-A | Remove `soft` mode after all UI pages send `employeeId` (tracked in PM-TASK-BOARD.md). Audit every `requirePermission(..., { soft: true })` call site first. | Open |
| 003 | 🔵 Low | `src/lib/auth-utils.ts` | Unused variable `requiredParts` on line 16 — `requiredPermission.split('.')` result is never read. | BE-A | Delete line 16. | Open |
| 004 | 🔵 Low | `src/lib/db.ts` | `READ_ACTIONS` constant (Set of read operation names, line 18) is defined but never used. The actual soft-delete guard lives in the Prisma extension, not this set. | BE-A | Delete the `READ_ACTIONS` constant. | Open |
| 005 | 🔵 Low | `src/lib/db.ts` | `NO_SOFT_DELETE_MODELS` must be kept manually in sync with schema models that lack `deletedAt`. No automated safety net. | BE-A | Add a comment to `schema.prisma` template reminding devs to add new no-`deletedAt` models here. | Open |
| 006 | 🔴 Critical | `prisma/schema.prisma` | `Employee.bankAccountNumber String?` is stored in plaintext. This is a W-2 direct deposit field containing real routing + account numbers. Unencrypted PII/financial data in the database. | Infra | Encrypt at application layer before write (e.g., AES-256-GCM using a `BANK_ENCRYPTION_KEY` env var). Store as encrypted blob, decrypt on read. Mark `bankRoutingNumber` the same way. Do before any payroll feature is live. | Open |
| 007 | ⚠️ Medium | `src/lib/cloud-auth.ts` | `verifyCloudToken()` checks `if (payload.exp && ...)` — if `exp` is `0` or missing, the expiry check is skipped entirely, making such a token permanently valid. Requires PROVISION_API_KEY to exploit, but is a logic error. | BE-A | Change to `if (!payload.exp \|\| payload.exp < Math.floor(Date.now() / 1000)) return null` — same fix pattern as `verifyOwnerToken`. | Open |
| 008 | ⚠️ Medium | `src/lib/cloud-auth.ts` | `CLOUD_BLOCKED_PATHS` in `isBlockedInCloudMode()` is a **blocklist** of POS routes. Any new POS route (e.g., a future `/queue` or `/drive-thru` screen) is accessible from cloud mode by default until explicitly added to this list. An allowlist of admin routes is safer. | BE-A | Consider inverting to an allowlist: `CLOUD_ALLOWED_PATHS = ['/settings', '/menu', '/employees', '/reports', ...]`. New routes are denied in cloud mode until explicitly allowed. | Open |
| 009 | 🔵 Low | `src/lib/access-log.ts` | `ensureTable()` runs `CREATE TABLE IF NOT EXISTS` on every read AND write call. This is a DB round-trip on every log event (typically 2–3 per access attempt). | BE-A | Call `ensureTable()` once at module init (top-level `await` or singleton pattern) rather than per call. | Open |
| 010 | ⚠️ Medium | `src/lib/datacap/reader-health.ts` | `healthMap` is an in-memory `Map` — not shared across serverless instances or multi-worker processes. If two Node.js workers run simultaneously (e.g., PM2 cluster or multiple Vercel invocations), a reader marked degraded on one worker is still seen as healthy on another. | Infra | For NUC (single-process) deployment: accept and document. For cloud/multi-worker: either (a) move health state to Redis/DB, or (b) document that cloud mode has no local readers and health tracking is irrelevant there. Add a comment to the file. | Open |
| 011 | ⚠️ Medium | `src/lib/payment-domain/rounding.ts` | Cash rounding uses JS floating point: `Math.round(amount / roundTo) * roundTo`. Division of decimals like `12.37 / 0.05` produces `247.39999...` rather than `247.4`, risking off-by-one rounding errors. The final `Math.round(result * 100) / 100` step mitigates some accumulation but does not eliminate the root issue. | BE-A | Convert to integer-cent arithmetic before rounding: `const cents = Math.round(amount * 100); const roundToCents = Math.round(roundTo * 100); const roundedCents = Math.round(cents / roundToCents) * roundToCents; return roundedCents / 100;` — eliminates floating point division entirely. | Open |
| 012 | 🔵 Low | `src/lib/payment-intent-manager.ts` | `syncIntent()` method (~50 lines) is dead code — `processPendingIntents` calls `batchSyncIntents()` exclusively. `syncIntent` was the original single-intent sync path before batch sync was added. | BE-A | Delete `syncIntent()` method. | Open |
| 013 | 🔴 Critical | `src/components/payment/QuickPayButton.tsx` | **Orphaned charge risk**: QuickPayButton uses a two-step flow — `POST /api/datacap/sale` (charges the card) then `POST /api/orders/:id/pay` (records in DB). If step 1 succeeds and step 2 fails (network, 500, crash), the customer is charged but the order remains "Unpaid" in the system. There is no reconciliation path. | BE-A + FE-A | **Preferred**: Consolidate into a single server-side action that calls Datacap, writes DB transactionally, and returns a definitive result. **If separate calls must remain**: add a reconciliation job that periodically queries Datacap for "captured, unlinked" transactions by `recordNo`/`refNumber`/`amountAuthorized` and flags orphaned charges for manual review. | Open |
| 014 | ⚠️ Medium | `src/components/payment/DatacapPaymentProcessor.tsx` | `handleVoidPartial` void failure is silent — errors are only logged with `console.error`. If the Datacap void call fails, the card auth remains active on the bank's side while staff believe it was cancelled. No visible "Void failed" message is shown to the cashier. | FE-A | Add a visible error state when the void API call returns a failure or non-approved result: e.g., `setError('Card void failed — verify in Datacap portal')`. Reuse existing `errors` state if available, or surface via toast. | Open |
| 015 | ⚠️ Medium | `src/components/payment/DatacapPaymentProcessor.tsx` | `handleStartPayment` emits `cfd:payment-started` with `totalToCharge` (including tip), but tip may still be editable after this event fires. The CFD (Customer-Facing Display) will then show a stale tip/total until the transaction completes. | FE-A | Decide: (a) lock tip once `handleStartPayment` is called and disable tip editing UI, or (b) emit a follow-up `cfd:payment-updated` event whenever tip/total changes after start. Document the decision. | Open |
| 016 | ⚠️ Medium | `src/components/payment/PaymentModal.tsx` | `loadHouseAccounts` derives `locationId` from `orderId` via `orderId?.split('-')[0]`. This assumes a stable `orderId` prefix schema. If order IDs ever use UUIDs or a different format, house accounts silently fail to load with no error shown to staff. | FE-A | Use the `locationId` prop directly (it is already available in scope) instead of parsing it from `orderId`. Make `locationId` required for any flow that needs house accounts. | Open |
| 017 | 🔵 Low | `src/components/payment/PaymentModal.tsx` | `processPayments` reads `pendingPayments` from the component closure to compute `isCashOnly`, mixing closure state with function arguments. Makes the function harder to reason about and unit-test in isolation. | FE-A | Pass `pendingPayments` as a parameter to `processPayments`, or compute `isCashOnly` at the call site and pass it as a boolean flag. Keeps the function pure with respect to its inputs. | Open |
| 018 | 🔵 Low | `src/components/payment/PaymentModal.tsx` | CFD "show order" `useEffect` has `// eslint-disable-line react-hooks/exhaustive-deps` on its dependency array. Risk: future devs add more prop reads inside the effect without updating deps, creating stale closures. | FE-A | Move CFD emission into a `useCallback` that explicitly lists its dependencies, then call it from an effect that only depends on `isOpen` + the stable callback. Removes the need to suppress the lint rule. | Open |
| 019 | 🔵 Low | `src/components/payment/PaymentModal.tsx` | `PaymentModal` uses large inline `style={{ ... }}` objects for layout while the rest of the app (including `DatacapPaymentProcessor`) uses Tailwind. Mixed styling approaches increase maintenance cost when multiple devs touch the same file. | FE-A | Adopt Tailwind as the standard for new work; migrate existing inline styles to Tailwind class names incrementally when the file is touched for other reasons. Not a blocker. | Open |
| 020 | 🔵 Low | `src/components/payment/QuickPayButton.tsx` | `parseFloat(data.amountAuthorized)` and similar string re-parsing for monetary values — inconsistent with the tolerance-compare pattern (`Math.abs(a - b) < 0.01`) used correctly in `DatacapPaymentProcessor`. | FE-A | Standardize: compute money in integer cents on the backend; frontend amounts should be numbers, not re-parsed strings. Avoid `parseFloat` on currency fields where the value is already numeric. | Open |

**Severity key:**
- 🔴 Critical — active security/data risk, fix before next deploy
- ⚠️ Medium — real risk, fix before go-live
- 🔵 Low — code quality / maintainability / minor performance
- ℹ️ Info — note for awareness, no action required

**Owner key:**
- `BE-A` — Back-end application developer
- `FE-A` — Front-end application developer
- `Infra` — Infrastructure / DevOps (env vars, encryption keys, Vercel config)

---

## Session 3-B — 2026-02-21 (Supplemental: Third-Party Review, Payment UI Components)

**Source:** Merged audit — Review A (Brian Lewis + Claude Code, library layer) + Review B (third-party, frontend component layer)
**Theme:** Tier 1 — Payment UI (DatacapPaymentProcessor, PaymentModal, QuickPayButton, SignatureCaptureCanvas)
**Note:** These files are scheduled for formal checklist review in Tier 3 (Core POS Pages). This supplemental entry records third-party findings so issues are tracked immediately. Checklist progress count is **not** incremented here — it will be updated when these files are reviewed per the checklist.

### Files Covered

| File | Review Source | Status | Findings |
|------|---------------|--------|----------|
| `src/components/payment/DatacapPaymentProcessor.tsx` | Third-party (Review B) | ⚠️ Issues | Issues #014, #015 — silent void failure + stale CFD tip |
| `src/components/payment/PaymentModal.tsx` | Third-party (Review B) | ⚠️ Issues | Issues #016, #017, #018, #019 — house acct lookup, processPayments impurity, CFD lint suppress, inline styles |
| `src/components/payment/QuickPayButton.tsx` | Third-party (Review B) | 🔴 Critical | Issue #013, #020 — orphaned charge risk + parseFloat inconsistency |
| `src/components/payment/SignatureCaptureCanvas.tsx` | Third-party (Review B) | ✅ Clean | None — coordinate scaling via `getBoundingClientRect()` + scale factor is correct |

### Session Notes

**Architecture assessment (Review B):** The payment UI is **A-grade** — explicit state machines, correct partial approval handling, idempotency keys generated client-side and passed to the API. The gap between A and A++++ is three things: the orphaned charge risk in QuickPayButton (Critical), the silent void failure (Medium), and several smaller maintainability issues in PaymentModal.

**`DatacapPaymentProcessor`** — Tracks 7 explicit statuses (`checking_readers`, `waiting_card`, `authorizing`, `approved`, `declined`, `partial`, `error`) with `AnimatePresence` keeping UI synchronized with hardware state. `handleVoidPartial` correctly voids partial authorizations when a user backs out — a failure mode many POS systems miss. Tip selection uses `Math.abs(tipAmount - tipValue) < 0.01` tolerance compare — the right approach for float comparison. Reader management includes backup reader swapping, which is essential for real-world bar hardware. Two issues: void failure is silent (Issue #014), and CFD tip synchronization after `handleStartPayment` is unresolved (Issue #015).

**`PaymentModal`** — Step machine (`'method' | 'cash' | 'tip' | 'gift_card' | 'house_account' | 'datacap_card'`) is explicit and guarded. `handleContinueFromTip` already has a null guard on `selectedMethod` — correct. Cash-only flow awaits `/pay` before closing (correct — must know immediately whether cash write succeeded). `waitForOrderReady()` hook prevents "order paid but items not saved" race conditions. `idempotencyKey` via `crypto.randomUUID()` is passed to the API — server deduplication is properly positioned. PAN and sensitive card data never appear in this component (PCI scope maintained). Four medium/low issues: house account lookup (Issue #016), closure reads in `processPayments` (Issue #017), CFD effect lint suppress (Issue #018), inline styles (Issue #019).

**`QuickPayButton`** — The critical finding (Issue #013): Datacap sale POST → local DB `/pay` POST is a two-step sequence with no atomic guarantee. A network failure between steps creates an orphaned charge — customer billed, order shows Unpaid. The fix is server-side consolidation: one endpoint that calls Datacap and writes the DB in the same operation. If that's not immediately feasible, a reconciliation job watching Datacap's captured-but-unlinked transactions is the fallback. `parseFloat` usage on `amountAuthorized` is inconsistent with the rest of the payment code (Issue #020).

**`SignatureCaptureCanvas`** — Clean. `getPoint` uses `getBoundingClientRect()` + scale factor to map pointer coordinates into canvas space, correctly handling high-DPI tablets and CSS vs. canvas size differences. No changes needed.

### Backend Verification Required (from Review B)

Before go-live, verify these backend behaviors:
1. `/api/orders/:id/pay` enforces idempotency: duplicate `idempotencyKey` returns the existing result, not a second payment row.
2. Datacap transactions are linked by `(datacapRecordNo, datacapRefNumber, sequenceNo)` tuple — not by amount — consistent with the Payment schema design.
3. Datacap failure responses include a human-friendly decline reason string so `DatacapPaymentProcessor` and `PaymentModal` can surface it to staff (not just a generic error code).

---

## Session 3 — 2026-02-21

**Theme:** Tier 1 — Payment Processing (Datacap Library + Payment Domain)
**Tier coverage:** Tier 1: 24/37 complete (+13 this session)

### Files Reviewed

| File | Lines | Status | Findings |
|------|-------|--------|----------|
| `src/lib/datacap/types.ts` | ~120 | ✅ Clean | None — `validateDatacapConfig()` hard-blocks simulated mode in production |
| `src/lib/datacap/client.ts` | 1,123 | ✅ Solid | None — `withPadReset()` safety pattern is exemplary |
| `src/lib/datacap/xml-builder.ts` | ~200 | ✅ Clean | None — `escapeXml()` + amount validation correct; `SimScenario` gated to non-prod |
| `src/lib/datacap/xml-parser.ts` | ~260 | ✅ Solid | None — regex parsing acceptable for controlled Datacap device XML |
| `src/lib/datacap/sequence.ts` | ~50 | ✅ Clean | None |
| `src/lib/datacap/helpers.ts` | ~120 | ✅ Clean | None — `validateReader()` cross-tenant guard correct |
| `src/lib/datacap/reader-health.ts` | ~80 | ✅ Solid | Issue #010 — in-memory Map not shared across processes/instances |
| `src/lib/payment-domain/rounding.ts` | ~100 | ✅ Solid | Issue #011 — JS floating point used for cash rounding arithmetic |
| `src/lib/payment-intent-manager.ts` | ~620 | ✅ Solid | Issue #012 — unused `syncIntent()` method (dead code) |
| `src/lib/payment.ts` | ~50 | ✅ Clean | None — `generateFakeAuthCode/TransactionId` confirmed simulator-only via prod guard |
| `src/lib/datacap/use-cases.ts` | ~250 | ✅ Solid | None — orchestration layer is clean; `voidPayment` cosmetically misuses `recordFailure()` |
| `src/lib/datacap/discovery.ts` | ~80 | ✅ Clean | None — UDP broadcast, server-side only via dynamic `dgram` import |
| `src/lib/datacap/simulator.ts` | ~300 | ✅ Clean | None — realistic XML responses for all 22+ TranCodes; blocked in production |

### Session Notes

**`types.ts`** — Complete discriminated union type definitions for all Datacap operations (`DatacapResult<T>`, all TranCode types, all config types). `validateDatacapConfig()` is the critical gate: it throws if `communicationMode === 'simulated'` in production. Clean, no issues. The `CommunicationMode` union (`'local' | 'cloud' | 'local_with_cloud_fallback' | 'simulated'`) is well-designed.

**`client.ts`** (1,123 lines — the core transport layer) — The most important file in this group. Key patterns:
- **`withPadReset()` wrapper**: Every monetary transaction auto-calls `EMVPadReset` after completion (even on failure). If the pad reset itself fails, the reader is marked degraded. This prevents card reader lockups in production — a critical hardware safety pattern.
- **`assertReaderHealthy()`**: Called at the start of every transaction. Blocks degraded readers with a descriptive error including recovery instructions.
- **3-tier transport**: `sendLocal` (HTTP to PAX at LAN IP), `sendCloud` (HTTPS to Datacap cloud), `send` (dispatches based on `communicationMode`). `local_with_cloud_fallback` tries local first, falls back on any error.
- **AbortController timeouts**: All requests have explicit timeouts. Correct.
- **Cloud credentials**: `cloudPassword` read per-reader from `paymentReader` DB record. Not hardcoded.
- Reader health logging is fire-and-forget: `void logReaderTransaction(...).catch(() => {})` — correct for non-critical side effects.

**`xml-builder.ts`** — All values passed through `escapeXml()` which handles `& < > "` — XML injection safe. `validateAmounts()` guards against NaN and negative values before building the XML. `customerCode` truncated to 17 chars per Datacap Level II specification. The `SimScenario` tag is only emitted when `NODE_ENV !== 'production'`.

**`xml-parser.ts`** — Regex-based XML parsing (not a DOM parser). Acceptable here: Datacap device responses are a controlled, predictable format — a full XML parser would be overkill and slower. Regex map is cached per tag name for performance. `rawXml` is redacted in production (`rawXml: process.env.NODE_ENV === 'production' ? '' : xml`). Partial approval detection handles both the `PartialAuthApprovalCode` tag and the `dsixReturnCode === '000001'` fallback. Offline detection handles both the `StoredOffline` tag and the `textResponse.includes('STORED OFFLINE')` text fallback.

**`sequence.ts`** — Minimal 2-function file: reads/writes `lastSequenceNo` to the `paymentReader` DB record. Datacap controls the sequence number format; no local validation needed.

**`helpers.ts`** — `getDatacapClient()` constructs a `DatacapConfig` from location settings. `validateReader()` checks `id + locationId + deletedAt: null + isActive: true` — this is the cross-tenant guard that prevents one venue's terminal from using another venue's reader. `requireDatacapClient()` throws a clean error if `processor === 'none'` (not configured).

**`reader-health.ts`** — Issue #010: `healthMap` is a module-level `Map<string, ReaderHealth>`. In the NUC deployment (single Node.js process), this works correctly. In a multi-worker environment (PM2 cluster, or if running on Vercel serverless in cloud mode), each worker/instance has its own isolated map — a reader marked degraded on worker A is still healthy on workers B and C. This is low-risk for the NUC deployment model, and cloud mode has no local readers, so the practical risk is limited. Should be documented.

**`rounding.ts`** — Issue #011: Cash rounding arithmetic uses standard JS floating point: `Math.round(amount / roundTo) * roundTo`. For example, `12.37 / 0.05 = 247.39999...` (not `247.4`) causing `Math.round` to return `247` → `247 * 0.05 = 12.35` — this specific case is correct because the patron pays less (cash rounding down). But accumulated floating point errors over many rounding operations are possible. The final `Math.round(result * 100) / 100` step mitigates gross accumulation. Recommend converting to integer cent arithmetic (see Issue #011 remediation) before going live with cash rounding.

**`payment-intent-manager.ts`** (`'use client'`, IndexedDB/Dexie) — Sophisticated 7-state offline payment resilience machine: `intent_created → token_received → authorizing → authorized/declined → capture_pending → captured`. Key design choices:
- **Exponential backoff**: 15s base, 2× multiplier, 120s max, 10 max retries before `permanently_failed`
- **Generation counter**: Prevents race conditions between the retry interval and the `online` event both triggering sync simultaneously
- **`idempotencyKey` format**: `{terminalId}-{orderId}-{amountCents}-{timestamp}-{uuid8}` — correctly unique per terminal-order-amount combo
- **Cleanup**: Removes `captured` intents older than 30 days
- Issue #012: `syncIntent()` (~50 lines) is dead code — `processPendingIntents` calls `batchSyncIntents()` exclusively. The single-intent path was the original implementation before batch sync was added.

**`payment.ts`** — Thin re-export wrapper over `payment-domain/rounding.ts`. Also exports `generateFakeAuthCode()` and `generateFakeTransactionId()`. These generate realistic-looking auth codes / transaction IDs for simulated payments. Confirmed safe: the only callers are in `simulator.ts`, which is blocked in production by `validateDatacapConfig()`. No production risk.

**`use-cases.ts`** — Clean orchestration layer. `processSale`, `openBarTab`, `closeBarTab`, `voidPayment`. Each creates a `PaymentIntent` in IndexedDB **before** any network call — correct ordering for offline resilience. `isNetworkError()` inspects Datacap error codes to decide whether to queue offline vs. treat as a permanent failure (declined, invalid card, etc.). Minor cosmetic note: `voidPayment` calls `recordFailure(intentId, 'Payment voided successfully')` — using the failure path to mark a successfully voided payment. Functionally correct (void cancels the payment intent) but the naming is misleading.

**`discovery.ts`** — UDP broadcast on port 9001 to discover Datacap/PAX readers on the local network. Uses dynamic `import('dgram')` so this module is safe to import in browser context (the `dgram` import only happens on the server path). Always defaults to PAX port 8080. `discoverAllDevices()` collects all responders within a configurable timeout (default 5s).

**`simulator.ts`** — Returns realistic TStream XML responses for all 22+ TranCodes including approve, decline, error, partial approval, and SAF (stored-offline). Used for development/testing without physical hardware. Blocked in production via `validateDatacapConfig()`.

### Overall Datacap Assessment

The Datacap integration is **well-engineered**. Key strengths:
- **`withPadReset()` safety wrapper** — prevents card reader lockups in all failure scenarios
- **Idempotency at every layer** — `idempotencyKey` in DB, `offlineIntentId`, IndexedDB state machine
- **Production guards** — `validateDatacapConfig()` + `NODE_ENV` checks prevent simulator use in production
- **XML injection safety** — `escapeXml()` applied to all values
- **Cross-tenant reader validation** — `validateReader()` prevents venue mixing
- **Partial approval handling** — both tag and `dsixReturnCode` detection paths covered

Three issues found (1 medium × 2, 1 low) — none are showstoppers. Payment API routes (12 remaining Tier 1 files) are the next review target.

---

## Session 2 — 2026-02-21

**Theme:** Tier 1 — Security & Auth (remaining auth files) + Schema
**Tier coverage:** Tier 1: 11/37 complete (+4 this session)

### Files Reviewed

| File | Lines | Status | Findings |
|------|-------|--------|----------|
| `src/lib/cloud-auth.ts` | 215 | ✅ Solid | Issues #007, #008 — expiry logic bug + blocklist risk |
| `src/lib/access-gate.ts` | 170 | ✅ Clean | None — stateless HMAC OTP is well-implemented |
| `src/lib/access-log.ts` | 104 | ✅ Clean | Issue #009 — ensureTable called per-request |
| `prisma/schema.prisma` | 6,630 | ✅ Solid | Issue #006 — Employee.bankAccountNumber plaintext |

### Session Notes

**`cloud-auth.ts`** — Two token types in one file: `CloudTokenPayload` (PROVISION_API_KEY signed, 8h, slug-bound, from MC) and `OwnerTokenPayload` (same key, 10min, email + venue list). The `signVenueToken` function mirrors MC's format exactly so `verifyCloudToken` validates both. `verifyOwnerToken` is the better-written expiry check — the inconsistency with `verifyCloudToken` is Issue #007. The `CLOUD_BLOCKED_PATHS` blocklist approach (Issue #008) is the highest-priority thing to address before scaling to more POS route areas.

**`access-gate.ts`** — Clean stateless HMAC OTP implementation. Uses first 4 bytes of SHA-256 HMAC → mod 1,000,000 → zero-pad to 6 digits. This is functionally equivalent to a simplified TOTP. The 20-minute grace window (current + previous window) is appropriate. No brute-force protection at the library level, but that's correctly handled by the rate-limit cookie in the API route. `normalizePhone` accepts non-US numbers, but the API layer validates US-only — acceptable layering.

**`access-log.ts`** — All queries use parameterized tagged-template SQL (injection-safe). Non-fatal logging is correct for a gate log. The `ensureTable` per-call pattern works but adds unnecessary round-trips (Issue #009). Raw Neon driver usage (no Prisma migration) is the right call here — the table sits outside the multi-tenant venue schema.

**`schema.prisma`** (key models reviewed: `Organization`, `Location`, `Customer`, `Role`, `Employee`, `EmployeeRole`, `Order`, `Payment`, `SyncAuditEntry`):

- Every model reviewed has `locationId` + `@@index([locationId])` ✅
- Every model reviewed has `deletedAt DateTime?` + `syncedAt DateTime?` ✅ (except `Organization`/`Location` which are intentionally in `NO_SOFT_DELETE_MODELS`)
- **Order model** is exemplary — `offlineId @unique`, `idempotencyKey @unique`, `offlineIntentId @unique`, optimistic locking `version`, 18 compound indexes. Offline sync was clearly well-engineered.
- **Payment model** — `idempotencyKey @unique` + `offlineIntentId @unique` are the critical deduplication guards. Both `voidedAt/voidedBy` and `refundedAmount/refundedAt` are tracked separately — correct (void ≠ refund). `settledAt` for batch settlement tracking is forward-thinking.
- **Employee model** — Complete payroll data including W-4 fields, YTD earnings, bank account info. `bankAccountNumber` stored plaintext is Issue #006 — the comment in the schema even says "Should be encrypted in production." This is the only critical finding in the schema review.
- **Role model** — `permissions Json?` is nullable. This is handled safely: `api-auth.ts` casts it as `(employee.role.permissions as string[]) || []`, so a null role gets `[]` permissions. Correct fallback behavior.

### Payment Risk Classes (Preview for Datacap session)

When reviewing Datacap files (next Tier 1 session), check these specific risk classes:
- **Idempotency** — Does every charge path check `idempotencyKey` before writing? Does the offline payment manager deduplicate on `offlineIntentId`?
- **Precision** — Are all monetary values handled as `Decimal` (Prisma) and never as JS `number`? Look for `parseFloat`, `toFixed`, or raw arithmetic on money fields.
- **Timeouts** — Does the Datacap client have explicit timeouts? What happens to the order state if a payment request times out mid-flight?
- **Auth** — Do all payment API routes call `requirePermission(..., 'pos.card_payments')` or equivalent before touching Datacap?
- **Error paths** — Does a Datacap failure (network error, declined) leave the order in a recoverable state? Are partial approvals handled?

---

## Session 1 — 2026-02-21

**Theme:** Tier 1 — Security & Authentication (core auth + DB layer)
**Tier coverage:** Tier 1: 7/37 complete

### Files Reviewed

| File | Lines | Status | Findings |
|------|-------|--------|----------|
| `src/middleware.ts` | 244 | ✅ Solid | Issue #001 — PROVISION_API_KEY empty fallback |
| `src/lib/auth.ts` | 63 | ✅ Clean | None |
| `src/lib/auth-utils.ts` | 460 | ✅ Solid | Issue #003 — unused `requiredParts` variable |
| `src/lib/api-auth.ts` | 178 | ✅ Solid | Issue #002 — soft-mode bypass (tracked, deferred) |
| `src/lib/db.ts` | 304 | ✅ Very solid | Issues #004, #005 — dead code + manual sync list |
| `src/lib/with-venue.ts` | 69 | ✅ Clean | None |
| `src/lib/request-context.ts` | 34 | ✅ Clean | None |

### Session Notes

Architecture quality: High. The multi-tenant Prisma proxy pattern (`db.ts`) is well-engineered — the JS Proxy intercepts every property access and resolves the correct PrismaClient at call time from a 3-tier chain (AsyncLocalStorage → x-venue-slug header → master). No silent fallback to master DB when a slug is present but invalid (`with-venue.ts` returns 500 instead). Permission system is solid: 60+ granular permissions, wildcard pattern matching (`pos.*`), 9 default role templates, clean separation between client-safe utilities (`auth-utils.ts`) and server-side DB-backed validation (`api-auth.ts`). The soft-mode bypass is the only real concern and is already tracked.

---

## Tier 1 Summary

_To be written when all 37 Tier 1 files are reviewed. Will consolidate critical/medium issues by theme: auth, DB, payments._

---

## Checklist Progress

| Tier | Files | Reviewed | Remaining |
|------|-------|----------|-----------|
| Tier 1 — Critical | 37 | 24 | 13 |
| Tier 2 — Core Business Logic | 52 | 0 | 52 |
| Tier 3 — Core POS Pages | 42 | 0 | 42 |
| Tier 4 — Menu, Printing, Hardware | 38 | 0 | 38 |
| Tier 5 — Admin Pages | 38 | 0 | 38 |
| Tier 6 — Reports | 26 | 0 | 26 |
| Tier 7 — Mobile & Public | 10 | 0 | 10 |
| Tier 8 — System & Infrastructure | 19 | 0 | 19 |
| Tier 9 — Supporting Code | 22 | 0 | 22 |
| **Total** | **284** | **24** | **260** |

---

_Prepend new sessions above Session 2. Update the progress table and Open Issues Tracker each session._
