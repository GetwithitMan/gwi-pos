/**
 * Peak Load Simulation
 *
 * Simulates 6 concurrent terminals hammering the POS for a configurable duration.
 * Measures response times and error rates. Fails if p95 > 200ms or error rate > 1%.
 *
 * Usage: npx tsx scripts/stress-test/peak-load.ts [duration_minutes]
 * Default: 5 minutes
 */

import 'dotenv/config'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3005'
const LOCATION_ID = process.env.TEST_LOCATION_ID
const EMPLOYEE_ID = process.env.TEST_EMPLOYEE_ID
const DURATION_MS = (parseInt(process.argv[2] || '5') * 60 * 1000)
const NUM_TERMINALS = 6

if (!LOCATION_ID || !EMPLOYEE_ID) {
  console.error('Set TEST_LOCATION_ID and TEST_EMPLOYEE_ID in .env')
  process.exit(1)
}

interface RequestLog {
  endpoint: string
  method: string
  duration: number
  status: number
  terminal: number
}

const requestLogs: RequestLog[] = []

async function timedApi(terminal: number, method: string, path: string, body?: any): Promise<{ ok: boolean; status: number; data: any }> {
  const start = Date.now()
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-location-id': LOCATION_ID!,
        'x-employee-id': EMPLOYEE_ID!,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const duration = Date.now() - start
    requestLogs.push({ endpoint: `${method} ${path.replace(/[a-f0-9-]{36}/g, ':id')}`, method, duration, status: res.status, terminal })
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) }
  } catch (err) {
    const duration = Date.now() - start
    requestLogs.push({ endpoint: `${method} ${path}`, method, duration, status: 0, terminal })
    return { ok: false, status: 0, data: null }
  }
}

async function simulateTerminal(terminalId: number, menuItems: any[], endTime: number) {
  let ordersCreated = 0
  let ordersClosed = 0

  while (Date.now() < endTime) {
    try {
      // 1. Create order
      const item = menuItems[Math.floor(Math.random() * menuItems.length)]
      const numItems = 1 + Math.floor(Math.random() * 3)
      const items = Array.from({ length: numItems }, () => {
        const mi = menuItems[Math.floor(Math.random() * menuItems.length)]
        return { menuItemId: mi.id, quantity: 1 + Math.floor(Math.random() * 2), price: Number(mi.price), name: mi.name }
      })

      const orderRes = await timedApi(terminalId, 'POST', '/api/orders', {
        employeeId: EMPLOYEE_ID,
        locationId: LOCATION_ID,
        orderType: 'dine_in',
        items,
      })

      if (!orderRes.ok || !orderRes.data?.data?.id) continue
      ordersCreated++
      const orderId = orderRes.data.data.id

      // 2. Maybe add more items (50% chance)
      if (Math.random() > 0.5) {
        const extraItem = menuItems[Math.floor(Math.random() * menuItems.length)]
        await timedApi(terminalId, 'POST', `/api/orders/${orderId}/items`, {
          items: [{ menuItemId: extraItem.id, quantity: 1, price: Number(extraItem.price), name: extraItem.name }],
          employeeId: EMPLOYEE_ID,
        })
      }

      // 3. Fetch open orders (every terminal does this frequently)
      await timedApi(terminalId, 'GET', `/api/orders/open?locationId=${LOCATION_ID}&summary=true`)

      // 4. Pay and close (cash for test simplicity)
      // Fetch fresh total to avoid tax rounding mismatches between create and pay
      const freshOrder = await timedApi(terminalId, 'GET', `/api/orders/${orderId}`)
      const total = Number(freshOrder.data?.data?.total || orderRes.data.data.total || orderRes.data.data.subtotal || 10)
      // Add small buffer for cash rounding safety
      const payAmount = Math.round((total + 0.05) * 100) / 100
      const tip = Math.round(total * (0.15 + Math.random() * 0.1) * 100) / 100
      await timedApi(terminalId, 'POST', `/api/orders/${orderId}/pay`, {
        payments: [{
          method: 'cash',
          amount: payAmount,
          tipAmount: tip,
          totalAmount: payAmount + tip,
        }],
        employeeId: EMPLOYEE_ID,
        idempotencyKey: `perf-${orderId}-${Date.now()}`,
      })
      ordersClosed++

      // 5. Small delay to simulate human speed (~3-5 seconds per order cycle)
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000))

    } catch (err) {
      // Network errors, etc. Just continue
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  return { terminal: terminalId, ordersCreated, ordersClosed }
}

async function simulateReportTerminal(terminalId: number, endTime: number) {
  let reportsFetched = 0

  while (Date.now() < endTime) {
    try {
      const today = new Date().toISOString().split('T')[0]
      const reports = ['daily', 'sales', 'product-mix', 'employees', 'tips', 'hourly']
      const report = reports[Math.floor(Math.random() * reports.length)]

      await timedApi(terminalId, 'GET', `/api/reports/${report}?locationId=${LOCATION_ID}&startDate=${today}&endDate=${today}&employeeId=${EMPLOYEE_ID}`)
      reportsFetched++

      // Reports fetched less frequently
      await new Promise(r => setTimeout(r, 5000 + Math.random() * 10000))
    } catch {
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  return { terminal: terminalId, reportsFetched }
}

async function run() {
  console.log(`=== Peak Load Simulation ===`)
  console.log(`   Terminals: ${NUM_TERMINALS}`)
  console.log(`   Duration: ${DURATION_MS / 60000} minutes`)
  console.log(`   Target: ${BASE_URL}\n`)

  // Get menu items
  const menuRes = await timedApi(0, 'GET', `/api/menu?locationId=${LOCATION_ID}`)
  const menuItems = menuRes.data?.data?.items || menuRes.data?.data?.categories?.flatMap((c: any) => c.menuItems || []) || []
  if (menuItems.length < 3) {
    console.error('Need at least 3 menu items')
    process.exit(1)
  }
  console.log(`   Menu items: ${menuItems.length}\n`)

  const endTime = Date.now() + DURATION_MS
  console.log('Starting simulation...\n')

  // Launch terminals: 4 order terminals, 1 report terminal, 1 tab terminal
  const results = await Promise.all([
    ...Array.from({ length: 4 }, (_, i) => simulateTerminal(i + 1, menuItems, endTime)),
    simulateReportTerminal(5, endTime),
    simulateTerminal(6, menuItems, endTime), // tab management terminal
  ])

  // Analyze results
  console.log('\n=== Terminal Results ===')
  for (const r of results) {
    console.log(`  Terminal ${(r as any).terminal}:`, r)
  }

  // Response time analysis
  const durations = requestLogs.map(r => r.duration).sort((a, b) => a - b)
  const p50 = durations[Math.floor(durations.length * 0.5)] || 0
  const p95 = durations[Math.floor(durations.length * 0.95)] || 0
  const p99 = durations[Math.floor(durations.length * 0.99)] || 0
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length || 0

  const errors = requestLogs.filter(r => r.status === 0 || r.status >= 500)
  const clientErrors = requestLogs.filter(r => r.status >= 400 && r.status < 500)
  const errorRate = (errors.length / requestLogs.length * 100) || 0

  console.log('\n=== Performance Metrics ===')
  console.log(`  Total requests: ${requestLogs.length}`)
  console.log(`  Avg response:   ${avg.toFixed(0)}ms`)
  console.log(`  p50 response:   ${p50}ms`)
  console.log(`  p95 response:   ${p95}ms`)
  console.log(`  p99 response:   ${p99}ms`)
  console.log(`  Error count:    ${errors.length} (5xx/network)`)
  console.log(`  4xx errors:     ${clientErrors.length}`)
  console.log(`  Error rate:     ${errorRate.toFixed(2)}%`)

  // Show error details
  if (errors.length > 0) {
    console.log('\n  Error Details:')
    for (const e of errors.slice(0, 10)) {
      console.log(`    ${e.endpoint} → ${e.status} (terminal ${e.terminal}, ${e.duration}ms)`)
    }
  }

  // Slowest endpoints
  const byEndpoint = new Map<string, number[]>()
  for (const r of requestLogs) {
    const key = r.endpoint
    if (!byEndpoint.has(key)) byEndpoint.set(key, [])
    byEndpoint.get(key)!.push(r.duration)
  }

  console.log('\n=== Slowest Endpoints (by p95) ===')
  const endpointStats = [...byEndpoint.entries()]
    .map(([endpoint, durations]) => {
      durations.sort((a, b) => a - b)
      return {
        endpoint,
        count: durations.length,
        p95: durations[Math.floor(durations.length * 0.95)] || 0,
        avg: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      }
    })
    .sort((a, b) => b.p95 - a.p95)
    .slice(0, 10)

  for (const s of endpointStats) {
    console.log(`  ${s.endpoint.padEnd(50)} p95=${s.p95}ms  avg=${s.avg}ms  n=${s.count}`)
  }

  // Pass/fail
  console.log('\n=== VERDICT ===')
  const p95Pass = p95 <= 200
  const errorPass = errorRate <= 1
  console.log(`  [${p95Pass ? 'PASS' : 'FAIL'}] p95 response time: ${p95}ms (target: <= 200ms)`)
  console.log(`  [${errorPass ? 'PASS' : 'FAIL'}] Error rate: ${errorRate.toFixed(2)}% (target: <= 1%)`)

  if (!p95Pass || !errorPass) {
    console.log('\n  PERFORMANCE TEST FAILED')
    process.exit(1)
  } else {
    console.log('\n  ALL CHECKS PASSED')
  }
}

run().catch(err => {
  console.error('Test crashed:', err)
  process.exit(1)
})
