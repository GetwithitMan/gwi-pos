# CLAUDE.md — GWI POS

Bar/restaurant POS. Hybrid SaaS: local NUC servers + Neon cloud sync. Fewest-clicks philosophy.

## Task Protocol

### Assess Every Turn
Before touching code: What is being asked? How many files/domains? Research needed? Parallelizable?

### Solo vs Team

| Condition | Action |
|-----------|--------|
| Single-file edit, < 20 lines | Solo |
| Bug fix in one known location | Solo |
| Question about codebase | Solo or Explore agent |
| **2+ files across domains** | **Team** |
| **Research + implementation** | **Team** (Explore researches while you plan) |
| **Schema + API + UI** | **Team** (parallelize layers) |
| **3+ files touched** | **Team** |
| **"PM Mode" or "use a team"** | **Team** (always) |
| **New feature (not a patch)** | **Team** |

### Team Composition
1. Spawn **Explore** agent first (background research)
2. Break down task with **TodoWrite**
3. Spawn **general-purpose** agents per workstream
4. Validate with **Bash** agent (build, lint, type-check)

### Forensic Research (bugs, "something's wrong")
Spawn 3 parallel Explore agents — **Forensic-Data** (trace data flow DB→API→store→UI), **Forensic-Integration** (imports, socket events, side effects), **Forensic-History** (git log, changelogs, recent changes). Each MUST read full files 2+ levels deep. Cross-reference before fixing.

**Triggers:** "doesn't work", fix didn't solve it, data wrong/missing/stale, differs between terminals, "used to work", about to change untraced code.

**Rule: Never fix what you don't fully understand.**

### Bias: When in Doubt, Team It

## Hard Rules

### Offline-First (7 rules)
- NEVER query Neon from POS API routes — all `db.*` → local PG
- NEVER make POS startup/login/orders/payments depend on cloud
- NEVER set NUC `DATABASE_URL` to neon.tech
- Clock discipline: DB-generated `NOW()` only, never client timestamps
- **Full rules:** `docs/guides/ARCHITECTURE-RULES.md`

### Event-Sourced Orders
- EVERY Order/OrderItem mutation MUST emit events via `emitOrderEvent()`
- NEVER write to `db.order`/`db.orderItem` without events
- NEVER read from `db.order`/`db.orderItem` — use snapshots
- **Full rules:** `docs/guides/ORDER-LIFECYCLE.md`

### Payments (Datacap Only)
- NEVER add Stripe/Square/Braintree — Datacap is the only processor
- Money first, reports second — never sacrifice payment reliability
- All payment code in `src/lib/datacap/` only
- **Full rules:** `docs/guides/PAYMENTS-RULES.md`

### Performance
- Socket-first: `emitToLocation()` / `getSharedSocket()` — never `io()` or polling
- Delta updates: removal → local state, addition → debounced refresh
- Fire-and-forget: `void doWork().catch(console.error)` for side effects
- **Full rules:** `docs/guides/CODING-STANDARDS.md`

### Multi-Tenancy
- Every table has `locationId` (except Organization, Location)
- Always filter: `locationId` + `deletedAt: null`
- Soft deletes only: `deletedAt: new Date()`
- **Full rules:** `docs/guides/ARCHITECTURE-RULES.md`

### Android
- Android is PRIMARY client, web is secondary fallback
- Touch targets min 48x48dp, no hover interactions
- Event-sourced orders: Android sends events → POS assigns `serverSequence`
- **Full rules:** `docs/guides/ANDROID-INTEGRATION.md`

## Quick Reference

### Demo Credentials
| Role | PIN |
|------|-----|
| Manager | 1234 |
| Server | 2345 |
| Bartender | 3456 |

### Dev Commands
```bash
npm install          # Install dependencies
npm run dev          # Dev server (localhost:3000)
npm run build        # Production build
npm run lint         # Lint
npx tsc --noEmit     # Type check
npm run db:studio    # Prisma Studio
```

### Custom Server
`server.ts` wraps Next.js for Socket.io + multi-tenant DB routing. All API routes use `withVenue()` from `src/lib/with-venue.ts`. See `docs/guides/CODING-STANDARDS.md` for patterns.

## Doc Routing Table

| Working On | Read First | Key Files |
|------------|-----------|-----------|
| Any API route | `docs/guides/CODING-STANDARDS.md` | `src/lib/with-venue.ts` |
| Orders / mutations | `docs/guides/ORDER-LIFECYCLE.md` | `src/lib/order-events/` |
| Payments / Datacap | `docs/guides/PAYMENTS-RULES.md` | `src/lib/datacap/` |
| Dual pricing | `docs/guides/PAYMENTS-RULES.md` + `docs/skills/SPEC-31-DUAL-PRICING.md` | `src/lib/pricing.ts` |
| Socket / real-time | `docs/guides/SOCKET-REALTIME.md` | `src/lib/socket-server.ts`, `shared-socket.ts` |
| Android interop | `docs/guides/ANDROID-INTEGRATION.md` | `src/app/api/sync/` |
| NUC deployment | `docs/guides/NUC-OPERATIONS.md` | `public/installer.run` |
| Database / schema | `docs/guides/ARCHITECTURE-RULES.md` | `prisma/schema.prisma` |
| Architecture / repos | `docs/guides/ARCHITECTURE-RULES.md` | `server.ts` |
| UI / components | `docs/guides/CODING-STANDARDS.md` | `src/stores/` |
| Menu / modifiers | `docs/domains/MENU-DOMAIN.md` | `src/app/(admin)/menu/` |
| Floor plan | `docs/domains/FLOOR-PLAN-DOMAIN.md` | `src/components/floor-plan/` |
| KDS / kitchen | `docs/domains/KDS-DOMAIN.md` | `src/app/(kds)/` |
| Hardware / printers | `docs/domains/HARDWARE-DOMAIN.md` | `src/lib/escpos/` |
| Inventory / recipes | `docs/domains/INVENTORY-DOMAIN.md` | `src/lib/inventory-calculations.ts` |
| Reports | `docs/domains/REPORTS-DOMAIN.md` | `src/app/(admin)/reports/` |
| Tips / tip-outs | `docs/domains/TIPS-DOMAIN.md` | `src/lib/tips/` |
| Tabs / pre-auth | `docs/domains/TABS-DOMAIN.md` | `src/app/api/tabs/` |
| Employees / roles | `docs/domains/EMPLOYEES-DOMAIN.md` | `src/app/(admin)/employees/` |
| Settings | `docs/domains/SETTINGS-DOMAIN.md` | `src/app/(admin)/settings/` |
| Entertainment | `docs/domains/ENTERTAINMENT-DOMAIN.md` | `src/app/(admin)/timed-rentals/` |
| Liquor builder | `docs/domains/LIQUOR-MANAGEMENT-DOMAIN.md` | `src/app/(admin)/liquor-builder/` |
| Combos | `docs/skills/SPEC-59-COMBO-MEALS.md` | `src/app/(admin)/combos/` |
| Splits | `docs/skills/SPEC-11-SPLITTING.md` | `src/app/api/orders/[id]/split/` |
| Online ordering | `docs/domains/OFFLINE-SYNC-DOMAIN.md` | `src/lib/neon-client.ts` |
| PM Mode / teams | `docs/guides/PM-MODE-GUIDE.md` | — |
| Code review | `docs/CODE-REVIEW-CHECKLIST.md` | — |
| Error handling | `docs/development/ERROR-HANDLING-STANDARDS.md` | — |

## Living Log & Documentation

- **Living Log:** `docs/logs/LIVING-LOG.md` — Update at end of every session (date, commits, features, bugs, blockers)
- **Domain changelogs:** `docs/changelogs/[DOMAIN]-CHANGELOG.md`
- **Skills index:** `docs/skills/SKILLS-INDEX.md` (347+ skill docs)
- **Task board:** `docs/guides/PM-TASK-BOARD.md`
- **PM Mode triggers:** `PM Mode: [Domain]`, `PM Mode: [Domain] (Single Agent)`, `PM Mode: [Domain] (Agent Team)`, `EOD: [Domain]`
