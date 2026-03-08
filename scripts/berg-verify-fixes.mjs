/**
 * Berg Security Fix Verification
 * Proves two fixes are working on the live dev server.
 *
 * Test 1: Body tamper → expects 401 (body hash mismatch)
 * Test 2: Rotate secret → pour with new secret → expects ACK
 *
 * Usage: node scripts/berg-verify-fixes.mjs
 */

import { createHash, createHmac } from 'crypto'

const POS_URL = process.env.GWI_POS_URL || 'http://localhost:3005'
const LOCATION_ID = 'loc-1'
const EMPLOYEE_ID = 'emp-super-admin'

let pass = 0
let fail = 0

function ok(label) { console.log(`  ✅ ${label}`); pass++ }
function bad(label, detail) { console.log(`  ❌ ${label}${detail ? ': ' + detail : ''}`); fail++ }

// ──────────────────────────────────────────────
// SETUP: Create a fresh test device with a known secret
// ──────────────────────────────────────────────

async function setup() {
  const res = await fetch(`${POS_URL}/api/berg/devices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      locationId: LOCATION_ID,
      employeeId: EMPLOYEE_ID,
      name: '__verify_test_device__',
      portName: '/dev/ttyUSB_TEST',
      model: 'MODEL_1504_704',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Device creation failed ${res.status}: ${text}`)
  }
  const data = await res.json()
  const deviceId = data.device?.id
  const bridgeSecret = data.bridgeSecret
  if (!deviceId || !bridgeSecret) throw new Error('No deviceId or bridgeSecret in response')
  return { deviceId, bridgeSecret }
}

// ──────────────────────────────────────────────
// TEARDOWN: Deactivate the test device
// ──────────────────────────────────────────────

async function teardown(deviceId) {
  await fetch(`${POS_URL}/api/berg/devices/${deviceId}?locationId=${LOCATION_ID}&employeeId=${EMPLOYEE_ID}`, {
    method: 'DELETE',
  }).catch(() => {})
}

// ──────────────────────────────────────────────
// HMAC helpers (mirrors bridge logic)
// ──────────────────────────────────────────────

function buildAuthHeaders(deviceId, secret, bodyStr) {
  const ts = String(Date.now())
  const bodySha256 = createHash('sha256').update(bodyStr).digest('hex')
  const message = `${deviceId}.${ts}.${bodySha256}`
  const sig = createHmac('sha256', secret).update(message).digest('hex')
  return { 'x-berg-ts': ts, 'x-berg-body-sha256': bodySha256, 'Authorization': `Bearer ${sig}` }
}

function buildDispenseBody(deviceId, pluNumber = 1) {
  return {
    deviceId,
    pluNumber,
    rawPacket: '023103',
    modifierBytes: null,
    trailerBytes: null,
    lrcReceived: '30',
    lrcCalculated: '30',
    lrcValid: true,
    parseStatus: 'OK',
    receivedAt: new Date().toISOString(),
  }
}

// ──────────────────────────────────────────────
// TEST 1: Body tamper → must be 401
// ──────────────────────────────────────────────

async function testBodyTamper(deviceId, secret) {
  console.log('\nTest 1 — Body tamper detection')

  const bodyA = JSON.stringify(buildDispenseBody(deviceId, 1))
  const bodyB = JSON.stringify(buildDispenseBody(deviceId, 99)) // different PLU

  // Sign headers for Body A, but send Body B
  const headers = { 'Content-Type': 'application/json', ...buildAuthHeaders(deviceId, secret, bodyA) }
  // Override x-berg-body-sha256 to be hash of Body A (NOT Body B)
  // The server should recompute hash of the actual received body (B) and reject the mismatch

  const res = await fetch(`${POS_URL}/api/berg/dispense`, {
    method: 'POST',
    headers,
    body: bodyB, // tampered body
  })

  if (res.status === 401) {
    ok('Tampered body rejected with 401')
  } else {
    const data = await res.json().catch(() => ({}))
    bad('Tampered body NOT rejected', `status=${res.status} body=${JSON.stringify(data)}`)
  }
}

// ──────────────────────────────────────────────
// TEST 2: Rotate secret → pour succeeds immediately
// ──────────────────────────────────────────────

async function testRotateAndPour(deviceId, _oldSecret) {
  console.log('\nTest 2 — Rotate secret → immediate pour')

  // Step A: Rotate the secret
  const rotateRes = await fetch(`${POS_URL}/api/berg/devices/${deviceId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      confirmDeviceId: deviceId,
      locationId: LOCATION_ID,
      employeeId: EMPLOYEE_ID,
    }),
  })

  if (!rotateRes.ok) {
    bad('Secret rotation request failed', `status=${rotateRes.status}`)
    return
  }
  const { bridgeSecret: newSecret, encryptedUpdated } = await rotateRes.json()
  if (!newSecret) { bad('No bridgeSecret in rotate response'); return }
  ok(`Secret rotated (encryptedUpdated=${encryptedUpdated ?? 'N/A'})`)

  // Step B: Send a valid pour using the NEW secret — must be ACK
  // If BRIDGE_MASTER_KEY is not set in the server env, encryptedUpdated will be false.
  // In that case the server can't auto-resolve the new secret (no encrypted field + no GWI_BRIDGE_SECRETS),
  // so the pour will 401.  We treat this as SKIPPED rather than FAILED — it's an env config issue,
  // not a code defect.
  if (!encryptedUpdated) {
    console.log('  ⚠️  SKIPPED pour test — encryptedUpdated=false (BRIDGE_MASTER_KEY not set on server).')
    console.log('     Set BRIDGE_MASTER_KEY in .env and re-rotate to enable encrypted secret storage.')
    console.log('     Alternatively add the new secret to GWI_BRIDGE_SECRETS env var manually.')
    return
  }

  const bodyStr = JSON.stringify(buildDispenseBody(deviceId, 2))
  const headers = { 'Content-Type': 'application/json', ...buildAuthHeaders(deviceId, newSecret, bodyStr) }

  const pourRes = await fetch(`${POS_URL}/api/berg/dispense`, {
    method: 'POST',
    headers,
    body: bodyStr,
  })
  const pourData = await pourRes.json().catch(() => ({}))

  if (pourRes.status === 200 && pourData.action === 'ACK') {
    ok('Pour with new secret → ACK')
  } else {
    bad('Pour with new secret failed', `status=${pourRes.status} action=${pourData.action} err=${pourData.error ?? ''}`)
  }

  // Step C: Confirm old secret no longer works
  const oldBodyStr = JSON.stringify(buildDispenseBody(deviceId, 3))
  const oldHeaders = { 'Content-Type': 'application/json', ...buildAuthHeaders(deviceId, _oldSecret, oldBodyStr) }
  const oldPourRes = await fetch(`${POS_URL}/api/berg/dispense`, {
    method: 'POST',
    headers: oldHeaders,
    body: oldBodyStr,
  })

  if (oldPourRes.status === 401) {
    ok('Pour with OLD secret → 401 (correctly rejected)')
  } else {
    const od = await oldPourRes.json().catch(() => ({}))
    bad('Pour with OLD secret should be 401', `status=${oldPourRes.status} action=${od.action}`)
  }
}

// ──────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════')
  console.log('  Berg Security Fix Verification')
  console.log(`  POS: ${POS_URL}`)
  console.log('═══════════════════════════════════════')

  let deviceId, initialSecret
  try {
    const setup_result = await setup()
    deviceId = setup_result.deviceId
    initialSecret = setup_result.bridgeSecret
    console.log(`\nSetup: device ${deviceId} created with secret`)
  } catch (err) {
    console.log(`\n❌ Setup failed: ${err.message}`)
    process.exit(1)
  }

  try {
    await testBodyTamper(deviceId, initialSecret)
    await testRotateAndPour(deviceId, initialSecret)
  } finally {
    await teardown(deviceId)
    console.log('\nTeardown: test device deactivated')
  }

  console.log('\n═══════════════════════════════════════')
  console.log(`  Results: ${pass} passed, ${fail} failed`)
  console.log('═══════════════════════════════════════\n')
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
