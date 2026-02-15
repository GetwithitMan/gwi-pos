#!/usr/bin/env tsx
/**
 * GWI POS - Busy Night Load Test
 *
 * Simulates 100 bartenders hammering the POS simultaneously.
 * Run before opening night to make sure the system can handle peak volume.
 *
 * Usage:
 *   npx tsx scripts/load-test.ts
 *   npx tsx scripts/load-test.ts --url http://192.168.1.50:3000
 *   npx tsx scripts/load-test.ts --concurrency 100 --rounds 3
 *
 * Flags:
 *   --url          Base URL (default: http://localhost:3000)
 *   --concurrency  Max concurrent requests per scenario (default: 50)
 *   --rounds       Repeat all scenarios N times (default: 1)
 */

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2)

function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`)
  if (idx !== -1 && args[idx + 1]) return args[idx + 1]
  return fallback
}

const BASE_URL = getArg('url', 'http://localhost:3000').replace(/\/+$/, '')
const CONCURRENCY = parseInt(getArg('concurrency', '50'), 10)
const ROUNDS = parseInt(getArg('rounds', '1'), 10)

// ---------------------------------------------------------------------------
// Color helpers (ANSI escape codes — no deps needed)
// ---------------------------------------------------------------------------

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m',
}

function colorForMs(ms: number): string {
  if (ms < 200) return c.green
  if (ms < 500) return c.yellow
  return c.red
}

function badgeForMs(ms: number): string {
  if (ms < 200) return `${c.bgGreen}${c.bold} FAST ${c.reset}`
  if (ms < 500) return `${c.bgYellow}${c.bold} OK   ${c.reset}`
  return `${c.bgRed}${c.bold} SLOW ${c.reset}`
}

// ---------------------------------------------------------------------------
// Stats collection
// ---------------------------------------------------------------------------

interface RequestResult {
  ok: boolean
  status: number
  durationMs: number
  serverTiming: string | null
  body?: unknown
  error?: string
}

interface ScenarioStats {
  name: string
  total: number
  successes: number
  errors: number
  errorRate: string
  min: number
  max: number
  median: number
  p95: number
  p99: number
  serverTimings: string[]
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

function computeStats(name: string, results: RequestResult[]): ScenarioStats {
  const durations = results.map(r => r.durationMs).sort((a, b) => a - b)
  const successes = results.filter(r => r.ok).length
  const errors = results.length - successes
  const serverTimings = results
    .map(r => r.serverTiming)
    .filter((t): t is string => t !== null)

  return {
    name,
    total: results.length,
    successes,
    errors,
    errorRate: results.length > 0 ? `${((errors / results.length) * 100).toFixed(1)}%` : '0%',
    min: durations[0] ?? 0,
    max: durations[durations.length - 1] ?? 0,
    median: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    serverTimings,
  }
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function timedFetch(
  url: string,
  init?: RequestInit,
): Promise<RequestResult> {
  const start = performance.now()
  try {
    const res = await fetch(url, init)
    const durationMs = Math.round(performance.now() - start)
    const serverTiming = res.headers.get('server-timing') ?? null

    let body: unknown
    const ct = res.headers.get('content-type') ?? ''
    if (ct.includes('application/json')) {
      body = await res.json()
    } else {
      body = await res.text()
    }

    return {
      ok: res.ok,
      status: res.status,
      durationMs,
      serverTiming,
      body,
      error: res.ok ? undefined : String(body),
    }
  } catch (err) {
    const durationMs = Math.round(performance.now() - start)
    return {
      ok: false,
      status: 0,
      durationMs,
      serverTiming: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// Fire N requests concurrently
async function blitz(
  n: number,
  buildRequest: (i: number) => { url: string; init?: RequestInit },
): Promise<RequestResult[]> {
  const promises: Promise<RequestResult>[] = []
  for (let i = 0; i < n; i++) {
    const { url, init } = buildRequest(i)
    promises.push(timedFetch(url, init))
  }
  return Promise.all(promises)
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printTable(stats: ScenarioStats) {
  const pad = (s: string, len: number) => s.padEnd(len)
  const padR = (s: string, len: number) => s.padStart(len)

  console.log()
  console.log(`${c.bold}${c.cyan}  ${stats.name}${c.reset}`)
  console.log(`${c.dim}  ${'─'.repeat(72)}${c.reset}`)

  const rows: [string, string][] = [
    ['Requests', `${stats.total}`],
    ['Successes', `${c.green}${stats.successes}${c.reset}`],
    ['Errors', stats.errors > 0 ? `${c.red}${stats.errors}${c.reset}` : `${stats.errors}`],
    ['Error Rate', stats.errors > 0 ? `${c.red}${stats.errorRate}${c.reset}` : stats.errorRate],
    ['Min', `${colorForMs(stats.min)}${stats.min}ms${c.reset}`],
    ['Median', `${colorForMs(stats.median)}${stats.median}ms${c.reset}`],
    ['P95', `${colorForMs(stats.p95)}${stats.p95}ms${c.reset}  ${badgeForMs(stats.p95)}`],
    ['P99', `${colorForMs(stats.p99)}${stats.p99}ms${c.reset}  ${badgeForMs(stats.p99)}`],
    ['Max', `${colorForMs(stats.max)}${stats.max}ms${c.reset}`],
  ]

  for (const [label, value] of rows) {
    console.log(`  ${pad(label, 14)} ${value}`)
  }

  if (stats.serverTimings.length > 0) {
    // Show first server timing as a sample
    console.log(`  ${c.dim}Server-Timing  ${stats.serverTimings[0]}${c.reset}`)
  }
}

function printSummary(allStats: ScenarioStats[]) {
  console.log()
  console.log(`${c.bold}${c.magenta}  FINAL SUMMARY${c.reset}`)
  console.log(`${c.dim}  ${'═'.repeat(90)}${c.reset}`)

  // Header
  const h = (s: string, w: number) => s.padEnd(w)
  const hr = (s: string, w: number) => s.padStart(w)
  console.log(
    `  ${h('Scenario', 30)} ${hr('Reqs', 5)} ${hr('OK', 5)} ${hr('Err', 5)} ${hr('Min', 7)} ${hr('Med', 7)} ${hr('P95', 7)} ${hr('P99', 7)} ${hr('Max', 7)}`
  )
  console.log(`  ${c.dim}${'─'.repeat(90)}${c.reset}`)

  for (const s of allStats) {
    const errStr = s.errors > 0 ? `${c.red}${s.errors}${c.reset}` : `${s.errors}`
    console.log(
      `  ${h(s.name, 30)} ${hr(String(s.total), 5)} ${hr(String(s.successes), 5)} ${hr(String(s.errors), s.errors > 0 ? 5 + c.red.length + c.reset.length : 5)} ` +
      `${colorForMs(s.min)}${hr(s.min + 'ms', 7)}${c.reset} ` +
      `${colorForMs(s.median)}${hr(s.median + 'ms', 7)}${c.reset} ` +
      `${colorForMs(s.p95)}${hr(s.p95 + 'ms', 7)}${c.reset} ` +
      `${colorForMs(s.p99)}${hr(s.p99 + 'ms', 7)}${c.reset} ` +
      `${colorForMs(s.max)}${hr(s.max + 'ms', 7)}${c.reset}`
    )
  }

  console.log(`  ${c.dim}${'═'.repeat(90)}${c.reset}`)

  // Overall verdict
  const worstP95 = Math.max(...allStats.map(s => s.p95))
  const totalErrors = allStats.reduce((sum, s) => sum + s.errors, 0)
  const totalRequests = allStats.reduce((sum, s) => sum + s.total, 0)

  console.log()
  if (totalErrors === 0 && worstP95 < 200) {
    console.log(`  ${c.bgGreen}${c.bold} PASS ${c.reset} ${c.green}All ${totalRequests} requests succeeded. Worst P95: ${worstP95}ms. You're ready for a busy night.${c.reset}`)
  } else if (totalErrors === 0 && worstP95 < 500) {
    console.log(`  ${c.bgYellow}${c.bold} WARN ${c.reset} ${c.yellow}All ${totalRequests} requests succeeded but P95 is ${worstP95}ms. Consider optimizing before peak hours.${c.reset}`)
  } else if (totalErrors > 0) {
    console.log(`  ${c.bgRed}${c.bold} FAIL ${c.reset} ${c.red}${totalErrors} errors out of ${totalRequests} requests. Fix issues before going live.${c.reset}`)
  } else {
    console.log(`  ${c.bgRed}${c.bold} SLOW ${c.reset} ${c.red}Worst P95 is ${worstP95}ms. The system will feel sluggish under load.${c.reset}`)
  }
  console.log()
}

// ---------------------------------------------------------------------------
// Bootstrap: get locationId and employeeId
// ---------------------------------------------------------------------------

async function bootstrap(): Promise<{ locationId: string; employeeId: string }> {
  console.log(`${c.dim}  Bootstrapping: fetching location and logging in...${c.reset}`)

  // 1. Get locationId
  const locRes = await timedFetch(`${BASE_URL}/api/location`)
  if (!locRes.ok) {
    throw new Error(`Cannot fetch location: ${locRes.status} ${locRes.error}`)
  }
  const locData = locRes.body as { data?: { id: string } }
  const locationId = locData?.data?.id
  if (!locationId) {
    throw new Error(`Location response missing data.id: ${JSON.stringify(locRes.body)}`)
  }

  // 2. Login with PIN 1234 (Manager)
  const loginRes = await timedFetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: '1234', locationId }),
  })
  if (!loginRes.ok) {
    throw new Error(`Login failed: ${loginRes.status} ${loginRes.error}`)
  }
  const loginData = loginRes.body as { employee?: { id: string } }
  const employeeId = loginData?.employee?.id
  if (!employeeId) {
    throw new Error(`Login response missing employee.id: ${JSON.stringify(loginRes.body)}`)
  }

  console.log(`${c.green}  Location: ${locationId}${c.reset}`)
  console.log(`${c.green}  Employee: ${employeeId}${c.reset}`)

  return { locationId, employeeId }
}

// ---------------------------------------------------------------------------
// Fetch a menu item ID from the menu
// ---------------------------------------------------------------------------

async function fetchMenuItemId(locationId: string): Promise<{ id: string; name: string; price: number }> {
  const res = await timedFetch(`${BASE_URL}/api/menu?locationId=${locationId}`)
  if (!res.ok) {
    throw new Error(`Menu fetch failed: ${res.status} ${res.error}`)
  }

  const data = res.body as { data?: { items?: Array<{ id: string; name: string; basePrice: number; price: number; isAvailable: boolean }> } }
  const items = data?.data?.items ?? []

  // Prefer a cheap available item (not entertainment/combo) for realistic ordering
  const candidate = items.find(
    item => item.isAvailable !== false && (item.basePrice ?? item.price) > 0
  )

  if (!candidate) {
    throw new Error('No available menu items found. Seed the database first: npm run db:seed')
  }

  const price = Number(candidate.basePrice ?? candidate.price)
  console.log(`${c.green}  Menu item: "${candidate.name}" ($${price.toFixed(2)}) [${candidate.id}]${c.reset}`)

  return { id: candidate.id, name: candidate.name, price }
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenarioFloorPlanSnapshot(locationId: string, n: number): Promise<ScenarioStats> {
  const results = await blitz(n, () => ({
    url: `${BASE_URL}/api/floorplan/snapshot?locationId=${locationId}`,
  }))
  return computeStats('Floor Plan Snapshot', results)
}

async function scenarioMenuLoad(locationId: string, n: number): Promise<ScenarioStats> {
  const results = await blitz(n, () => ({
    url: `${BASE_URL}/api/menu?locationId=${locationId}`,
  }))
  return computeStats('Menu Load', results)
}

async function scenarioOpenOrders(locationId: string, n: number): Promise<ScenarioStats> {
  const results = await blitz(n, () => ({
    url: `${BASE_URL}/api/orders/open?locationId=${locationId}`,
  }))
  return computeStats('Open Orders', results)
}

async function scenarioCreateOrders(
  locationId: string,
  employeeId: string,
  n: number,
): Promise<{ stats: ScenarioStats; orderIds: string[] }> {
  const results = await blitz(n, (i) => ({
    url: `${BASE_URL}/api/orders`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId,
        locationId,
        orderType: 'bar_tab',
        tabName: `Load Test Tab ${i + 1}`,
        guestCount: 1,
        items: [],
      }),
    },
  }))

  const orderIds: string[] = []
  for (const r of results) {
    if (r.ok) {
      const d = r.body as { data?: { id: string } }
      if (d?.data?.id) orderIds.push(d.data.id)
    }
  }

  return { stats: computeStats('Create Orders', results), orderIds }
}

async function scenarioAddItems(
  orderIds: string[],
  menuItem: { id: string; name: string; price: number },
  n: number,
): Promise<ScenarioStats> {
  // Use min(n, orderIds.length) to avoid index overflow
  const count = Math.min(n, orderIds.length)
  if (count === 0) {
    return computeStats('Add Items', [])
  }

  const results = await blitz(count, (i) => ({
    url: `${BASE_URL}/api/orders/${orderIds[i]}/items`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          { menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, quantity: 1, modifiers: [] },
          { menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, quantity: 2, modifiers: [] },
          { menuItemId: menuItem.id, name: menuItem.name, price: menuItem.price, quantity: 1, modifiers: [] },
        ],
      }),
    },
  }))

  return computeStats('Add Items (3 each)', results)
}

async function scenarioSendToKitchen(
  orderIds: string[],
  n: number,
): Promise<ScenarioStats> {
  const count = Math.min(n, orderIds.length)
  if (count === 0) {
    return computeStats('Send to Kitchen', [])
  }

  const results = await blitz(count, (i) => ({
    url: `${BASE_URL}/api/orders/${orderIds[i]}/send`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  }))

  return computeStats('Send to Kitchen', results)
}

async function scenarioPayCash(
  orderIds: string[],
  itemPrice: number,
  n: number,
): Promise<ScenarioStats> {
  const count = Math.min(n, orderIds.length)
  if (count === 0) {
    return computeStats('Pay (Cash)', [])
  }

  // Each order has 4 items (1+2+1 qty across 3 line items = qty 4 total)
  // Total per order = price * 4
  const orderTotal = itemPrice * 4

  const results = await blitz(count, (i) => ({
    url: `${BASE_URL}/api/orders/${orderIds[i]}/pay`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payments: [
          {
            method: 'cash',
            amount: orderTotal,
            tipAmount: 0,
            amountTendered: Math.ceil(orderTotal),
            simulate: true,
          },
        ],
      }),
    },
  }))

  return computeStats('Pay (Cash)', results)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log()
  console.log(`${c.bold}${c.magenta}  ╔══════════════════════════════════════════════════╗${c.reset}`)
  console.log(`${c.bold}${c.magenta}  ║       GWI POS — Busy Night Load Test            ║${c.reset}`)
  console.log(`${c.bold}${c.magenta}  ╚══════════════════════════════════════════════════╝${c.reset}`)
  console.log()
  console.log(`  ${c.dim}Target:       ${c.reset}${BASE_URL}`)
  console.log(`  ${c.dim}Concurrency:  ${c.reset}${CONCURRENCY}`)
  console.log(`  ${c.dim}Rounds:       ${c.reset}${ROUNDS}`)
  console.log()

  // Check server is reachable
  try {
    const ping = await timedFetch(`${BASE_URL}/api/location`)
    if (!ping.ok && ping.status === 0) {
      console.log(`${c.red}  Cannot reach server at ${BASE_URL}. Is it running?${c.reset}`)
      process.exit(1)
    }
  } catch {
    console.log(`${c.red}  Cannot reach server at ${BASE_URL}. Is it running?${c.reset}`)
    process.exit(1)
  }

  // Bootstrap
  const { locationId, employeeId } = await bootstrap()
  const menuItem = await fetchMenuItemId(locationId)
  console.log()

  const allStats: ScenarioStats[] = []

  for (let round = 1; round <= ROUNDS; round++) {
    if (ROUNDS > 1) {
      console.log(`${c.bold}${c.cyan}  ── Round ${round} of ${ROUNDS} ${'─'.repeat(50)}${c.reset}`)
    }

    // Scenario 1: Floor Plan Snapshot
    console.log(`${c.dim}  Running: Floor Plan Snapshot (${CONCURRENCY} concurrent)...${c.reset}`)
    const fpStats = await scenarioFloorPlanSnapshot(locationId, CONCURRENCY)
    printTable(fpStats)
    allStats.push(fpStats)

    // Scenario 2: Menu Load
    console.log(`${c.dim}  Running: Menu Load (${CONCURRENCY} concurrent)...${c.reset}`)
    const menuStats = await scenarioMenuLoad(locationId, CONCURRENCY)
    printTable(menuStats)
    allStats.push(menuStats)

    // Scenario 3: Open Orders
    console.log(`${c.dim}  Running: Open Orders (${CONCURRENCY} concurrent)...${c.reset}`)
    const openStats = await scenarioOpenOrders(locationId, CONCURRENCY)
    printTable(openStats)
    allStats.push(openStats)

    // Scenario 4: Create Orders
    const createCount = Math.min(CONCURRENCY, 50)
    console.log(`${c.dim}  Running: Create Orders (${createCount} concurrent)...${c.reset}`)
    const { stats: createStats, orderIds } = await scenarioCreateOrders(
      locationId, employeeId, createCount
    )
    printTable(createStats)
    allStats.push(createStats)

    if (orderIds.length === 0) {
      console.log(`${c.red}  No orders created — skipping remaining write scenarios.${c.reset}`)
      continue
    }
    console.log(`${c.dim}  Created ${orderIds.length} orders for subsequent scenarios.${c.reset}`)

    // Scenario 5: Add Items
    const addCount = Math.min(CONCURRENCY, orderIds.length)
    console.log(`${c.dim}  Running: Add Items (${addCount} concurrent, 3 items each)...${c.reset}`)
    const addStats = await scenarioAddItems(orderIds, menuItem, addCount)
    printTable(addStats)
    allStats.push(addStats)

    // Scenario 6: Send to Kitchen
    const sendCount = Math.min(CONCURRENCY, orderIds.length)
    console.log(`${c.dim}  Running: Send to Kitchen (${sendCount} concurrent)...${c.reset}`)
    const sendStats = await scenarioSendToKitchen(orderIds, sendCount)
    printTable(sendStats)
    allStats.push(sendStats)

    // Scenario 7: Pay (Cash)
    const payCount = Math.min(25, orderIds.length)
    console.log(`${c.dim}  Running: Pay Cash (${payCount} concurrent)...${c.reset}`)
    const payStats = await scenarioPayCash(orderIds, menuItem.price, payCount)
    printTable(payStats)
    allStats.push(payStats)
  }

  // Final summary
  printSummary(allStats)
}

main().catch((err) => {
  console.error(`${c.red}  Fatal error: ${err.message}${c.reset}`)
  process.exit(1)
})
