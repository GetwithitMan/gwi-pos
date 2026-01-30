# GWI POS Task Queue

## How This Works

1. **PM (this terminal)** reviews project state and creates tasks
2. **Workers (other terminals)** receive task prompts and execute
3. **Results** are copied back to PM for review
4. **PM** validates, tests, and updates this queue

---

## Task Status Key

| Status | Meaning |
|--------|---------|
| 🔴 BLOCKED | Waiting on dependency |
| 🟡 READY | Can be picked up now |
| 🔵 IN PROGRESS | Worker assigned |
| ✅ COMPLETE | Done, reviewed, merged |
| ❌ FAILED | Needs rework |

---

## Current Sprint: Documentation & Foundation

### Critical Path (Do First)

| ID | Task | Status | Worker | Dependencies |
|----|------|--------|--------|--------------|
| T001 | Create OFFLINE-SYNC-ALGORITHM.md | ✅ COMPLETE | Worker 1 | None |
| T002 | Create PAYMENT-PROCESSING.md | ✅ COMPLETE | Worker 2 | None |
| T003 | Consolidate REQUIREMENTS.md files | ✅ COMPLETE | Worker 1 | None |
| T004 | Create API-REFERENCE.md | ✅ COMPLETE | Worker 1 | None |
| T005 | Create ERROR-HANDLING-STANDARDS.md | ✅ COMPLETE | Worker 1 | None |
| T006 | Create TESTING-STRATEGY.md | ✅ COMPLETE | Worker 2 | None |

### High Priority (After Critical)

| ID | Task | Status | Worker | Dependencies |
|----|------|--------|--------|--------------|
| T007 | Update BUILD-PLAN.md for SQLite reality | ✅ COMPLETE | Worker 1 | None |
| T008 | Add headers to all skill files | ✅ COMPLETE | Worker 2 | None |
| T009 | Create DATABASE-REFERENCE.md | ✅ COMPLETE | Worker 1 | T004 ✓ |
| T010 | Implement Socket.io for real-time | ✅ COMPLETE | Worker 2 | T001 ✓ |

### Feature Work (Phase 1 Completion)

| ID | Task | Status | Worker | Dependencies |
|----|------|--------|--------|--------------|
| T011 | Implement payment processing | 🔴 BLOCKED | - | MagTek agreement pending |
| T012 | Implement check splitting | ✅ COMPLETE | Worker 2 | None |
| T013 | Implement coursing system | ✅ COMPLETE | Worker 1 | None |
| T014 | Build local server Docker config | ✅ COMPLETE | Worker 2 | T001 ✓ |
| T015 | Interactive Floor Plan + Table Combine | ✅ COMPLETE | Worker 3 | None |
| T017 | Floor Plan Premium UI Overhaul | ✅ COMPLETE | Worker 3 | T015 |
| T019 | Integrate Floor Plan into Orders Page | 🔵 IN PROGRESS | Worker 3 | T017 |
| T020 | Event Ticketing APIs (Skill 108) | ✅ COMPLETE | Worker 1 | None |
| T021 | Visual Pizza Builder (Skill 109) | ✅ COMPLETE | Worker 2 | None |
| T022 | Pizza Seed Data (Full Menu) | ✅ COMPLETE | Worker 2 | T021 |
| T024 | Pizza Builder Integration (Click to Open) | 🔵 IN PROGRESS | Worker 2 | T021, T022 |
| T023 | Floor Plan as Home + Inline Ordering | 🔵 IN PROGRESS | Worker 1 | T019 |
| T025 | Bar Tabs Page (Search/Filter) | 🟡 READY | - | T023 |
| T018 | Super Admin Role + Dev Access | ✅ COMPLETE | Worker 2 | T016 |
| T016 | Simulated Card Reader (Tap/Chip) | ✅ COMPLETE | Worker 2 | None |

---

## Task Details

### T001: Create OFFLINE-SYNC-ALGORITHM.md
**Priority:** 🔴 Critical
**Estimated Effort:** Medium
**Location:** `/docs/OFFLINE-SYNC-ALGORITHM.md`

**Requirements:**
- Document step-by-step sync algorithm
- Define conflict resolution rules (last-write-wins)
- Handle: concurrent edits, deletions, ordering
- Include pseudocode examples
- Define sync queue data structure
- Document retry logic for failed syncs

**Acceptance Criteria:**
- [ ] Algorithm clearly documented
- [ ] Conflict scenarios covered
- [ ] Pseudocode provided
- [ ] Edge cases addressed

---

### T002: Create PAYMENT-PROCESSING.md ✅
**Priority:** 🔴 Critical
**Status:** COMPLETE
**Location:** `/docs/PAYMENT-PROCESSING.md`

**Delivered:**
- Payment flow diagrams (ASCII lifecycle + integration)
- Processor-agnostic code (Square/MagTek options, NO Stripe)
- Offline store-and-forward with $50 limit
- PCI compliance (tokenization, encryption, audit)
- All payment types: cash, card, split, gift, house account, loyalty

**Acceptance Criteria:**
- [x] Payment flow diagram
- [x] Processor integration documented (Square/MagTek)
- [x] Offline handling specified
- [x] Security requirements listed

---

### T003: Consolidate REQUIREMENTS.md
**Priority:** 🔴 Critical
**Estimated Effort:** Small
**Action:** Merge root `/REQUIREMENTS.md` into `/docs/REQUIREMENTS.md`

**Requirements:**
- Review both files
- Merge unique content from root into docs version
- Delete or archive root version
- Update any cross-references

**Acceptance Criteria:**
- [ ] Single REQUIREMENTS.md in /docs
- [ ] No duplicate content
- [ ] All links updated

---

### T004: Create API-REFERENCE.md
**Priority:** 🟡 High
**Estimated Effort:** Large
**Location:** `/docs/API-REFERENCE.md`

**Requirements:**
- Document ALL API endpoints
- Include: method, path, params, response
- Group by domain (menu, orders, employees, etc.)
- Include example requests/responses
- Document authentication requirements

**Acceptance Criteria:**
- [ ] All 40+ API routes documented
- [ ] Examples for each endpoint
- [ ] Auth requirements clear

---

### T005: Create ERROR-HANDLING-STANDARDS.md
**Priority:** 🟡 High
**Estimated Effort:** Small
**Location:** `/docs/ERROR-HANDLING-STANDARDS.md`

**Requirements:**
- Define error code numbering scheme
- Document retry logic patterns
- Define user-facing error messages
- Create error response format standard

**Acceptance Criteria:**
- [ ] Error codes defined
- [ ] Retry patterns documented
- [ ] Message templates created

---

### T006: Create TESTING-STRATEGY.md
**Priority:** 🟡 High
**Estimated Effort:** Medium
**Location:** `/docs/TESTING-STRATEGY.md`

**Requirements:**
- Define unit test patterns
- Define integration test approach
- Define E2E test critical paths
- Define performance test methodology
- Include file naming conventions

**Acceptance Criteria:**
- [ ] Test types defined
- [ ] File structure documented
- [ ] Critical paths listed

---

### T015: Interactive Floor Plan + Table Combine
**Priority:** 🟡 High
**Estimated Effort:** Large
**Skills:** 106, 107
**Location:** `/src/components/floor-plan/`

**Requirements:**
- SVG-based interactive floor plan component
- Tables colored by status (available/occupied/dirty)
- Seats visible around tables
- Drag table onto another to combine orders
- Split combined tables back apart
- Real-time events abstraction (prep for WebSockets)

**Acceptance Criteria:**
- [ ] SVG floor plan renders tables from database
- [ ] Tables show correct status colors
- [ ] Drag-to-combine triggers order merge
- [ ] Combined tables show merged name (T1+T2)
- [ ] Split option for combined tables
- [ ] APIs include locationId filtering
- [ ] Touch gestures work on iPad

---

### T016: Simulated Card Reader (Tap/Chip)
**Priority:** 🟡 High
**Estimated Effort:** Medium
**Skill:** 112
**Location:** `/src/components/payment/`, `/src/lib/mock-cards.ts`

**Requirements:**
- Two buttons at top of payment screen: "Tap Card" and "Chip Card"
- Mock database of 50+ fake card holders (names, last 4 digits, card types)
- Tap Card: Quick approval, NO customer name returned
- Chip Card: Approval with customer name, card type, last 4 digits
- Random delay (500-2000ms) to simulate real processing
- Occasional random decline (5% chance) for realism
- Only visible in dev mode or when `testMode: true` in settings

**Mock Card Data:**
- First/Last names (realistic mix)
- Card types: Visa, Mastercard, Amex, Discover
- Last 4 digits (random)
- Some cards flagged as "decline" for testing error flows

**Acceptance Criteria:**
- [ ] Tap Card button works (fast approval, no name)
- [ ] Chip Card button works (approval with customer name)
- [ ] Mock card database with 50+ entries
- [ ] Random processing delay feels realistic
- [ ] Occasional declines for testing
- [ ] Only shows in dev/test mode
- [ ] Integrates with existing payment flow

---

## Completed Tasks

| ID | Task | Completed | Notes |
|----|------|-----------|-------|
| - | Add sync fields to schema | 2026-01-30 | 80 tables updated |
| - | Update CLAUDE.md | 2026-01-30 | Architecture added |
| - | Update SKILLS-INDEX.md | 2026-01-30 | Status updated |
| - | Create GWI-ARCHITECTURE.md | 2026-01-30 | Full doc created |
| T002 | Create PAYMENT-PROCESSING.md | 2026-01-30 | 1,156 lines, processor-agnostic (no Stripe) |
| T001 | Create OFFLINE-SYNC-ALGORITHM.md | 2026-01-30 | Full algorithm, bidirectional customer sync, super admin manual trigger |
| T015 | Interactive Floor Plan + Table Combine | 2026-01-30 | Skills 106/107, SVG floor plan, drag-combine, split, 30s undo |
| T003 | Consolidate REQUIREMENTS.md | 2026-01-30 | Merged 831+687 lines → 1,021 lines, deleted root duplicate |
| T016 | Simulated Card Reader (Tap/Chip) | 2026-01-30 | Skill 112, 55 mock cards, tap/chip behavior, DEV mode only |
| T004 | Create API-REFERENCE.md | 2026-01-30 | 40+ endpoints, 25 domains, full request/response docs |
| T018 | Super Admin Role + Dev Access | 2026-01-30 | PIN 0000, dev.access permission, DEV badge, gates SimulatedCardReader |
| T005 | Create ERROR-HANDLING-STANDARDS.md | 2026-01-30 | 25 domains, 100+ error codes, retry patterns, PCI logging |
| T006 | Create TESTING-STRATEGY.md | 2026-01-30 | Unit/integration/E2E patterns, 5 critical paths, CI/CD workflow, 75% coverage goal |
| T007 | Update BUILD-PLAN.md for SQLite reality | 2026-01-30 | v2.0, hybrid architecture, Docker configs, 85% Phase 1 complete |
| T008 | Add headers to skill files | 2026-01-30 | Only 3 files exist (102-104), all updated with YAML frontmatter |
| T010 | Implement Socket.io for real-time | 2026-01-30 | Provider-agnostic events system, 15+ event types, React hooks, Skill 110 |
| T009 | Create DATABASE-REFERENCE.md | 2026-01-30 | 78 tables, 28 domains, full field docs, query patterns |
| T012 | Implement check splitting | 2026-01-30 | 5 split types, added Split by Seat, Skill 014 docs |
| T013 | Implement coursing system | 2026-01-30 | Full coursing: 5 components, KDS integration, auto/manual modes |
| T014 | Build local server Docker config | 2026-01-30 | SQLite + PostgreSQL options, Watchtower, systemd, backup/restore |
| T021 | Visual Pizza Builder (Skill 109) | 2026-01-30 | Quick + Visual modes, mode switching, SVG canvas |
| T020 | Event Ticketing APIs (Skill 108) | 2026-01-30 | Full API: tiers, tables, holds, purchase, check-in, refunds |
| T022 | Pizza Seed Data (Full Menu) | 2026-01-30 | 6 sizes, 6 crusts, 8 sauces, 8 cheeses, 50 toppings, 13 specialties |
| T017 | Floor Plan Premium UI Overhaul | 2026-01-30 | Dark theme, glows, glassmorphism, Framer Motion |

---

## Backlog (Future Sprints)

### Infrastructure
- [ ] Real-time events with Pusher/Ably (Skill 110)
- [ ] SQLite → PostgreSQL migration
- [ ] Redis cache layer
- [ ] Build local server Docker config

### Features
- [x] Event Ticketing APIs (Skill 108) → T020
- [x] Visual Pizza Builder (Skill 109) → T021
- [ ] Training Mode (Skill 111) — Sandbox with temp DB for server training
- [ ] Simulated Card Reader (Skill 112) — Dev tap/chip simulation
- [ ] Build online ordering module
- [ ] Create mobile PWA device pairing
- [ ] Implement buzzer/pager integration
- [ ] Create host management module
- [ ] Build live dashboard

---
*Last Updated: January 30, 2026 (PM Session - Evening)*
*Workers Active: 3*
*Tasks Completed Today: 19*
*Tasks In Progress: 4 (T019, T023, T024, T025)*
