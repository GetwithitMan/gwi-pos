# Deduction Outbox — Operations Runbook

When inventory deductions fail silently or accumulate in the queue, this runbook walks you through diagnosis, recovery, and prevention.

---

## Architecture at a glance

```
Payment commits
    └── db.pendingDeduction.upsert()   ← written inside pay transaction
           │
           ├── Immediate: processNextDeduction()  ← best-effort, same request
           └── Cron:      /api/cron/process-deductions  ← every 5 min
                             └── processAllPending()  ← drains up to 100 jobs
```

**Idempotency guarantee:** `PendingDeduction` has a `UNIQUE("orderId")` constraint. `upsert` is used at write time. A job can be retried safely — the deduction workers are called again but Prisma's `update` with `{ increment }` means stock changes, not overwrites. Dead-letter retry does not create a new row.

---

## Status lifecycle

```
pending → processing → succeeded
                    ↘
                     failed  (availableAt = backoff)
                        ↓ (after maxAttempts = 5)
                       dead
```

- **pending** — waiting to be claimed
- **processing** — claimed by a worker (transient; cleared on success or error)
- **succeeded** — done
- **failed** — error occurred; will retry after exponential backoff (2^n × 30s)
- **dead** — exhausted all 5 attempts; requires manual retry

---

## 0. What is normal?

Use this section to calibrate. If numbers are within these ranges, no action is needed.

### Expected daily counts (typical busy service, ~200 covers)

| Metric | Normal range | Notes |
|--------|-------------|-------|
| Jobs created per day | 150–250 | One per paid order |
| Still `pending` right now | 0–3 | Cron runs every 5 min; idle periods may queue briefly |
| `succeeded` today | ≈ jobs created | Should match within 1–2 (in-flight at query time) |
| `failed` (not yet dead) | 0–2 | Transient DB hiccup; auto-resolves on next cron |
| `dead` | **0 in the last 24h** is normal | Even 1 dead job means something needs attention |

### Expected failure rate

- **< 1% of jobs ever reaching `failed`**: normal. Occasional connectivity blip.
- **1–5% failing**: investigate. Usually a single bad recipe or missing inventory item causing repeated `InventoryItem not found`.
- **> 5% failing or any mass failure event**: stop and diagnose before retrying — bulk retry without fixing root cause will just re-fail and waste attempts.

### When dead-letter is acceptable vs urgent

| Situation | Urgency | First Action |
|-----------|---------|--------------|
| 1–2 dead jobs, isolated orders, low-volume shift | Low — fix next business day | Hit **Retry** once in admin UI. If it re-fails, note the order IDs and manually adjust stock. |
| Dead jobs for orders from the last hour | Medium — fix before close | **Retry** → if it re-dead-letters, check common causes #1–#3 (`lastError` will point to the right one). |
| 5+ dead jobs or pattern across many orders | **High — fix now** | `SELECT DISTINCT "lastError" FROM "PendingDeduction" WHERE status='dead'` → fix shared root cause → bulk reset + trigger cron. |
| Dead jobs + `succeeded` count stopped growing | **Critical** | Check cron health first (`vercel.json` schedule + last run time). If cron is down, trigger manually. Notify owner. Consider pausing new payments until queue drains. |
| Any dead job containing a large-dollar order | **High** | Correct stock manually via `/inventory` → stock adjust. Then retry and verify idempotency (§6 query below). |

### Quick sanity check (run anytime)

```sql
SELECT status, COUNT(*) as count
FROM "PendingDeduction"
WHERE "createdAt" > NOW() - INTERVAL '24 hours'
GROUP BY status
ORDER BY status;
```

**Green:** all rows are `succeeded`, maybe 1–2 `pending`.
**Yellow:** any `failed` rows — check `lastError`, monitor for auto-recovery.
**Red:** any `dead` rows, or `succeeded` count < 90% of total — action required.

---

## 1. Where to look first

### Admin UI
Navigate to **Inventory → Deductions Queue** (`/inventory/deductions-queue`).

| Column | What it tells you |
|--------|-------------------|
| Status | Current state — red badge = failed/dead |
| Attempts | How many times the worker ran |
| Last Error | Truncated error message |
| Next Retry | `availableAt` — when the cron will next pick it up |
| Run Count | Total DeductionRun records for this job |

### Direct DB query (NUC terminal)
```sql
SELECT id, "orderId", status, attempts, "lastError", "availableAt"
FROM "PendingDeduction"
WHERE status IN ('failed', 'dead')
ORDER BY "updatedAt" DESC
LIMIT 20;
```

---

## 2. Retrying failed / dead jobs

### Via admin UI
Click **Retry Now** on any failed or dead row. This sets `status='pending'` and `availableAt=NOW()`.

### Via API
```bash
curl -X POST http://localhost:3005/api/inventory/deduction-queue \
  -H "Content-Type: application/json" \
  -d '{"locationId":"<id>","employeeId":"<id>","action":"retry","id":"<pendingDeductionId>"}'
```

### Via cron trigger (runs all pending)
```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3005/api/cron/process-deductions
```

### Direct DB reset (emergency only)
```sql
UPDATE "PendingDeduction"
SET status = 'pending', "availableAt" = NOW(), "lastError" = NULL
WHERE status IN ('failed', 'dead');
```

---

## 3. Common failure patterns

### "InventoryItem not found"
**Cause:** Menu item has a recipe ingredient pointing to a deleted or wrong-location inventory item.
**Fix:** Check `MenuItemRecipeIngredient` → verify `inventoryItemId` exists in `InventoryItem` for that `locationId`. Re-link the recipe ingredient in the menu editor.

### "Order not found"
**Cause:** Order was hard-deleted (shouldn't happen) or the orderId on the deduction row is wrong.
**Fix:** Check `db.order.findUnique({ where: { id: orderId } })`. If genuinely missing, mark the deduction dead manually — it cannot be processed.

### "DB connection lost" / "connection timeout"
**Cause:** Transient PostgreSQL issue (NUC power, disk pressure).
**Fix:** The backoff will retry automatically. Check `pg_stat_activity` for blocking queries. If disk is full: `df -h`, clear old logs.

### Job stuck in `processing` status
**Cause:** Worker crashed mid-run (server restart while processing).
**Fix:** The cron does NOT re-claim `processing` rows. Reset manually:
```sql
UPDATE "PendingDeduction"
SET status = 'failed', "availableAt" = NOW()
WHERE status = 'processing'
  AND "lastAttemptAt" < NOW() - INTERVAL '10 minutes';
```

### Many dead jobs at once (mass failure event)
**Cause:** Usually a schema migration broke a query, or a dependency (InventoryItem table) was cleared.
**Steps:**
1. Identify the shared error via `SELECT DISTINCT "lastError" FROM "PendingDeduction" WHERE status='dead'`
2. Fix the underlying cause
3. Bulk reset: `UPDATE "PendingDeduction" SET status='pending', attempts=0, "availableAt"=NOW(), "lastError"=NULL WHERE status='dead'`
4. Trigger cron manually or wait for next 5-min window

---

## 4. Log locations

| Where | How to find deduction logs |
|-------|---------------------------|
| App stdout | `grep "deduction-processor" /var/log/gwi-pos/app.log` |
| Vercel / NUC dev | Console output tagged `[deduction-processor]` |
| DeductionRun table | `SELECT * FROM "DeductionRun" WHERE "pendingDeductionId"='<id>' ORDER BY "createdAt" DESC` |

---

## 5. Monitoring thresholds

| Signal | Action |
|--------|--------|
| > 5 failed jobs | Investigate `lastError` — likely a shared root cause |
| Any dead job | Manual retry after fixing root cause |
| `succeeded` count stops growing after a payment | Check if cron is running (`vercel.json` schedule entry) |
| `processing` row older than 10 min | Stuck worker — see "stuck in processing" above |

---

## 6. Verifying idempotency after a retry

After retrying a dead job, confirm no double-deduction occurred:

```sql
-- Count stock adjustment transactions for the order
SELECT i.name, COUNT(*) as deduction_count, SUM(t."quantityChange") as total_change
FROM "InventoryItemTransaction" t
JOIN "InventoryItem" i ON i.id = t."inventoryItemId"
WHERE t."referenceId" = '<orderId>'
  AND t.type = 'sale'
GROUP BY i.name;
```

If `deduction_count > 1` for any item, the deduction ran multiple times. Compensate by manually adjusting stock (`/inventory` → stock adjust) and file a bug.

> **Prevention:** The `UNIQUE("orderId")` constraint on `PendingDeduction` and the `upsert` write pattern prevent a second job row from being created. The deduction workers use `{ increment: -qty }` (not absolute sets), so a double-run does double-decrement. If you see this, the issue is the dead row was duplicated outside normal flow — investigate how.
