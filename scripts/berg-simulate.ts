#!/usr/bin/env ts-node
export {}
/**
 * Berg Burst Simulator — Throughput & Load Test
 *
 * Simulates Berg ECU packets sent to the berg-bridge HTTP endpoint.
 * Required gate before first client deployment.
 *
 * Usage:
 *   npx ts-node scripts/berg-simulate.ts
 *   npx ts-node scripts/berg-simulate.ts --pours 50 --interval 100
 *   npx ts-node scripts/berg-simulate.ts --pours 100 --interval 50 --inject-bad-lrc 5
 *   npx ts-node scripts/berg-simulate.ts --pours 50 --interval 100 --cpu-mem
 *
 * Options:
 *   --pours N           Number of pours to simulate (default: 20)
 *   --interval N        Milliseconds between pours (default: 200)
 *   --inject-bad-lrc N  Inject N bad LRC packets to test NAK handling (default: 0)
 *   --device-id ID      BergDevice ID to use (default: reads from BERG_TEST_DEVICE_ID env)
 *   --pos-url URL       POS URL (default: http://localhost:3005)
 *   --cpu-mem           Enable CPU/memory profiling output
 *   --help              Show this help
 *
 * Pass criteria:
 *   - All valid pours ACK'd
 *   - Max ACK latency < 3000ms
 *   - No dropped packets (response count = send count)
 *   - Bad LRC packets → NAK
 */

const args = process.argv.slice(2)
function getArg(name: string, defaultVal: string): string {
  const idx = args.indexOf(`--${name}`)
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : defaultVal
}
function hasFlag(name: string): boolean {
  return args.includes(`--${name}`)
}

if (hasFlag('help')) {
  console.log(`
Berg Burst Simulator
Usage: npx ts-node scripts/berg-simulate.ts [options]
  --pours N           Number of pours (default: 20)
  --interval N        ms between pours (default: 200)
  --inject-bad-lrc N  N bad LRC packets to inject (default: 0)
  --device-id ID      BergDevice ID (or set BERG_TEST_DEVICE_ID)
  --pos-url URL       POS URL (default: http://localhost:3005)
  --cpu-mem           CPU/memory profiling
  --help              Show help
`)
  process.exit(0)
}

const POUR_COUNT = parseInt(getArg('pours', '20'), 10)
const INTERVAL_MS = parseInt(getArg('interval', '200'), 10)
const BAD_LRC_COUNT = parseInt(getArg('inject-bad-lrc', '0'), 10)
const DEVICE_ID = getArg('device-id', process.env.BERG_TEST_DEVICE_ID || 'test-device-1')
const POS_URL = getArg('pos-url', process.env.GWI_POS_URL || 'http://localhost:3005')
const CPU_MEM = hasFlag('cpu-mem')

// Sample PLU numbers to cycle through
const SAMPLE_PLUS = [1, 2, 3, 5, 8, 12, 15, 20]

function buildPacket(pluNumber: number, injectBadLrc = false): {
  rawPacket: string
  lrcReceived: string
  lrcCalculated: string
  lrcValid: boolean
  modifierBytes: null
  trailerBytes: null
} {
  const STX = 0x02
  const ETX = 0x03
  const pluStr = String(pluNumber)
  const pluBytes = Array.from(pluStr).map(c => c.charCodeAt(0))
  const data = [STX, ...pluBytes, ETX]
  const xor = data.reduce((a, b) => a ^ b, 0)
  const lrcByte = injectBadLrc ? (xor ^ 0xff) : xor // flip all bits for bad LRC
  const rawPacket = data.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join('')
  const lrcHex = xor.toString(16).toUpperCase().padStart(2, '0')
  const lrcReceivedHex = lrcByte.toString(16).toUpperCase().padStart(2, '0')
  return {
    rawPacket,
    lrcReceived: lrcReceivedHex,
    lrcCalculated: lrcHex,
    lrcValid: !injectBadLrc,
    modifierBytes: null,
    trailerBytes: null,
  }
}

interface SimResult {
  index: number
  pluNumber: number
  isBadLrc: boolean
  action: 'ACK' | 'NAK' | 'ERROR'
  latencyMs: number
  error?: string
}

async function sendPour(index: number, pluNumber: number, isBadLrc: boolean): Promise<SimResult> {
  const packet = buildPacket(pluNumber, isBadLrc)
  const receivedAt = new Date().toISOString()
  const start = Date.now()

  try {
    const res = await fetch(`${POS_URL}/api/berg/dispense`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: DEVICE_ID,
        pluNumber,
        parseStatus: isBadLrc ? 'BAD_LRC' : 'OK',
        receivedAt,
        ...packet,
      }),
      signal: AbortSignal.timeout(5000),
    })
    const latencyMs = Date.now() - start
    const data = await res.json() as { action?: string }
    return { index, pluNumber, isBadLrc, action: (data.action || 'ERROR') as 'ACK' | 'NAK' | 'ERROR', latencyMs }
  } catch (err: unknown) {
    const error = err as { message?: string }
    return { index, pluNumber, isBadLrc, action: 'ERROR', latencyMs: Date.now() - start, error: error?.message }
  }
}

async function main() {
  console.log(`\n╔══════════════════════════════════════════╗`)
  console.log(`║   Berg Burst Simulator                   ║`)
  console.log(`╚══════════════════════════════════════════╝`)
  console.log(`  POS:       ${POS_URL}`)
  console.log(`  Device ID: ${DEVICE_ID}`)
  console.log(`  Pours:     ${POUR_COUNT} (+ ${BAD_LRC_COUNT} bad LRC)`)
  console.log(`  Interval:  ${INTERVAL_MS}ms`)
  console.log(`  CPU/Mem:   ${CPU_MEM ? 'enabled' : 'disabled'}`)
  console.log()

  if (CPU_MEM) {
    const startMem = process.memoryUsage()
    console.log(`  Baseline memory: RSS=${Math.round(startMem.rss / 1024 / 1024)}MB Heap=${Math.round(startMem.heapUsed / 1024 / 1024)}MB`)
  }

  const results: SimResult[] = []
  let badLrcInjected = 0
  const testStart = Date.now()

  for (let i = 0; i < POUR_COUNT; i++) {
    const pluNumber = SAMPLE_PLUS[i % SAMPLE_PLUS.length]
    const injectBad = badLrcInjected < BAD_LRC_COUNT && Math.random() < 0.3
    if (injectBad) badLrcInjected++

    const result = await sendPour(i + 1, pluNumber, injectBad)
    results.push(result)

    const badTag = result.isBadLrc ? ' [BAD_LRC]' : ''
    console.log(`  [${String(i + 1).padStart(3, ' ')}] PLU ${pluNumber}${badTag} → ${result.action} (${result.latencyMs}ms)`)

    if (i < POUR_COUNT - 1 && INTERVAL_MS > 0) {
      await new Promise(r => setTimeout(r, INTERVAL_MS))
    }
  }

  const elapsed = Date.now() - testStart

  // Results summary
  const validPours = results.filter(r => !r.isBadLrc)
  const badLrcPours = results.filter(r => r.isBadLrc)
  const acked = validPours.filter(r => r.action === 'ACK')
  const nacked = validPours.filter(r => r.action === 'NAK')
  const errors = results.filter(r => r.action === 'ERROR')
  const latencies = validPours.filter(r => r.action === 'ACK').map(r => r.latencyMs)
  const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0
  const maxLatency = latencies.length > 0 ? Math.max(...latencies) : 0
  const over3s = latencies.filter(l => l > 3000).length
  const badLrcNaked = badLrcPours.filter(r => r.action === 'NAK').length

  console.log(`\n  ═══ Results ═══════════════════════════`)
  console.log(`  Total sent:     ${results.length}`)
  console.log(`  Valid pours:    ${validPours.length}`)
  console.log(`    ACK'd:        ${acked.length}`)
  console.log(`    NAK'd:        ${nacked.length}`)
  console.log(`  Bad LRC injected: ${badLrcPours.length} → NAK'd: ${badLrcNaked}`)
  console.log(`  Errors:         ${errors.length}`)
  console.log(`  Avg latency:    ${avgLatency}ms`)
  console.log(`  Max latency:    ${maxLatency}ms`)
  console.log(`  Over 3s:        ${over3s}`)
  console.log(`  Total time:     ${elapsed}ms`)

  if (CPU_MEM) {
    const endMem = process.memoryUsage()
    console.log(`\n  Memory: RSS=${Math.round(endMem.rss / 1024 / 1024)}MB Heap=${Math.round(endMem.heapUsed / 1024 / 1024)}MB`)
  }

  // Pass/fail
  const passAck = validPours.length === 0 || acked.length === validPours.length
  const passLatency = maxLatency < 3000 || over3s === 0
  const passBadLrc = badLrcPours.length === 0 || badLrcNaked === badLrcPours.length
  const passErrors = errors.length === 0

  console.log(`\n  ═══ Pass Criteria ══════════════════════`)
  console.log(`  ${passAck ? '✅' : '❌'} All valid pours ACK'd (${acked.length}/${validPours.length})`)
  console.log(`  ${passLatency ? '✅' : '❌'} Max latency < 3s (max: ${maxLatency}ms, over-3s: ${over3s})`)
  console.log(`  ${passBadLrc ? '✅' : '❌'} Bad LRC packets NAK'd (${badLrcNaked}/${badLrcPours.length})`)
  console.log(`  ${passErrors ? '✅' : '❌'} No errors (${errors.length})`)

  const allPass = passAck && passLatency && passBadLrc && passErrors
  console.log(`\n  ${allPass ? '✅ ALL PASS — ready for client deployment' : '❌ FAILED — do not deploy until passing'}\n`)

  process.exit(allPass ? 0 : 1)
}

main().catch(err => {
  console.error('Simulator error:', err)
  process.exit(1)
})
