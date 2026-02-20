# Skill 407 — DC Direct Payment Reader Architecture

**Domain:** Payments / Hardware
**Date:** 2026-02-20
**Commit:** `e2d1d58`
**Addresses:** Payment readers going through simulated flow instead of real hardware; hardcoded MID credential; communicationMode routing missing; USB modal misleading; simulated mode not detected by reader mode

---

## Overview

Established the correct DC Direct payment architecture for GWI POS and wired all layers to support it. DC Direct is **firmware that runs on standalone networked payment terminals** (PAX A920, Ingenico AXIUM, etc.) — it is NOT software installed on the NUC. The POS sends HTTP POSTs to the terminal's IP address on the local network; the terminal handles card collection and routes to NETePay Hosted.

---

## DC Direct Architecture (Canonical)

```
POS Browser (any device on local network)
  └── fetch POST http://{terminal-ip}:8080/ProcessEMVTransaction
        └── PAX A920 / Ingenico AXIUM (DC Direct firmware)
              └── Card reader prompts customer
              └── HTTPS to NETePay Hosted (Datacap cloud)
                    └── Processor → Authorization → Response
```

**Key facts:**
- Nothing is installed on the Ubuntu NUC for payment hardware
- DC Direct runs on the terminal (PAX, Ingenico, PamiPOP)
- Port is 8080 for PAX devices, 80 for Ingenico
- POS must be on the same local network as the terminal
- USB sled (VP3350) is NOT a standalone DC Direct device — it needs PamiPOP (Android display) or a Windows PC with dsiEMVUS

**Supported hardware for GWI POS DC Direct:**

| Device | Form factor | Notes |
|--------|-------------|-------|
| PAX A920 Pro | Handheld | Best for server handhelds |
| PAX A920 Max | Handheld (large) | Counter/table service |
| PAX IM30 | Countertop | Fixed POS stations |
| Ingenico DX8000 | Countertop | Fixed POS stations |
| PamiPOP + VP3350 | Display terminal | Counter — VP3350 mounted inside |

---

## Changes Made

### 1. Schema — `prisma/schema.prisma`

- Added `connectionType` field: `"USB" | "IP" | "BLUETOOTH" | "WIFI"` (default `"IP"`)
- Changed `ipAddress` to have default `"127.0.0.1"` (USB/BT always use 127.0.0.1; network readers use terminal's IP)
- Removed `@@unique([locationId, ipAddress])` — USB/BT readers share 127.0.0.1, so this constraint breaks multi-reader setups
- Added `@@index([connectionType])`
- Added `@@unique([locationId, name])` — name must be unique per location instead

### 2. MID Credential Flow — `src/app/api/hardware/payment-readers/route.ts`

**Before:** Client sent `merchantId` in POST body; page.tsx had `DATACAP_TEST_MID = 'SSBLGFRUI0GP'` hardcoded.

**After:** `merchantId` is never accepted from the client. The POST route reads MID from location settings:

```typescript
// Pull MID from location settings — managed by Mission Control, never from client
const location = await db.location.findUnique({
  where: { id: locationId },
  select: { settings: true },
})
const locSettings = parseSettings(location?.settings)
const merchantId = locSettings.payments?.datacapMerchantId || null
```

Same fix applied to PUT handler in `[id]/route.ts` — merchantId removed from accepted body fields.

### 3. Terminal API — `src/app/api/hardware/terminals/[id]/route.ts`

Added `communicationMode: true` to the `paymentReader` select in both GET and PUT handlers so the `useDatacap` hook can route correctly.

### 4. useDatacap Hook — `src/hooks/useDatacap.ts`

**Simulated mode detection** (was: only checked `paymentProvider === 'SIMULATED'`):
```typescript
const simulated = terminal.paymentProvider === 'SIMULATED' ||
  terminal.paymentReader?.communicationMode === 'simulated'
```

This means a reader with `communicationMode: 'simulated'` routes correctly even when `paymentProvider` is `DATACAP_DIRECT` (e.g., readers set to simulated while waiting for real hardware).

**getReaderUrl routing** — now handles 4 cases:
```typescript
const getReaderUrl = useCallback((path: string) => {
  if (isSimulatedRef.current) return `/api/simulated-reader${path}`
  if (!reader) return ''
  if (reader.communicationMode === 'simulated') return `/api/simulated-reader${path}`  // safety net
  if (reader.communicationMode === 'cloud') return `/api/hardware/payment-readers/${reader.id}/cloud${path}`
  return `http://${reader.ipAddress}:${reader.port}${path}`  // 'local' — DC Direct terminal
}, [reader])
```

**Unmount cleanup** — cancel URL also respects simulated communicationMode:
```typescript
if (isSimulatedRef.current || readerRef.current?.communicationMode === 'simulated') {
  cancelUrl = '/api/simulated-reader/cancel'
}
```

### 5. Cloud Proxy Routes (for future cloud/TranCloud mode)

Three new server-side routes proxy cloud-mode reader communication:

| Route | Purpose |
|-------|---------|
| `GET /api/hardware/payment-readers/[id]/cloud/device/info` | Returns serial/firmware from DB (no live handshake needed) |
| `POST /api/hardware/payment-readers/[id]/cloud/process` | Proxies transaction to Datacap NETePay Hosted |
| `POST /api/hardware/payment-readers/[id]/cloud/cancel` | Calls padReset on cloud reader |

### 6. Payment Readers Page — `page.tsx`

- **Removed** `DATACAP_TEST_MID = 'SSBLGFRUI0GP'` hardcoded constant
- **Removed** merchantId from RegisterFormData, form state, and request body
- **Added** `BoltIcon` bolt/initialize button on reader cards (pad-reset → EMVParamDownload)
- **USB info message** updated: removed "cloud mode" reference; now correctly says DC Direct runs on the terminal at port 8080
- **communicationMode default** for new USB readers: changed from `'cloud'` to `'local'`

---

## Reader Registration Workflow (Production)

1. Connect PAX/Ingenico terminal to venue WiFi
2. Note terminal's IP address (shown on screen or in router DHCP)
3. Settings → Hardware → Payment Readers → Scan or Add Manually
4. Enter: name, connection type = IP, terminal IP, port = 8080
5. Assign to one or more POS terminals
6. Hit the bolt ⚡ button to run EMVParamDownload (first-time init)

**MID flows automatically** from Mission Control → location settings → stamped on reader at registration. No manual credential entry needed.

---

## Testing (Simulated Mode)

While waiting for real hardware, set `communicationMode = 'simulated'` on the reader:
- Hook detects it and routes to `/api/simulated-reader/*`
- Reader shows as online (simulated readers are always online)
- Full payment flow works end-to-end without physical hardware

---

## Key Files

| File | Role |
|------|------|
| `src/hooks/useDatacap.ts` | Payment reader communication hook |
| `src/app/api/hardware/payment-readers/route.ts` | POST (create reader) — MID from location settings |
| `src/app/api/hardware/payment-readers/[id]/route.ts` | PUT/DELETE reader |
| `src/app/api/hardware/payment-readers/[id]/cloud/` | Cloud proxy routes |
| `src/app/api/hardware/terminals/[id]/route.ts` | Terminal config — exposes communicationMode |
| `src/app/(admin)/settings/hardware/payment-readers/page.tsx` | Payment readers admin UI |
| `prisma/schema.prisma` | PaymentReader model |
