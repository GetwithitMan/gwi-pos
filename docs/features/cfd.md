# Feature: CFD (Customer-Facing Display)

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
The Customer-Facing Display (CFD) is a stateless display screen shown to customers during checkout. It runs an 8-state state machine driven entirely by socket events from the POS terminal. The CFD shows the live order summary, prompts for tip selection, captures signatures, displays payment processing status (approved/declined), and offers receipt delivery options. The primary hardware target is the PAX A3700 tablet running the `gwi-cfd` Android app. All state transitions are server-driven — the CFD has no local persistence.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | Socket dispatch, CFD settings API, admin config, loyalty snapshot plumbing | Full |
| `gwi-android-register` | None (CFD is a separate app) | None |
| `gwi-cfd` | Stateless Android kiosk app on PAX A3700 | Full |
| `gwi-backoffice` | None | None |
| `gwi-mission-control` | None | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/settings/hardware/cfd` | Managers |
| Android CFD | `CfdIdleScreen → CfdOrderScreen → CfdTipScreen → ...` | Customer-facing |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/cfd-loyalty-snapshot.ts` | Resolve order-linked customer + loyalty enablement for CFD payloads |
| `src/types/multi-surface.ts` | CFD_EVENTS constants + multi-surface types |
| `src/lib/socket-dispatch/cfd-dispatch.ts` | `dispatchCFDShowOrder()`, `dispatchCFDShowOrderDetail()`, `dispatchCFDPaymentStarted()`, `dispatchCFDTipPrompt()`, `dispatchCFDSignatureRequest()`, `dispatchCFDReceiptSent()`, `dispatchCFDOrderUpdated()` |
| `src/app/api/cfd/loyalty/enroll/route.ts` | Phone-entry enrollment/attach endpoint for loyalty prompt flow |
| `src/app/api/hardware/cfd-settings/route.ts` | GET/PUT CFD settings |
| `src/app/api/hardware/terminals/[id]/pair-cfd/route.ts` | POST/DELETE CFD pairing |
| `src/app/(admin)/settings/hardware/cfd/page.tsx` | CFD settings page |

### gwi-cfd (Android)
| File | Purpose |
|------|---------|
| `app/.../socket/CfdEvents.kt` | Event constants + CfdEvent sealed interface |
| `app/.../socket/CfdSocketManager.kt` | Socket.IO singleton, joins terminal room |
| `app/.../ui/screen/CfdScreenState.kt` | 8-state sealed class |
| `app/.../ui/CfdViewModel.kt` | State machine + timers |
| `app/.../ui/navigation/AppNavigation.kt` | AnimatedContent router |
| `app/.../ui/screen/CfdIdleScreen.kt` | Idle screen |
| `app/.../ui/screen/CfdTipScreen.kt` | Tip selection |
| `app/.../ui/screen/CfdPaymentScreens.kt` | Processing/approved/declined |
| `app/.../ui/screen/CfdSignatureScreen.kt` | Signature capture |
| `app/.../ui/screen/CfdReceiptScreen.kt` | Receipt choice |
| `app/.../ui/screen/CfdOrderScreen.kt` | Order display |
| `app/.../data/model/FeaturedItem.kt` | Featured item model |
| `app/.../data/TokenProvider.kt` | Token management |
| `app/.../di/AppModule.kt` | Hilt dependency injection |
| `app/.../ui/MainActivity.kt` | Activity entry point |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET/PUT` | `/api/hardware/cfd-settings` | Manager | CFD display settings (tip mode, tip options, signature threshold) |
| `POST` | `/api/hardware/terminals/[id]/pair-cfd` | Manager | Pair CFD device to register terminal |
| `DELETE` | `/api/hardware/terminals/[id]/pair-cfd` | Manager | Unpair CFD device |

---

## Socket Events

### Emitted by POS → CFD
| Event | Payload | Trigger |
|-------|---------|---------|
| `cfd:show-order` | `{ orderId, orderNumber, items[], subtotal, tax, total, customer?, loyaltyEnabled? }` | Payment modal opened / order refresh |
| `cfd:payment-started` | `{ orderId, amount, paymentMethod }` | Card reader activated |
| `cfd:tip-prompt` | `{ orderId, subtotal, suggestedTips[] }` | Tip step shown to cashier |
| `cfd:signature-request` | `{ orderId, transactionId? }` | Signature required |
| `cfd:processing` | `{ message }` | Payment processing |
| `cfd:approved` | `{ amountCents, last4? }` | Payment approved |
| `cfd:declined` | `{ reason? }` | Payment declined |
| `cfd:idle` | (none) | Return to idle screen |
| `cfd:receipt-sent` | `{ orderId, total, emailEnabled, smsEnabled, printEnabled, timeoutSeconds }` | Payment complete, receipt options |
| `cfd:order-updated` | `{ orderId, orderNumber, items[], subtotal, tax, total, customer?, loyaltyEnabled? }` | Any item/discount/void/tab mutation |
| `cfd:settings-updated` | `{ cfdDisplay }` | CFD display settings changed |

### Emitted by CFD → POS
| Event | Source | Purpose |
|-------|--------|---------|
| `cfd:tip-selected` | CFD | `{ tipAmountCents }` — customer selected tip amount |
| `cfd:signature-done` | CFD | `{ signatureData }` — Base64 signature or null (skipped) |
| `cfd:receipt-choice` | CFD | `{ choice, recipient? }` — email, sms, print, or none |

### Event Routing
- If terminal has a paired CFD (`cfdTerminalId`): events sent via `emitToTerminal(cfdTerminalId, event, data)`
- If no paired CFD: events broadcast via `emitToLocation(locationId, event, data)`
- CFD joins both location room and terminal-specific room on connect

---

## Data Model

```
Terminal {
  cfdTerminalId   String?  // FK → Terminal (the paired A3700)
  cfdConnectionMode String? // "usb" | "bluetooth"
}

Terminal (CFD device) {
  category     CFD_DISPLAY
  deviceToken  String (unique, from pairing)
}

CfdSettings (stored on Terminal or Location.settings) {
  tipMode           String    // "percent" | "dollar" | "both"
  tipStyle          String    // "button" | "slider"
  tipOptions        String    // CSV: "15,18,20,25"
  tipShowNoTip      Boolean   // Show "No Tip" button
  signatureEnabled  Boolean
  signatureThresholdCents  Int (default 2500 = $25)
  receiptEmailEnabled    Boolean
  receiptSmsEnabled      Boolean
  receiptPrintEnabled    Boolean
  receiptTimeoutSeconds  Int (default 30)
  tabMode           String
  tabPreAuthAmountCents  Int (default 100)
  idlePromoEnabled  Boolean
  idleWelcomeText   String
}
```

---

## Business Logic

### 8-State Machine
```
idle → order → payment-started → tip → signature → processing → approved/declined → receipt → idle
```

1. **Idle**: Clock + welcome branding displayed
2. **Order**: Live order summary (items, modifiers, subtotal, tax, total) — updated in real time as cashier adds items
3. **Payment Started**: "Please insert/tap card" prompt
4. **Tip**: Customer selects tip amount (configurable options: percent/dollar/both)
5. **Signature**: Customer signs on screen (if enabled and above threshold)
6. **Processing**: "Processing payment..." spinner
7. **Approved/Declined**: Result screen with amount and last4 digits
8. **Receipt**: Customer chooses email, SMS, print, or no receipt (configurable timeout)

### CFD Pairing Flow
1. Admin creates a Terminal with `category = CFD_DISPLAY`
2. Admin pairs CFD to a register terminal via `/api/hardware/terminals/[id]/pair-cfd`
3. Register terminal now has `cfdTerminalId` → all CFD events route to that specific device
4. Android CFD app authenticates via bootstrap token, joins `terminal:{id}` socket room

### Tip Selection
- CFD tip selection is **race-free** with 60-second timeout
- If customer doesn't select within timeout, POS defaults to $0 tip
- Tip options configurable: percentages, dollar amounts, or both
- "No Tip" button visibility controlled by `tipShowNoTip` setting
- `noTipQuickButton` in TipBankSettings hides quick-tip buttons (forces manual entry)

### Edge Cases & Business Rules
- CFD is **stateless** — all state driven by socket events from POS
- No local DB, no Room, no WorkManager on the Android app
- If socket disconnects, CFD returns to idle screen
- Signature threshold: signatures only required above configurable amount (default $25)
- Receipt timeout: auto-dismiss after configurable seconds (default 30)
- Loyalty prompt is driven by the order payload, not by CFD settings:
  - `loyaltyEnabled === false` → hide loyalty UI
  - `loyaltyEnabled === true && customer == null` → show `Enter loyalty number`
  - `loyaltyEnabled === true && customer != null` → show the customer name, tier, and points
- The enroll endpoint is `POST /api/cfd/loyalty/enroll`:
  - body: `{ orderId, phone, firstName?, lastName?, email? }`
  - on match: attach customer to order/tab and refresh the CFD immediately
  - on no match + no name: return `promptForName: true`
  - on no match + name: create customer, attach, and refresh the CFD immediately

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Payments | CFD tip selection feeds back to payment flow via `cfd:tip-selected` |
| Payments | CFD signature data feeds back via `cfd:signature-done` |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Payments | Payment flow drives all CFD state transitions |
| Orders | Order data displayed on CFD |
| Hardware | Terminal pairing, device management |
| Settings | CFD settings (tip mode, signature threshold, receipt options) |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Payments** — CFD state transitions must match payment flow exactly
- [ ] **Socket events** — any payload change must update both gwi-pos dispatch AND gwi-cfd listener
- [ ] **gwi-cfd** — Android app must handle all event payloads (Kotlin data classes must match)
- [ ] **Settings** — CfdSettings changes affect both web CFD and Android CFD
- [ ] **Terminal pairing** — CFD device pairing flow must remain intact

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View CFD | N/A (customer-facing) | N/A |
| Configure CFD settings | `HARDWARE_MANAGE` | High |
| Pair/unpair CFD device | `TERMINAL_MANAGE` | High |

---

## Known Constraints & Limits
- CFD is completely stateless — no local persistence
- All state driven by socket events — socket disconnect = idle screen
- 60-second timeout on tip selection
- Signature capture: Base64 encoded PNG data
- Receipt timeout: configurable (default 30s)
- PAX A3700 is the only supported hardware CFD device
- Web CFD at `/cfd` is a fallback — primary is Android app

---

## Android-Specific Notes (gwi-cfd)
- Runs on PAX A3700 tablet
- Jetpack Compose UI with AnimatedContent transitions
- Hilt dependency injection
- Socket.IO via OkHttp (not standard Android WebSocket)
- No Room DB, no WorkManager — fully stateless
- CfdViewModel manages state machine + auto-timeouts
- Bootstrap pairing via `TokenProvider` + NUC API
- `CfdSocketManager` singleton handles connect/disconnect/reconnect
- Order payloads should render a distinct loyalty footer when `customer` is null and `loyaltyEnabled` is true.
- The footer should submit phone entry to `/api/cfd/loyalty/enroll` and replace itself with customer/points state on success.

---

## Related Docs
- **Domain doc:** `docs/domains/CUSTOMER-DISPLAY-DOMAIN.md`
- **Architecture guide:** `docs/guides/SOCKET-REALTIME.md`
- **Skills:** Skill 218 (CFD Web Browser), Skill 219 (Pay-at-Table), Skill 389 (CFD Socket Events), Skill 461 (PAX A3700 NUC Backend), Skill 462 (GWI CFD Android App)
- **Changelog:** `docs/changelogs/CFD-CHANGELOG.md`

---

*Last updated: 2026-03-03*
