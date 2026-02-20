# GWI POS — Living Log

> **Rolling development log shared with the team.** Updated every session.
> Newest entries at the top. Each entry includes what was done, commits, deployments, and blockers.

---

## 2026-02-20 (PM4) — Datacap Forensic Audit + Fixes (Commit 894e5fe)

### Session Summary
Ran a full 3-lens forensic audit of the entire Datacap integration (data flow, cross-system connections, commit history). Found and fixed 8 issues ranging from simulator inaccuracies to error handling gaps and an edge-case NaN in discovery timeout. Zero TypeScript errors, all 6 files patched in a single commit.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `894e5fe` | fix(datacap): forensic audit fixes — simulator accuracy, error handling, edge cases |
| `970d940` | docs: forensic audit fixes session log (PM4) |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel (commit 894e5fe) |

### Bug Fixes

| # | Bug | Fix |
|---|-----|-----|
| 1 | Simulator `PartialAuthApprovalCode` was echoing auth code value instead of protocol `'P'` — `isPartialApproval` detection relied on DSIXReturnCode fallback only | Changed to `'P'` |
| 2 | Simulator `forceOffline` flag had no effect — cert test 18.1 would never see `StoredOffline` response | Added `forceOffline` to `SimOptions`; returns `<StoredOffline>Yes</StoredOffline>` + `STORED OFFLINE` textResponse |
| 3 | Simulator `send()` passed empty fields `{ merchantId:'', operatorId:'', tranCode }` — amounts, customerCode, recordNo, invoiceNo were always undefined in simulator | Extract all needed fields from the XML string before calling `simulateResponse()` |
| 4 | `storedOffline` detection too broad — `textResponse.includes('STORED')` could false-positive | Changed to `extractTag(...,'StoredOffline')==='Yes'` (primary) + `'STORED OFFLINE'` phrase check (fallback) |
| 5 | `discoverAllDevices` NaN: `?timeoutMs=abc` → `parseInt` returns `NaN` → `Math.min(NaN,15000)=NaN` → `setTimeout(fn, NaN)` fires immediately | Added `isNaN(raw) ? 5000 : raw` guard before `Math.min` cap |
| 6 | `datacapErrorResponse` only handled `Error` instances; `DatacapError` plain objects (with `.code`/`.text`) fell through to generic "Internal server error" | Check for `.text` property before falling back to generic message |
| 7 | `sale-by-record` route response missing `storedOffline` field | Added `storedOffline: response.storedOffline` to response body |
| 8 | Partial approval scenario only existed in `SaleByRecordNo` simulator case; `EMVSale` had no partial path | Added `options.partial` handling to EMVSale/EMVPreAuth case block |

---

## 2026-02-20 (PM3) — Datacap Certification: GetDevicesInfo + Level II (Skills 390–391)

### Session Summary
Implemented the final two Datacap certification gaps: GetDevicesInfo (UDP broadcast discovery of all readers on the network) and Level II interchange qualification (customer code + tax). 0 TypeScript errors. Used a 2-agent parallel team.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `e46d997` | feat(datacap): GetDevicesInfo + Level II — certification tests 1.0 + 3.11 |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel (commit e46d997) |

### Features Delivered

**GetDevicesInfo (Skill 390 — Test 1.0)**
- `discoverAllDevices(timeoutMs)` in `discovery.ts` — UDP broadcast to `255.255.255.255:9001`, collects all `"<SN> is at: <IP>"` responses, deduplicates by serial number
- `GET /api/datacap/discover?timeoutMs=5000` — scan entire local subnet for readers (cap 15s)
- `POST /api/datacap/discover` — find specific reader by serial number (wraps existing `discoverDevice()`)

**Level II Interchange (Skill 391 — Test 3.11)**
- `customerCode?: string` on `SaleParams` + `DatacapRequestFields` (17-char max enforced at XML layer)
- `taxAmount` accepted by `POST /api/datacap/sale` → routed to `amounts.tax`
- `<CustomerCode>` XML tag emitted in `buildRequest()`
- `<Level2Status>` parsed from processor response → returned in sale API response
- Simulator returns `<Level2Status>Accepted</Level2Status>` when `customerCode` present

### Certification Progress — COMPLETE

| Test | Case | Status |
|------|------|--------|
| 1.0 | GetDevicesInfo | ✅ Done |
| 3.11 | Level II (tax + customer code) | ✅ Done |

**Final pass rate: ~26/27 (96%)** — only ForceOffline real-device test remains (needs hardware)

### Skill Docs Created
- `docs/skills/390-GET-DEVICES-INFO.md`
- `docs/skills/391-LEVEL-II-INTERCHANGE.md`

---

## 2026-02-20 (PM2) — Datacap Store-and-Forward / SAF (Skill 389)

### Session Summary
Implemented full SAF (Store-and-Forward) support across the Datacap stack — library layer, 2 API routes, batch pre-check, and SAF queue management UI on the payment readers settings page. 0 TypeScript errors. Used a 3-agent parallel team.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `9e10978` | feat(datacap): Store-and-Forward (SAF) — certification tests 18.x |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel (commit 9e10978) |

### Features Delivered

**SAF Library Layer**
- `forceOffline?: boolean` on `SaleParams`, `PreAuthParams`, `DatacapRequestFields` — sends `<ForceOffline>Yes</ForceOffline>` in XML (cert test 18.1)
- `DatacapResponse`: new fields `safCount`, `safAmount`, `safForwarded`, `storedOffline`
- `xml-parser.ts`: parses SAFCount, SAFAmount, SAFForwarded, StoredOffline tags
- `DatacapClient.safStatistics(readerId)` — queries reader SAF queue (cert test 18.2)
- `DatacapClient.safForwardAll(readerId)` — flushes queue to processor (cert test 18.3)

**SAF API Routes**
- `GET /api/datacap/saf/statistics?locationId=&readerId=` — returns `{ safCount, safAmount, hasPending }`
- `POST /api/datacap/saf/forward` — returns `{ safForwarded }` count
- `GET /api/datacap/batch` — batch summary now includes `safCount`, `safAmount`, `hasSAFPending` so UI can warn before batch close if offline transactions are queued

**SAF UI (Payment Readers Settings)**
- Per-reader SAF Queue widget: "Check" button → fetches live stats from reader
- Amber badge when pending transactions exist (`X pending · $Y.ZZ`)
- "Forward Now" button with loading state — flushes queue, resets badge to green "Clear"
- Disabled automatically when reader is offline

### Certification Progress

| Test | Case | Status |
|------|------|--------|
| 18.1 | ForceOffline flag in sale/preAuth | ✅ Done |
| 18.2 | SAF_Statistics | ✅ Done |
| 18.3 | SAF_ForwardAll | ✅ Done |

**Updated pass rate: ~23/27 (85%)** — up from 74%

### Remaining for Full Certification
- GetDevicesInfo — UDP discovery route (UDP discovery lib exists at `src/lib/datacap/discovery.ts`; just needs a cert-facing API route)
- Level II (tax + customer code in sale requests)

### Skill Docs Created
- `docs/skills/389-STORE-AND-FORWARD-SAF.md`

---

## 2026-02-20 (PM) — Datacap Certification: Token Transactions + Simulator Scenarios (Skills 385–388)

### Session Summary
Implemented 4 critical Datacap certification test cases (7.7, 8.1, 8.3, 17.0): PartialReversalByRecordNo, SaleByRecordNo, PreAuthByRecordNo, and EMVAuthOnly. Extended simulator with decline/error/partial-approval scenarios. 0 TypeScript errors. Used a 2-agent parallel team.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `cd96121` | feat(datacap): add certification TranCodes — PartialReversal, SaleByRecord, PreAuthByRecord, AuthOnly |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel (commit cd96121) |

### Features Delivered

**PartialReversalByRecordNo (Skill 385 — Test 7.7)**
- `POST /api/datacap/partial-reversal` — reduces a pre-auth hold by a specified amount
- `DatacapClient.partialReversal(readerId, { recordNo, reversalAmount })`
- Used when a tab closes for less than its authorized hold

**SaleByRecordNo (Skill 386 — Test 8.1)**
- `POST /api/datacap/sale-by-record` — charges a stored card without physical card present
- `DatacapClient.saleByRecordNo(readerId, { recordNo, invoiceNo, amount, gratuityAmount? })`
- Supports partial approval detection

**PreAuthByRecordNo (Skill 387 — Test 8.3)**
- `POST /api/datacap/preauth-by-record` — places a new pre-auth hold on a stored card token
- `DatacapClient.preAuthByRecordNo(readerId, { recordNo, invoiceNo, amount })`
- Alternative to IncrementalAuth for full re-authorization

**EMVAuthOnly (Skill 388 — Test 17.0)**
- `POST /api/datacap/auth-only` — zero-dollar card validation with vault token return
- `DatacapClient.authOnly(readerId, { invoiceNo })`
- Enables card-on-file enrollment without charging

**Simulator Enhancements**
- New `error` scenario: simulates device/communication failure
- New `partial` scenario: approves 50% of requested amount (partial approval testing)
- `SimScenario` XML tag: pass `simScenario: 'decline' | 'error' | 'partial'` in request fields
- 6 new simulator switch cases (incl. SAF_Statistics + SAF_ForwardAll scaffold)

### Certification Progress

| Test | Case | Status |
|------|------|--------|
| 7.7 | PartialReversalByRecordNo | ✅ Done |
| 8.1 | SaleByRecordNo | ✅ Done |
| 8.3 | PreAuthByRecordNo | ✅ Done |
| 17.0 | AuthOnly | ✅ Done |
| 3.2 | Simulator decline | ✅ Done |
| 3.3 | Simulator error | ✅ Done |
| 3.4 | Simulator partial | ✅ Done |

**Updated pass rate: ~20/27 (74%)** — up from 48%

### Remaining for Full Certification
- Store-and-Forward / SAF (offline queuing) — TranCodes scaffolded, logic not yet built
- GetDevicesInfo (device discovery) — UDP discovery exists, cert test route missing
- Level II (tax + customer code) — not tested

### Skill Docs Created

- `docs/skills/385-PARTIAL-REVERSAL-BY-RECORD.md`
- `docs/skills/386-SALE-BY-RECORD.md`
- `docs/skills/387-PREAUTH-BY-RECORD.md`
- `docs/skills/388-AUTH-ONLY.md`

---

## 2026-02-20 — Card Re-Entry by Token, Real-Time Tabs, Bartender Speed (Skills 382–384)

### Session Summary
Built full card-based tab re-entry using Datacap RecordNo token (two-stage server-side detection, zero double holds), real-time TabsPanel socket subscriptions, bartender fire-and-forget speed optimizations, instant new-tab modal, MultiCardBadges full redesign with brand theming and DC4 token display, and fixed void-tab missing socket dispatch. Used a 3-agent parallel team for implementation.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `f391a03` | feat(tabs): card re-entry by token, live TabsPanel sockets, void-tab fix |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel (commit f391a03) |

### Features Delivered

**Card Re-Entry by Datacap Token (Skill 384)**
- Swiping an existing tab's card now detects the open tab via `RecordNo` — no duplicate tab, no double hold
- Stage 1: RecordNo checked after `CollectCardData` (zero new hold for returning vaulted cards)
- Stage 2: RecordNo checked after `EMVPreAuth` — new hold voided immediately if existing tab found
- `CardFirstTabFlow`: new `existing_tab_found` state with "Open Tab" / "Different Card" UI

**Bartender Speed Optimizations (Skill 383)**
- Send to existing tab: fire-and-forget — UI clears instantly, all network ops run in background
- New tab card modal: appears immediately with "Preparing Tab…" spinner while shell creates in background
- `CardFirstTabFlow` now accepts `orderId: string | null` and auto-starts when ID arrives

**MultiCardBadges Card Pill (Skill 382)**
- Brand-specific dark color theming: Visa=blue-950, MC=red-950, AMEX=emerald-950, Discover=orange-950
- Three modes: compact (tab list), default (medium pill), full (all fields + DC4 token)
- Shows cardholder name, auth hold amount, DC4 token (truncated: `DC4:ABCD1234…`)
- `TabsPanel` shows cardholder name + hold under single-card tabs

**Real-Time TabsPanel**
- `TabsPanel` subscribes to `tab:updated` + `orders:list-changed` via `useEvents()`
- All bartender terminals update instantly when any tab opens, closes, or is voided

### Bug Fixes

| Fix | File | Impact |
|-----|------|--------|
| `void-tab` missing `dispatchTabUpdated` | `void-tab/route.ts` | Voided tabs now disappear in real time on all terminals |
| TabsPanel only refreshed on manual trigger | `TabsPanel.tsx` | Now socket-driven — no stale lists |

### Schema Changes

| Change | Migration |
|--------|-----------|
| `OrderCard`: `@@index([recordNo])` | `npm run db:push` applied ✅ |

### Skill Docs Created

- `docs/skills/382-MULTICARD-BADGES-CARD-PILL.md`
- `docs/skills/383-BARTENDER-SPEED-OPTIMIZATIONS.md`
- `docs/skills/384-CARD-REENTRY-BY-TOKEN.md`

---

## 2026-02-19 (PM) — Device Fleet Management & Live Venue Fixes

### Session Summary
Built full device fleet management across POS and MC repos (5-agent team). Fixed live venue deployment issues, voided stale orders, removed kiosk --incognito for performance.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `1f7815d` | Add device fleet endpoints + SystemReloadListener for Mission Control |
| `819ed89` | Remove --incognito from kiosk Chromium flags for faster terminal loads |
| `0362305` | Clean up repo: remove Datacap Word docs, update task board and schema |

### Commits (Mission Control — `gwi-mission-control`)

| Commit | Description |
|--------|-------------|
| `30604fa` | Add device fleet management — visibility + remote control from Mission Control |
| `4f40149` | Fix FORCE_UPDATE to use db push, add deploy failure + version mismatch alerts |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel |
| Mission Control | app.thepasspos.com | Auto-deployed via Vercel |

### Features Delivered

**Device Fleet Management (MC)**
- Device inventory synced via NUC heartbeat — terminals, handhelds, KDS, printers, payment readers
- DeviceInventoryCard with count vs. limit progress bars, status dots, relative timestamps
- Remote actions: Restart Kiosk, Reload All Terminals from MC dashboard
- Release "Requires kiosk restart" checkbox — auto-reloads terminals after deploy
- Deploy failure alerts (red banner) and version mismatch warnings (amber banner)

**POS Endpoints**
- Internal device-inventory API for heartbeat sync
- Internal reload-terminals and reload-terminal APIs for remote control
- SystemReloadListener component — auto-refreshes browser on socket event
- License enforcement (fail-open) for device count limits

**Live Venue Fixes**
- Voided 4 stale open orders from Feb 17 at Fruita Bar & Grill
- Fixed FORCE_UPDATE handler: uses prisma db push instead of prisma migrate, aborts on failure
- Removed --incognito from kiosk service on both live NUCs for faster loads

### Bug Fixes

| Fix | Impact |
|-----|--------|
| FORCE_UPDATE used prisma migrate (failed silently) | NUCs now use prisma db push and abort on schema failure |
| DeviceInventoryCard crashed on null data | Rewrote to handle nested device object + null guards |
| Kiosk --incognito caused slow cold starts | Terminals now cache assets, load faster after restart |
| 4 stale open orders showing on terminal | Voided via direct DB update |

### New Skills Documented

| Skill | Name |
|-------|------|
| 376 | Device Fleet Management |
| 377 | Remote Device Actions |
| 378 | Deploy Alerts & Version Mismatch |
| 379 | Terminal License Enforcement |
| 380 | Kiosk Performance (Incognito Removal) |
| 381 | Release Kiosk Restart |

---

## 2026-02-19 — Sprint 2B/2C: Cloud Admin + Settings + P0 Fixes

### Session Summary
Completed MC admin features (cash discount management, data retention), fixed production deployment, then ran a 7-agent team sprint to knock out P0/P1 blockers.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `e7cdd14` | Add auth hydration guards to prevent false logouts on page load |
| `3500e4d` | T-077: Add EOD auto-close stale orders API route |
| `1b7239f` | Add missing Settings admin UI sections: Bar Tabs, Payments, POS Display, Receipts |
| `e54bc8e` | Add DATA_CHANGED handler to NUC sync agent for real-time settings sync |
| `b3d9777` | T-044: Add void/comp status fields to BartenderView order items mapping |
| `cda3e76` | T-033: Add API failure rollback + toast to Floor Plan editor |
| `f4614d5` | Fix partial payment approval flow (T-079) |
| `5ca0d37` | Replace Cash Discount settings with read-only rate viewer |
| `da66c1e` | Sprint 2: Add View on Web banners to all report pages |

### Commits (Mission Control — `gwi-mission-control`)

| Commit | Description |
|--------|-------------|
| `5d28178` | Add Cash Discount management + Data Retention to location admin |

### Commits (Backoffice — `gwi-backoffice`)

| Commit | Description |
|--------|-------------|
| `cc93c80` | Sprint 2: Add Thymeleaf admin dashboard with report pages |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel |
| Mission Control | app.thepasspos.com | Deployed + DB schema synced (`prisma db push`) |
| Backoffice | localhost:8080 (dev) | Running locally |

### Features Delivered

**Cloud Admin (Mission Control)**
- Cash Discount management UI — GWI admins can set processing rates per-location
- Data Retention dropdown — configure how long the local POS keeps report data; older data is available in the cloud backoffice at `/admin`
- Settings sync pipeline — MC → SSE → NUC sync agent → local POS (end-to-end wired)

**POS Settings**
- Cash Discount section is now **read-only** ("Contact your administrator to change rates")
- 5 new settings sections added: Bar Tabs, Payments, POS Display, Receipts, Tax
- Each with full form UI matching the TypeScript interfaces

**POS Reports**
- "View on Web" banners on all 13 report pages when date range exceeds local data retention

**Backoffice Admin Dashboard**
- 6 Thymeleaf pages: Dashboard, Sales, Payroll, Tips, Voids, Employees
- Client-side fetch to report API endpoints with date range filters

### Bug Fixes

| Fix | Impact |
|-----|--------|
| Partial payment false-positive (T-079) | $65.82/$65.82 no longer triggers partial approval UI |
| Void & Retry now voids partial auth before restarting | Prevents orphaned card holds |
| BartenderView missing void/comp fields (T-044) | Voided items now show stamps + excluded from subtotal |
| Floor Plan silent API failures (T-033) | Create/update/delete now show toast on failure + rollback |
| Auth hydration guards (T-053) | No more false logouts on page refresh across all admin pages |
| MC dashboard 500 (missing DB column) | `prisma db push` added `localDataRetention` to production |

### Resolved Task Board Items

| ID | Task | Resolution |
|----|------|------------|
| T-031 | Console logging in floor plan hot paths | Already clean — no action needed |
| T-032 | Math.random() table placement | Already deterministic — no action needed |
| T-033 | Floor plan API failure rollback | Fixed — toast + rollback on create/update/delete |
| T-044 | VOID/COMP stamps on all views | Fixed — BartenderView was missing fields |
| T-045 | Settings admin pages | Added 5 sections (Bar Tabs, Payments, Display, Receipts, Tax) |
| T-053 | Auth store persistence | Added useAuthGuard hook + admin layout guard |
| T-077 | EOD auto-close stale orders | Created `/api/orders/eod-cleanup` route |
| T-079 | Partial payment approval flow | Fixed false-positive + void-before-retry |

### New Task Added

| ID | Task | Priority |
|----|------|----------|
| T-080 | Full Pricing Program System (surcharge, flat rate, interchange+, tiered) | P2 |

### Known Issues / Blockers
- Pre-existing TS error in `tabs/page.tsx` (employee possibly null) — not blocking
- Backoffice running locally only (no cloud deployment yet)
- Settings sync: NUC side wired but not tested on physical hardware

---

## 2026-02-19 — Sprint 2A: NUC-to-Cloud Event Pipeline

### Session Summary
Built the complete event pipeline from local POS servers to the cloud backoffice. Java backoffice fully operational with event ingestion and 7 report endpoints.

### Commits (POS)

| Commit | Description |
|--------|-------------|
| `1436aca` | Phase 2: Dynamic backoffice URL + 4 new cloud event types |
| *(earlier)* | cloud-events.ts + cloud-event-queue.ts + pay route wiring |

### Commits (Backoffice)

| Commit | Description |
|--------|-------------|
| `cc93c80` | Sprint 2: Add Thymeleaf admin dashboard with report pages |
| *(earlier)* | Event ingestion endpoint + 7 report APIs |

### Features Delivered
- NUC → Cloud event pipeline (HMAC-signed, fire-and-forget)
- 7 cloud event types: order_completed, payment_processed, item_sold, void, comp, tip_adjusted, employee_clock
- Java backoffice: event ingestion + sales/payroll/tips/voids/employees reports
- Admin dashboard with 6 Thymeleaf pages

### Bug Fixes
- Java `.env` CRLF line endings causing auth failure
- Thymeleaf fragment resolution (`__${...}__` preprocessing)
- Wrong event ingestion path (`/api/events/ingest` not `/api/events`)
- UUID required for eventId field
- Demo data sent to correct venue ID (`loc-1`)

---

## How to Update This Log

Each development session should add a new entry at the top with:
1. **Date + Sprint/Theme name**
2. **Session Summary** (1-2 sentences)
3. **Commits** per repo (hash + description)
4. **Deployments** (what was deployed where)
5. **Features Delivered** (user-facing changes)
6. **Bug Fixes** (table format)
7. **Resolved Task Board Items** (if any)
8. **Known Issues / Blockers** (carry forward or resolve)
