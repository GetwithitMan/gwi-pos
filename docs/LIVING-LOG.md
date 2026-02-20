# GWI POS — Living Log

> **Rolling development log shared with the team.** Updated every session.
> Newest entries at the top. Each entry includes what was done, commits, deployments, and blockers.

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
