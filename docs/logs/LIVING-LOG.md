# GWI POS — Living Log

> **Rolling development log shared with the team.** Updated every session.
> Newest entries at the top. Each entry includes what was done, commits, deployments, and blockers.

---

## 2026-02-23 — Clerk-Based Owner Access + GWI Access Gate Replacement

**Session theme:** Owner auth — enable location owners to access venues via Clerk; replace GWI access gate phone+code with Clerk email+password

**Summary:** Location owners added in Mission Control's Team tab were getting `clerkUserId: "pending_{email}"` but never receiving a Clerk invitation, so they couldn't authenticate. Fixed by sending Clerk instance-level invitations on team member creation and adding `pending_` reconciliation in `resolveAdminUserId()` to link placeholder records to real Clerk accounts on first login. Replaced the GWI Access gate on barpos.restaurant (phone number + 6-character code) with Clerk email+password login. Extracted `verifyWithClerk()` into a shared module for reuse across venue-login and the new access gate endpoint.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `9a7875b` | feat: replace GWI access gate phone+code with Clerk email+password login |

### Commits — gwi-mission-control

| Hash | Description |
|------|-------------|
| `4fea70c` | feat: send Clerk invitations for location owners and GWI access allowlist |

### Deployments

- **POS** `9a7875b` pushed to `main` → Vercel auto-deploy to `barpos.restaurant` / `*.ordercontrolcenter.com`
- **MC** `4fea70c` pushed to `main` → Vercel auto-deploy to `app.thepasspos.com`

### Features Delivered

**Clerk Invitations for Location Owners (MC)**
- `POST /api/admin/locations/[id]/team` now sends `clerk.invitations.createInvitation()` after AdminUser create/upsert
- Owners receive email invitation → create Clerk account → can log into `{slug}.ordercontrolcenter.com`
- Silently ignores "already invited" / "already exists" errors

**Pending ClerkUserId Reconciliation (MC)**
- `resolveAdminUserId()` in `src/lib/auth.ts` now checks for `pending_{email}` records when direct lookup fails
- One-time reconciliation: updates the placeholder clerkUserId to the real Clerk user ID
- Subsequent logins use the real ID directly

**Clerk Invitations for GWI Access Allowlist (MC)**
- `POST /api/admin/gwi-access/allowlist` sends Clerk invitation when email is provided in body
- Users added to the allowlist get invited to create Clerk accounts

**GWI Access Gate — Clerk Login (POS)**
- Replaced two-step phone+code flow with single-step email+password form at `/access`
- New `POST /api/access/clerk-verify` endpoint verifies credentials via Clerk FAPI and sets `gwi-access` cookie
- `src/lib/access-gate.ts` rewritten: email-based JWT tokens, removed all OTP/phone functions
- Extracted `verifyWithClerk()` to `src/lib/clerk-verify.ts` (shared by venue-login and access gate)
- Removed dead routes: `/api/access/request`, `/api/access/verify`
- Middleware token refresh updated to use `accessPayload.email`

### Files Changed

| Repo | File | Action |
|------|------|--------|
| POS | `src/lib/clerk-verify.ts` | New — shared Clerk FAPI verification module |
| POS | `src/lib/access-gate.ts` | Rewrite — email-based tokens, removed OTP/phone |
| POS | `src/app/access/page.tsx` | Rewrite — email+password form |
| POS | `src/app/api/access/clerk-verify/route.ts` | New — Clerk verify + cookie endpoint |
| POS | `src/app/api/auth/venue-login/route.ts` | Edit — import from shared clerk-verify |
| POS | `src/app/api/admin/access-allowlist/route.ts` | Edit — inlined normalizePhone |
| POS | `src/middleware.ts` | Edit — email-based token refresh |
| POS | `src/app/api/access/request/route.ts` | Deleted — dead phone verification |
| POS | `src/app/api/access/verify/route.ts` | Deleted — dead OTP verification |
| MC | `src/app/api/admin/locations/[id]/team/route.ts` | Edit — send Clerk invitation |
| MC | `src/lib/auth.ts` | Edit — pending_ reconciliation |
| MC | `src/app/api/admin/gwi-access/allowlist/route.ts` | Edit — send Clerk invitation |

### Known Issues / Next Steps
- GWI Access allowlist POST body currently expects phone+name; MC dashboard UI for GWI Access may need updating to collect email instead of (or in addition to) phone
- Existing gwi-access cookies with `phone` payload will fail verification after deploy — users will be redirected to `/access` to re-authenticate with email+password (expected, no data loss)

---

## 2026-02-21 — NUC Fleet Recovery + Sync Agent Self-Update

**Session theme:** Fleet ops — diagnose and fix NUC deployment failures; add self-healing sync agent boot mechanism

**Summary:** Three NUC demo stations were failing FORCE_UPDATE with "git pull failed". Root-caused via SSH to AdminDemo1 (172.16.20.58): old sync agents silently ignore unknown commands, no .git-credentials file, git in merge conflict state, and missing INTERNAL_API_SECRET env var causing npm run build to throw at module level. Fixed AdminDemo1 directly via SSH. Built full remote repair system in Mission Control (REPAIR_GIT_CREDENTIALS command, bootstrap/full-deploy injection modes, Repair Git UI button). Added boot-time self-update to sync agent so NUCs automatically stay current on every reboot. Fixed installer to generate INTERNAL_API_SECRET. Removed module-level throw from datacap/sale that was crashing all NUC builds. Fixed online ordering local preview link using wrong locationId.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `842adb3` | Include actual git error in FORCE_UPDATE failure response |
| `a21feaa` | Sync agent boot self-update + fix NUC build failures |
| `3e1c1e8` | Fix sync agent boot-update edge cases + add local preview link |

### Commits — gwi-mission-control

| Hash | Description |
|------|-------------|
| (deployed to Vercel) | REPAIR_GIT_CREDENTIALS command type in schema; repair-credentials API endpoint; Repair Git + Full Deploy UI in ServerActions |

### Features Delivered

**Skill 407 — NUC Remote Git Repair**
- New `REPAIR_GIT_CREDENTIALS` fleet command in sync-agent.js (new agents): writes token to .git-credentials, verifies with git fetch
- `POST /api/admin/servers/[id]/repair-credentials` (MC, super_admin only): three modes — normal (REPAIR_GIT_CREDENTIALS), bootstrap (SCHEDULE_REBOOT shell injection for old agents), full deploy (entire pipeline in background)
- "Repair Git" + "Full Deploy" buttons in MC ServerActions per server row (super_admin only)

**Skill 408 — Sync Agent Boot Self-Update**
- `checkBootUpdate()` runs on every sync agent startup before connecting to MC
- Downloads latest sync-agent.js from GitHub using stored .git-credentials token
- Atomically replaces file and exits if content differs — systemd restarts with new version
- Falls through silently on any error (no credentials, network down, timeout, empty response)
- settled guard prevents double-start from timeout + error handler both firing

**Skill 409 — Modifier Group Direct Ownership Migration**
- Eliminated `MenuItemModifierGroup` junction table from schema
- Added `showOnline` directly to `ModifierGroup` (data-migrated from junction rows)
- Switched all read paths to `ownedModifierGroups`: `GET /api/menu`, `GET /api/menu/items/[id]`, `GET /api/online/menu`
- Updated write path: `showOnline` toggle writes to `ModifierGroup` directly
- Fixed root cause of online ordering showing items with no modifier groups

### Bug Fixes

| Bug | Fix |
|-----|-----|
| NUC `npm run build` failing with "INTERNAL_API_SECRET required in production" | Removed module-level throw from `src/app/api/datacap/sale/route.ts`; added INTERNAL_API_SECRET auto-generation to installer.run (new + backfill) |
| Online ordering `/order?locationId=10c-1` returning no items | Wrong locationId in URL (real ID is `loc-1`); added local preview link to settings/online-ordering page showing correct URL |
| AdminDemo1 git merge conflict blocking all deployments | Fixed via SSH: `git reset --hard HEAD`; wrote .git-credentials; full rebuild and restart |

### Known Issues / Next Steps
- Fruita Grill and Shanes Admin Demo still need physical access (one visit) to run `installer.run` with re-register option, after which self-update handles everything going forward
- Rotate GitHub PAT shared during session (ghp_leRwO6Vy...) after off-site NUCs are fixed

---

## 2026-02-20 — Pour Size Deduction Fix (Session 14)

**Session theme:** T-006 — pour size multiplier flows all the way to inventory deduction

**Summary:** Pour size selection (shot/double/tall/short) was being applied to pricing but silently dropped before inventory deduction. Added `pourSize` + `pourMultiplier` fields to OrderItem schema, wired them through the store → hook → API chain, and applied the multiplier in both the MenuItemRecipe and liquor RecipeIngredient deduction paths. Zero schema breaking changes (nullable fields). `npx prisma db push` required on NUC deploy.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `cf8c898` | feat(inventory): T-006 — store pourMultiplier on OrderItem, apply in deduction engine |

### Features Delivered

**T-006** — 7 files, 32 insertions. OrderItem.pourSize/pourMultiplier fields added. Frontend passes them through addItem/updateItem. API stores them. Deduction engine applies `pourMult` in MenuItemRecipe path and liquor RecipeIngredient path. Modifier paths unchanged (pre-modifier multipliers remain independent).

### Resolved Task Board Items
T-006

---

## 2026-02-20 — Mobile Auth Security Fix (Session 13)

**Session theme:** T-025 — remove backwards-compat ?employeeId query param bypass from mobile bartender tabs

**Summary:** The `?employeeId` query param auth bypass was the last security hole in the mobile device auth flow. Both mobile/tabs/page.tsx and mobile/tabs/[id]/page.tsx now unconditionally call `checkAuth()` on mount, requiring a valid httpOnly session cookie. RegisteredDevice + MobileSession infrastructure already in place.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `d1868b3` | fix(security): T-025 — remove ?employeeId auth bypass from mobile tabs |

### Features Delivered

**T-025** — `searchParams.get('employeeId')` removed from mobile/tabs/page.tsx and mobile/tabs/[id]/page.tsx. `checkAuth()` always called on mount. Invalid/expired session → redirect to `/mobile/login`. 2 files, ~18 lines removed.

### Resolved Task Board Items
T-025

---

## 2026-02-20 — T-001/T-050/T-017 Cleanup Sprint (Session 12)

**Session theme:** Seed data cleanup, CSS optimization, inventory verification, inventory engine deferral

**Summary:** T-001 links all Ranch ingredient variants to shared InventoryItem in seed.ts. T-050 adds `optimize: true` to postcss for dev/prod CSS parity. T-017 verified code-complete (Skill 291 already fixed root causes). T-011 deferred post-MVP (10-17d data migration, HIGH risk).

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `12da703` | fix(css): T-050 — optimize: true in @tailwindcss/postcss |
| `4870737` | fix(seed): T-001 — link Ranch/RanchDressing/RanchDrizzle to inv-ranch-dressing-001 |

### Resolved Task Board Items
T-001, T-050, T-017 (code-complete), T-014 (verified already done), T-011 (deferred)

---

## 2026-02-20 — Inventory Engine Sprint: T-002/T-004/T-014 (Session 11)

**Session theme:** Inventory deduction hardening — prep item explosion, unit mismatch warnings, bulk move verified

**Summary:** Three inventory tasks cleared. T-002 adds prep item explosion to Path B modifier deductions. T-004 adds unit mismatch warnings at link-time (API + toast) and deduction-time. T-014 verified already complete.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `19ebc15` | feat(inventory): T-004 — unit mismatch warning on modifier→ingredient links |
| `b71b8fe` | feat(inventory): T-002 — prep item explosion for modifier deductions (Path B) |

### Features Delivered

**T-002** — Modifier→PrepItem deductions now explode to raw sub-ingredients. `ORDER_INVENTORY_INCLUDE` includes `prepItem.ingredients.inventoryItem`. Path B: `else if (ingredient?.prepItem)` calls `explodePrepItem()`. 1 file, 32 lines.

**T-004** — `inventory-link` API returns non-blocking `warning` field on cross-category UOM. `useModifierEditor` shows 8s `toast.warning`. Path A+B log `console.warn` with context on null conversion.

**T-014** — Verified complete (already wired). No change needed.

### Resolved Task Board Items
T-002, T-004, T-014

---

## 2026-02-20 — T-071/T-072 Online Ordering Routing + Pages (Session 10)

**Session theme:** Customer-facing online ordering — middleware bypass + dynamic `/{orderCode}/{slug}/` route

**Summary:** T-071 and T-072 shipped. Middleware now bypasses cloud auth for `/:orderCode/:slug` paths. New public `resolve-order-code` endpoint resolves slug → locationId with backward-compatible onlineOrderingEnabled check. Full 3-step online ordering flow (menu → cart → Datacap payment) available at `/{orderCode}/{slug}/` using Next.js 15 async params. Zero TypeScript errors.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `34e237b` | feat(online-ordering): T-071 + T-072 — middleware routing + customer ordering pages |

### Features Delivered

**T-071** — Middleware bypass for `/:orderCode/:slug` and `/api/online|public/*` paths. Runs before cloud auth, sets `x-venue-slug` header, passes through unauthenticated. All existing admin auth untouched.

**T-072** — `src/app/[orderCode]/[slug]/page.tsx` (962 lines): full online ordering flow using `use(params)` for Next.js 15 async params. Calls `GET /api/public/resolve-order-code?slug=X` on mount. Error + not-found pages included. `onlineOrderingEnabled` defaults to allowed if key absent (backward compat).

### Resolved Task Board Items
T-071, T-072

### Known Issues / Blockers
- `Location.settings.onlineOrdering.enabled` key not yet populated — online ordering defaults to allowed for all venues. Need to add toggle in POS settings UI (future task).
- T-046: Socket end-to-end — needs Docker/hardware
- T-049: KDS full flow on Chrome 108 — needs physical device

---

## 2026-02-20 — T-042/T-073/T-075 Multi-Repo Sprint (Session 9)

**Session theme:** Multi-select pre-modifiers (gwi-pos), QR code generation + environment field (gwi-mission-control)

**Summary:** Three tasks shipped across two repos. T-042 uses compound string format to enable multi-select pre-modifiers ("side,extra") with zero schema change. T-073 adds QR code display/download for venue order codes in MC. T-075 adds a deployment environment field to CloudLocation with grouped deploy modal UX.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `77c1de6` | feat(orders): T-042 — multi-select pre-modifiers via compound string format |

### Commits — gwi-mission-control

| Hash | Description |
|------|-------------|
| `f06611e` | feat(locations): T-073 QR code generation + T-075 environment field |

### Features Delivered

**T-042** — Pre-modifiers now support combinations ("Side Extra Ranch"). Compound string `"side,extra"` stored in existing `preModifier String?` field. Toggle helpers, colored badges per token in OrderPanelItem, compound-aware print/KDS/inventory paths. 12 files, no schema change.

**T-073** — QrCodeModal with 256px canvas QR, Download PNG, and Print actions. "Generate QR Code" button in VenueUrlCard when orderCode exists.

**T-075** — `LocationEnvironment` enum + field on CloudLocation (prisma db push applied). EnvironmentSelector segmented control in location detail page. Deploy modal groups locations by Production/Staging/Development sections with color-coded headers.

### Resolved Task Board Items
T-042, T-073, T-075

### Known Issues / Blockers
- T-071/T-072 (online ordering routing + pages) — build in progress
- T-046: Socket end-to-end — needs Docker/hardware
- T-049: KDS full flow on Chrome 108 — needs physical device

---

## 2026-02-20 — T-013 Modifier Multipliers (Session 8)

**Session theme:** Per-modifier Lite/Extra multiplier overrides in Item Builder and inventory deduction engine

**Summary:** T-013 shipped. Added `liteMultiplier` and `extraMultiplier` nullable Decimal fields to Modifier model. Item Builder now shows inline `×` multiplier inputs beside Lite/Extra toggles. Deduction engine applies per-modifier overrides, falling back to location-level defaults. `prisma db push` run to add columns.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `63d72ca` | feat(menu): T-013 — per-modifier liteMultiplier/extraMultiplier in Item Builder |

### Features Delivered

**T-013** — Modifier model gains `liteMultiplier`/`extraMultiplier` (nullable Decimal). Item Builder shows `×` inputs next to Lite/Extra toggles. POST/PUT modifier API persists + returns new fields. `formatModifierGroup()` includes them in responses. Deduction engine applies per-modifier multiplier override with location-default fallback (0.5/2.0).

### Resolved Task Board Items
T-013

### Known Issues / Blockers
- T-046: Socket end-to-end validation — needs Docker/hardware
- T-049: KDS full flow on Chrome 108 — needs physical device
- T-026: Card token persistence — needs live Datacap hardware

---

## 2026-02-20 — T-021/022/034/036 + Task Board Cleanup (Session 7)

**Session theme:** Clear remaining P1/P2 items — normalizeCoord hardening, soft-delete audit, batch close UI, tip adjustment report

**Summary:** Four more tasks shipped. T-034 adds fail-fast dev behavior and context-aware logging to `normalizeCoord`. T-036 fixes two missing `deletedAt: null` guards in floor-plan-elements. T-021 ships the Batch Settlement card in settings. T-022 ships the Tip Adjustment report with live Datacap gratuity adjust. Task board cleaned up (duplicates removed, T-023/T-048 back-filled).

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `b3442a6` | fix(floor-plan): T-034 + T-036 — normalizeCoord context logging + soft-delete guards |
| `aedfad2` | docs: task board — mark T-023/034/036/048 complete, remove duplicate rows |
| `7fe7fb5` | feat(settings): T-021 — Batch Settlement card in settings/payments |
| `0beee97` | feat(reports): T-022 — Tip Adjustment report with per-row Datacap gratuity adjust |

### Features Delivered

**T-034** — `normalizeCoord` now throws in dev on invalid coords (fail-fast). Prod logs tableId+action context. bulk-update route passes context.

**T-036** — Audited 22 DB queries across floor plan routes. Fixed 2 missing `deletedAt: null` in floor-plan-elements POST (menuItem + section validation).

**T-021** — Batch Settlement card in settings/payments: reader selector, live batch summary preview modal, Confirm & Close Batch flow with SAF warning.

**T-022** — `/reports/tip-adjustment`: date-range filter, 3 summary cards, per-row inline Datacap gratuity adjust, disabled for SAF/offline payments, optimistic state update.

### Resolved Task Board Items
T-021, T-022, T-034, T-036 (plus back-filled T-023, T-048)

### Known Issues / Blockers
- T-080 Phase 6: Backoffice surcharge reports (gwi-backoffice) — not yet started
- P1-05: Socket multi-terminal validation — needs Docker/hardware
- P1-07: Card token persistence — needs live Datacap hardware
- T-049: KDS full flow on Chrome 108 — needs physical device

---

## 2026-02-20 — P0/P1 Bug Sprint + T-080 Full Stack + T-016 UI Polish (Session 6)

**Session theme:** Button up all remaining sprint items — P0 floor plan bugs, T-079 partial payments, T-077 EOD, T-080 all phases (POS + MC + receipts), T-016 glassmorphism lift

**Summary:** Cleared all P0 floor plan deployment blockers (T-031, T-032, T-033, T-044), fixed partial payment void-and-retry flow, shipped EOD manager socket notifications, completed T-080 pricing program across all three layers (MC admin UI, POS checkout, receipts/print), and polished the POS ordering interface with glassmorphism throughout.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `423febb` | fix(floor-plan): T-031/033 — remove hot-path console.error, add toast + rollback |
| `ef9eb04` | fix(payments): T-079 — Void & Retry auto-return + split-tender progress banner |
| `87b0a09` | feat(eod): T-077 — EOD businessDay logic fix + socket notification + summary overlay |
| `9a8c423` | feat(pricing): T-080 Phase 3+5 — surcharge line item in checkout + receipts |
| `ac292bf` | feat(ui): T-016 — glassmorphism polish on POS ordering interface |

### Commits — gwi-mission-control

| Hash | Description |
|------|-------------|
| `7c13ecf` | feat(pricing): T-080 Phase 2 — PricingProgramCard MC admin UI |

### Deployments
- All pushed to `main` → Vercel auto-deploys

### Features Delivered

**P0 Floor Plan Fixes** (`423febb`)
- T-031: Removed `console.error` from 5 hot-path handlers (handlePointerUp, handleTableUpdate, handleSeatDrag, handleMoveTable, handleRotateTable) → replaced with `toast.error()`
- T-033: Optimistic rollback added to handlePointerUp (`prevTables` snapshot + restore on catch); `response.ok` check before applying server state
- T-032: Verified deterministic grid placement already in place (no Math.random) — no change needed
- T-044: Verified VOID/COMP stamps correctly render on FloorPlanHome — no change needed

**Partial Payment Fixes** (`ef9eb04`)
- T-079: After Void & Retry succeeds, `onCancel()` called automatically → returns to method selection (no manual dismiss required)
- Split-tender progress banner shows when `pendingPayments.length > 0` ("X of Y payments captured")

**EOD Reset Improvements** (`87b0a09`)
- T-077: `eod-cleanup` route now uses `businessDayDate` OR `createdAt` fallback — consistent with `eod/reset` business day logic
- `eod/reset` emits `eod:reset-complete` socket event with stats after reset
- FloorPlanHome listens for `eod:reset-complete` → toast + `refreshAll()` + dismissable overlay (bottom-right)

**T-080 Phase 3+5 — Surcharge in Checkout + Receipts** (`9a8c423`)
- `useOrderSettings`: exposes `pricingProgram` from location settings cache
- `usePricing`: computes `surchargeAmount` via `calculateSurcharge()` when model=surcharge and method≠cash
- `PaymentModal`: surcharge line item ("Credit Card Surcharge (X%): +$X.XX") + disclosure text visible before confirm
- `Receipt.tsx`: surcharge row between discount and tax; disclosure text above footer
- `print-factory`: ESC/POS surcharge line + disclosure text on thermal receipts
- `daily-report-receipt` / `shift-closeout-receipt`: optional `surchargeTotal` line in revenue/sales sections

**T-080 Phase 2 — MC Pricing Admin UI** (`7c13ecf` in gwi-mission-control)
- `PricingProgramCard.tsx` (750 lines): replaces CashDiscountCard
- 6-pill model selector (none, cash_discount, surcharge, flat_rate, interchange_plus, tiered)
- Conditional form fields per model; surcharge shows CT/MA/PR compliance warning + 3% cap validation
- `buildInitialState()` backward-compat from legacy `dualPricing` settings
- Saves as `settings.pricingProgram` via existing deep-merge endpoint
- `LocationSettings` type + `PricingProgram` interface added to `venue-settings.ts`

**T-016 Glassmorphism UI Polish** (`ac292bf`)
- `FloorPlanMenuItem`: `backdrop-blur(12px)`, elevated box shadows, indigo hover glow
- `OrderPanel`: `backdrop-blur(16px)` on main panel; seat group headers get accent left-border (indigo selected, seat-color otherwise)
- `CategoriesBar`: `blur(10px)` backdrop + bottom border; active category gets glow shadow
- `ModifierGroupSection`: required/optional badges ("• Required" / "• Optional") + left-border CSS classes
- `ModifierModal`: "📝 Special Instructions" label + focus/blur border color transitions

### Resolved Task Board Items
T-016, T-031, T-032 (verified), T-033, T-044 (verified), T-047 (verified), T-077, T-079, T-080 (Phases 1–5)

### Known Issues / Blockers
- T-080 Phase 6: Backoffice reports (gwi-backoffice) — surcharge tracking in cloud reports. Not yet started.
- P1-05: Socket multi-terminal validation — needs real Docker/hardware
- P1-07: Card token persistence — needs live Datacap hardware (blocks Loyalty)
- GL-06: Pre-launch checklist at 8% — manual hardware testing required
- T-049: KDS full flow on Chrome 108 — needs physical KDS device

---

## 2026-02-20 — Full Feature Sweep: All Remaining P1 Tasks (Session 5)

**Session theme:** Clear all remaining backlog items — settings UI, orders manager, pricing engine, small UX fixes

**Summary:** Seven more tasks cleared in a parallel build sprint. All P0 and most P1 items from the backlog are now resolved. T-080 (Pricing Programs) Phase 1+4 shipped; Phases 2/3/5/6 remain for future sessions (Phase 2 is in gwi-mission-control repo).

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `b91bf0b` | fix(ux): T-038/039/052/053 — layout timing, Quick Pick toggle, hydration guard |
| `353dd07` | feat(orders): T-078 — Open/Stale Orders Manager admin page |
| `63c41dd` | feat(settings): T-045 — Walkout Recovery + AutoReboot UI sections |
| `d295212` | feat(pricing): T-080 Phase 1+4 — multi-model pricing engine + settings viewer |

### Deployments
- All pushed to `main` → Vercel auto-deploys

### Features Delivered

**Small UX Fixes** (`b91bf0b`)
- T-038: usePOSLayout now guards behind employeeId before fetching layout — no more "Failed to fetch" on first render
- T-039: Quick Pick Numbers toggle added to gear dropdown in UnifiedPOSHeader; fixed pre-existing bug (quickBarEnabled was toggling quickPickEnabled)
- T-052: Verified quickPickEnabled default already true
- T-053: Added useAuthenticationGuard to floorplan/editor; other admin pages already had it

**Open/Stale Orders Manager** (`353dd07`)
- New `/orders/manager` admin page: filter by status, balance, rolled-over state, text search
- Table shows order age (human-readable), status badges, rolled-over + capture-declined flags
- Bulk Cancel (drafts/$0) + Bulk Void (has balance) with permission check
- Detail modal: full order info, reassign table dropdown, item list with modifiers
- Socket listener (debounced 300ms) for real-time updates
- GET /api/orders: new dateFrom/dateTo/balanceFilter/includeRolledOver params
- POST /api/orders/bulk-action: cancel action (pre-flight rejects pre-auth orders)
- "Open Orders" nav link added to AdminNav (managers only)

**Settings UI Completions** (`63c41dd`)
- Walkout Recovery sub-section: enable toggle, retry frequency, max duration, idle timeout
- AutoReboot card: nightly reboot toggle + delay-minutes input
- Verified Price Rounding toggles + all TipBank advanced sections already existed

**Pricing Program Engine** (`d295212`)
- PricingProgram interface: 6 models (cash_discount, surcharge, flat_rate, interchange_plus, tiered, none)
- New functions: calculateSurcharge(), calculateSurchargeTotal(), calculateFlatRateCost(), calculateInterchangePlusCost(), calculateTieredCost(), isSurchargeLegal() (CT/MA/PR banned), applyPricingProgram() strategy selector
- getPricingProgram() backward-compat helper: reads new field, falls back to legacy dualPricing
- Settings viewer: "Processing Program" card shows all 5 models with color-coded badge + model-specific details
- All existing pricing functions unchanged

### Resolved Task Board Items
T-038, T-039, T-045, T-052, T-053, T-078, T-080 (Phase 1+4)

### Known Issues / Blockers
- T-080 Phases 2/3/5/6 remain: MC admin UI (separate repo), POS checkout surcharge display, receipts, backoffice reports
- P1-05: Socket multi-terminal validation — needs real Docker/hardware
- P1-07: Card token persistence — needs live Datacap hardware (blocks Loyalty)
- GL-06: Pre-launch checklist at 8% — manual hardware testing required
- T-049: KDS full flow on Chrome 108 — needs physical KDS device

---

## 2026-02-20 — P0/P1 Bug Sprint (Session 4)

**Session theme:** Clear deployment blockers + high-priority payment and order fixes

**Summary:** Cleared all P0 floor plan deployment blockers, fixed partial payment flow bugs, improved EOD reset with manager notifications. Also shipped Online Ordering Phase 5 and Shift Swap Phase 2 earlier this session (see commits below).

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `7ff4658` | feat(scheduling): Shift Swap Phase 2 — admin panel + mobile UI |
| `325c044` | feat(online-ordering): Phase 5 — customer order page + Datacap PayAPI checkout |
| `0bc5857` | docs: update Living Log |
| `423febb` | fix(floor-plan): T-031/T-033 — remove hot-path console.error, add toast + rollback |
| `ef9eb04` | fix(payments): T-079 — partial payment flow fixes |
| `87b0a09` | feat(eod): T-077 — EOD manager notification + eod-cleanup businessDay fix |

### Deployments
- All pushed to `main` → Vercel auto-deploys

### Features Delivered

**Shift Swap Phase 2** (`7ff4658`)
- Admin: swap request modal, per-shift icon, Swap Requests panel with approve/reject
- Mobile: incoming swap requests section, outgoing swap request sheet

**Online Ordering Phase 5** (`325c044`)
- Public `/order` page: 3-step flow (menu → cart/customer info → Datacap iFrame checkout)
- `GET /api/online/menu` + `POST /api/online/checkout` (PayAPI, status `received` on approval)

**Floor Plan P0 Fixes** (`423febb`)
- T-031: Removed console.error from 5 hot-path handlers (drag, seat drag, rotate, move, update)
- T-032: Verified deterministic grid placement already in place (Math.random gone)
- T-033: Added toast.error + optimistic rollback (prevTables restore) to all 5 handlers; response.ok guard in handlePointerUp
- T-044: Verified VOID/COMP stamps, voidReason, wasMade all correctly wired

**Partial Payment Fixes** (`ef9eb04`)
- T-047: Verified dispatchOpenOrdersChanged already in both void routes
- T-079: Void & Retry now auto-returns to method selection after void; Payment Progress banner shows collected + remaining when pendingPayments > 0

**EOD Reset Improvements** (`87b0a09`)
- T-077: eod-cleanup now uses businessDayDate instead of midnight UTC cutoff
- eod/reset emits `eod:reset-complete` socket event with stats payload
- FloorPlanHome shows dismissable EOD Summary overlay (cancelled drafts, rolled orders, tables reset) + auto-refreshes table statuses

### Bug Fixes

| Bug | Fix | Commit |
|-----|-----|--------|
| console.error in drag/rotate hot paths | Removed from 5 handlers in UnifiedFloorPlan.tsx | `423febb` |
| Floor plan drag failure: no user feedback | toast.error + state rollback on API failure | `423febb` |
| Void & Retry left staff in limbo | onCancel() called after void to return to method selection | `ef9eb04` |
| eod-cleanup used midnight UTC not business day | Replaced with getCurrentBusinessDay() + businessDayDate filter | `87b0a09` |

### Resolved Task Board Items
T-031, T-032, T-033, T-044, T-047, T-077, T-079

### Known Issues / Blockers
- P1-05: Socket multi-terminal validation — needs real Docker/hardware
- P1-07: Card token persistence — needs live Datacap hardware (blocks Loyalty)
- GL-06: Pre-launch checklist at 8% — manual hardware testing required
- Pricing Programs (T-080): 5-phase surcharge/interchange+/tiered overhaul
- T-078: Open/Stale Orders Manager UI (no UI to view orders from previous days)

---

## 2026-02-20 — P3 Continued: Shift Swap Phase 2 + Online Ordering Phase 5 (Session 3)

**Session theme:** Complete Shift Swap end-to-end + ship Online Ordering Phase 5 customer checkout

**Summary:** Committed remaining Phase 1 shift swap (schema + 7 API routes from prior agent), built full Shift Swap Phase 2 (admin panel + mobile UI), and shipped Online Ordering Phase 5 — the complete customer-facing order page with Datacap hosted iFrame tokenization, 3-step checkout flow, and two new public API routes.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `2bd4c36` | feat(scheduling): Shift Swap Phase 1 — schema + 7 API routes |
| `7ff4658` | feat(scheduling): Shift Swap Phase 2 — admin panel + mobile UI |
| `325c044` | feat(online-ordering): Phase 5 — customer order page + Datacap PayAPI checkout |

### Deployments
- Pushed to `main` → Vercel auto-deploys

### Features Delivered

**Shift Swap Phase 1** (`2bd4c36`)
- New `ShiftSwapRequest` Prisma model: `pending` → `accepted` → `approved` workflow
- 7 API routes: create, list (location-wide), accept, decline, approve (with shift reassignment transaction), reject, soft-cancel (DELETE)
- `prisma db push` applied; `prisma generate` run

**Shift Swap Phase 2** (`7ff4658`)
- Admin scheduling page: swap request modal, per-shift swap icon (shown on hover), Swap Requests panel with Approve/Reject buttons
- Manager direct-approve: calls `/accept` then `/approve` in sequence (bypasses employee acceptance step)
- Mobile schedule page: "Swap Requests For You" section with Accept/Decline, outgoing swap request sheet on each swappable shift
- Mobile schedule API: `scheduleId` added to response shape (needed for swap request URL)

**Online Ordering Phase 5** (`325c044`)
- `GET /api/online/menu` — public, groups items by category, filters online-visible + orderable, includes stock status and modifier groups
- `POST /api/online/checkout` — re-validates prices server-side, generates atomic order number, creates Order + all items/modifiers in one nested write, calls `PayApiClient.sale()`, sets status `received` on approval, hard-deletes on decline (HTTP 402)
- `src/app/(public)/order/page.tsx` — 3-step flow: (1) menu browse with category tabs + item cards + stock badges + ItemModal with modifier validation + floating cart bar; (2) cart review + customer name/email/phone/notes; (3) Datacap hosted iFrame tokenizer + Place Order → success screen
- Card data never touches our servers — iFrame handles tokenization; OTU token sent to checkout API

### Known Issues / Blockers
- P1-05: Socket multi-terminal validation — needs real Docker/hardware
- P1-07: Card token persistence — needs live Datacap hardware (blocks Loyalty)
- GL-06: Pre-launch checklist at 8% — manual hardware testing required
- Pricing Programs: Large, 5-phase (surcharge, interchange+, tiered)

---

## 2026-02-21 — P3 Continued: PayAPI Client + Shift Swap (Session 2)

**Session theme:** Unblock Online Ordering Phase 5 (found + built Datacap PayAPI integration) + begin Scheduling Shift Swap workflow

**Summary:** Session resumed from P3 sprint. Cleared the Online Ordering Phase 5 payment blocker — Datacap PayAPI documentation was located in the project folder (`Datacap/Datacap integration/Pay Api - online ordering/`). Audited the full API spec and built a complete `PayApiClient` library. Also ran full scope audit on Scheduling Shift Swap, then launched Phase 1 build (schema + 7 API routes). Late agent notifications processed (all already committed in prior session — no duplicate work).

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `4cd3024` | feat(payments): Datacap PayAPI V2 client library for online ordering + convert PayAPI docs to .txt |

### Deployments
- Pushed to `main` → Vercel auto-deploys

### Features Delivered

**Datacap PayAPI Client Library** (`4cd3024`)
- `src/lib/datacap/payapi-client.ts`: Full REST client for Datacap PayAPI V2 (card-not-present, eCommerce)
- `PayApiClient` class: `sale()`, `voidSale()`, `refund()`, `preAuth()`, `capture()`, `voidAuth()`, `getTransaction()`
- V2 Basic Auth: `Authorization: Basic BASE64(DATACAP_PAYAPI_MID:DATACAP_PAYAPI_KEY)`
- Cert URL: `https://pay-cert.dcap.com/v2/` / Prod URL: `https://pay.dcap.com/v2/`
- `PayApiError` class with HTTP status + full response for caller inspection
- Simulated mode (`DATACAP_PAYAPI_ENV=simulated`) — fake approved responses, no credentials needed for dev
- `getPayApiClient()` singleton (same pattern as existing `DatacapClient`)
- Converted PayAPI reference docs from `.docx` to `.txt` in project folder

**Client-side tokenization flow (documented, not yet built):**
- Load `https://token.dcap.com/v1/client/hosted` — Datacap hosted iFrame tokenizer
- Customer enters card in iFrame (PCI scope never touches our servers)
- `DatacapHostedWebToken.requestToken()` fires → callback receives `{ Token, Brand, Last4 }`
- Client POSTs OTU token to our checkout API → server calls `POST /credit/sale` → creates Order + Payment
- Credentials: `DATACAP_PAYAPI_TOKEN_KEY` (public, client-side) + MID + ApiKey (private, server-side)

**Shift Swap Audit (completed, build in progress):**
- `ShiftSwapRequest` model needed — `ScheduledShift` has `originalEmployeeId`/`swappedAt`/`swapApprovedBy` for tracking but no workflow model
- Full scope: 1 new schema model, 7 API routes, admin panel components, mobile pages, 4 socket events
- Phase 1 build launched: schema + all 7 API routes (in progress at session end)

### Known Issues / Blockers
- Shift Swap Phase 1 in progress at session end (schema + API routes building)
- Online Ordering Phase 5 (customer `/order` page): unblocked — PayAPI client done; still needs checkout page + Datacap iFrame tokenization UI
- P1-05: Socket multi-terminal validation — needs real Docker/hardware
- P1-07: Card token persistence — needs live Datacap hardware (blocks Loyalty)
- GL-06: Pre-launch checklist at 8% — manual hardware testing required
- Pricing Programs: Large, 5-phase (surcharge, interchange+, tiered)

---

## 2026-02-21 — P3 Feature Sprint (Multi-Agent Team)

**Session theme:** P3 polish sprint (full day) — 13 features built across hardware, reports, scheduling, customers, POS, and floor plan

**Summary:** Continued from P2 completion sprint. Full-day multi-agent sprint resolving virtually all remaining small-to-medium P3 items. Verified 10+ items as already complete (no build needed). Built: Server Performance Report, Online Ordering Phase 3+4, Cash Drawer Signal, Reader Health Dashboard, Scheduling shift edit/delete + mobile view, Customer history pagination + date filter, KDS Browser Version badge, Customer Notes inline editor, Sales Forecasting report, Barcode Scanner (Skill 58), P2-B01 Bottle Service floor plan progress bar + re-auth alert. All remaining items are Large scope or blocked on external dependencies.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `ec61b20` | docs: P2-B01 resolved — bottle service workflow Phase 1 complete |
| `eb30807` | feat(floor-plan): P2-B01 bottle service min-spend progress bar + re-auth alert |
| `99727e9` | docs: MASTER-TODO — integration settings verified complete, logo/round-robin deferred |
| `b9dfc57` | docs: MASTER-TODO — customer notes, KDS browser version, shift swap scope |
| `30bf5f7` | docs: MASTER-TODO — forecasting report + barcode scanner resolved |
| `ea47c11` | feat(pos): Barcode Scanner / SKU item lookup (Skill 58) |
| `d9343c5` | feat(reports): Sales Forecasting report — day-of-week patterns + 14-day projection |
| `d0a8dc5` | feat(customers): inline notes editor in customer detail modal |
| `ea967d9` | feat(kds): display Chrome version on KDS admin page |
| `65a6575` | docs: living log — P3 sprint session (2026-02-21) |
| `add469a` | docs: update MASTER-TODO — scheduling + customer history resolved |
| `52438dc` | feat(customers): order history pagination + date range filter |
| `3b26b0e` | feat(scheduling): shift edit/delete API + mobile schedule view |
| `3ff3755` | feat(hardware): Reader Health Dashboard — PaymentReaderLog schema + health API + dashboard UI |
| `f10c9cb` | feat(hardware): Skill 56 — Cash Drawer Signal on cash payment |
| `573446c` | feat(online-ordering): P3 Online Ordering Phase 3+4 — useMenuSocket hook + isOrderableOnline utility |
| `1a1f8f5` | feat(reports): Server Performance Report + mark P1-01 verified |
| `58cb7cc` | docs: P2 sprint session 2 complete — all P2 items resolved |

### Deployments
- All commits pushed to `main` → Vercel auto-deploys to `barpos.restaurant` / `*.ordercontrolcenter.com`

### Features Delivered

**Server Performance Report** (`1a1f8f5`)
- `GET /api/reports/server-performance`: groups paid orders by employee, computes totalSales/tips/orderCount/avgCheckSize/tableTurns; sorted by revenue desc
- `/reports/server-performance` page: date range filter, 4 summary cards, server table with gold #1 badge for top performer, CSV export

**Online Ordering Phase 3+4** (`573446c`)
- `src/hooks/useMenuSocket.ts`: subscribes to location room via `getSharedSocket()`; routes `menu:item-changed`, `menu:stock-changed`, `menu:structure-changed` to callbacks; stale-closure safe via `callbacksRef`; cleanup releases socket
- `src/lib/online-availability.ts`: `computeIsOrderableOnline()` (showOnline → isAvailable → stock → availableDays → time windows incl. overnight); `getStockStatus()` (out_of_stock/low_stock/in_stock)
- `menu/items/[id]/route.ts`: stock change dispatch now uses full `computeIsOrderableOnline()` instead of bare `isAvailable`

**Cash Drawer Signal** (`f10c9cb`)
- `src/lib/cash-drawer.ts`: `triggerCashDrawer(locationId)` finds receipt printer by `printerRole`, sends ESC/POS DRAWER_KICK byte sequence; always resolves, never throws
- `POST /api/print/cash-drawer`: withVenue, delegates to `triggerCashDrawer`, always 200
- `pay/route.ts`: fire-and-forget `triggerCashDrawer` guarded by `hasCash` flag

**Reader Health Dashboard** (`3ff3755`)
- Schema: `PaymentReaderLog` model (locationId, readerId, responseTime, success, errorCode, tranType). db:push applied.
- `src/lib/reader-health.ts`: `logReaderTransaction()` — creates log row + fire-and-forget rolling avg/successRate update on `PaymentReader` (last 50 logs); `getReaderHealthSummary()` — returns metrics + 10 recent errors
- `GET /api/hardware/readers/health`: all-readers summary or single-reader detail; withVenue
- `/settings/hardware/health` page: per-reader cards, color-coded response time + success rate, online/offline badge, 30s auto-refresh
- `DatacapClient.withPadReset`: timing wrapper tracks startTime/endTime, captures tranType before padReset clears it, logs every transaction fire-and-forget

**Scheduling — Shift Edit/Delete + Mobile View** (`3b26b0e`)
- `PUT/DELETE /api/schedules/[id]/shifts/[shiftId]`: update shift fields (date, times, role, notes, employee) or soft-delete; ownership validated
- Admin scheduling page: pencil/× hover buttons on draft shift cards; `EditShiftModal` for inline editing; `refreshSelectedSchedule()` helper used by add/edit/delete
- `GET /api/mobile/schedule`: returns upcoming published shifts (today + N weeks) for an employee
- `/mobile/schedule` page: auth-guarded, week-grouped shift cards (This Week / Next Week / Week of…), 12h time format, status color badges, role icon, notes; dark theme matching mobile style
- Mobile tabs header: "Schedule" nav link with calendar icon

**Customer Order History Pagination** (`52438dc`)
- `GET /api/customers/[id]`: accepts `page`, `limit` (max 50), `startDate`, `endDate`; uses `Prisma.OrderWhereInput` to avoid readonly array TS errors; returns `ordersPagination: { page, limit, total, totalPages }`
- Customer detail modal: date range inputs (start/end) + Apply/Clear buttons + Prev/Next pagination controls in "Recent Orders" section

**KDS Browser Version** (`ea967d9`)
- Heartbeat route extracts Chrome/browser version from `user-agent` header, stores in existing `deviceInfo` JSON field
- `GET /api/hardware/kds-screens` now returns `deviceInfo` in response
- KDS admin page shows "Chrome X.Y" badge next to last-seen timestamp (hidden until first heartbeat)

**Customer Notes Inline Editor** (`d0a8dc5`)
- Replaced read-only yellow box with persistent editable card in customer detail modal
- Pencil icon toggles edit mode → textarea auto-focuses → Save (`PUT /api/customers/[id]` with notes) or Cancel
- Empty state: "No notes. Click the pencil to add." placeholder
- Edit state resets on modal close

**Sales Forecasting Report** (`d9343c5`)
- `GET /api/reports/forecasting`: businessDayDate OR-fallback, 84-day lookback by default, groups by weekday (JS `.getDay()`), projects forward N days using day-of-week averages
- `/reports/forecasting` page: lookback/horizon selectors (28/56/84 days, 7/14 days), 3 summary cards (Strongest Day gold, Weakest Day, Projected 7-Day Revenue), day-of-week table with gold ★ for top day, forecast table with Today/Tomorrow badges
- Reports hub: new "Sales Forecasting" tile in Sales & Revenue section

**Barcode Scanner / SKU Lookup — Skill 58** (`ea47c11`)
- `GET /api/menu/search?sku=X`: exact-match on `MenuItem.sku` (already indexed `@@unique([locationId, sku])`), returns same response shape as name search
- `useMenuSearch`: new `lookupBySku(sku)` function + `isSkuMode`/`skuResults` state path
- `MenuSearchInput` + `UnifiedPOSHeader`: global keyboard-wedge detector (100ms burst heuristic → buffer; Enter with buffer.length ≥ 3 + input unfocused → `onScanComplete`)
- `orders/page.tsx`: `handleScanComplete` → `lookupBySku` → `handleSearchSelect` (adds to order) or `toast.error("Item not found: {sku}")`

**P2-B01 Bottle Service Floor Plan Progress Bar + Re-Auth Alert** (`eb30807`)
- `snapshot.ts`: added `subtotal` + `bottleServiceDeposit` to order select; computes `bottleServiceCurrentSpend` and `bottleServiceReAuthNeeded` (≥ 80% of deposit triggers flag)
- `FloorPlanTable` interface: `bottleServiceCurrentSpend?` + `bottleServiceReAuthNeeded?` fields
- `FloorPlanHome`: passes new fields through active + non-active bottle service badge objects
- `TableNode`: 4px horizontal progress bar (tier color → green when min spend met) with "$X / $Y min" label below; amber "⚠ Extend" badge when `reAuthNeeded` is true

### Bug Fixes

| Bug | Fix | Commit |
|-----|-----|--------|
| `as const` on Prisma `status: { in: [...] }` caused `readonly` type error | Typed `ordersWhere` as `Prisma.OrderWhereInput`, removed `as const`, mutated `createdAt` conditionally | `52438dc` |
| `Schedule.name` field doesn't exist — mobile schedule API tried to select it | Changed to `weekStart`/`weekEnd` select, display uses `getWeekLabel()` helper | `3b26b0e` |

### Verified Complete (No Build Needed)

| Item | Finding |
|------|---------|
| P1-01 Void & Retry | All 5 layers already implemented |
| Online Ordering Phase 2 | All active menu CRUD routes dispatch socket events |
| Product Mix Trends | `/reports/product-mix` + API already built |
| Void/Comp Report | `isComp` correctly derived at runtime from `reason` field |
| Quick Pick toggle | Lives in gear menu, calls `updateLayoutSetting()` |
| KDS prep station assignment | `KDSScreenStation` junction model, admin UI, fully DB-driven |
| Customer Favorites | Auto-computed top-5 from order history — complete as-is |
| Integration Settings (SMS/Slack/Email) | All three settings pages + APIs + Twilio/Resend/alert-service fully built |
| Bottle Service deposit pre-auth | `POST /api/orders/[id]/bottle-service` fully implemented (collectCardData → preAuth → OrderCard) |
| Bottle Service re-auth | `POST /api/orders/[id]/bottle-service/re-auth` built; `BottleServiceBanner` shows amber "Extend" alert at 80% |

### Known Issues / Blockers
- GL-06: Pre-launch checklist at 8% — requires manual hardware testing
- Online Ordering Phase 5 (customer-facing `/order` page) — Large effort, blocked on payment processor decision (Stripe vs Datacap)
- Scheduling shift request/swap — Large (18-20 files, needs new `ShiftSwapRequest` model); use existing shift edit as workaround
- P1-05: Socket layer multi-terminal validation — needs real Docker/hardware environment
- P1-07: Card token persistence test — needs live Datacap hardware (blocks Loyalty Program)
- Pricing Programs (surcharge, interchange+, tiered) — Large, 5-phase overhaul
- ESC/POS custom logo — deferred (needs image processing lib + real printer testing)
- Printer round-robin — deferred (wait for venue with 3+ same-role printers)

---

## 2026-02-20 — P2 Feature Sprint Session 2 (Multi-Agent Team)

**Session theme:** P2 completion sprint — item discounts, employee discounts, bottle service floor plan + reservations, mobile auth, print routing, mobile tab sync, pay-at-table sync

**Summary:** Continuation of the P2 sprint. Completed all remaining P2 items: P2-D01 (Item-Level Discounts — schema + API + UI), P2-D02 (Employee Discount UX — isEmployeeDiscount flag + dedicated section in DiscountModal), P2-D03 (verified correct — no fix needed), P2-B02 (Bottle Service floor plan tier badge via snapshot batch-fetch), P2-B03 (Bottle Service Reservation workflow — schema + API + UI + order creation auto-link), P2-E02 (Mobile Device Auth — RegisteredDevice + MobileSession models, PIN-based session cookie, /mobile/login page, auth guard on mobile tabs). Also includes P2-H04, P2-H05, P2-H01, P2-H02 from the first half of this session. All P2 items are now resolved.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `ae8f76e` | feat(mobile): P2-E02 — Mobile Device Authentication (PIN + session cookie) |
| `690b52c` | feat(reservations): P2-B03 — Bottle Service Reservation Workflow |
| `298ceb3` | feat(floor-plan): P2-B02 — Bottle Service tier badge on table cards |
| `4c9ca42` | feat(discounts): P2-D02 — Employee Discount UX |
| `eed6334` | feat(orders): P2-D01 — Item-Level Discounts: schema + API + UI |
| `df88cf2` | feat(print): P2-H02 — Modifier-only ticket context lines |
| `43bf02b` | feat(print): P2-H01 — Print Routing Phase 3 |
| `72f725b` | feat(mobile): P2-H05 — Pay-at-Table socket sync on payment completion |
| `65c38b8` | feat(mobile): P2-H04 — Mobile Bartender Tab Sync socket wiring |
| `ba88936` | docs: update living log + MASTER-TODO — P2-D04, P2-H03, P1-03, P2-R01, P2-R03, P2-P02 resolved |

### Features Delivered

**P2-D01 — Item-Level Discounts** (`eed6334`)
- New `OrderItemDiscount` model: locationId, orderId, orderItemId, discountRuleId?, amount, percent, appliedById, reason. Back-relations on Location/Order/OrderItem/DiscountRule. db:push applied cleanly.
- `POST /api/orders/[id]/items/[itemId]/discount` — apply fixed/percent discount; caps at item total; rejects paid orders (409); increments Order.discountTotal atomically
- `DELETE /api/orders/[id]/items/[itemId]/discount?discountId=` — soft-delete, decrements discountTotal
- `OrderPanelItem`: "%" button (green when active), strikethrough original price, `-$amount` in green below item price

**P2-D02 — Employee Discount UX** (`4c9ca42`)
- Added `isEmployeeDiscount Boolean @default(false)` to `DiscountRule` schema (db:push applied)
- GET/POST `/api/discounts` + PUT `/api/discounts/[id]`: accept + filter/save `isEmployeeDiscount`
- Admin `/discounts` page: "Employee Discount" checkbox with green EMPLOYEE badge
- `DiscountModal`: employee discounts surfaced in a dedicated top section with EMPLOYEE badge header; regular discounts follow below

**P2-D03 — Discount + Void/Refund Interaction** — Verified correct, no fix needed. `payment.amount` always stores discounted amount. Void uses `recordNo` referencing original charge. Refund ceiling is `payment.amount`. Zero code change.

**P2-B02 — Bottle Service Floor Plan Integration** (`298ceb3`)
- `snapshot.ts`: adds `isBottleService`, `bottleServiceTierId`, `bottleServiceMinSpend` to order select; batch-fetches tier names/colors via single `findMany` post-query (zero queries when no bottle service orders)
- `FloorPlanTable` interface: 5 new optional bottle service fields on `currentOrder`
- `TableNode`: `isBottleService`/`tierName`/`tierColor` added to `orderStatusBadges` prop; renders colored tier name pill (defaulting to gold `#D4AF37`) as the first badge
- `FloorPlanHome`: computes bottle service badge for active table; passes minimal badge for all non-active bottle service tables

**P2-B03 — Bottle Service Reservation Workflow** (`690b52c`)
- Schema: `bottleServiceTierId` + `BottleServiceTier` relation on `Reservation`; back-relation on `BottleServiceTier`. `@@index([bottleServiceTierId])` added. db:push applied.
- GET/POST `/api/reservations` + GET/PUT `/api/reservations/[id]`: include `bottleServiceTier` select, accept/save `bottleServiceTierId`
- Reservations admin UI: tier selector dropdown with live color preview; colored tier pill badge on reservation card
- POST `/api/orders`: accept optional `reservationId`; fire-and-forget links `reservation.orderId` and copies `bottleServiceTierId`/`isBottleService`/`bottleServiceMinSpend` to the new order

**P2-E02 — Mobile Device Authentication** (`ae8f76e`)
- Schema: `RegisteredDevice` + `MobileSession` models; back-relations on `Location` + `Employee`. db:push applied.
- `POST /api/mobile/device/register`: PIN validation via bcrypt, creates/reuses `RegisteredDevice` by fingerprint, issues 256-bit hex session token, sets `httpOnly` `mobile-session` cookie (8h, path: `/mobile`)
- `GET /api/mobile/device/auth`: validates cookie or `x-mobile-session` header, returns employee data; 401 on expired/missing
- `/mobile/login`: dark-theme PIN pad page; POSTs PIN → redirects to `/mobile/tabs` on success
- `/mobile/tabs` + `/mobile/tabs/[id]`: auth check on mount; redirects to `/mobile/login` on 401; backwards-compatible with legacy `?employeeId` param

**P2-H04 — Mobile Bartender Tab Sync** (`65c38b8`)
- `TAB_ITEMS_UPDATED: 'tab:items-updated'` + `TabItemsUpdatedEvent` added to `multi-surface.ts`
- 3 dispatch helpers in `socket-dispatch.ts`: `dispatchTabClosed`, `dispatchTabStatusUpdate`, `dispatchTabItemsUpdated`
- Socket relay handlers in `socket-server.ts` for `TAB_CLOSE_REQUEST`, `TAB_TRANSFER_REQUEST`, `TAB_ALERT_MANAGER`
- `close-tab/route.ts`: `dispatchTabClosed` called after successful capture
- `items/route.ts`: `dispatchTabItemsUpdated` called for bar tab item changes

**P2-H05 — Pay-at-Table Socket Sync** (`72f725b`)
- New `POST /api/orders/[id]/pat-complete`: marks order paid, creates Payment records, dispatches `orders:list-changed` + `tab:updated` + `floorplan:update`, idempotent
- `pay-at-table/page.tsx`: `accumulatedTipRef` tracks tip across splits; fire-and-forget `pat-complete` call on last split in both direct Datacap path and socket path

**P2-H01 — Print Routing Phase 3** (`43bf02b`)
- New `src/types/print/route-specific-settings.ts` with `RouteSpecificSettings` interface + `DEFAULT_ROUTE_SETTINGS`
- `kitchen/route.ts`: PrintRoute fetch by priority; tier-1 matching by categoryIds/itemTypes; modifier routing split (`follow`/`also`/`only`) with synthetic `_modifierOnlyFor` items; backup printer failover on failure

**P2-H02 — Modifier-Only Context Lines** (`df88cf2`)
- `kitchen/route.ts`: renders `FOR: {item name}` context line before modifier list when `_modifierOnlyFor` is set

### Known Issues / Next Up
- All P2 items ✅ resolved
- P1-01 (Partial Payment Void & Retry) still pending hardware test
- P1-05 (Socket layer Docker validation) still pending
- P1-07 (Card token persistence test) still pending
- GL-06 (Pre-Launch checklist tests) — 8% complete

---

## 2026-02-20 — P2 Feature Sprint Session 1 (Multi-Agent Team)

**Session theme:** P2 features — closed orders UI, AR aging report, hourly sales, refund vs void, discount on receipt, CFD socket wiring

**Summary:** Multi-agent sprint delivering 7 P2/P1 features. P2-R01 (Closed Orders UI) and P1-03 (House Accounts AR Report) fully built. P2-R03 (Hourly Sales) added with CSS-only bar chart. P2-P02 (Refund vs Void) delivered in 3 phases: schema migration, two new routes, and VoidPaymentModal UI overhaul. P2-D04 discount line added to thermal receipt builder. P2-H03 wired 4 CFD socket emit calls across 5 files. All previously-built APIs reused — zero duplicate work.

### Commits — gwi-pos

| Hash | Description |
|------|-------------|
| `b693b5f` | feat(cfd): P2-H03 — wire CFD socket emit calls |
| `d8a8432` | fix(receipts): P2-D04 — add discount line to thermal receipt builder |
| `2fab494` | feat(orders): P2-R01 — Closed Orders Management UI |
| `d515a88` | docs: update MASTER-TODO — sprint completions 2026-02-20 |
| `b0b9678` | docs: update living log for 2026-02-20 sprint session |
| `dc95f38` | Fix deployment: Decimal→number type error + auth guard + P2-B01 auto-grat |
| `78e0859` | feat(reports): P1-03 — House Accounts Aging Report + Record Payment endpoint |
| `2f81fde` | chore: regenerate schema.sql |
| `0cf6786` | feat(reports): P2-R03 — Hourly Sales Breakdown report |
| `54ccb3e` | feat(schema): P2-P02 Phase 1 — add Payment.settledAt + RefundLog model |
| `4b62e9e` | feat(payments): P2-P02 Phase 2 — Datacap refund route + refund-payment route |
| `b8644a1` | feat(payments): P2-P02 Phase 3 — Refund vs Void distinction in VoidPaymentModal |

### Deployments
- gwi-pos → pushed to `origin/main` (Vercel auto-deploy on each commit)

### Features Delivered

**P2-R01 — Closed Orders Management UI** (`2fab494`)
- New page at `/settings/orders/closed`
- Filter bar: date range (today default), server, order type, tip status, text search
- Summary stats: order count, total revenue, needs-tip count
- Orders table with cursor-based pagination, amber "Needs Tip" badges
- Row actions: Reopen (ReopenOrderModal + manager PIN), Adjust Tip (AdjustTipModal + PIN), Reprint Receipt (browser print)
- All 3 modals (ManagerPinModal, ReopenOrderModal, AdjustTipModal) already existed — reused

**P1-03 — House Accounts Aging Report + Record Payment** (`78e0859`)
- New `POST /api/house-accounts/[id]/payments` — records cash/check/ACH payment atomically (updates balance + creates HouseAccountTransaction)
- New `GET /api/reports/house-accounts` — AR aging with 30/60/90/over-90 day buckets from oldest unpaid charge
- New `/reports/house-accounts` page: 6 summary cards (Total Outstanding, Current, 30/60/90 day buckets), accounts table with aging badges, inline Record Payment form, CSV export
- Added "Accounts Receivable" tile to reports hub Operations section

**P2-R03 — Hourly Sales Breakdown** (`0cf6786`)
- New `GET /api/reports/hourly` — 24-hour breakdown for a business day, optional compareDate overlay, 4 AM rollover support
- New `/reports/hourly` page: CSS-only bar chart (no chart library), data table toggle, peak hour highlighted purple, compare date overlay in orange
- 4 summary cards: Total Revenue, Total Orders, Peak Hour, Avg Order Value
- Added "Hourly Sales" tile to reports hub Sales & Revenue section

**P2-P02 — Refund vs Void UX Distinction** (3 commits: `54ccb3e`, `4b62e9e`, `b8644a1`)
- Phase 1 (Schema): Added `Payment.settledAt DateTime?` + new `RefundLog` model (refundAmount, originalAmount, refundReason, Datacap refs, approval chain, receipt tracking). Back-relations on Order, Employee, Location. db:push clean — zero data loss.
- Phase 2 (Routes): `POST /api/datacap/refund` (calls DatacapClient.emvReturn with ReturnByRecordNo for card-not-present). `POST /api/orders/[id]/refund-payment` (validates manager permission, Datacap call for cards, atomic db.$transaction: update Payment + create RefundLog + AuditLog).
- Phase 3 (UI): Updated `VoidPaymentModal.tsx` — detects `payment.settledAt` to show Refund vs Void path. Amber "Refund $X.XX" button with partial refund input, reader dropdown for card payments. All existing void functionality preserved.

### Bug Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Vercel deploy failure (TS2322) | GL-08 fix returned Prisma `Decimal` object where `number` expected | Wrapped `DEFAULT_MULTIPLIERS` fallbacks in `Number()` in helpers.ts — commit `dc95f38` |

**P2-D04 — Discount Line on Thermal Receipt** (`d8a8432`)
- Added `discount?: number` to `totals` parameter type in `src/lib/print-factory.ts`
- Conditional discount line renders between Subtotal and Tax: `Discount: -$X.XX`
- Callers pass `discount: Number(order.discountTotal)` — zero impact on receipts with no discount

**P2-H03 — CFD Socket Event Wiring** (`b693b5f`)
- Added `RECEIPT_SENT: 'cfd:receipt-sent'` to `CFD_EVENTS` in `src/types/multi-surface.ts`
- Added 4 fire-and-forget CFD dispatch functions to `src/lib/socket-dispatch.ts`: `dispatchCFDShowOrder`, `dispatchCFDPaymentStarted`, `dispatchCFDTipPrompt`, `dispatchCFDReceiptSent`
- `PaymentModal.tsx` emits `cfd:show-order` when modal opens (order summary to CFD)
- `DatacapPaymentProcessor.tsx` emits `cfd:payment-started` before card reader activates
- `src/app/api/orders/[id]/pay/route.ts` emits `cfd:receipt-sent` server-side on full payment

### Known Issues / Next Up
- P2-H04 (Mobile Bartender Tab Sync) — queued
- P2-H05 (Pay-at-Table Socket Sync) — queued
- P2-D01 (Item-level discounts) — needs schema + API + UI, queued

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
