# Skill 246: Go-Live & Launch Readiness Domain

**Domain:** Go-Live (Domain 23)
**Trigger:** `PM Mode: Go-Live`
**Status:** DONE (Domain setup)
**Created:** 2026-02-09

---

## What It Covers

Centralized domain for everything required to transition a GWI POS location from development to production. This is the final gate -- nothing ships to a real location without passing this domain's checks.

## Three Location Modes

| Mode | Purpose | Charges | Data |
|------|---------|---------|------|
| **Development** | Local dev machines | Simulated (fake) | Seed/demo data |
| **Training** | Staff training on real hardware | Sandbox (real hardware, fake charges) | Tagged training orders |
| **Production** | Live location | Real charges | Real data |

## Search Tags for Cleanup

Before go-live, search for and resolve:
- `SIMULATED_DEFAULTS` -- simulated payment placeholders
- `// TODO` -- unfinished work
- `console.log` / `console.warn` -- debug logging
- `test-floorplan` -- dev-only test routes
- `/rnd/` -- R&D prototype routes

## Go-Live Checklist Categories

1. **Payments** -- Real credentials, test transactions
2. **Hardware** -- Printers, KDS, card readers configured and tested
3. **Data** -- Real menu, demo data removed, employees set up
4. **Security** -- HTTPS, PINs changed, permissions reviewed
5. **Infrastructure** -- PostgreSQL, Docker, backups
6. **Monitoring** -- Error reporting, health checks, alerting
7. **Training** -- Staff trained, training orders cleared
8. **Final Verification** -- 3 end-to-end test transactions

## Key Files

- `/docs/domains/GO-LIVE-DOMAIN.md` -- Full domain documentation
- `/docs/changelogs/GO-LIVE-CHANGELOG.md` -- Session history
- `src/lib/datacap/simulated-defaults.ts` -- Simulated payment constants
- `prisma/seed.ts` -- Demo data to remove

## Training Mode Spec

- Location-level `isTrainingMode: boolean`
- Orders tagged `isTraining: true`
- Reports filter training orders by default
- Receipts show "TRAINING MODE" watermark
- KDS shows yellow "TRAINING" banner
- Inventory not deducted for training orders

## Related Skills

- Skill 111: Training Mode (TODO -- implementation)
- Skill 112: Simulated Card Reader (DONE -- dev/training simulation)
- Skill 120: Datacap Direct Integration (DONE -- real payment protocol)
- Domain 16: Error Reporting (monitoring infrastructure)
