# Skill 400 — Batch Monitoring

**Domain:** Payments / Infrastructure / MC Fleet
**Date:** 2026-02-20
**Commits:** a38a8cf (gwi-pos), cde2cc9 (gwi-mission-control)
**Addresses:** Operators had no visibility into whether daily card batch was closed; no way to detect unadjusted tips or open orders after close

---

## Overview

Batch monitoring surfaces live Datacap batch status — open order count, unadjusted tip count, current batch total, and last batch close time — from the NUC heartbeat up through Mission Control's fleet dashboard and location detail pages. Operators can see at a glance whether each venue's batch is healthy (green), overdue (yellow), or critically late (red), and whether any card payments are sitting with a tip of $0.

---

## Why This Exists

Card processors require a daily batch close to settle authorized transactions. If a venue forgets to run the batch, authorizations expire and revenue is lost. There was no way for GWI or venue owners to know from Mission Control whether a batch had been closed, how long ago it was closed, or whether there were open orders or unadjusted tips that should have been resolved before close.

---

## Architecture

```
NUC heartbeat (every 60s)
    │
    ├─ GET http://localhost:3005/api/system/batch-status
    │   (no auth — localhost only)
    │   returns: openOrderCount, unadjustedTipCount,
    │            currentBatchTotal, lastBatchClosedAt
    │
    ├─ Read /opt/gwi-pos/last-batch.json
    │   { closedAt, batchNo, status, itemCount }
    │
    └─ POST /api/fleet/heartbeat (MC)
        reports: batchClosedAt, batchStatus, batchItemCount,
                 batchNo, openOrderCount, unadjustedTipCount,
                 currentBatchTotal

MC heartbeat route
    │
    └─ ServerNode fields updated (Prisma)
        lastBatchAt, lastBatchTotal, lastBatchStatus,
        lastBatchItemCount, openOrderCount, unadjustedTipCount

Fleet dashboard → StatusCard (compact colored dot + relative time)
Location detail → Overview tab → BatchStatusCard (full detail)
```

---

## POS Side

### `GET /api/system/batch-status`

No authentication required — called only from localhost by the heartbeat cron. Returns live data from the database:

```typescript
{
  data: {
    openOrderCount: number          // orders where status = 'open'
    unadjustedTipCount: number      // card payments with tipAmount <= 0 since last batch close
    currentBatchTotal: number       // sum of card payment amounts since last batch close
    lastBatchClosedAt: string | null  // ISO timestamp from last-batch.json
  }
}
```

**Unadjusted tip count definition:** Card payments (credit/debit) with `tipAmount <= 0` that were processed after `lastBatchClosedAt`. These are pre-auth holds where the server has not yet added a tip — a common source of revenue loss if the batch closes before tips are adjusted.

### `POST /api/datacap/batch` — writes `last-batch.json`

After a successful batch close, the batch route now writes:

```json
{
  "closedAt": "2026-02-20T03:47:22.000Z",
  "batchNo": "1042",
  "status": "closed",
  "itemCount": 47
}
```

File path: `/opt/gwi-pos/last-batch.json`

### `installer.run` heartbeat additions

The 60-second heartbeat cron calls `batch-status` and reads `last-batch.json`, then includes all batch fields in the HMAC-signed heartbeat payload sent to Mission Control.

---

## Mission Control Side

### Prisma migrations

Two migrations add batch fields to `ServerNode`:

```prisma
model ServerNode {
  // ... existing fields ...
  lastBatchAt        DateTime?
  lastBatchTotal     Float?
  lastBatchStatus    String?
  lastBatchItemCount Int?
  openOrderCount     Int?
  unadjustedTipCount Int?
}
```

### Heartbeat route

The `POST /api/fleet/heartbeat` route is extended to accept and store all batch fields. Zod validation added for all new fields.

### `BatchStatusCard` component

Full-detail card shown on the Location detail Overview tab. Status is derived from time since last batch:

| Badge | Color | Condition |
|-------|-------|-----------|
| Closed | Green | Last batch within 26 hours |
| Overdue | Yellow | Last batch 26–48 hours ago |
| Critical | Red | Last batch more than 48 hours ago |

Card contents:
- Last batch timestamp + total (e.g. "11:47 PM — $3,241.18")
- Open order count
- Amber warning when `unadjustedTipCount > 0`: "N card payments have no tip recorded"
- Red alert when no batch in 24h AND open orders present: "No batch in 24h — N open orders"

### Fleet dashboard `StatusCard` additions

The compact server card in the fleet dashboard gains:
- Colored dot (green / yellow / red) based on batch age
- Relative last-batch time (e.g. "11:47 PM")
- Amber `⚠ No batch` badge when `lastBatchAt` is null or older than 24 hours

### Alert logic summary

| Condition | Alert |
|-----------|-------|
| `lastBatchAt` null or > 48h ago | Red badge on StatusCard |
| `lastBatchAt` 26–48h ago | Yellow badge on StatusCard |
| `unadjustedTipCount > 0` | Amber warning in BatchStatusCard |
| > 24h no batch AND `openOrderCount > 0` | Red alert in BatchStatusCard |

---

## Files Changed

### gwi-pos

| File | Change |
|------|--------|
| `src/app/api/system/batch-status/route.ts` | New — live batch status (open orders, unadjusted tips, current total) |
| `src/app/api/datacap/batch/route.ts` | Modified — writes `last-batch.json` after successful close |
| `public/installer.run` | Modified — heartbeat reads batch-status + last-batch.json, reports to MC |

### gwi-mission-control

| File | Change |
|------|--------|
| `prisma/migrations/…_add_batch_fields/migration.sql` | New — adds 6 batch columns to ServerNode |
| `src/app/api/fleet/heartbeat/route.ts` | Modified — stores batch fields; Zod validation added |
| `src/components/fleet/BatchStatusCard.tsx` | New — full batch detail card with green/yellow/red badge |
| `src/components/fleet/StatusCard.tsx` | Modified — compact batch dot + relative time + ⚠ No batch badge |
| `src/app/(dashboard)/locations/[id]/page.tsx` | Modified — BatchStatusCard in Overview tab from primaryServer |

---

## Summary Table

| Change | File | Impact |
|--------|------|--------|
| Batch status API | `api/system/batch-status/route.ts` | Live open orders + tip data for heartbeat |
| last-batch.json write | `api/datacap/batch/route.ts` | Persistent batch close record for heartbeat |
| Heartbeat batch reporting | `public/installer.run` | Batch data flows to MC every 60s |
| ServerNode schema migration | MC Prisma migration | 6 new batch fields on ServerNode |
| Heartbeat route expansion | MC `api/fleet/heartbeat/route.ts` | Stores all batch fields |
| BatchStatusCard | MC `components/fleet/BatchStatusCard.tsx` | Full batch health card on location detail |
| Fleet dashboard batch dot | MC `components/fleet/StatusCard.tsx` | Compact batch indicator on fleet list |
| Location Overview tab | MC location detail page | BatchStatusCard integrated |
