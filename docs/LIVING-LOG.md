# GWI POS — Living Log

> **Rolling development log shared with the team.** Updated every session.
> Newest entries at the top. Each entry includes what was done, commits, deployments, and blockers.

---

## 2026-02-20 — Go-Live Blocker Sprint + P1 Critical Fixes + P2 Features (Multi-Agent Team)

**Session theme:** Full-team audit and fix sprint — go-live blockers, P1 payment bugs, EOD cron, auth hardening, new report pages, bottle service auto-grat

**Summary:** 9-agent multi-agent team sprint. 11 MASTER-TODO items confirmed already implemented (no build needed). GL-08 inventory bugs fixed. 3 P1-01 payment bugs patched. EOD stale-order cleanup built. Auth hydration guard deployed across all admin pages. P2-P03 batch close UI, P2-P04 tip adjustment report, P2-R02 labor cost report, and P2-B01 auto-grat all built and shipped.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `35224cd` | Fix go-live blockers and P1 payment bugs — multi-agent sprint 2026-02-20 |
| `f51f2a6` | Add Tip Adjustment Report page (P2-P04) |
| `a0b8259` | Add Labor Cost % report page (P2-R02) |
| `dc95f38` | Fix deployment: Decimal→number type error in helpers.ts + auth guard + P2-B01 auto-grat |

### Deployments
- gwi-pos → pushed to `origin/main` (Vercel auto-deploy on each commit)

### Features Delivered
- **GL-05:** Floor plan API failure rollback — 3 mutation gaps closed in `FloorPlanEditor.tsx` (handleReset, handleRegenerateSeats force callback, 2 section create handlers)
- **GL-08 Fix 1:** Liquor void deduction — added `recipeIngredients` processing to `src/lib/inventory/void-waste.ts` (was missing for all liquor items voided with wasMade=true)
- **GL-08 Fix 2:** Multiplier 0 fallback bug — fixed all 3 multiplier getters in `src/lib/inventory/helpers.ts` (`||` → explicit null/undefined check + `Number()` wrap on fallback)
- **P1-01 Fix 1:** Removed double-fire of onPartialApproval from `DatacapPaymentProcessor.tsx` (auto-fire in onSuccess removed; only button click fires it)
- **P1-01 Fix 2:** Fixed tip double-counting in `PaymentModal.tsx` partial approval pending payment (`tipAmount: 0` for partials)
- **P1-01 Fix 3:** Fixed false-positive partial detection in `useDatacap.ts` — added `purchaseAmount` param so tip is excluded from partial detection math
- **P1-04:** Built `POST /api/system/cleanup-stale-orders` + EOD scheduler (setTimeout chain, 4 AM daily, NUC-only via `POS_LOCATION_ID` env)
- **P1-06:** Created `src/hooks/useAuthenticationGuard.ts` shared hook + applied to all authenticated admin/POS pages (prevents false logout on refresh)
- **P2-P03:** Added Batch Management card to `/settings/payments` — shows batch summary, SAF queue status, Close Batch button with confirmation
- **P2-P04:** Built `/reports/tip-adjustments` page + `/api/payments/tip-eligible` endpoint — date range filters, editable tip column, CSV export
- **P2-R02:** Built `/reports/labor` page — labor cost %, hours worked, overtime, by-employee/by-day/by-role tabs
- **P2-B01:** Wired `autoGratuityPercent` into `close-tab` route — looks up `BottleServiceTier`, applies auto-grat when no explicit tip is set

### Inventory Tests Added
- `src/lib/inventory/__tests__/helpers.test.ts` — 54 Vitest unit tests
- `src/lib/inventory/__tests__/deduction.test.ts` — 13 Vitest integration tests (Prisma mocked)
- `vitest.config.ts` — new test framework config
- All 67/67 tests passing

### Already-Built Discoveries (no build needed)
- **GL-01:** `simulated-defaults.ts` never existed; `SIMULATED_DEFAULTS` not in code
- **GL-02:** `/settings/payments` already has all 8 required config cards
- **GL-03:** Logger utility is production-stripped (no raw console.log in render paths)
- **GL-04:** Deterministic grid placement already in `POST /api/tables`
- **GL-07:** VOID/COMP stamps verified working on all 3 views (FloorPlanHome, BartenderView, orders/page)
- **P1-02:** House Accounts fully wired in PaymentModal — just feature-toggled off (`acceptHouseAccounts: false`)
- **P2-E01:** Bar Tab Settings UI complete at `/settings/tabs`
- **P2-P01:** Split payments fully built (schema + API + UI)
- **P2-R02 API:** `/api/reports/labor` already existed
- **P2-P03 API:** `/api/datacap/batch` already existed

### Bug Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Liquor void items not deducting inventory | `deductInventoryForVoidedItem` only processed `ingredientId` direct link, skipped `recipeIngredients` | Added recipe ingredient loop with multiplier scaling in `void-waste.ts` |
| Multiplier 0 treated as missing | `getMultiplier() \|\| 1.0` coerced valid 0 (for "NO" instruction) to 1.0 | Changed to explicit null/undefined check + `Number()` wrap in `helpers.ts` |
| Failed Vercel deployment | `DEFAULT_MULTIPLIERS` fields are Prisma `Decimal` type — fallback path returned raw `Decimal` instead of `number` | Wrapped all 3 fallbacks in `Number()` in `helpers.ts` lines 82, 91, 99 |
| Partial approval double-fire | `onSuccess` callback auto-fired `onPartialApproval` AND button click also fired it | Removed auto-fire from `onSuccess`; only manual button triggers it |
| Tip double-counted in partial payments | Pending payment included `tipAmount` when recording partial | Set `tipAmount: 0` for partial approval pending payments |
| False-positive partial detection | Tip amount included in approved vs requested comparison | Added `purchaseAmount` param to exclude tip from partial math |
| Floor plan mutations silently fail | 3 mutation paths lacked API failure rollback | Added rollback logic to handleReset, handleRegenerateSeats, section create |

### Known Issues
- P1-03 (House Accounts Aging Report) confirmed not built — queued for next sprint
- P2-R01 (Closed Orders UI) confirmed not built — queued for next sprint
- 3 pre-existing Decimal type issues in `src/lib/inventory/helpers.ts` unrelated to this sprint (now resolved by `Number()` wrapping fix)

---

## 2026-02-20 — DC Direct Payment Reader Architecture (Skill 407)

**Session theme:** Establish correct DC Direct payment terminal architecture and fix simulated routing

**Summary:** Discovered VP3350 USB cannot work standalone with DC Direct (DC Direct is firmware on networked terminals like PAX A920/Ingenico, not NUC middleware). Hardened MID credential flow (server-reads from location settings, never from client). Fixed useDatacap hook to detect simulated mode via `communicationMode === 'simulated'` in addition to `paymentProvider === 'SIMULATED'`. User will procure PAX/Ingenico terminals per station. Current dev setup routes through simulated readers.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `e2d1d58` | feat(payments): DC Direct payment reader architecture + credential flow |

### Deployments
- gwi-pos → pushed to `origin/main`

### Architecture Decision
- **DC Direct is firmware on the payment terminal** (PAX A920 Pro, PAX A920 Max, PAX IM30, Ingenico DX8000, PamiPOP+VP3350). Nothing is installed on the Ubuntu NUC for payment hardware.
- POS sends `POST http://{terminal-ip}:8080/ProcessEMVTransaction` on local network
- VP3350 USB sled alone cannot work with DC Direct on Ubuntu — it requires PamiPOP (Android display) or a Windows PC with dsiEMVUS
- Each POS station will pair with a networked PAX/Ingenico terminal

### Features Delivered
- `connectionType` field on PaymentReader (`USB | IP | BLUETOOTH | WIFI`)
- `ipAddress` defaults to `127.0.0.1` for USB/BT readers
- MID credential never accepted from client — always read from location settings
- `communicationMode` exposed on terminal config endpoint
- Bolt ⚡ button on reader cards for EMVParamDownload (first-time init)
- Cloud proxy routes for future TranCloud mode (`/api/hardware/payment-readers/[id]/cloud/`)
- useDatacap hook detects simulated via reader's communicationMode, not just terminal's paymentProvider

### Bug Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| VP3350 using simulated flow despite DATACAP_DIRECT terminal | Hook only checked `paymentProvider === 'SIMULATED'`; DATACAP_DIRECT + USB reader tried `http://127.0.0.1:8080` (nothing there) | Added `|| reader.communicationMode === 'simulated'` to simulated detection |
| Hardcoded MID in payment readers page | `DATACAP_TEST_MID = 'SSBLGFRUI0GP'` baked into page.tsx | Removed — MID reads from `location.settings.payments.datacapMerchantId` server-side |
| USB readers defaulted to cloud communicationMode | `rawMode ?? 'cloud'` for non-network types | Changed default to `'local'` for all connection types |

### DB State (dev)
- VP Reader 1 (USB/127.0.0.1): `communicationMode: 'simulated'`, `isActive: true`
- Simulated Card Reader: `communicationMode: 'simulated'`, `isActive: true`
- Main Terminal → assigned to VP Reader 1 (routes to simulated)

### Skills
- Skill 407: DC Direct Payment Reader Architecture

---

## 2026-02-20 — Admin Venue Access Fix

**Session theme:** Fix GWI admin one-click access to venue POS admin panels

**Summary:** Diagnosed and fixed two bugs causing GWI admins to be redirected to /admin-login on every MC → venue access attempt. The cloud auth client was calling login(undefined) due to a data envelope mismatch. Also added a prominent "Open Admin (authenticated)" button to the VenueUrlCard in Mission Control so the JWT handoff flow is easily discoverable from the main location detail page.

### Commits

| Repo | Hash | Description |
|------|------|-------------|
| gwi-pos | `460da99` | Fix cloud auth client — unwrap { data: { employee } } envelope |
| gwi-mission-control | `5e449ec` | Add Open Admin button to VenueUrlCard → /pos-access/{slug} |

### Deployments
- gwi-pos → Vercel (barpos.restaurant / *.ordercontrolcenter.com)
- gwi-mission-control → Vercel (app.thepasspos.com)

### Features Delivered
- GWI admins can now click "Open Admin (authenticated)" on any location in MC and land directly in the venue admin panel with no login prompt
- 8-hour session — no re-login required during a working session

### Bug Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Bounced to /admin-login after MC handoff | `login(data.employee)` — API returns `{ data: { employee } }`, so `data.employee` was `undefined`; Zustand store empty despite valid cookie | Changed to `login(data.data?.employee)` in `/auth/cloud/page.tsx` |
| VenueUrlCard "Open" sent to plain URL | `href={venueUrl}` opened `https://{slug}.ordercontrolcenter.com` — no auth token → middleware redirect to admin-login | Added "Open Admin (authenticated)" button `href="/pos-access/{slug}"` |

### Skills
- Skill 405: Cloud Auth Client Fix
- Skill 406: MC Admin Venue Access

---

## 2026-02-20 — Business Day Tracking + Previous Day Orders UX

**Session theme:** Accurate business-day attribution for orders + previous-day stale tab improvements

**Summary:** Fixed open orders panel to respect the venue's business day rollover time. Added Previous Day filter, stale-tab date badges, and count chip. Introduced `businessDayDate` field on orders so revenue lands on the day a tab is closed (not opened), with promotion on item-add and pay. Updated all 10 report routes.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `c7af5ef` | Fix open orders business day filter — was showing all open orders regardless of date |
| `4687312` | Previous Day open orders: server-side fetch, date badge on stale cards, count chip |
| `e2bf8e5` | Add businessDayDate to orders — revenue reports on payment day, not open day |

### Deployments
- gwi-pos → Vercel (barpos.restaurant / *.ordercontrolcenter.com) — pushed e2bf8e5

### Features Delivered
- Open orders panel now filters by current business day (respects 4 AM rollover)
- "Previous Day" chip shows count of stale open tabs
- Stale order cards show "📅 Feb 19 · 5:33 PM" badge so servers know when a tab was opened
- Previous-day tabs that get touched (item added) automatically promote to Today
- Revenue always reported on the day an order is paid, not the day it was opened
- All 10 report routes updated for accurate business-day attribution

### Bug Fixes

| Bug | Fix |
|-----|-----|
| Open orders showed yesterday's orders | Added businessDayStart filter to /api/orders/open |
| Snapshot count badge showed 3 but panel showed 0 | Added businessDayStart filter to snapshot.ts count |
| EOD reset used hardcoded 24h window | Replaced with getCurrentBusinessDay() boundary |
| Previous Day filter showed nothing | Fixed: now fetches ?previousDay=true from API |
| Revenue on wrong day when tab spans midnight | Fixed: businessDayDate promotes to payment day |

### Skills
- Skill 402: Open Orders Business Day Filter
- Skill 403: Previous Day Open Orders Panel
- Skill 404: Business Day Date on Orders

---

## 2026-02-20 — Self-Updating Sync Agent + Batch Monitoring + Auto-Reboot (Skills 399-401)

**Session Summary:** Built three interconnected infrastructure features: the sync agent now self-updates on every deploy (no more SSH-to-fix-NUCs), Mission Control now shows live batch status per venue (with unadjusted tip warnings and 24h no-batch alerts), and servers can automatically reboot after the nightly Datacap batch closes.

### Commits

| Repo | Hash | Description |
|------|------|-------------|
| gwi-pos | a38a8cf | feat(sync): self-updating sync agent + batch monitoring + auto-reboot |
| gwi-mission-control | cde2cc9 | feat(batch): batch monitoring, auto-reboot, and fleet alerts |

### Deployments
- gwi-pos → Vercel auto-deploy (triggered by push to main)
- gwi-mission-control → Vercel auto-deploy (triggered by push to main)

### Features Delivered

**Self-Updating Sync Agent (Skill 399)**
- `public/sync-agent.js` extracted from installer.run heredoc into a standalone versioned file
- Every FORCE_UPDATE deploy now automatically copies the new sync agent from the repo and restarts `pulse-sync` 15 seconds after ACK (gives the current process time to confirm success before being replaced)
- New fleet commands: `SCHEDULE_REBOOT` (sudo shutdown -r +N) and `CANCEL_REBOOT` (sudo shutdown -c)
- `installer.run` updated: fresh provisions copy agent from repo instead of embedding it; sudoers adds shutdown + pulse-sync restart permissions

**Batch Monitoring in Mission Control (Skill 400)**
- New `GET /api/system/batch-status` POS endpoint: live open order count, unadjusted tip count, current batch total
- `datacap/batch` POST now writes `/opt/gwi-pos/last-batch.json` after each close
- Heartbeat reports full batch state to MC every 60 seconds
- MC `BatchStatusCard`: green (<26h) / yellow (26-48h) / red (>48h) freshness badge, last batch time + dollar total, open order count, amber "⚠ N orders with unadjusted tips" warning, red 24h no-batch alert
- MC fleet dashboard: compact colored dot + relative time per venue; `⚠ No batch` amber badge when stale

**Auto-Reboot After Batch (Skill 401)**
- MC Config tab: `AutoRebootCard` — toggle + delay minutes (1-60), defaults off / 15 min
- Setting synced to NUC via `DATA_CHANGED` fleet command
- MC heartbeat route: detects new batch close → creates `SCHEDULE_REBOOT` fleet command if setting enabled
- Sync agent executes the reboot on schedule, preventing memory buildup overnight

### Bug Fixes

| Bug | Fix | Commit |
|-----|-----|--------|
| Sync agent never updated on deploys | Extracted to sync-agent.js; FORCE_UPDATE self-copies + restarts pulse-sync | a38a8cf |
| `git pull --ff-only` fails on diverged branches | Already fixed in prior session (621e0b7); batch reports now prevent repeat stuck states | — |

### Known Issues / Blockers
- Two NUCs (Fruita Grill, Shanes Admin Demo) still need one-time manual SSH reset to get onto the new sync agent. All future deploys will be automatic.
- Terminal 5-tap kiosk exit zone not yet implemented (deferred — requires separate terminal agent process).

---

## 2026-02-20 — Datacap Payment Verification Report

**Session Summary:** Built a Payment Verification report so owners can see which card payments went through live, which are sitting in offline/SAF mode, and cross-reference against Datacap's cloud records when a Reporting API key is configured.

### Commits

| Repo | Hash | Description |
|------|------|-------------|
| gwi-pos | af96d3f | feat: add Datacap payment verification report (Skill 398) |

### Deployments
- gwi-pos → `*.ordercontrolcenter.com` (Vercel auto-deploy)

### Features Delivered
- **Payment Verification report** at `/reports/datacap` — new tile in Reports Hub under Operations
- **Status badges**: Live (green), Offline/SAF (yellow), Voided (gray), Refunded (blue) on every card payment
- **Summary cards**: Total card payments, Live count, Offline/SAF count, Voided/Refunded count
- **Date range filters**: Today / Yesterday / This Week quick-select + custom date range
- **Status filter** (All / Live / Offline / Voided) on local payments tab
- **Datacap Reporting V3 integration**: When `DATACAP_REPORTING_API_KEY` env var is set, cross-references each local payment against Datacap's cloud records by auth code — shows Approved/Declined per payment
- **Datacap Cloud tab**: Raw Datacap V3 transaction view (TranCode, amount, card type, auth code, result)
- **Config guidance**: Warning if merchant ID not set; info banner explaining how to add reporting key

### New Files
| File | Purpose |
|------|---------|
| `src/app/api/reports/datacap-transactions/route.ts` | Queries local payments + Datacap V3 API, cross-reference by authCode |
| `src/app/(admin)/reports/datacap/page.tsx` | Full report UI |
| (modified) `src/app/(admin)/reports/page.tsx` | Payment Verification tile added |

### Skills
- **398** — Datacap Payment Verification Report (`docs/skills/398-DATACAP-PAYMENT-VERIFICATION-REPORT.md`)

---

## 2026-02-20 — Password Reset System

**Session Summary:** Built end-to-end password reset flow keeping merchants entirely on {slug}.ordercontrolcenter.com. Venue login page gains forgot/verify modes via Clerk FAPI. MC location detail gains an Owner Access card so GWI admins can trigger resets and share deep-links with merchants.

### Commits

| Repo | Hash | Description |
|------|------|-------------|
| gwi-pos | fdd4bd9 | feat(auth): forgot-password + reset-password flow on venue login page |
| gwi-mission-control | 82624df | feat(owner): send password reset from MC location detail page |

### Deployments
- gwi-pos → `*.ordercontrolcenter.com` (Vercel auto-deploy)
- gwi-mission-control → `app.thepasspos.com` (Vercel auto-deploy)

### Features Delivered
- **"Forgot your password?"** link on venue admin-login page
- **Self-service reset flow** — enter email → 6-digit code from Clerk email → new password, all on venue subdomain
- **`?reset_sid=` deep-link** — URL param drops merchant directly into code-entry step
- **Owner Access card** in MC location detail Overview tab
- **"Send Reset" button** per owner in MC — triggers Clerk reset email, shows copyable deep-link
- **4 new API routes**: `/api/auth/forgot-password`, `/api/auth/reset-password` (POS); `/api/admin/locations/[id]/owners`, `/api/admin/locations/[id]/send-owner-reset` (MC)
- **`OwnerResetCard`** component in MC matching VenueUrlCard dark card styling

### Design Constraint Met
Merchants **never see** `app.thepasspos.com`. Clerk FAPI handles reset server-side (email_code strategy = 6-digit code, no redirect link). Entire flow stays on `{slug}.ordercontrolcenter.com`.

### Skills
- **397** — Password Reset System (`docs/skills/397-PASSWORD-RESET-SYSTEM.md`)

---

## 2026-02-20 — Venue-Local Login + Multi-Venue Owner Routing

**Session Summary:** Built venue-local admin login system to replace broken MC redirect flow, added Clerk credential passthrough (same email+password as Mission Control), and wired in multi-venue owner routing with venue picker UI and cross-domain owner token.

### Commits

| Repo | Hash | Description |
|------|------|-------------|
| gwi-pos | 4f2434d | feat(auth): venue-local admin login — bypass Mission Control redirect |
| gwi-pos | f4947b1 | feat(auth): venue login uses Clerk credentials (Option B) |
| gwi-pos | 7b6bb2f | feat(auth): multi-venue owner routing — venue picker + owner session |
| gwi-mission-control | 74bf036 | feat(owner): GET /api/owner/venues — returns venues for an owner email |
| gwi-mission-control | a4eeaf9 | fix(auth): bypass Clerk for /api/owner/* routes (PROVISION_API_KEY auth) |

### Deployments
- gwi-pos → `*.ordercontrolcenter.com` (Vercel, auto-deploy on push to main)
- gwi-mission-control → `app.thepasspos.com` (Vercel, auto-deploy on push to main)

### Features Delivered
- **Venue admin login page** at `{slug}.ordercontrolcenter.com/admin-login` — no MC redirect required
- **Clerk credential passthrough** — same email+password as Mission Control works on venue login
- **bcrypt fallback** — local employee password used if owner has no Clerk account
- **venue-setup endpoint** — emergency credential bootstrap via `PROVISION_API_KEY`
- **Multi-venue owner detection** — after Clerk auth, checks MC for owner's venue count
- **Venue picker UI** — dark card grid shown when owner has 2+ venues
- **Cross-domain owner token** — 10-minute HMAC-SHA256 JWT carries identity to target venue
- **`/auth/owner` landing page** — validates token, issues venue session, redirects to `/settings`
- **`/api/auth/owner-session`** — server endpoint: validates owner token, issues `pos-cloud-session`
- **MC `/api/owner/venues`** — internal endpoint (PROVISION_API_KEY) returns all venues for an owner email

### Bug Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| `shanes-admin-demo.ordercontrolcenter.com/settings` inaccessible | `app.thepasspos.com` served old deployment missing `/pos-access` routes | Replaced MC redirect with venue-local login (4f2434d) |
| MC `/api/owner/venues` returning 404 | Clerk middleware `auth.protect()` intercepting requests before handler ran | Added `isOwnerApiRoute` bypass in MC middleware (a4eeaf9) |

### Skills
- **395** — Venue-Local Admin Login + Clerk Auth (`docs/skills/395-VENUE-LOCAL-ADMIN-LOGIN.md`)
- **396** — Multi-Venue Owner Routing (`docs/skills/396-MULTI-VENUE-OWNER-ROUTING.md`)

---

## 2026-02-20 (PM5) — Third-Party Audit: Datacap Bulletproofing (Commit 14de60e)

### Session Summary
Implemented all recommendations from a third-party developer audit across 8 sections. Added a per-reader health state machine, hardened all XML builders, locked down API route security, guarded production from simulated mode, and cleaned up logging discipline. 14 files changed (1 new), 0 TypeScript errors.

### Commits (POS — `gwi-pos`)

| Commit | Description |
|--------|-------------|
| `14de60e` | feat(datacap): third-party audit bulletproofing — reader health, security, XML safety |

### Deployments

| App | URL | Status |
|-----|-----|--------|
| POS | barpos.restaurant | Auto-deployed via Vercel (commit 14de60e) |

### Features / Hardening Delivered

**§1 — Reader Lifecycle & Health**
- New `src/lib/datacap/reader-health.ts` — per-reader state machine (`healthy | degraded`)
- `withPadReset` now calls `assertReaderHealthy()` before every transaction — refused if degraded
- Pad reset failure → `markReaderDegraded()` + structured log error (was silent `console.error`)
- Successful pad reset → `markReaderHealthy()` — manual pad-reset route also clears state
- `padResetTimeoutMs` is now configurable in `DatacapConfig` (was hardcoded 5s globally)

**§2/§3 — XML Building & Parsing Safety**
- `validateCustomerCode()` exported from `xml-builder.ts` for upstream route validation
- Dev-mode warning logged when customerCode >17 chars is truncated (silent before)
- `buttonLabels` capped at 4 (Datacap protocol max) — was unbounded
- `SimScenario` XML tag blocked in production (`NODE_ENV=production`) — never reaches wire
- `extractPrintData` bounded: max 36 lines, 500 chars/line (prevents memory blowup on bad payloads)
- `rawXml` stripped in production (`''`) — avoids accumulating response data in prod logs

**§4 — Discovery Hardening**
- `discovery.ts`: hardcoded `port: 8080` → `DEFAULT_PORTS.PAX` (single source of truth)

**§5 — API Route Security**
- `walkout-retry`: malformed JSON now returns `400 Invalid JSON` (was silently `missing walkoutRetryId`)
- `sale` route: card-profile fire-and-forget uses `INTERNAL_BASE_URL` + `x-internal-call` header instead of `NEXT_PUBLIC_BASE_URL`
- Numeric validation normalized: `!amount` → `amount === undefined || amount === null` in 5 routes

**§6 — Logging Discipline**
- Cloud fallback `console.warn` → `logger.warn` with structured context
- `walkout-retry` `console.error` → `logger.error`
- `helpers.ts`: re-exports `getReaderHealth`, `clearReaderHealth`, `ReaderHealth` type

**§7 — Config Hardening**
- `validateDatacapConfig` throws if `communicationMode === 'simulated'` in production

### Files Changed

| File | Change |
|------|--------|
| `src/lib/datacap/reader-health.ts` | NEW — per-reader health state machine |
| `src/lib/datacap/types.ts` | `padResetTimeoutMs` on DatacapConfig; prod guard in validateDatacapConfig |
| `src/lib/datacap/client.ts` | Health integration in withPadReset + padReset; configurable timeout; logger |
| `src/lib/datacap/xml-builder.ts` | Button cap, customerCode warning, SimScenario prod guard, validateCustomerCode |
| `src/lib/datacap/xml-parser.ts` | printData bounds; rawXml stripped in production |
| `src/lib/datacap/discovery.ts` | DEFAULT_PORTS.PAX replaces hardcoded 8080 |
| `src/lib/datacap/helpers.ts` | Re-exports reader health functions |
| `src/lib/datacap/index.ts` | Barrel exports for reader-health module |
| `src/app/api/datacap/walkout-retry/route.ts` | JSON parse hardening; logger migration |
| `src/app/api/datacap/sale/route.ts` | INTERNAL_BASE_URL; numeric validation |
| `src/app/api/datacap/sale-by-record/route.ts` | Numeric validation |
| `src/app/api/datacap/preauth/route.ts` | Numeric validation |
| `src/app/api/datacap/preauth-by-record/route.ts` | Numeric validation |
| `src/app/api/datacap/return/route.ts` | Numeric validation |

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
