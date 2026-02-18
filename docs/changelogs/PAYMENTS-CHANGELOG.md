# Payments Domain Changelog

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
