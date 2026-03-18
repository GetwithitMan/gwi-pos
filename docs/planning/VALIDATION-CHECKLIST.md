# Server Hardening — Validation Checklist

**Gate to production-strong status. All 5 must pass.**

---

## 1. Quarantine Blocking Mode (48h staging)

**Action:** Set `SYNC_QUARANTINE_MODE=blocking` in staging `.env`

**Monitor for 48 hours:**
```bash
# Check quarantine events
SELECT COUNT(*) FROM "SyncConflict" WHERE "detectedAt" > NOW() - INTERVAL '48 hours';

# Check false positive rate
SELECT model, COUNT(*) as conflicts,
  COUNT(*) FILTER (WHERE "resolvedAt" IS NOT NULL) as resolved
FROM "SyncConflict"
GROUP BY model;

# Check watermark health
SELECT * FROM "SyncWatermark" ORDER BY "updatedAt" DESC;
```

**Pass criteria:**
- [ ] Zero false positives (no conflicts on data that wasn't actually edited concurrently)
- [ ] Watermarks advancing on every sync cycle
- [ ] Real conflicts (if any) correctly quarantined instead of silently overwritten
- [ ] No sync worker crashes or hangs

**Fail action:** Revert to `SYNC_QUARANTINE_MODE=log-only`, investigate timestamp drift or watermark staleness.

---

## 2. RLS Failure-Mode Tests (staging DB)

Run these 4 tests against the staging Neon database after migration 078 has run.

### Test 1: Cross-tenant READ
```sql
-- As venue-A connection, try to read venue-B data
SET LOCAL app.current_tenant = 'venue-a-location-id';
SELECT * FROM "Order" WHERE "locationId" = 'venue-b-location-id' LIMIT 1;
-- Expected: 0 rows returned (RLS blocks)
```
- [ ] Returns 0 rows

### Test 2: Cross-tenant WRITE
```sql
SET LOCAL app.current_tenant = 'venue-a-location-id';
UPDATE "Order" SET notes = 'RLS test' WHERE "locationId" = 'venue-b-location-id';
-- Expected: 0 rows affected (RLS blocks)
```
- [ ] Affects 0 rows

### Test 3: Transaction scope
```sql
BEGIN;
SELECT set_config('app.current_tenant', 'venue-a-location-id', true);
SELECT COUNT(*) FROM "Order"; -- Should only see venue-A orders
SELECT set_config('app.current_tenant', 'venue-b-location-id', true);
SELECT COUNT(*) FROM "Order"; -- Should only see venue-B orders
COMMIT;
-- After commit, GUC resets — queries see nothing (fail-closed)
SELECT COUNT(*) FROM "Order"; -- Should see 0 (no GUC set)
```
- [ ] First count = venue-A orders only
- [ ] Second count = venue-B orders only
- [ ] Post-commit count = 0 (fail-closed)

### Test 4: App-layer bypass simulation
```javascript
// In a test script, bypass the repo and use raw Prisma without setting GUC
const results = await db.order.findMany({ where: { locationId: 'venue-b-id' } })
// With RLS active and no GUC set, this should return 0 rows
```
- [ ] Returns 0 rows (RLS catches the bypass)

**Pass criteria:** All 4 tests produce expected results.

**Fail action:** Check `ALTER TABLE ... FORCE ROW LEVEL SECURITY` was applied. Verify GUC name matches policy.

---

## 3. CSP Report Review

**Action:** Check `/api/csp-report` logs after 1 week of report-only mode.

```bash
# In production logs, search for CSP violations
grep "CSP-VIOLATION" /var/log/gwi-pos/*.log | head -50
```

**Review categories:**
- [ ] `script-src` violations — identify inline scripts that need nonces
- [ ] `style-src` violations — Tailwind/Framer Motion inline styles (expected, keep unsafe-inline for styles)
- [ ] `connect-src` violations — any unexpected outbound connections
- [ ] Third-party violations — browser extensions (ignore)

**If clean (no legitimate violations):**
- [ ] Remove `'unsafe-inline'` from `script-src` in enforced CSP
- [ ] Add nonces for any legitimate inline scripts identified

**If violations found:**
- [ ] Add specific nonces/hashes for legitimate scripts
- [ ] Keep report-only for another week
- [ ] Re-review

---

## 4. End-to-End Concurrency & Replay Scenarios

Run these on staging with real Android devices + web POS.

### Scenario A: Two devices editing same order
1. Device 1 opens order #100, adds item
2. Device 2 opens order #100, adds different item
3. Both send to kitchen
- [ ] Both items appear on KDS
- [ ] Order total is correct
- [ ] No data loss

### Scenario B: Cloud update during local edit
1. Admin changes menu price in Mission Control
2. While downstream sync runs, POS adds that item to an order
3. Check: order uses the price at time of addition (locked on OrderItem)
- [ ] Price on OrderItem matches the price when item was added
- [ ] No conflict quarantine triggered (different entities)

### Scenario C: Payment + void + modify simultaneously
1. Device 1 starts card payment on order
2. Device 2 voids an item on same order
3. Payment completes
- [ ] Payment amount reflects pre-void total (locked at payment start)
- [ ] Void is recorded
- [ ] Order state is consistent after both complete

### Scenario D: Offline → reconnect sync flood
1. Disconnect NUC from internet
2. Process 10 orders with payments
3. Reconnect
4. Monitor upstream sync
- [ ] All 10 orders sync to Neon within 30 seconds
- [ ] No duplicate orders or payments
- [ ] Outage queue replays correctly
- [ ] Socket outbox flushes pending events

### Scenario E: Shift close under load
1. Open 20 orders across 3 employees
2. Close shift for employee 1 (force close, transfer orders)
3. Verify: transferred orders accessible to manager
- [ ] All transferred orders have correct employeeId
- [ ] ORDER_METADATA_UPDATED events emitted per order
- [ ] Shift summary calculations correct

**Pass criteria:** All 5 scenarios produce correct, consistent results.

---

## 5. Freeze Architecture Boundaries

### CI enforcement
- [ ] ESLint `no-restricted-syntax` rule is ERROR (not WARN) — **DONE**
- [ ] CI runs `npx tsc --noEmit` — **DONE**
- [ ] CI runs `npm run lint` — **DONE**
- [ ] CI checks schema drift — **DONE**

### Boundary rules (verify in eslint.config.mjs)
- [ ] `db.order.*` banned outside approved files — **DONE**
- [ ] `db.orderItem.*` banned — **DONE**
- [ ] `db.payment.*` banned — **DONE**
- [ ] `db.employee.*` banned — **DONE**
- [ ] `db.menuItem.*` banned — **DONE**
- [ ] Approved files list is frozen (no new additions without review)

### TX-KEEP audit
```bash
grep -rn 'TX-KEEP' src/app/api/ --include='*.ts' | wc -l
# Expected: 48 (freeze at this number — any increase requires justification)
```
- [ ] TX-KEEP count is 48
- [ ] No new TX-KEEP tags added without review

### No new escape hatches
- [ ] No new `adminDb.*` usage in route files without review
- [ ] No new `eslint-disable` for `no-restricted-syntax`
- [ ] No new files added to ESLint `ignores` list without review

---

## Sign-off

| Check | Status | Date | Notes |
|-------|--------|------|-------|
| 1. Quarantine blocking 48h | | | |
| 2. RLS 4 failure tests | | | |
| 3. CSP report review | | | |
| 4. E2E concurrency scenarios | | | |
| 5. Boundaries frozen in CI | | | |

**When all 5 pass: system is production-strong.**
