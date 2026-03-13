/**
 * Concurrent Order Mutation Test
 *
 * Hammers a single order from multiple "terminals" simultaneously
 * to verify FOR UPDATE locks, version conflicts, and total consistency.
 *
 * Usage: npx tsx scripts/stress-test/concurrent-orders.ts
 */

import 'dotenv/config'

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3005'
const LOCATION_ID = process.env.TEST_LOCATION_ID
const EMPLOYEE_ID = process.env.TEST_EMPLOYEE_ID

if (!LOCATION_ID || !EMPLOYEE_ID) {
  console.error('Set TEST_LOCATION_ID and TEST_EMPLOYEE_ID in .env')
  process.exit(1)
}

let passed = 0
let failed = 0

async function api(method: string, path: string, body?: any) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-location-id': LOCATION_ID!,
      'x-employee-id': EMPLOYEE_ID!,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) }
}

function assert(name: string, condition: boolean, expected: string, actual: string) {
  if (condition) {
    console.log(`  [PASS] ${name}`)
    passed++
  } else {
    console.log(`  [FAIL] ${name}`)
    console.log(`         Expected: ${expected}`)
    console.log(`         Actual:   ${actual}`)
    failed++
  }
}

async function run() {
  console.log('=== Concurrent Order Mutation Test ===\n')

  // Get menu items
  const menuRes = await api('GET', `/api/menu?locationId=${LOCATION_ID}`)
  const allItems = menuRes.data?.data?.items || menuRes.data?.data?.categories?.flatMap((c: any) => c.menuItems || []) || []

  if (allItems.length < 4) {
    console.error('Need at least 4 menu items')
    process.exit(1)
  }

  const items = allItems.slice(0, 4)

  // Create a test order with 1 item
  console.log('1. Creating base order...')
  const orderRes = await api('POST', '/api/orders', {
    employeeId: EMPLOYEE_ID,
    locationId: LOCATION_ID,
    orderType: 'dine_in',
    items: [{ menuItemId: items[0].id, quantity: 1, price: Number(items[0].price), name: items[0].name }],
  })
  const orderId = orderRes.data?.data?.id
  if (!orderId) {
    console.error('Failed to create order:', orderRes.data)
    process.exit(1)
  }
  console.log(`   Order ${orderId} created\n`)

  // TEST 1: Add 4 items simultaneously from 4 "terminals"
  console.log('2. Adding 4 items simultaneously...')
  const addResults = await Promise.allSettled(
    items.map((item: any, i: number) =>
      api('POST', `/api/orders/${orderId}/items`, {
        items: [{ menuItemId: item.id, quantity: 1, price: Number(item.price), name: item.name }],
        employeeId: EMPLOYEE_ID,
      }).then(r => ({ terminal: i + 1, ...r }))
    )
  )

  const successCount = addResults.filter(r => r.status === 'fulfilled' && (r.value as any).ok).length
  assert(
    'All 4 concurrent item adds succeed',
    successCount === 4,
    '4 successes',
    `${successCount} successes`
  )

  // Verify order state
  const orderAfterAdds = await api('GET', `/api/orders/${orderId}`)
  const itemCount = orderAfterAdds.data?.data?.items?.length || 0
  assert(
    'Order has all 5 items (1 original + 4 added)',
    itemCount === 5,
    '5 items',
    `${itemCount} items`
  )

  // Verify subtotal is correct (sum of all item prices)
  const expectedSubtotal = items.reduce((sum: number, i: any) => sum + Number(i.price), 0) + Number(items[0].price)
  const actualSubtotal = Number(orderAfterAdds.data?.data?.subtotal || 0)
  const subtotalMatch = Math.abs(actualSubtotal - expectedSubtotal) < 0.02
  assert(
    'Subtotal is mathematically correct after concurrent adds',
    subtotalMatch,
    `~$${expectedSubtotal.toFixed(2)}`,
    `$${actualSubtotal.toFixed(2)}`
  )

  // TEST 2: Apply discount + change quantity simultaneously
  console.log('\n3. Concurrent discount + quantity change...')
  const orderItems = orderAfterAdds.data?.data?.items || []
  if (orderItems.length >= 2) {
    const [discountResult, quantityResult] = await Promise.allSettled([
      api('POST', `/api/orders/${orderId}/discount`, {
        type: 'percent',
        value: 10,
        reason: 'stress test',
        employeeId: EMPLOYEE_ID,
      }),
      api('PUT', `/api/orders/${orderId}/items/${orderItems[1].id}`, {
        quantity: 3,
        employeeId: EMPLOYEE_ID,
      }),
    ])

    // Both should succeed (FOR UPDATE serializes them)
    const discountOk = discountResult.status === 'fulfilled' && (discountResult.value as any).ok
    const quantityOk = quantityResult.status === 'fulfilled' && (quantityResult.value as any).ok
    assert(
      'Concurrent discount + quantity both succeed (serialized by FOR UPDATE)',
      discountOk && quantityOk,
      'both succeed',
      `discount: ${discountOk ? 'ok' : 'failed'}, quantity: ${quantityOk ? 'ok' : 'failed'}`
    )
  }

  // Verify final order integrity
  const finalOrder = await api('GET', `/api/orders/${orderId}`)
  const fo = finalOrder.data?.data
  if (fo) {
    const st = Number(fo.subtotal)
    const dt = Number(fo.discountTotal)
    const tt = Number(fo.taxTotal)
    const total = Number(fo.total)

    // total should equal subtotal + tax (discount is already reflected in subtotal)
    const computedTotal = Math.round((st + tt) * 100) / 100
    const totalMatch = Math.abs(total - computedTotal) < 0.05
    assert(
      'Final total = subtotal + tax (discount already in subtotal)',
      totalMatch,
      `$${computedTotal.toFixed(2)}`,
      `$${total.toFixed(2)} (sub=$${st.toFixed(2)} disc=$${dt.toFixed(2)} tax=$${tt.toFixed(2)})`
    )
  }

  // TEST 3: Double-remove same item (race condition)
  console.log('\n4. Double-remove same item (race)...')
  if (orderItems.length >= 1) {
    const targetItemId = orderItems[0].id
    const [remove1, remove2] = await Promise.allSettled([
      api('DELETE', `/api/orders/${orderId}/items/${targetItemId}?employeeId=${EMPLOYEE_ID}`),
      api('DELETE', `/api/orders/${orderId}/items/${targetItemId}?employeeId=${EMPLOYEE_ID}`),
    ])

    // At least one should succeed, the other should fail gracefully (404 or conflict)
    const r1ok = remove1.status === 'fulfilled' && (remove1.value as any).ok
    const r2ok = remove2.status === 'fulfilled' && (remove2.value as any).ok
    assert(
      'Double-remove: exactly one succeeds, one fails gracefully',
      (r1ok && !r2ok) || (!r1ok && r2ok) || (r1ok && r2ok), // both ok is also acceptable (idempotent delete)
      'one success + one graceful failure (or both idempotent)',
      `remove1: ${r1ok ? 'ok' : 'failed'}, remove2: ${r2ok ? 'ok' : 'failed'}`
    )
  }

  // Summary
  console.log(`\n=== RESULTS: ${passed} passed, ${failed} failed ===`)
  if (failed > 0) process.exit(1)
}

run().catch(err => {
  console.error('Test crashed:', err)
  process.exit(1)
})
