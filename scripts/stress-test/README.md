# GWI POS Stress Test Suite

Run these against a test NUC or local dev before deploying to production.

## Setup
```bash
cd scripts/stress-test
npm install          # installs k6, artillery, or uses native fetch
cp .env.example .env # set TARGET_URL, TEST_LOCATION_ID, TEST_EMPLOYEE_PIN
```

## Test Matrix

### 1. Peak Load Simulation (`peak-load.ts`)
Simulates 6 terminals doing simultaneous operations for 30 minutes:
- 4 terminals adding items + closing orders (60 orders/hour each)
- 1 terminal running reports
- 1 terminal doing tab management (open, transfer, close)
- **Pass criteria:** p95 response time < 200ms, zero 500 errors

### 2. Concurrent Order Mutation (`concurrent-orders.ts`)
Hammers a single order from 4 terminals simultaneously:
- Terminal A adds items while Terminal B applies discount
- Terminal C changes quantity while Terminal D splits the check
- **Pass criteria:** Final order total is mathematically correct, no lost updates

### 3. Payment Gauntlet (`payment-gauntlet.ts`)
Runs every payment edge case in sequence:
- Single tender cash, card, split (2-way, 3-way, uneven)
- Double-tap (same idempotency key twice)
- Tip adjustment after close (including > 100% tip)
- Void after payment, refund after payment
- Dual pricing cash vs card
- Surcharge calculation verification
- **Pass criteria:** Every order total reconciles, every payment balances

### 4. Report Reconciliation (`reconciliation.ts`)
Creates a known set of orders, then verifies every report matches:
- Create 50 orders: 10 cash, 10 card, 10 split, 10 voided, 10 comped
- Run: daily report, sales report, product-mix, employee report, tips report
- **Pass criteria:** All 5 reports show identical revenue totals (to the penny)

### 5. Inventory Accuracy (`inventory-accuracy.ts`)
Tracks inventory through the full lifecycle:
- Set starting stock for 10 items
- Run 50 orders using those items (with modifiers, pizza toppings, sized drinks)
- Void 5 orders, comp 3 items, refund 2 payments
- **Pass criteria:** Final stock = starting stock - sold + restored (exact match)

### 6. Sync Stress (`sync-stress.ts`)
Tests multi-device sync under load:
- Open 20 tabs across 4 simulated terminals
- Disconnect one terminal for 60 seconds, reconnect
- Verify all terminals show identical order state after reconnect
- **Pass criteria:** Zero stale data after reconnect, catch-up replay works

### 7. Offline Resilience (`offline-resilience.ts`)
Simulates cloud outage:
- Kill Neon connection (set DATABASE_URL to invalid)
- Continue taking orders and payments for 5 minutes
- Restore connection
- **Pass criteria:** All orders sync to cloud, OutageQueue drains completely

### 8. EOD Reconciliation (`eod-reconciliation.ts`)
Full end-of-day simulation:
- Run 200 orders over a simulated 8-hour shift
- Mix of: dine-in, bar tabs, splits, voids, comps, discounts, tip adjustments
- Run automated EOD batch close
- **Pass criteria:** Cash drawer reconciles, card batch matches Datacap settlement
