# Skill 480 — Reverse-Flow Documentation Audit

**Date:** 2026-03-03
**Scope:** gwi-pos docs system
**Type:** Documentation methodology + forensic audit

---

## What This Skill Does

A "reverse-flow" audit starts from **outputs** and traces backwards to **triggers**, instead of reading code forward from features to outputs. This catches a fundamentally different class of problems than forward-flow auditing.

**Forward-flow (what feature docs describe):**
`Feature → API → Event → Storage → Output`

**Reverse-flow (what this audit does):**
`Output → who sends it? → what triggers that? → is it documented?`

---

## When to Run This

Run a reverse-flow audit when:
- A forward-flow feature audit was recently completed (catches what it missed)
- You suspect "dead code" — emitters or receivers with no counterpart
- Financial records are accumulating with no documented close path
- Reports show data that has no documented write path

---

## The 5 Audit Vectors

### Vector 1 — Socket Bidirectionality
For every `socket.emit('event:name')` in the codebase, find its `socket.on('event:name')`. For every `socket.on(...)`, find its emitter.

**Key grep patterns:**
```bash
grep -r "socket.emit\|io.emit\|emitToLocation" src/ | grep -oP "'[^']+'" | sort -u
grep -r "socket.on\|useSocket.*'[^']+'" src/ | grep -oP "'[^']+'" | sort -u
```

**Orphan emitters** = emitted but no listener → real-time UI updates broken
**Orphan consumers** = listening for events that are never emitted → dead listeners

**Findings from 2026-03-03 audit:**
- 63 unique socket events (vs 51 previously estimated)
- 6 true orphan emitters: `inventory:changed`, `employees:changed`, `employees:updated`, `shifts:changed`, `order-types:updated`, `settings:updated`
- `eod:reset-complete` previously assumed orphan — actually consumed by `FloorPlanHome.tsx` (previous docs were wrong)
- `employees:changed` vs `employees:updated` naming conflict (two names, same intent)
- Mobile tab events (`tab:close-request`, `tab:transfer-request`, `tab:alert-manager`) emitted by `MobileTabActions.tsx` — ZERO server handlers in `socket-server.ts`

---

### Vector 2 — Financial Model Close Paths
For every Prisma model that tracks money or debt, verify there is a documented API endpoint that formally closes, resolves, or writes off the record.

**Pattern to check:** Does each model have:
- A creation path? (POST endpoint)
- A close/resolve/settle path? (PUT endpoint)
- An escalation/write-off path? (for when closure is impossible)

**Findings from 2026-03-03 audit:**
| Model | Creation Path | Close Path | Write-Off Path |
|-------|--------------|-----------|----------------|
| `WalkoutRetry` | ✅ two paths | ⚠️ manual retry only | ❌ fields exist, no API |
| `ChargebackCase` | ✅ import/create | ❌ no PUT endpoint | ❌ no API |
| `TipDebt` | ✅ auto-created | ❌ no resolve API | ❌ no write-off API |
| `CashTipDeclaration` | ✅ POST endpoint | ❌ no seal at shift close | — |

**Invariant to enforce:** Every financial model MUST have a documented close/resolve path. Money records that accumulate forever are an accounting liability.

---

### Vector 3 — Report Data Lineage
For every field in every report API response, confirm there is a write path that populates it. Read the report query, identify every field, then grep for the write.

**Pattern:**
```bash
# Find report route
cat src/app/api/reports/[name]/route.ts
# For each field in response, find its write:
grep -r "fieldName" src/ --include="*.ts" | grep -v "select\|where\|report\|route"
```

**Findings from 2026-03-03 audit:**
- `shift.variance` — queried in cash-liabilities and shift reports, no write path found (possibly dead field)
- `TipShare` model used in `tip-shares` report but NOT migrated to `TipLedgerEntry` — dual source of truth
- `businessDayDate` population path undocumented (field exists but how it's set wasn't captured in any feature doc)

---

### Vector 4 — Print/Output Factory
For every function in `print-factory.ts` and `print-template-factory.ts`, confirm there is an API endpoint that calls it. Any function with no caller is a "built but unreachable" feature.

**Findings from 2026-03-03 audit:**
- `buildReceiptWithSettings()` — fully built (dual pricing, tip suggestions, signature, surcharge), but NO `/api/print/receipt` endpoint calls it. Customer receipt is browser `window.print()` only.
- 5 kitchen ticket templates all reachable via `/api/print/kitchen`
- Email receipt reachable via `/api/receipts/email`

---

### Vector 5 — External Integration Dead Paths
For every external service call (Resend, Twilio, Slack, Datacap, etc.) in the codebase, trace backwards to what triggers it and whether the env config is present.

**Pattern:**
```bash
grep -r "SLACK_WEBHOOK_URL\|TWILIO_\|RESEND_" src/ --include="*.ts"
grep -r "alertService\|sendAlert\|slackWebhook" src/ --include="*.ts"
```

**Findings from 2026-03-03 audit:**
- Slack: `alert-service.ts` fully implements Slack routing — `SLACK_WEBHOOK_URL` never appears in any `.env.example` or deployment script — HIGH alerts reach email only
- Twilio: SMS has secondary guard (`sendSMSAlert` only called from CRITICAL path after additional check)
- Resend: dev-mode bypass silently returns success without calling Resend API
- `online-order-worker.ts` and `hardware-command-worker.ts` — both workers found in codebase, neither documented in any feature doc

---

## New Feature Docs Created (2026-03-03)

From this audit, the following feature docs were created or expanded:

| File | Status |
|------|--------|
| `docs/features/walkout-retry.md` | New (full doc) |
| `docs/features/mobile-tab-management.md` | New (full doc) |
| `docs/features/notifications.md` | New (full doc) |
| `docs/features/eod-reset.md` | New (full doc) |
| `docs/features/pay-at-table.md` | New (full doc) |
| `docs/features/gift-cards.md` | New (full doc) |
| `docs/features/happy-hour.md` | New (full doc) |
| `docs/features/daily-prep-count.md` | New (full doc) |
| `docs/features/coupons.md` | New (full doc) |
| `docs/features/floor-plan.md` | Expanded (2→35 routes, 6 models fully documented) |
| `docs/features/events-tickets.md` | Expanded (4→22 routes, full data model) |
| `docs/features/tips.md` | Expanded (TipAdjustment, TipDebt, CashTipDeclaration added) |

---

## Known Gaps Identified (added to `_INDEX.md`)

13 new Known Gaps discovered. Full list in `docs/features/_INDEX.md` → Known Gaps section.
Critical gaps added to `docs/planning/MASTER-TODO.md` as RF-01 through RF-13.

---

## Maintenance Rule

Run a reverse-flow audit:
- After any significant feature sprint that adds new socket events
- Before closing out a release (catches dead emitters before they ship)
- When reports show unexpected null/zero values (trace write path backwards)
- When a financial model is added (ensure close path designed from day 1)

---

*Completed: 2026-03-03*
