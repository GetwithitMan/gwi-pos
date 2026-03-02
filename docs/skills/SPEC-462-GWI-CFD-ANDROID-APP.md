# Skill 462 — GWI CFD Android App (PAX A3700)

**Domain:** Hardware / Customer Display / Android
**Status:** DONE
**Dependencies:** Skill 461 (NUC Backend)
**Repo:** `gwi-cfd/` at `/Users/brianlewis/Documents/My websites/GWI-POS FULL/gwi-cfd/`
**Commit:** `9cc8123`
**Date:** 2026-03-02

---

## Overview

Full Android Jetpack Compose application for the PAX A3700 customer-facing display. Stateless kiosk — no Room DB, no WorkManager. Driven entirely by Socket.IO events from the NUC.

---

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Kotlin | 2.3.0 | Language |
| Jetpack Compose | BOM 2026.02.01 | UI |
| Hilt | 2.59.2 | DI |
| Socket.io-client | 2.1.0 | Real-time NUC events |
| Retrofit + OkHttp | 2.11.0 | HTTP (future: pairing API) |
| Moshi | 1.15.1 | JSON |
| EncryptedSharedPreferences | — | Secure token storage |
| **NO Room** | — | Stateless — no local DB |
| **NO WorkManager** | — | No background sync |

---

## Architecture

```
NUC Socket.IO
    │  (WiFi LAN, room: terminal:{terminalId})
    ▼
CfdSocketManager (@Singleton)
    │  SharedFlow<CfdEvent>
    ▼
CfdViewModel (@HiltViewModel)
    │  StateFlow<CfdScreenState>
    ▼
AppNavigation (AnimatedContent)
    │
    ├─ CfdIdleScreen
    ├─ CfdOrderScreen
    ├─ CfdTipScreen
    ├─ CfdSignatureScreen
    ├─ CfdProcessingScreen
    ├─ CfdApprovedScreen
    ├─ CfdDeclinedScreen
    └─ CfdReceiptScreen
```

---

## Socket Events

### Inbound (NUC → CFD) — 9 events

| Event | CfdEvent type | Screen triggered |
|-------|---------------|-----------------|
| `cfd:show-order` | `ShowOrder` | Order |
| `cfd:payment-started` | `PaymentStarted` | (no UI change — stashes orderId) |
| `cfd:tip-prompt` | `TipPrompt` | TipPrompt |
| `cfd:signature-request` | `SignatureRequest` | SignaturePrompt |
| `cfd:processing` | `Processing` | Processing |
| `cfd:approved` | `Approved` | Approved → 4s → Idle |
| `cfd:declined` | `Declined` | Declined → 3s → Idle |
| `cfd:idle` | `Idle` | Idle |
| `cfd:receipt-sent` | `ReceiptSent` | ReceiptOptions (cancels Approved timer) |

### Outbound (CFD → NUC) — 3 events

| Event | Payload | Trigger |
|-------|---------|---------|
| `cfd:tip-selected` | `{ tipAmountCents }` | Customer taps tip preset |
| `cfd:signature-done` | `{ signatureData }` | Customer signs or skips |
| `cfd:receipt-choice` | `{ choice, recipient? }` | Customer picks receipt method |

---

## State Machine

```kotlin
sealed class CfdScreenState {
    object Idle : CfdScreenState()
    data class Order(items, subtotalCents, taxCents, totalCents) : CfdScreenState()
    data class TipPrompt(totalCents, tipMode, tipOptions, tipStyle, showNoTip, selectedTipCents?) : CfdScreenState()
    data class SignaturePrompt(amountCents, signatureEnabled) : CfdScreenState()
    data class Processing(message) : CfdScreenState()
    data class Approved(amountCents, last4?) : CfdScreenState()
    data class Declined(reason?) : CfdScreenState()
    data class ReceiptOptions(orderId, emailEnabled, smsEnabled, printEnabled, timeoutSeconds, remainingSeconds) : CfdScreenState()
}
```

### Timer behavior (CfdViewModel)

| Trigger | Timer | Cancels when |
|---------|-------|-------------|
| `Approved` state | 4s → Idle | `ReceiptSent` arrives |
| `Declined` state | 3s → Idle | Any new event |
| `ReceiptOptions` state | Countdown (1s ticks) | Customer taps choice |
| Countdown hits 0 | auto-emit `cfd:receipt-choice("skip")` → Idle | — |

---

## Screens

### CfdIdleScreen
- Live clock (`hh:mm a`) + date (`EEEE, MMMM d, yyyy`) via `LaunchedEffect` loop
- Welcome text (placeholder — will come from CfdSettings)
- "Tap items on register" hint text
- Double-tap logo → `viewModel.onReturnToIdle()` (emergency reset)
- Fade-in on enter

### CfdOrderScreen
- 60/40 landscape split: item list (left) + totals panel (right)
- `LazyColumn` with `animateItemPlacement` for smooth item additions
- `"$%.2f".format(cents / 100.0)` money formatting everywhere

### CfdTipScreen
- Preset buttons: 140×100dp cards, `animateColorAsState` for selection highlight
- `calculateTipCents(total, preset, style)` pure function on ViewModel
- Dollar style: `preset.toLong() * 100`; Percent style: `(total * value / 100.0).roundToLong()`
- No Tip button conditional on `showNoTip`
- Does NOT advance state on tap — waits for `cfd:processing` from server

### CfdSignatureScreen
- Two-panel: instructions + action buttons (40%) | drawing canvas (60%)
- `detectDragGestures` tracks strokes as `List<List<Offset>>`
- Done: encodes strokes as `"x,y;...|"` then Base64 (`NO_WRAP`)
- Skip: `onSignatureDone(null)`
- If `signatureEnabled == false`: auto-calls `onSignatureDone(null)` after 500ms

### CfdProcessingScreen
- `CircularProgressIndicator` 80dp, `PrimaryIndigo`, 6dp stroke
- Server-provided message text

### CfdApprovedScreen
- `CheckCircle` icon 120dp in `GreenApproved`
- `AnimatedVisibility`: `fadeIn + scaleIn` on appear

### CfdDeclinedScreen
- `Cancel` icon 120dp in `RedDeclined`
- Shake animation: `Animatable` oscillates ±12dp → 0 over 480ms

### CfdReceiptScreen
- Email / SMS / Print buttons (conditional on flags)
- No Receipt always shown
- `LinearProgressIndicator` with `animateFloatAsState` countdown
- Auto-skip when `remainingSeconds` reaches 0

### AppNavigation
- `AnimatedContent(targetState = screenState)` with 300ms fade transitions
- `CfdPairingScreen` shown when `startPaired == false`
- Amber disconnection banner: `AnimatedVisibility(slideInVertically + fadeIn)` when socket drops

---

## File Structure

```
gwi-cfd/
├── settings.gradle.kts, build.gradle.kts, gradle.properties, local.properties
├── gradle/libs.versions.toml, wrapper/gradle-wrapper.properties
└── app/
    ├── build.gradle.kts, proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml         (landscape, keepScreenOn, WAKE_LOCK)
        └── java/com/gwi/cfd/
            ├── GwiCfdApp.kt            (@HiltAndroidApp)
            ├── data/TokenProvider.kt   (EncryptedSharedPreferences)
            ├── di/AppModule.kt         (Hilt singleton bindings)
            ├── socket/
            │   ├── CfdEvents.kt        (CfdEventNames, CfdEvent sealed interface, CfdOrderItem)
            │   └── CfdSocketManager.kt (@Singleton, joins terminal room, 3 outbound emitters)
            └── ui/
                ├── CfdViewModel.kt     (@HiltViewModel, state machine, timers)
                ├── MainActivity.kt     (FLAG_KEEP_SCREEN_ON, calls AppNavigation)
                ├── navigation/AppNavigation.kt
                ├── screen/
                │   ├── CfdScreenState.kt
                │   ├── CfdIdleScreen.kt
                │   ├── CfdOrderScreen.kt
                │   ├── CfdTipScreen.kt
                │   ├── CfdSignatureScreen.kt
                │   ├── CfdPaymentScreens.kt   (Processing, Approved, Declined)
                │   └── CfdReceiptScreen.kt
                └── theme/Color.kt, Theme.kt, Type.kt
```

---

## Color Palette

| Color | Hex | Usage |
|-------|-----|-------|
| BackgroundDark | 0xFF0F172A | Full-screen background |
| SurfaceDark | 0xFF1E293B | Cards, panels |
| SurfaceVariant | 0xFF334155 | Dividers, borders |
| OnSurface | 0xFFF1F5F9 | Primary text |
| OnSurfaceVariant | 0xFF94A3B8 | Secondary/muted text |
| PrimaryIndigo | 0xFF4F46E5 | Accent, selected state |
| PrimaryIndigoDark | 0xFF3730A3 | Selection border |
| GreenApproved | 0xFF22C55E | Approved screen |
| RedDeclined | 0xFFEF4444 | Declined screen |
| AmberWarning | 0xFFF59E0B | Disconnection banner |

---

## Pending / Phase 3

1. **Register app wiring** — emit `cfd:show-order` on order mutations, `cfd:payment-started`/`cfd:tip-prompt` from Android payment flow
2. **Initial pairing flow** — mechanism to provision A3700 with nucBaseUrl + deviceToken the first time
3. **Back office UI** — settings page for CfdSettings per-location config
4. **Suggested items** — curated list shown on Idle/Order screens with "Add to Order" button
5. **Tab via card** — token-only or pre-auth from the CFD, wired to tabMode setting
6. **Per-location branding** — logo image URL + primary color overrides
