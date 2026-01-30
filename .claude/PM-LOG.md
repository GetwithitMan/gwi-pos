# GWI POS - Project Manager Log

This file tracks session notes, ideas, decisions, and worker activity. Updated each PM session.

---

# Session: 2026-01-30

**PM Session Start**: Activated via "Open Project Manager"

## Project Status at Session Start
- Phase 1 (MVP): 75% complete
- Skills: 77 DONE, 3 PARTIAL, 7 TODO (87 total, 92%)
- Tasks Ready: 6 (T001-T006)
- Tasks Blocked: 4

---

## Ideas Captured

### Real-Time Architecture (Sockets Discussion)
- Developer friend mentioned "LTA Sockets" for speed
- Clarified as WebSockets/Socket.io
- Current system uses 5-second polling
- At 20K users: polling = 4,000 req/sec = disaster
- **Decision**: Plan for Pusher/Ably now, implement later
- Added Skill 110: Real-time Events (Pusher/Ably)

### Interactive Floor Plan (Konva/SVG)
- Friend suggested Konva.js or Fabric.js for canvas-based floor plan
- Layered approach: Background → Tables → Seats
- For restaurant scale (< 100 tables): SVG is simpler
- For 20K event ticketing: Konva handles better
- **Decision**: SVG first for bar/restaurant, upgrade to Konva for ticketing
- Added Skill 106: Interactive Floor Plan (Konva)

### Table Combine/Split Feature
- Core bar/restaurant need: drag two tables together to merge orders
- Touch-slide gesture to combine
- Combined tables show "T1+T2" name
- Seats accessible from both tables
- Split option to reverse
- **Decision**: Build as part of floor plan (Skill 107)
- Added Skill 107: Table Combine/Split

### Event Ticketing Platform
- Schema already built: Event, EventPricingTier, EventTableConfig, Ticket
- Supports: per_seat, per_table, general_admission, hybrid modes
- Hold system: heldAt, heldUntil, heldBySessionId (10min TTL)
- Missing: APIs, UI, real-time seat status
- **Decision**: Build after floor plan foundation
- Added Skill 108: Event Ticketing APIs

### Visual Pizza Builder
- Same Konva/SVG tech could enhance pizza ordering
- Section selection (whole, half, quarter, sixth)
- Drag toppings to sections
- Live preview on KDS
- Reuses 60% of floor plan code
- **Decision**: Build after ticketing floor plan
- Added Skill 109: Visual Pizza Builder

### Training Mode (New - from T002 review)
- Sandbox mode for training servers
- Nothing recorded to production database
- Uses temp local storage or separate DB
- Accessible via developer options or manager toggle
- **Decision**: Add as future skill
- Added Skill 111: Training Mode

### Simulated Card Reader (New - from T002 review)
- Developer option at top of screen: "Tap Card" vs "Chip Card" buttons
- Tap: Quick payment simulation, no customer name pulled
- Chip: Full simulation, pulls customer name, more functionality
- Useful for development and training mode
- **Decision**: Add as future skill
- Added Skill 112: Simulated Card Reader

---

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| SVG before Konva | Simpler for restaurant scale, can upgrade later |
| Pusher/Ably over self-hosted | Battle-tested, works with Vercel, ~$50/mo |
| Table combine is priority | Daily bread-and-butter for bars/restaurants |
| 20K event ticketing is Phase 2+ | Focus on core POS first |
| Add events abstraction now | Prep for WebSockets without full implementation |
| No Stripe | User decision - use Square/MagTek instead |
| MagTek agreement pending | T011 blocked until business agreement finalized |
| Training mode as separate skill | Valuable for onboarding, not urgent for MVP |

---

## Skills Added This Session

| Skill | Name | Status | Notes |
|-------|------|--------|-------|
| 106 | Interactive Floor Plan (Konva) | TODO | SVG first, Konva for scale |
| 107 | Table Combine/Split | TODO | Drag gesture to merge orders |
| 108 | Event Ticketing APIs | TODO | CRUD, hold/release, check-in |
| 109 | Visual Pizza Builder | TODO | Reuses floor plan components |
| 110 | Real-time Events (Pusher/Ably) | TODO | WebSocket abstraction layer |
| 111 | Training Mode | TODO | Sandbox with temp DB for server training |
| 112 | Simulated Card Reader | TODO | Dev/training tap vs chip simulation |

**Updated totals**: 77 DONE, 3 PARTIAL, 14 TODO (94 total, 85%)

---

## Workers Deployed

### Worker 1: T001 - OFFLINE-SYNC-ALGORITHM.md
- **Type**: Documentation
- **Priority**: Critical
- **Status**: ✅ COMPLETE
- **Deployed At**: 2026-01-30
- **Output**: Full algorithm with ASCII diagrams, pseudocode, edge cases
- **User Clarifications Applied**:
  - Alerts → both admin UI + email
  - Customer data bidirectional via cloud (additive merge for loyalty)
  - Dispute workflow = processor-dependent best-case design
  - Manual sync = super admin only (cloud level)
- **Unblocked**: T010 (Socket.io), T014 (Docker config) now READY

### Worker 2: T002 - PAYMENT-PROCESSING.md
- **Type**: Documentation
- **Priority**: Critical
- **Status**: ✅ COMPLETE
- **Deployed At**: 2026-01-30
- **Output**: 1,156 lines, all criteria met
- **Modifications**: Removed Stripe per user request, now processor-agnostic (Square/MagTek)
- **Note**: T011 (Implement payment processing) remains BLOCKED - MagTek agreement pending

### Worker 3: Skills 106/107 - Floor Plan + Table Combine
- **Type**: Code
- **Priority**: High (User's fun project)
- **Status**: ✅ COMPLETE
- **Deployed At**: 2026-01-30
- **Output**:
  - 9 files created (components, APIs, store, events abstraction)
  - 3 files modified (schema, tables API, tables page)
  - Schema: Added combinedWithId, combinedTableIds, originalName to Table
  - Features: SVG floor plan, drag-combine, long-press split, 30s undo, pan/zoom
- **Known Limitations**: No position persistence, basic touch (no pinch-zoom)

---

## Pending Review
- [x] Worker 1 output (OFFLINE-SYNC-ALGORITHM.md) ✅ APPROVED
- [x] Worker 2 output (PAYMENT-PROCESSING.md) ✅ APPROVED
- [x] Worker 3 output (Floor Plan + Table Combine code) ✅ APPROVED
- [x] Worker 1 output (T003: Consolidate REQUIREMENTS.md) ✅ APPROVED
- [x] Worker 2 output (T016: Simulated Card Reader) ✅ APPROVED
- [x] Worker 1 output (T004: API-REFERENCE.md) ✅ APPROVED
- [x] Worker 2 output (T018: Super Admin Role + Dev Access) ✅ APPROVED
- [x] Worker 1 output (T005: ERROR-HANDLING-STANDARDS.md) ✅ APPROVED
- [x] Worker 2 output (T006: TESTING-STRATEGY.md) ✅ APPROVED
- [x] Worker 1 output (T007: Update BUILD-PLAN.md) ✅ APPROVED
- [x] Worker 2 output (T008: Add skill file headers) ✅ APPROVED (Note: Only 3 skill files exist, not 60)
- [x] Worker 2 output (T010: Real-time Events System) ✅ APPROVED
- [x] Worker 1 output (T009: DATABASE-REFERENCE.md) ✅ APPROVED
- [x] Worker 2 output (T012: Check Splitting) ✅ APPROVED
- [x] Worker 1 output (T013: Coursing System) ✅ APPROVED
- [x] Worker 2 output (T014: Docker Config) ✅ APPROVED
- [x] Worker 1 output (T020: Event Ticketing APIs) ✅ APPROVED
- [x] Worker 2 output (T021: Visual Pizza Builder) ✅ APPROVED
- [x] Worker 2 output (T022: Pizza Seed Data) ✅ APPROVED
- [x] Worker 1 output (T023: Floor Plan Home - Initial) ✅ NEEDS REWORK (major UX changes requested)
- [ ] Worker 3 output (T019: Seat Persistence) - In Progress
- [ ] Worker 2 output (T024: Pizza Builder Integration) - In Progress

---

## UX Direction Change (Evening Session)

**Major Decision:** The floor plan IS the main order screen. No navigation away.

**Requirements clarified:**
1. Category click = tables disappear, menu items appear (same screen)
2. Employee menu in top-left (from old order screen)
3. Per-employee settings (colors, reset to default)
4. Order panel = table info panel style
5. Takeout/Delivery/Bar Tab buttons on floor plan
6. Open Orders button with count
7. NEW: `/tabs` page for bartenders - scrollable, searchable
8. Deprecate old order screen entirely

**New Task Created:** T025 - Bar Tabs Page

---

## Notes for Next Session
- Review worker outputs when complete
- Update TASKS.md with completion status
- Consider starting T003 (Consolidate REQUIREMENTS.md) - quick win
- Discuss Pusher account setup if ready for real-time

---

## Architecture Discussions

### Current vs Target Architecture

**Current (Polling)**:
```
[Clients] → poll every 5 sec → [Vercel API] → [SQLite]
```

**Target (Real-time)**:
```
[Clients] ←WebSocket→ [Pusher/Ably]
     ↓
[Vercel Edge/Serverless]
     ↓
[Redis Cache] → [PostgreSQL]
```

### Migration Path
1. SQLite → PostgreSQL (Neon/Supabase) - 2-4 hrs
2. Add Redis cache - 4-6 hrs
3. Add events abstraction - 1-2 hrs
4. Add Pusher/Ably - 4-8 hrs
5. Connection pooling - Built into Prisma

---

*Log updated: 2026-01-30*
