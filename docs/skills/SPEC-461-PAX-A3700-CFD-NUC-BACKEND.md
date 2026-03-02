# Skill 461 — PAX A3700 CFD: NUC Backend

**Domain:** Hardware / Customer Display
**Status:** DONE
**Dependencies:** Skill 389 (CFD socket events), Skill 120 (Datacap)
**NUC Commit:** `54b97da`
**Date:** 2026-03-02

---

## Overview

NUC-side backend enabling the PAX A3700 Customer Facing Display (CFD) system. Covers Prisma schema, Socket.IO targeted dispatch, pairing API routes, CfdSettings configuration routes, and NUC migration.

---

## Schema Changes (`prisma/schema.prisma`)

### TerminalCategory enum
```prisma
enum TerminalCategory {
  FIXED_STATION
  HANDHELD
  CFD_DISPLAY   // ← new: PAX A3700 kiosk
}
```

### Terminal model additions
```prisma
cfdTerminalId      String?   @db.VarChar(36)
cfdTerminal        Terminal? @relation("TerminalCFD", fields: [cfdTerminalId], references: [id])
cfdRegisterFor     Terminal[] @relation("TerminalCFD")
cfdIpAddress       String?
cfdConnectionMode  String?   @default("usb")   // "usb" | "bluetooth"
@@index([cfdTerminalId])
```

### CfdSettings model (new)
```prisma
model CfdSettings {
  id                        String    @id @default(cuid())
  locationId                String    @unique
  location                  Location  @relation(fields: [locationId], references: [id])
  // Tip
  tipMode                   String    @default("pre_tap")    // "pre_tap" | "post_auth"
  tipStyle                  String    @default("percent")    // "percent" | "dollar"
  tipOptions                String    @default("18,20,22,25") // CSV
  tipShowNoTip              Boolean   @default(true)
  // Signature
  signatureEnabled          Boolean   @default(true)
  signatureThresholdCents   Int       @default(2500)         // $25.00
  // Receipt
  receiptEmailEnabled       Boolean   @default(true)
  receiptSmsEnabled         Boolean   @default(true)
  receiptPrintEnabled       Boolean   @default(true)
  receiptTimeoutSeconds     Int       @default(30)
  // Tab
  tabMode                   String    @default("token_only") // "token_only" | "pre_auth" | "both"
  tabPreAuthAmountCents     Int       @default(100)          // $1.00
  // Idle
  idlePromoEnabled          Boolean   @default(false)
  idleWelcomeText           String    @default("Welcome!")
  // Soft delete
  deletedAt                 DateTime?
  createdAt                 DateTime  @default(now())
  updatedAt                 DateTime  @updatedAt
}
```

---

## Socket Targeting (`src/lib/socket-server.ts`)

```typescript
export function emitToTerminal(terminalId: string, event: string, data: unknown): void
```
- Emits to room `terminal:{terminalId}`
- Falls through IPC the same as `emitToRoom` (works in both cluster and single-process)

---

## Dispatch Functions (`src/lib/socket-dispatch.ts`)

All 5 functions updated with `cfdTerminalId: string | null` as second parameter:

```typescript
dispatchCFDShowOrder(locationId, cfdTerminalId, payload)
dispatchCFDPaymentStarted(locationId, cfdTerminalId, payload)
dispatchCFDTipPrompt(locationId, cfdTerminalId, payload)
dispatchCFDSignatureRequest(locationId, cfdTerminalId, payload)
dispatchCFDReceiptSent(locationId, cfdTerminalId, payload)
```

If `cfdTerminalId` is truthy → `emitToTerminal(cfdTerminalId, event, data)`
If null → `emitToLocation(locationId, event, data)` (backward compatible)

---

## API Routes

### `POST /api/hardware/terminals/[id]/pair-cfd`

Links a CFD (A3700) terminal to a register terminal.

**Body:** `{ cfdTerminalId, cfdIpAddress?, cfdConnectionMode? }`

**Validations:**
- `cfdTerminalId` required
- Cannot pair to self
- Register must not be `CFD_DISPLAY` category
- Both terminals must exist and not be soft-deleted

**Side effect:** Best-effort updates CFD terminal's category to `CFD_DISPLAY`

### `DELETE /api/hardware/terminals/[id]/pair-cfd`

Clears `cfdTerminalId`, `cfdIpAddress`, `cfdConnectionMode` to null.

### `GET /api/hardware/cfd-settings?locationId=...`

Returns CfdSettings for location or sensible defaults (id: null) if not yet created.

### `PUT /api/hardware/cfd-settings`

Upserts CfdSettings. Validates: tipMode, tipStyle, tabMode, signatureThresholdCents ≥ 0, receiptTimeoutSeconds 5-300, tabPreAuthAmountCents ≥ 0.

---

## NUC Migration (`scripts/nuc-pre-migrate.js`)

Four idempotent SQL cases added before "Pre-push migrations complete":

| Case | What |
|------|------|
| A | `ALTER TYPE "TerminalCategory" ADD VALUE 'CFD_DISPLAY'` (checks pg_enum) |
| B | `ALTER TABLE "Terminal" ADD COLUMN` × 3 (cfdTerminalId, cfdIpAddress, cfdConnectionMode) |
| C | `CREATE INDEX "Terminal_cfdTerminalId_idx"` (checks pg_indexes) |
| D | `CREATE TABLE "CfdSettings"` with all columns + PK + unique constraint + index |

---

## Files Modified

| File | Change |
|------|--------|
| `prisma/schema.prisma` | +51 lines: CFD_DISPLAY enum, Terminal fields, CfdSettings model |
| `src/lib/socket-server.ts` | +16 lines: emitToTerminal() |
| `src/lib/socket-dispatch.ts` | +42/-4 lines: cfdTerminalId param on all 5 dispatch functions |
| `src/app/api/hardware/terminals/[id]/route.ts` | +29 lines: CFD fields in GET include + PUT body + baseData |
| `src/app/api/hardware/cfd-settings/route.ts` | NEW: GET/PUT CfdSettings |
| `src/app/api/hardware/terminals/[id]/pair-cfd/route.ts` | NEW: POST/DELETE pair-cfd |
| `scripts/nuc-pre-migrate.js` | +88 lines: 4 migration cases |
