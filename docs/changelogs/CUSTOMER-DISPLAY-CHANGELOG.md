# Customer Display Domain Changelog

## 2026-03-02 — CFD Phase 3: Register Wiring + Pairing (Skill 463)

### NUC Backend — Commit `995cb03`

**`bootstrap/route.ts`:**
- `terminalConfig` now includes `terminalId`, `locationId`, and `cfdTerminalId`
- `cfdSettings` added to bootstrap response (tip/signature/receipt/tab/idle config)

**`socket-server.ts` bidirectional CFD relay:**
- Auth middleware: `socket.data.cfdTerminalId` cached from DB
- Register→CFD relay (6 events): `cfd:payment-started`, `cfd:tip-prompt`, `cfd:processing`, `cfd:approved`, `cfd:declined`, `cfd:idle` forwarded to `terminal:{cfdTerminalId}`
- CFD→Register relay (3 events): `cfd:tip-selected`, `cfd:signature-done`, `cfd:receipt-choice` reverse-looked-up to register room via `cfdTerminalId` FK

**`order-events/batch/route.ts`:**
- After ingestion: auto-dispatches `cfd:show-order` from projected `OrderState` (cents payload, zero extra DB queries)

### Android Register — Commit `795dd66`

**CFD wiring:**
- `TokenProvider`: `getCfdTerminalId()` / `setCfdTerminalId()` in EncryptedSharedPreferences
- `SyncDto`: `TerminalConfigDto(terminalId, locationId, cfdTerminalId)` + `CfdSettingsDto` (14 fields)
- `BootstrapWorker`: stores `cfdTerminalId` + 7 `SyncMeta` keys from `CfdSettings`
- `SocketEvent.CfdTipSelected(tipAmountCents: Long)` — new sealed class variant
- `SocketManager`: `registerCfdListeners()` dispatches `cfd:tip-selected` as `CfdTipSelected`
- `OrderSyncController`: pass-through for `CfdTipSelected`
- `PaymentManager`: `loadCfdConfig()` from SyncMeta; `collectCfdTip()` race-free (async started before emitting `cfd:tip-prompt`, 60s timeout); `gratuity` field set on `DatacapAmountFields`

### gwi-cfd — Commit `d17a50b`

**Real pairing screen (`AppNavigation.kt`):**
- Two `OutlinedTextField`s: NUC Base URL + Device Token
- OkHttp `GET {nucUrl}/api/sync/bootstrap` with Bearer auth
- Parses `data.terminalConfig.terminalId` + `.locationId`
- Stores 4 credentials (nucBaseUrl, deviceToken, terminalId, locationId) via `TokenProvider`
- `onPaired()` transitions to main socket-connected flow

**Build fixes:**
- `kotlinOptions { jvmTarget }` → `kotlin { compilerOptions { jvmTarget.set(JVM_17) } }`
- Added `implementation("androidx.appcompat:appcompat:1.7.0")`
- `CfdSocketManager`: `?.ifBlank { null }` on nullable String
- `CfdOrderScreen`: `animateItemPlacement(tween(...))` → `animateItem(placementSpec = tween(...))`
- `themes.xml`: `Theme.AppCompat.Light.NoActionBar`

---

## 2026-03-02 — PAX A3700 CFD System — Phase 1 + Phase 2 (Skills 461-462)

### Phase 1: NUC Backend (Skill 461) — Commit `54b97da`

**Schema additions:**
- `TerminalCategory.CFD_DISPLAY` enum value
- `Terminal`: `cfdTerminalId`, `cfdTerminal` (self-relation), `cfdIpAddress`, `cfdConnectionMode`
- `CfdSettings` model: full per-location CFD configuration (tip, signature, receipt, tab, idle)
- `Location.cfdSettings` reverse relation

**Socket targeting:**
- `emitToTerminal(terminalId, event, data)` in `socket-server.ts` — targeted dispatch to `terminal:{id}` room
- All 5 `dispatchCFD*` functions accept optional `cfdTerminalId` param, fall back to location broadcast if null

**New API routes:**
- `POST /api/hardware/terminals/[id]/pair-cfd` — links A3700 CFD to register, auto-sets CFD_DISPLAY category
- `DELETE /api/hardware/terminals/[id]/pair-cfd` — unlinks
- `GET/PUT /api/hardware/cfd-settings` — per-location CFD config with full validation

**Migration:** `nuc-pre-migrate.js` — 4 idempotent SQL cases for all new schema

### Phase 2: GWI CFD Android App (Skill 462) — Commit `9cc8123`

New repo at `gwi-cfd/`. Full Android Jetpack Compose app for PAX A3700.

**Architecture:** Stateless kiosk (no Room, no WorkManager). NUC socket is sole data source.

**State machine — 8 screens:**
| State | Trigger | Auto-exit |
|-------|---------|-----------|
| `Idle` | `cfd:idle` or timeout | — |
| `Order` | `cfd:show-order` | — |
| `TipPrompt` | `cfd:tip-prompt` | After tip selected |
| `SignaturePrompt` | `cfd:signature-request` | After sign/skip |
| `Processing` | `cfd:processing` | — |
| `Approved` | `cfd:approved` | 4s → Idle (unless ReceiptSent) |
| `Declined` | `cfd:declined` | 3s → Idle |
| `ReceiptOptions` | `cfd:receipt-sent` | Countdown → auto-skip |

**Key design decisions:**
- Socket joins `terminal:{cfdTerminalId}` room (not location room) for targeted dispatch
- Signature encoded as Base64 stroke path data (no bitmap allocation)
- Receipt countdown in ViewModel (`remainingSeconds`), animated progress bar on screen
- `AnimatedContent` 300ms fade between all state transitions
- Amber disconnection banner slides in when NUC socket drops

---

## 2026-02-23 — Chaos Test Fixes (Skill 416)

### Bug 15 (MEDIUM): No Max Tip Validation on CFD
- Customer-facing display accepted any tip amount — accidental or abusive large tips possible
- Fix: Tips exceeding 50% of order total trigger a confirmation screen asking customer to verify
- File: `src/components/cfd/CFDTipScreen.tsx`

---

## 2026-02-23 — CFD Tip Screen Rework (Skill 413)

### Full Rework
- Order summary (subtotal, tax, total) displayed at top of screen
- Tip preset buttons (percentage or dollar amount) with visual selection state
- No Tip button + Custom tip with numeric keypad
- Confirm CTA with live total (base + tip)
- Disconnect overlay with auto-reconnect polling
- Multi-surface type updates for tip screen events

### Files Modified
- `src/components/cfd/CFDTipScreen.tsx` — Full rework
- `src/app/(cfd)/cfd/page.tsx` — CFD tip screen event integration
- `src/types/multi-surface.ts` — Tip screen event types

### Commit
- `e69d5b3` — Payment UX & Safety Wave 1

---

## 2026-02-09 — Domain Created
- Domain 21 established for Customer Display
- Covers CFD state machine, pay-at-table, tip/signature screens
- Split from Guest domain to clarify customer-facing surface ownership
- Domain doc created at `/docs/domains/CUSTOMER-DISPLAY-DOMAIN.md`
