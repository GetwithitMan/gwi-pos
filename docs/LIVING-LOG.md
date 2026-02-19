# GWI POS — Living Log

> **Rolling development log shared with the team.** Updated every session.
> Newest entries at the top. Each entry includes what was done, commits, deployments, and blockers.

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
