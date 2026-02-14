# Domain 23: Go-Live & Launch Readiness

**Trigger:** `PM Mode: Go-Live`
**Changelog:** `/docs/changelogs/GO-LIVE-CHANGELOG.md`
**Skill Doc:** `/docs/skills/239-GO-LIVE-LAUNCH-READINESS.md`

---

## Domain Overview

This domain is the **FINAL GATE** before any location goes live. Nothing ships to a real location without passing this domain's checks. It covers everything needed to transition from development to production: removing simulated code, configuring real hardware, training staff, and verifying end-to-end functionality.

**Purpose:** Centralized tracking of EVERYTHING that must change before a location goes live.

---

## Three Location Modes

Every location exists in exactly one of these three modes:

### 1. Development Mode

- Local developer machines only
- Simulated payment processing (no real charges)
- Seed/demo data (PIN 1234/2345/3456)
- Debug logging enabled (`console.log`, debug divs)
- Neon PostgreSQL database (database-per-venue)
- R&D routes accessible (`/rnd/*`, `/test-floorplan`)
- No HTTPS required

### 2. Training Mode

- **Real hardware** (printers, KDS, card readers) connected
- **Real UI** -- staff sees exactly what production looks like
- **NO real charges** -- payment processor uses training/sandbox credentials (NOT simulated; real hardware, fake charges)
- Orders created in training mode are tagged `isTraining: true` and excluded from real reports
- Receipts print "TRAINING MODE" watermark
- KDS shows yellow "TRAINING" banner
- Dashboard shows "TRAINING MODE" indicator
- Location-level flag: `isTrainingMode: boolean`

**When `isTrainingMode` is true:**
- All orders get `isTraining: true` flag
- Payment processor uses training/sandbox credentials
- Reports filter out training orders by default (toggle to include)
- Receipts print "TRAINING MODE" watermark
- KDS shows yellow "TRAINING" banner
- Dashboard shows "TRAINING MODE" indicator

**Switching to production:** Run the Go-Live Verification Checklist, then flip the flag.

### 3. Production Mode

- Real everything: real charges, real inventory, real reports
- Neon PostgreSQL database (database-per-venue)
- HTTPS enforced
- Debug logging removed
- Demo data removed
- Default PINs changed
- Monitoring and alerting active

---

## Layers

| Layer | Scope | Key Areas |
|-------|-------|-----------|
| **Simulated Payments** | Remove `SIMULATED_DEFAULTS`, configure real Datacap credentials, set reader communication modes to `local` or `cloud` | `/src/lib/datacap/simulated-defaults.ts`, `PaymentReader` records, Location `settings.payments` |
| **Training Mode** | Training flag on Location, training order tagging, training report filtering, receipt watermark, KDS banner | Location settings, Order model, report APIs, receipt generation, KDS UI |
| **Seed/Demo Data** | Remove demo employees (PIN 1234/2345/3456), demo menu items, demo tables | `prisma/seed.ts`, Employee records, MenuItem records, Table records |
| **Debug/Dev Code** | Remove `console.log`/`console.warn`/`console.error` (keep error logging), debug divs, dev-only routes | All source files, `/rnd/*`, `/test-floorplan` |
| **Environment Config** | `.env.local` to `.env.production`, verify `DATABASE_URL` points to Neon PostgreSQL, enable HTTPS, configure real API keys | `.env.*`, Docker Compose, Nginx/Caddy config |
| **Hardware Verification** | Printers configured and tested, KDS screens paired, payment readers pinged and responding | `/settings/hardware`, KDS pairing, reader ping |
| **Security Hardening** | Change default PINs, enforce HTTPS, enable IP binding on KDS, review role permissions, remove R&D routes | Employee records, KDS settings, role/permission audit |
| **Data Migration** | Verify all tables have `locationId`, verify sync fields (`deletedAt`, `syncedAt`) present, provision venue database | Prisma migration scripts, schema validation |
| **Monitoring** | Error reporting active, health checks configured, alerting enabled (SMS for CRITICAL, email for HIGH) | Error Reporting domain (Domain 16), `/api/monitoring/*` |

---

## Search Tags for Cleanup

Before any location goes live, search the codebase for these tags and resolve each occurrence:

| Tag | What It Means | Action |
|-----|---------------|--------|
| `SIMULATED_DEFAULTS` | Simulated payment placeholders | Replace with real merchant credentials |
| `// TODO` | Unfinished work | Complete or remove with justification |
| `console.log` | Debug logging | Remove (keep `console.error` for genuine error paths) |
| `console.warn` | Dev warnings | Review -- keep if production-relevant, remove if debug-only |
| `test-floorplan` | Dev-only test route | Remove route and navigation links |
| `/rnd/` | R&D prototype routes | Must not ship -- remove or gate behind feature flag |
| `TRAINING` | Training mode markers | Verify they activate correctly when `isTrainingMode` is true |

---

## Training Mode Specification

### Schema Changes Required

```prisma
// On Location settings (JSON field)
// settings.isTrainingMode: boolean (default false)

// On Order model
// isTraining: Boolean @default(false)
```

### Behavior When Training Mode is Active

| Component | Behavior |
|-----------|----------|
| **Orders** | All new orders get `isTraining: true` |
| **Payments** | Processor uses training/sandbox credentials (real hardware, fake charges) |
| **Reports** | Filter out `isTraining: true` orders by default; toggle to include |
| **Receipts** | Print "TRAINING MODE" watermark across receipt |
| **KDS** | Yellow "TRAINING" banner at top of all KDS screens |
| **Dashboard** | Persistent "TRAINING MODE" indicator visible to all users |
| **Inventory** | Training orders do NOT deduct real inventory |
| **Tips** | Training tips are excluded from tip reports and payroll |

### Transition Checklist (Training to Production)

1. Run Go-Live Verification Checklist (all categories must pass)
2. Clear all training orders from database (or archive)
3. Verify real payment credentials are configured
4. Flip `isTrainingMode` to `false`
5. Process 3 test transactions end-to-end
6. Verify transactions appear in reports
7. Verify inventory deductions are working

---

## Go-Live Master Checklist

### Category 1: Payments

| # | Check | How to Verify |
|---|-------|---------------|
| 1.1 | Real `merchantId` configured | Check Location `settings.payments.merchantId` is not `SIMULATED_*` |
| 1.2 | Real `operatorId` configured | Check Location `settings.payments.operatorId` is not `SIMULATED_*` |
| 1.3 | Payment reader communication mode set to `local` or `cloud` | Check `PaymentReader.communicationMode` is not `simulated` |
| 1.4 | Processor setting is `datacap` (not `simulated`) | Check Location `settings.payments.processor` |
| 1.5 | Process test EMVSale transaction | Ring up item, pay with card, verify Datacap XML sent and payment recorded |
| 1.6 | Process test PreAuth + Capture | Open bar tab with card, close tab, verify capture completes |
| 1.7 | Process test Void | Void a payment, verify hold released |

### Category 2: Hardware

| # | Check | How to Verify |
|---|-------|---------------|
| 2.1 | Receipt printer configured | `/settings/hardware` shows printer with valid IP and port |
| 2.2 | Receipt printer test print | Print test page, verify formatting |
| 2.3 | Kitchen printer(s) configured | Each kitchen station has assigned printer |
| 2.4 | Kitchen printer test print | Send test ticket, verify it prints |
| 2.5 | KDS screen(s) paired | `/settings/hardware/kds-screens` shows paired devices |
| 2.6 | Payment reader(s) responding | Ping reader from settings, verify response |
| 2.7 | Backup printer configured (if applicable) | Verify failover printer is set |

### Category 3: Data

| # | Check | How to Verify |
|---|-------|---------------|
| 3.1 | Real menu entered | All real menu items, categories, prices, modifiers configured |
| 3.2 | Demo menu items removed | No seed data items remain (unless intentionally kept) |
| 3.3 | Demo employees removed | PINs 1234, 2345, 3456 are removed or changed |
| 3.4 | Real employees created | All staff have accounts with correct roles and real PINs |
| 3.5 | Tax rates configured | Correct local tax rate(s) set |
| 3.6 | Tip-out rules configured | Tip distribution rules match house policy |
| 3.7 | Floor plan set up | Tables, sections, entertainment items placed |

### Category 4: Security

| # | Check | How to Verify |
|---|-------|---------------|
| 4.1 | Default PINs changed | No employee has PIN 1234, 2345, or 3456 |
| 4.2 | HTTPS enabled | All traffic over HTTPS (check Nginx/Caddy config) |
| 4.3 | KDS IP binding enabled (if on UniFi) | `enforceStaticIp` true on KDS screens |
| 4.4 | Role permissions reviewed | Manager, server, bartender permissions match business needs |
| 4.5 | R&D routes removed or gated | `/rnd/*` and `/test-floorplan` not accessible |
| 4.6 | `.env` secrets not in source control | Verify `.gitignore` excludes `.env*` |

### Category 5: Infrastructure

| # | Check | How to Verify |
|---|-------|---------------|
| 5.1 | PostgreSQL database running | `DATABASE_URL` points to Neon PostgreSQL venue database |
| 5.2 | Venue database provisioned | Database `gwi_pos_{slug}` created, schema migrated, data seeded |
| 5.3 | Docker Compose configured | All services start cleanly |
| 5.4 | Watchtower configured | Auto-updates enabled |
| 5.5 | Database backups configured | Automated backup schedule verified |
| 5.6 | Local network connectivity verified | All terminals can reach server |

### Category 6: Monitoring

| # | Check | How to Verify |
|---|-------|---------------|
| 6.1 | Error reporting active | Error Reporting domain (Domain 16) enabled |
| 6.2 | Health checks configured | `/api/monitoring/health-check` returns healthy |
| 6.3 | Alerting enabled | SMS for CRITICAL, email for HIGH severity |
| 6.4 | Performance monitoring active | Slow query detection enabled |

### Category 7: Training

| # | Check | How to Verify |
|---|-------|---------------|
| 7.1 | All staff trained on POS | Each employee has completed training session |
| 7.2 | Training orders cleared | No `isTraining: true` orders remain (or archived) |
| 7.3 | Training mode flag off | `isTrainingMode` is `false` |

### Category 8: Final Verification

| # | Check | How to Verify |
|---|-------|---------------|
| 8.1 | Process 3 end-to-end transactions | Create order, send to kitchen, pay -- verify in reports |
| 8.2 | Verify KDS receives tickets | Send order, confirm KDS displays it |
| 8.3 | Verify receipt prints | Pay order, confirm receipt prints correctly |
| 8.4 | Verify reports populate | Check daily report after test transactions |
| 8.5 | Verify inventory deductions | Check stock levels decreased after sale |
| 8.6 | Verify tip recording | Add tip on payment, verify in tip report |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/datacap/simulated-defaults.ts` | Centralized simulated payment placeholders |
| `prisma/seed.ts` | Demo/seed data that must be removed for production |
| `.env.local` | Development environment variables |
| `docs/domains/GO-LIVE-DOMAIN.md` | This file |
| `docs/changelogs/GO-LIVE-CHANGELOG.md` | Session history |

---

## Future: Go-Live CLI Tool

A planned CLI tool (`scripts/go-live-check.ts`) that automatically verifies checklist items:

```bash
# Run all go-live checks
npm run go-live-check

# Output:
# [PASS] Payments: merchantId is not simulated
# [PASS] Payments: operatorId is not simulated
# [FAIL] Payments: reader communicationMode is 'simulated'
# [PASS] Security: no default PINs found
# [FAIL] Data: demo employee 'Manager Demo' still exists
# ...
# Result: 14/16 checks passed. 2 FAILURES must be resolved.
```

This tool would query the database, check environment variables, and ping hardware to produce a comprehensive go/no-go report.
