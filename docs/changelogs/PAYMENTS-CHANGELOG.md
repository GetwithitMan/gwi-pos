# Payments Domain Changelog

## 2026-02-23 — Payment UX & Safety Wave 1 (Skill 413)

### UX Overhaul
- **Send to Kitchen**: 3-state button (Idle -> Sending -> Sent!), bgChain failure reverts optimistic marks
- **Start Tab**: inline "Authorizing card..." status, 15s slow-reader warning, success/decline feedback
- **Add To Tab**: socket listener for `tab:updated`, `increment_failed` amber banner, silent success update
- **Pay/Close**: inline "Processing payment..." with locked controls, idempotency + version verified

### CFD Tip Screen Rework
- Full rework: order summary, tip presets (% or $), custom keypad, confirm CTA, disconnect overlay

### Backend Safety
- close-tab: double-capture prevention guard (returns early if already paid)
- open-tab: timeout recovery (`pending_auth` -> `open`, prevents stuck orders)
- Structured `[PAYMENT-SAFETY]` logs in all payment catch blocks

### Instrumentation
- New `payment-timing.ts`: 4-timestamp flow measurement (start, apiCall, apiReturn, uiComplete)
- Wired into Send, Cash Pay, Card Pay, Start Tab flows

### Commits
- `e69d5b3` — Payment UX & Safety Wave 1 (15 files, 976 insertions)

---

## 2026-02-23 — Fix TABLE_OCCUPIED Client Recovery

### Bug Fix
- When `POST /api/orders` returns 409 `TABLE_OCCUPIED`, client now adopts the existing order instead of failing
- `startOrder` background draft: adopts existing order ID on 409
- `ensureOrderInDB`: loads existing order, appends local items, shows "Joined existing order" toast
- Root cause: walk-in table lock (from A+ Polish commit `685eb61`) was correct server-side but client had no recovery path

### Commit
- `2931b18` — Fix TABLE_OCCUPIED error

---

## 2026-02-20 — Sprint Sessions 8-14: Pricing Programs, Tip Adjustment, Batch Close, Partial Void, Refunds, Datacap Client

### T-080 (Phases 1-6) — Pricing Programs / Surcharge Engine
- New `PricingProgram` Prisma model for surcharge configuration.
- `usePricing` hook computes surcharge amounts client-side.
- `PaymentModal` shows surcharge line item and mandatory disclosure text.
- Receipt row and ESC/POS print line added for surcharge.
- Mission Control `PricingProgramCard` admin component (~750 lines): create/edit/delete pricing programs per location.
- Backoffice `surchargeTotal` field added to sales event payload.

### T-022 — Tip Adjustment Report
- New page at `/reports/tip-adjustment`.
- Inline Datacap gratuity adjust (via `AdjustByRecordNo`) per row — no separate modal.
- Date-range filter with summary cards: total tips, adjusted tips, unadjusted count.

### T-021 — Batch Close UI
- New card on `/settings/payments` for batch settlement.
- Reader selector, live pre-close summary (open orders, unadjusted tips, estimated total).
- `isSuperAdmin` gate prevents non-admin batch close.

### T-079 — Partial Payment Void-and-Retry
- "Void & Retry" flow calls `onCancel()` after void completes so the payment modal resets cleanly.
- Payment Progress banner displayed when `pendingPayments > 0` on the order.

### P2-P02 — Refund vs Void
- New `Refund` Prisma model tracking post-settlement refunds.
- `POST /api/orders/[id]/refund` calls Datacap `ReturnByRecord` with the stored `recordNo`.
- `/settings/orders/refunds` admin list page with date filter and status badges.

### Datacap PayAPI Client Library
- Standalone `DatacapPayAPIClient` wrapper class extracted into `src/lib/datacap/payapi-client.ts`.
- XML builder, XML response parser, and `CommunicationMode` enum all encapsulated.
- Used by all Datacap transaction routes — replaces inline XML construction.

---

## 2026-02-20 — DC Direct Architecture + Credential Flow (Skill 407)

### Architecture Clarification
- **DC Direct is firmware on payment terminals** (PAX A920, Ingenico AXIUM) — NOT software on the NUC
- POS sends HTTP POST to `http://{terminal-ip}:8080/ProcessEMVTransaction` on local network
- USB sled (VP3350) requires PamiPOP or Windows middleware — not standalone DC Direct compatible on Ubuntu

### Changes
- **MID credential flow hardened**: `merchantId` removed from all client POST/PUT bodies; server reads from `location.settings.payments.datacapMerchantId` (Mission Control managed)
- **`communicationMode: 'simulated'`** now detected by hook in addition to `paymentProvider === 'SIMULATED'` — readers marked simulated at the reader level route correctly to `/api/simulated-reader/*`
- **Cloud proxy routes added**: `/api/hardware/payment-readers/[id]/cloud/{device/info,process,cancel}` for future TranCloud/cloud mode
- **USB communicationMode default**: changed from `'cloud'` to `'local'` (DC Direct is always local HTTP)
- **Schema**: added `connectionType` field (USB/IP/WIFI/BLUETOOTH), ipAddress default `127.0.0.1`, removed broken `@@unique([locationId, ipAddress])` (USB readers all share 127.0.0.1)
- **Terminal API**: now exposes `communicationMode` on paymentReader so hook can route

### Commit
`e2d1d58` — feat(payments): DC Direct payment reader architecture + credential flow

---

## 2026-02-20 — Batch Monitoring Endpoint (Skill 400)

### New Features

- **`GET /api/system/batch-status`**: New POS endpoint returning live open order count, unadjusted tip count, and current batch total. Consumed by NUC heartbeat every 60 seconds to report batch state to Mission Control.
- **`datacap/batch` POST persistence**: After each batch close, writes `/opt/gwi-pos/last-batch.json` with timestamp and batch total — enables MC to calculate batch freshness and trigger auto-reboot if configured.
- **Unadjusted tip detection**: Batch status endpoint surfaces count of open orders with unadjusted tips, surfaced as an amber warning in MC fleet dashboard.

### Commit
`a38a8cf` — feat(sync): self-updating sync agent + batch monitoring + auto-reboot

---

## 2026-02-20 (PM5) — Third-Party Audit Bulletproofing (Commit 14de60e)

### New Features / Hardening

- **Reader health state machine** (`reader-health.ts`): Per-reader `healthy | degraded` tracking. Transactions refused on degraded readers. Pad-reset failures mark degraded; successful pad-reset (manual or automatic) clears state.
- **Configurable pad-reset timeout**: `padResetTimeoutMs` in `DatacapConfig` — venue operators can increase for high-latency environments.
- **Production simulated-mode guard**: `validateDatacapConfig` now throws if `communicationMode === 'simulated'` in production.
- **SimScenario XML tag**: Blocked in production — never emitted to the wire.
- **`validateCustomerCode()`**: New export from `xml-builder.ts` for upstream validation before truncation occurs.
- **Button labels cap**: Enforced max 4 buttons in `buildRequest()`.
- **`extractPrintData` bounds**: Max 36 lines, 500 chars each — prevents memory issues on pathological receipts.
- **`rawXml` redacted in production**: Prevents response XML accumulation in production logs.
- **Discovery ports**: `DEFAULT_PORTS.PAX` replaces hardcoded `8080` in `discovery.ts`.
- **Walkout-retry JSON safety**: Malformed JSON now returns `400 Invalid JSON request body`.
- **Internal card-profile calls**: `INTERNAL_BASE_URL` + `x-internal-call` header replaces `NEXT_PUBLIC_BASE_URL`.
- **Numeric validation normalized**: `!amount` → `=== undefined || null` in 5 monetary routes.
- **Logging discipline**: Remaining `console.*` in datacap paths migrated to `logger`.

### Commit

`14de60e` — feat(datacap): third-party audit bulletproofing — reader health, security, XML safety

---

## 2026-02-20 (PM4) — Forensic Audit Fixes (Commit 894e5fe)

### Bug Fixes

- **Simulator field passthrough**: `send()` now extracts `purchase`, `gratuity`, `customerCode`, `recordNo`, `invoiceNo` from the emitted XML and passes them to `simulateResponse()`. Previously the simulator received empty fields, making amount-based responses (partial approval amounts, Level II status) incorrect.
- **`PartialAuthApprovalCode`**: Changed from echoing the auth code value to the correct protocol value `'P'`. Parser was already checking for `'Y'` or `'P'` but this was never set correctly.
- **`forceOffline` → `storedOffline` in simulator**: When `<ForceOffline>Yes</ForceOffline>` is in the XML, simulator now returns `<StoredOffline>Yes</StoredOffline>` + `STORED OFFLINE` textResponse (required for SAF cert test 18.1 verification).
- **EMVSale partial approval**: Added `options.partial` path to EMVSale/PreAuth simulator case — returns 50% approval with `DSIXReturnCode: 000001` and `PartialAuthApprovalCode: P`.
- **`storedOffline` detection hardened**: Parser now checks explicit `<StoredOffline>Yes</StoredOffline>` tag first, falls back to `'STORED OFFLINE'` exact phrase in textResponse (not just `'STORED'` which was too broad).
- **`datacapErrorResponse` handles `DatacapError`**: Was only checking `instanceof Error`; `DatacapError` objects have `.text` not `.message`. Now correctly extracts the message from either type.
- **Discover route NaN guard**: `?timeoutMs=abc` → `parseInt` returns `NaN` → `setTimeout(NaN)` fires immediately. Added `isNaN(raw) ? 5000 : raw` guard.
- **`sale-by-record` response**: Added `storedOffline` field to route response body.

### Commit

`894e5fe` — fix(datacap): forensic audit fixes — simulator accuracy, error handling, edge cases

---

## 2026-02-20 (PM) — Datacap Certification: Token Transactions + Simulator Scenarios (Skills 385–388)

### New Features

- **PartialReversalByRecordNo** (`/api/datacap/partial-reversal`): Reduces a pre-auth hold by a partial amount using RecordNo. No card present needed. See Skill 385.
- **SaleByRecordNo** (`/api/datacap/sale-by-record`): Charges a stored vault token without card present. Supports gratuity and partial approval. See Skill 386.
- **PreAuthByRecordNo** (`/api/datacap/preauth-by-record`): Places a new pre-auth hold on a stored card token. See Skill 387.
- **EMVAuthOnly** (`/api/datacap/auth-only`): Zero-dollar card validation — vaults card without charging. Returns RecordNo for future SaleByRecordNo use. See Skill 388.

### Simulator Enhancements

- New `error` scenario: `simScenario: 'error'` → returns `CmdStatus: Error` / `DSIXReturnCode: 200003`
- New `partial` scenario: `simScenario: 'partial'` on SaleByRecordNo → returns 50% of requested amount with `DSIXReturnCode: 000001`
- `<SimScenario>` tag in XML: `buildRequest()` emits tag when `fields.simScenario` is set; `send()` extracts and routes to simulator
- SAF_Statistics and SAF_ForwardAll simulator cases scaffolded (logic TBD)

### Certification Progress

Covers Datacap cert tests 7.7, 8.1, 8.3, 17.0 + simulator scenarios 3.2, 3.3, 3.4.
Updated pass rate: **~74% (20/27)** — up from 48%.

### Commit

`cd96121` — feat(datacap): add certification TranCodes — PartialReversal, SaleByRecord, PreAuthByRecord, AuthOnly

---

## 2026-02-20 — Datacap Card Re-Entry + Token Display

### New Features

- **Card re-entry detection**: `open-tab` route performs two-stage `RecordNo` lookup — before and after `EMVPreAuth` — to detect returning cards and prevent duplicate holds. See Skill 384.
- **DC4 token display**: `OrderCard.recordNo` now displayed (truncated as `DC4:ABCD1234…`) in `MultiCardBadges` full mode and `TabNamePromptModal` success banner.
- **Auth hold display**: Auth hold amount shown in card pills (`$100 hold`) and tab name modal.

### Schema

- `OrderCard.recordNo`: added `@@index([recordNo])` — DB index now active in Postgres.

---

## 2026-02-18 — Multi-Card Tab Payments

### New Features
- **Multi-card tab support**: "Add Card to Tab" button in PaymentModal (method + card steps)
- **Card selection on close**: `orderCardId` parameter on close-tab API to charge specific card
- **Tab card display**: Existing cards shown on datacap_card step with "Charge •••XXXX" buttons
- **Payment skip**: Auto-set credit method when pre-auth tab cards exist

### Bug Fixes
- **Deleted items in payment totals**: Added `where: { deletedAt: null }` to pay route items include

---

## Session: February 17, 2026 — Task Board Update

### Summary
Added T-079 to PM Task Board for partial payment approval flow handling.

### What Changed
1. **T-079: Handle Partial Payment Approval Flow** — Added P1 task to PM Task Board (PM: Payments). Covers scenario where payment terminal approves a partial amount (e.g., card with insufficient funds approves $50 of $80). Needs UI flow for server to handle remaining balance.

### Files Modified
- `docs/PM-TASK-BOARD.md` — Added T-079

---

## Session: Feb 11, 2026 — Cash Rounding Pipeline Fix (Skill 327)

### Summary
Fixed the complete cash payment rounding pipeline. Two separate rounding systems (`priceRounding` from Skill 88 and legacy `cashRounding`) were not synchronized, causing payment failures, $0.04 phantom remaining balances, missing `roundingAdjustment` on payment records, and no rounding data in daily reports.

### Bugs Fixed
1. **Payment validation rejection** — Server only checked `cashRounding` ('none'), rejected client's rounded amount
2. **Stale totals after void** — PaymentModal showed pre-void totals, causing false "insufficient payment"
3. **$0.04 phantom remaining** — Rounding artifact not detected as "fully paid"
4. **roundingAdjustment always null** — Server re-rounded already-rounded amount (0 adjustment). Fixed to compute from raw order balance
5. **No rounding in daily report** — `payment.roundingAdjustment` stored but never queried

### Files Modified
- `src/app/api/orders/[id]/pay/route.ts` — priceRounding priority, rawRemaining adjustment, paidTolerance
- `src/components/payment/PaymentModal.tsx` — Rounding line, artifact detection, rounded remaining
- `src/app/(pos)/orders/page.tsx` — Immediate syncServerTotals on comp/void
- `src/app/api/reports/daily/route.ts` — Cumulative rounding in revenue + cash sections
- `src/app/(admin)/reports/daily/page.tsx` — Yellow "Cash Rounding" display line

### Skill Doc
`docs/skills/327-CASH-ROUNDING-PIPELINE.md`

---

## Session: Feb 6, 2026 — Datacap Direct Integration (Full Stack)

### Summary
Complete rewrite of payment integration from fake REST endpoints to real Datacap Direct XML-over-HTTP protocol. Implemented across 5 sprints covering 13 phases.

### Commits
| Commit | Message | Files | Lines |
|--------|---------|-------|-------|
| `52cbbca` | feat(payments): Datacap Direct integration — XML protocol, bar tabs, Quick Pay (Sprints 1-2) | 44 | +4,761 / -349 |
| `6a26905` | feat(payments): Sprint 3 — walkout recovery, digital receipts, chargebacks, card recognition | 8 | +890 |
| `1e9c00e` | feat(payments): Sprints 4-5 — bottle service tiers, CFD, pay-at-table, bartender mobile | 27 | +2,890 |
| **Total** | | **79** | **+8,541** |

### What Was Built

#### Sprint 1 — Phase 1: Core Library (`src/lib/datacap/`)
- `types.ts` — TranCode, CmdStatus, DatacapConfig, DatacapResponse, all enums
- `constants.ts` — TRAN_CODES, ERROR_CODES, CARD_TYPE_MAP, cloud URLs, ports
- `xml-builder.ts` — buildRequest(), buildAmountBlock(), buildGratuityBlock()
- `xml-parser.ts` — parseResponse(), parseError(), extractTag(), extractCardLast4()
- `client.ts` — DatacapClient class with all transaction methods + withPadReset wrapper
- `sequence.ts` — getSequenceNo(), updateSequenceNo() per reader
- `simulator.ts` — simulateResponse() for testing without hardware
- `discovery.ts` — UDP device discovery on port 9001
- `helpers.ts` — getDatacapClient(), requireDatacapClient(), validateReader()

#### Sprint 1 — Phase 2: API Routes (`src/app/api/datacap/`)
12 routes: sale, preauth, capture, increment, adjust, void, return, pad-reset, batch, param-download, device-prompt, collect-card

#### Sprint 2 — Phase 3: UI Integration
- `useDatacap.ts` — Full rewrite routing through /api/datacap/* routes
- `DatacapPaymentProcessor.tsx` — Added locationId + tipMode props
- `PaymentModal.tsx` — Datacap field passthrough (recordNo, sequenceNo, etc.)
- `orders/[id]/pay/route.ts` — Accept real Datacap auth data
- `payment-readers/[id]/ping/route.ts` — EMVPadReset instead of broken /v1/device/info
- `payment-readers/[id]/verify/route.ts` — Uses real Datacap protocol

#### Sprint 2 — Phase 4: Bar Tab Integration
- Schema: `OrderCard` model for multi-card tabs + tab fields on Order
- 5 API routes: open-tab, cards, close-tab, auto-increment, void-tab
- 3 components: PendingTabAnimation, MultiCardBadges, CardFirstTabFlow
- TabsPanel: pending tab shimmer, card badges, bottle service banner
- Auto-increment fire-and-forget in items route

#### Sprint 2 — Phase 9: Quick Pay
- `TipPromptSelector` — Smart $ vs % based on threshold
- `QuickPayButton` — Single-tap payment flow
- `SignatureCapture` — HTML5 Canvas for chargeback defense

#### Sprint 3 — Phase 5-8: Advanced Features
- Schema: DigitalReceipt, ChargebackCase, CardProfile, WalkoutRetry models
- Settings: walkout retry, card recognition, digital receipts
- API routes: walkout-retry, receipts, chargebacks, card-profiles, mark-walkout
- Card recognition fire-and-forget in sale route

#### Sprint 4 — Phase 10: Bottle Service
- Schema: BottleServiceTier model + Order bottle service fields
- Settings: 4 bottle service settings (enabled, auto-grat, re-auth alert, min spend)
- API routes: tiers CRUD, open bottle service tab, status/progress, re-auth
- Components: BottleServiceTabFlow (tier picker), BottleServiceBanner (spend progress)

#### Sprint 5 — Phase 11: Customer-Facing Display
- `/cfd` route with layout (full-screen black, no nav)
- State machine: idle/order/payment/tip/signature/processing/approved/declined
- 5 components: CFDIdleScreen, CFDOrderDisplay, CFDTipScreen, CFDSignatureScreen, CFDApprovedScreen

#### Sprint 5 — Phase 12: Pay-at-Table
- `/pay-at-table` route for server iPad
- 3 components: TablePayment, SplitSelector, TipScreen

#### Sprint 5 — Phase 13: Bartender Mobile
- `/mobile/tabs` route with mobile layout
- `/mobile/tabs/[id]` detail view
- 2 components: MobileTabCard, MobileTabActions

### Schema Changes
| Model | Action | Notes |
|-------|--------|-------|
| `OrderCard` | Created | Multi-card tab support with recordNo, authAmount, isDefault |
| `DigitalReceipt` | Created | Receipt data + signature for chargeback defense |
| `ChargebackCase` | Created | Chargeback tracking with auto-match to orders |
| `CardProfile` | Created | Repeat customer tracking by hashed card ID |
| `WalkoutRetry` | Created | Auto-retry schedule for walkout tabs |
| `BottleServiceTier` | Created | Tiered packages with deposit + minimum spend |
| `Order` | Modified | Added tabNickname, tabStatus, isBottleService, bottleService*, isWalkout, walkout* fields |
| `PaymentReader` | Modified (prior) | lastSequenceNo, deviceType, communicationMode, cloud credentials |
| `Payment` | Modified (prior) | datacapRecordNo, datacapSequenceNo |

### Settings Added (`PaymentSettings`)
- Bar tab: incrementThresholdPercent, incrementAmount, autoIncrementEnabled, maxTabAlertAmount
- Quick Pay: quickPayEnabled, tipDollarAmountThreshold, tipDollarSuggestions, tipPercentSuggestions, requireCustomForZeroTip
- Walkout: walkoutRetryEnabled, walkoutRetryFrequencyDays, walkoutMaxRetryDays, walkoutAutoDetectMinutes
- Card Recognition: cardRecognitionEnabled, cardRecognitionToastEnabled
- Digital Receipts: digitalReceiptRetentionDays, requireSignatureAbove
- Bottle Service: bottleServiceEnabled, bottleServiceAutoGratuityPercent, bottleServiceReAuthAlertEnabled, bottleServiceMinSpendEnforced

### Socket Event Types Created (`src/types/multi-surface.ts`)
- CFD events: show-order, payment-started, tip-prompt, signature-request, processing, approved, declined, idle, tip-selected, signature-done, receipt-choice
- Pay-at-Table events: pay-request, pay-result, split-request, split-result
- Mobile events: tab-close-request, tab-closed, tab-status-update, tab-transfer-request, tab-alert-manager

### Pending Work
- Wire Socket.io events to CFD/Mobile pages (currently scaffolded, not connected)
- CFD terminal pairing (admin pairs CFD device to terminal)
- Mobile device authentication (PIN-based session)
- Batch close admin UI (settings page section)
- Tip adjustment report (list today's sales with RecordNo, adjust tips)
- Reader health dashboard (avgResponseTime, successRate trending)
- Chargeback auto-notification (TSYS MREPORT API integration — future)
- Customer merge (CardProfile → Customer via phone number — future)

### Resume Tomorrow
1. Say: `PM Mode: Payments`
2. Review PM Task Board for assigned tasks
3. Review this changelog
4. Wire Socket.io for CFD/Mobile if needed
5. Test Datacap with real device when hardware available
