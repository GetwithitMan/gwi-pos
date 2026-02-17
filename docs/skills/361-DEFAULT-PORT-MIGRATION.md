# Skill 361: Default Port Migration (3000 → 3005)

**Date:** February 17, 2026
**Commit:** `95500cb`
**Domain:** DevOps / Infrastructure
**Status:** Complete

## Problem

Port 3000 is the default for many services (PM2, Create React App, other Node.js servers). Running the POS on port 3000 caused frequent conflicts during development and on NUC servers where PM2 or other processes claimed port 3000 first.

## Solution

Changed the default port from 3000 to 3005 across the entire codebase. All hardcoded references to port 3000 were updated to 3005, including the custom server, test configuration, seed scripts, load tests, the NUC installer, and API fallback URLs.

## Files Changed (9 files)

| # | File | Change |
|---|------|--------|
| 1 | `server.ts` | Default PORT env fallback changed from 3000 to 3005 |
| 2 | `playwright.config.ts` | Base URL and webServer port updated to 3005 |
| 3 | `prisma/seed.ts` | Any localhost references updated to 3005 |
| 4 | `load-test.ts` | Target URL port updated to 3005 |
| 5 | `public/installer.run` | Kiosk URL, health check, and service definitions updated to 3005 |
| 6-9 | API fallback URLs | Hardcoded `localhost:3000` references updated to `localhost:3005` |

## Key Details

- The PORT environment variable still takes precedence — this only changes the fallback default
- Existing `.env.local` files with `PORT=3000` will continue to work (env overrides default)
- NUC installer now provisions kiosk Chromium pointing to `http://localhost:3005`
- Health checks in systemd service definitions updated to poll port 3005

## Verification

1. `npm run dev` — starts on port 3005 (without PORT env set)
2. `grep -rn "3000" server.ts playwright.config.ts prisma/seed.ts load-test.ts` — zero matches
3. `grep -n "3005" server.ts` — confirms new default
4. Existing deployments with `PORT=3000` in `.env.local` — still bind to 3000 (env takes precedence)
5. `npx tsc --noEmit` — clean

## Related Skills

- **Skill 345**: NUC Installer Package (installer.run updated)
- **Skill 362**: Kiosk Service Hardening (also modifies installer.run kiosk config)
