# Customer Display Domain

**Domain ID:** 21
**Status:** Active Development
**Created:** February 9, 2026

## Overview

The Customer Display domain manages customer-facing screens and surfaces that are separate from the employee POS interface. It handles:
- Customer-Facing Display (CFD) with 8-state state machine (idle, order, subtotal, tip, signature, processing, approved, declined)
- Pay-at-table with split check support
- Tip selection interface for customers
- Signature capture on customer screen
- Multi-surface state synchronization between POS terminal and customer display

## Domain Trigger

```
PM Mode: Customer Display
```

## Layers

| Layer | Scope | Key Files |
|-------|-------|-----------|
| CFD State Machine | 8-state display flow | `src/app/(cfd)/cfd/page.tsx` |
| Idle Screen | Clock + welcome branding | `src/components/cfd/CFDIdleScreen.tsx` |
| Order Display | Live order view for customer | `src/components/cfd/CFDOrderDisplay.tsx` |
| Tip Screen | Tip selection buttons | `src/components/cfd/CFDTipScreen.tsx` |
| Signature | Signature capture canvas | `src/components/cfd/CFDSignatureScreen.tsx` |
| Approval | Approved/declined screens | `src/components/cfd/CFDApprovedScreen.tsx` |
| Pay-at-Table | Guest self-pay interface | `src/app/(pos)/pay-at-table/`, `src/components/pay-at-table/` |

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(cfd)/cfd/page.tsx` | CFD state machine (8 states) |
| `src/components/cfd/CFDIdleScreen.tsx` | Clock + welcome screen |
| `src/components/cfd/CFDOrderDisplay.tsx` | Live order display |
| `src/components/cfd/CFDTipScreen.tsx` | Tip selection |
| `src/components/cfd/CFDSignatureScreen.tsx` | Signature capture |
| `src/components/cfd/CFDApprovedScreen.tsx` | Approval/decline screens |
| `src/components/pay-at-table/TablePayment.tsx` | Pay-at-table flow |
| `src/components/pay-at-table/SplitSelector.tsx` | Split check selector |
| `src/components/pay-at-table/TipScreen.tsx` | Pay-at-table tip entry |
| `src/types/multi-surface.ts` | Multi-surface state types |

## PAX A3700 Hardware CFD (Skills 461-462)

The PAX A3700 runs a dedicated Android app (`gwi-cfd/`) that replaces the browser-based CFD for venues with physical hardware displays. It is stateless — no Room DB, no WorkManager — driven entirely by NUC socket events.

### Communication Model
```
NUC socket-dispatch.ts
  └─ emitToTerminal(cfdTerminalId, event, data)
       └─ Socket.IO room: terminal:{cfdTerminalId}
            └─ CfdSocketManager.kt (PAX A3700)
                 └─ CfdViewModel.kt (state machine)
                      └─ Compose screens
```

### CFD Socket Events
| Direction | Event | Payload |
|-----------|-------|---------|
| NUC → CFD | `cfd:show-order` | items[], subtotalCents, taxCents, totalCents |
| NUC → CFD | `cfd:payment-started` | orderId, totalCents |
| NUC → CFD | `cfd:tip-prompt` | totalCents, tipMode, tipOptions, tipStyle, showNoTip |
| NUC → CFD | `cfd:signature-request` | amountCents, enabled, thresholdCents |
| NUC → CFD | `cfd:processing` | message |
| NUC → CFD | `cfd:approved` | amountCents, last4? |
| NUC → CFD | `cfd:declined` | reason? |
| NUC → CFD | `cfd:idle` | (none) |
| NUC → CFD | `cfd:receipt-sent` | orderId, emailEnabled, smsEnabled, printEnabled, timeoutSeconds |
| CFD → NUC | `cfd:tip-selected` | tipAmountCents |
| CFD → NUC | `cfd:signature-done` | signatureData (Base64 or null) |
| CFD → NUC | `cfd:receipt-choice` | choice, recipient? |

### CfdSettings Schema Fields
`tipMode`, `tipStyle`, `tipOptions` (CSV), `tipShowNoTip`, `signatureEnabled`, `signatureThresholdCents` (default 2500), `receiptEmailEnabled`, `receiptSmsEnabled`, `receiptPrintEnabled`, `receiptTimeoutSeconds` (default 30), `tabMode`, `tabPreAuthAmountCents` (default 100), `idlePromoEnabled`, `idleWelcomeText`

### Terminal Pairing
- Register terminal has `cfdTerminalId FK → Terminal` (the A3700)
- `Terminal.category = CFD_DISPLAY` marks it as a display-only device
- `cfdConnectionMode`: `"usb"` (primary) or `"bluetooth"` (backup)
- Pairing API: `POST/DELETE /api/hardware/terminals/[id]/pair-cfd`
- Settings API: `GET/PUT /api/hardware/cfd-settings?locationId=...`

### Android App Key Files (gwi-cfd/)
| File | Purpose |
|------|---------|
| `socket/CfdEvents.kt` | Event constants + CfdEvent sealed interface |
| `socket/CfdSocketManager.kt` | Socket.IO singleton, joins terminal room |
| `ui/screen/CfdScreenState.kt` | 8-state sealed class |
| `ui/CfdViewModel.kt` | State machine + timers |
| `ui/navigation/AppNavigation.kt` | AnimatedContent router |

## Related Skills

| Skill | Name | Status |
|-------|------|--------|
| 218 | Customer-Facing Display (web browser) | DONE |
| 219 | Pay-at-Table | DONE |
| 389 | CFD Socket Events (P2-H03) | DONE |
| 461 | PAX A3700 CFD — NUC Backend | DONE |
| 462 | GWI CFD Android App | DONE |

## Integration Points

- **Payments Domain**: Payment processing, tip entry, signature capture
- **Orders Domain**: Order data for live display
- **Settings Domain**: CFD branding and configuration (CfdSettings model)
- **Hardware Domain**: Terminal pairing, A3700 device management
- **Android CFD App**: `gwi-cfd/` — stateless kiosk app on PAX A3700
