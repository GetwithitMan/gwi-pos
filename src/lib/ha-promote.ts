/**
 * HA Promotion Handler (MC-Arbitrated Failover — Phase 2 NUC-side)
 *
 * Executes the 11-step promotion sequence when MC commands this standby
 * NUC to become the new primary. Only runs on NUCs (never Vercel).
 *
 * Steps:
 *   1. Verify this NUC is actually in PG recovery (standby)
 *   2. Fence the old primary via HTTP
 *   3. pg_ctl promote
 *   4. Wait for PG to exit recovery
 *   5. Update .env (STATION_ROLE=server)
 *   6. Restart POS service
 *   7. Wait for POS health check
 *   8. Start sync workers
 *   9. Report PROMOTE_COMPLETE to MC
 *  10. Gratuitous ARP for VIP takeover
 *  11. Write result to disk
 *
 * Concurrency guard: only one promotion can run at a time.
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('ha-promote')

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PromoteCommand {
  command: 'PROMOTE'
  oldPrimaryNodeId: string
  oldPrimaryIp: string
  venueSlug: string
  fenceCommandId: string
  issuedAt: string
  expiresAt: string
}

export interface PromotionResult {
  status: 'PROMOTE_COMPLETE' | 'PROMOTE_FAILED' | 'PROMOTE_DEGRADED'
  detail: string
  startedAt: string
  completedAt: string
  fenceCommandId: string
  venueSlug: string
  steps: StepResult[]
}

interface StepResult {
  step: number
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail?: string
  durationMs: number
}

// ── State ─────────────────────────────────────────────────────────────────────

const APP_BASE = process.env.APP_BASE || '/opt/gwi-pos'
const STATE_DIR = join(APP_BASE, 'state')
const RESULT_FILE = join(STATE_DIR, 'promotion-result.json')

let _promotionInProgress = false
let _lastResult: PromotionResult | null = null

// Load last result from disk on module init
try {
  if (existsSync(RESULT_FILE)) {
    _lastResult = JSON.parse(readFileSync(RESULT_FILE, 'utf8'))
  }
} catch {
  // Ignore — file may be corrupted or missing
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Whether a promotion is currently executing.
 */
export function isPromotionInProgress(): boolean {
  return _promotionInProgress
}

/**
 * Get the result of the last promotion attempt (from memory or disk).
 */
export function getLastPromotionResult(): PromotionResult | null {
  return _lastResult
}

/**
 * Execute the full promotion sequence.
 * Throws if a promotion is already in progress.
 */
export async function handlePromotion(command: PromoteCommand): Promise<PromotionResult> {
  if (_promotionInProgress) {
    throw new Error('Promotion already in progress')
  }

  // Check command expiration
  if (command.expiresAt && new Date(command.expiresAt) < new Date()) {
    const expired: PromotionResult = {
      status: 'PROMOTE_FAILED',
      detail: 'PROMOTE command expired before execution',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      fenceCommandId: command.fenceCommandId,
      venueSlug: command.venueSlug,
      steps: [],
    }
    writeResult(expired)
    void reportToMc(expired).catch(logReportError)
    return expired
  }

  _promotionInProgress = true
  const startedAt = new Date().toISOString()
  const steps: StepResult[] = []
  let overallStatus: PromotionResult['status'] = 'PROMOTE_COMPLETE'
  let overallDetail = 'Promotion successful'

  try {
    // ── Step 1: Verify this NUC is actually a standby ──────────────────────
    const step1 = await runStep(1, 'Verify standby (pg_is_in_recovery)', async () => {
      const inRecovery = execPg("SELECT pg_is_in_recovery()")
      if (inRecovery.trim() !== 't') {
        throw new Error(`Not in recovery mode (pg_is_in_recovery=${inRecovery.trim()}) — refusing promotion`)
      }
    })
    steps.push(step1)
    if (step1.status === 'fail') {
      overallStatus = 'PROMOTE_FAILED'
      overallDetail = step1.detail || 'Not a standby'
      return buildResult(overallStatus, overallDetail, startedAt, command, steps)
    }

    // ── Step 2: Fence the old primary ─────────────────────────────────────
    const step2 = await runStep(2, 'Fence old primary', async () => {
      const myIp = getMyIp()
      const fenceBody = JSON.stringify({
        action: 'step_down',
        newPrimary: myIp,
        fenceCommandId: command.fenceCommandId,
      })

      try {
        const resp = await fetch(`http://${command.oldPrimaryIp}:3005/api/internal/ha-fence`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.HA_SHARED_SECRET || process.env.INTERNAL_API_SECRET || ''}`,
          },
          body: fenceBody,
          signal: AbortSignal.timeout(5000),
        })

        if (resp.ok) {
          return 'Old primary acknowledged fence (stepped down)'
        }
        return `Old primary returned HTTP ${resp.status} — proceeding anyway`
      } catch {
        return 'Old primary unreachable (expected if crashed) — proceeding'
      }
    })
    steps.push(step2)
    // Fence failure is non-fatal (old primary may be crashed)

    // ── Step 3: pg_ctl promote ────────────────────────────────────────────
    const step3 = await runStep(3, 'pg_ctl promote', async () => {
      const pgVersion = detectPgVersion()
      if (!pgVersion) {
        throw new Error('Could not detect PostgreSQL version (tried 17, 16, 15)')
      }
      const dataDir = `/var/lib/postgresql/${pgVersion}/main`
      try {
        execSync(`sudo -u postgres pg_ctl promote -D ${dataDir}`, {
          timeout: 15000,
          stdio: 'pipe',
        })
        return `Promoted PG ${pgVersion} at ${dataDir}`
      } catch (e) {
        throw new Error(`pg_ctl promote failed for PG ${pgVersion}: ${e instanceof Error ? e.message : String(e)}`)
      }
    })
    steps.push(step3)
    if (step3.status === 'fail') {
      overallStatus = 'PROMOTE_FAILED'
      overallDetail = step3.detail || 'pg_ctl promote failed'
      return buildResult(overallStatus, overallDetail, startedAt, command, steps)
    }

    // ── Step 4: Wait for PG to exit recovery ──────────────────────────────
    const step4 = await runStep(4, 'Wait for PG to exit recovery', async () => {
      const maxWaitSec = 30
      for (let waited = 0; waited < maxWaitSec; waited++) {
        try {
          const stillRecovery = execPg("SELECT pg_is_in_recovery()")
          if (stillRecovery.trim() === 'f') {
            return `PG promoted — no longer in recovery after ${waited}s`
          }
        } catch {
          // PG may be briefly unavailable during promotion
        }
        await sleep(1000)
      }
      throw new Error(`PG still in recovery after ${maxWaitSec}s`)
    })
    steps.push(step4)
    if (step4.status === 'fail') {
      overallStatus = 'PROMOTE_FAILED'
      overallDetail = step4.detail || 'PG failed to exit recovery'
      return buildResult(overallStatus, overallDetail, startedAt, command, steps)
    }

    // ── Step 5: Update .env ───────────────────────────────────────────────
    const step5 = await runStep(5, 'Update .env (STATION_ROLE=server)', async () => {
      const envPath = join(APP_BASE, '.env')
      if (!existsSync(envPath)) {
        throw new Error(`.env not found at ${envPath}`)
      }

      let envContent = readFileSync(envPath, 'utf8')

      // Update STATION_ROLE
      if (/^STATION_ROLE=.*/m.test(envContent)) {
        envContent = envContent.replace(/^STATION_ROLE=.*/m, 'STATION_ROLE=server')
      } else {
        envContent += '\nSTATION_ROLE=server\n'
      }

      // Update PRIMARY_NUC_IP to point at ourselves
      const myIp = getMyIp()
      if (/^PRIMARY_NUC_IP=.*/m.test(envContent)) {
        envContent = envContent.replace(/^PRIMARY_NUC_IP=.*/m, `PRIMARY_NUC_IP=${myIp}`)
      }

      writeFileSync(envPath, envContent)

      // Copy to app directory symlinks / copies
      const appEnv = join(APP_BASE, 'app', '.env')
      const appEnvLocal = join(APP_BASE, 'app', '.env.local')
      try { writeFileSync(appEnv, envContent) } catch { /* may not exist */ }
      try { writeFileSync(appEnvLocal, envContent) } catch { /* may not exist */ }

      // Also update in-memory process.env
      process.env.STATION_ROLE = 'server'

      return 'STATION_ROLE=server written to disk and in-memory'
    })
    steps.push(step5)
    if (step5.status === 'fail') {
      // .env failure is critical but PG is already promoted — degraded
      overallStatus = 'PROMOTE_DEGRADED'
      overallDetail = step5.detail || '.env update failed'
    }

    // ── Step 6: Restart POS service ───────────────────────────────────────
    const step6 = await runStep(6, 'Restart POS service', async () => {
      try {
        execSync('systemctl enable thepasspos', { timeout: 10000, stdio: 'pipe' })
        execSync('systemctl restart thepasspos', { timeout: 10000, stdio: 'pipe' })
        return 'POS service restarted'
      } catch (e) {
        // Non-fatal — service may already be running in dev mode
        return `systemctl restart returned error (may be dev mode): ${e instanceof Error ? e.message : String(e)}`
      }
    })
    steps.push(step6)

    // ── Step 7: Health check ──────────────────────────────────────────────
    const step7 = await runStep(7, 'Wait for POS health check', async () => {
      const maxWaitSec = 60
      for (let waited = 0; waited < maxWaitSec; waited += 2) {
        try {
          const resp = await fetch('http://localhost:3005/api/health', {
            signal: AbortSignal.timeout(3000),
          })
          if (resp.ok) {
            return `POS healthy after ${waited}s`
          }
        } catch {
          // Not yet ready
        }
        await sleep(2000)
      }
      throw new Error(`POS app not healthy after ${maxWaitSec}s`)
    })
    steps.push(step7)
    if (step7.status === 'fail') {
      // POS not healthy but PG is promoted — degraded
      if (overallStatus === 'PROMOTE_COMPLETE') {
        overallStatus = 'PROMOTE_DEGRADED'
        overallDetail = step7.detail || 'POS app not healthy'
      }
    }

    // ── Step 8: Start sync workers ────────────────────────────────────────
    const step8 = await runStep(8, 'Start sync workers', async () => {
      try {
        execSync('systemctl start thepasspos-sync', { timeout: 10000, stdio: 'pipe' })
        return 'Sync workers started'
      } catch {
        return 'Sync workers not available as systemd unit (may be in-process)'
      }
    })
    steps.push(step8)

    // ── Step 9: Report to MC ──────────────────────────────────────────────
    const step9 = await runStep(9, 'Report to MC', async () => {
      const result = buildResult(overallStatus, overallDetail, startedAt, command, steps)
      await reportToMc(result)
      return 'Reported to MC'
    })
    steps.push(step9)

    // ── Step 10: Gratuitous ARP ───────────────────────────────────────────
    const step10 = await runStep(10, 'Gratuitous ARP for VIP', async () => {
      const vip = getEnvValue('VIRTUAL_IP')
      if (!vip) {
        return 'No VIRTUAL_IP configured — skipping ARP'
      }
      try {
        const iface = execSync(
          "ip route get 1 | awk '{for(i=1;i<=NF;i++) if($i==\"dev\") print $(i+1); exit}'",
          { timeout: 5000, encoding: 'utf8' }
        ).trim()
        if (iface) {
          execSync(`arping -U -c 3 -I ${iface} ${vip}`, { timeout: 10000, stdio: 'pipe' })
          return `Gratuitous ARP sent on ${iface} for VIP ${vip}`
        }
        return 'Could not detect network interface — skipping ARP'
      } catch {
        return 'arping failed (non-fatal)'
      }
    })
    steps.push(step10)

    // ── Step 11: Write result to disk ─────────────────────────────────────
    const finalResult = buildResult(overallStatus, overallDetail, startedAt, command, steps)
    const step11 = await runStep(11, 'Write result to disk', async () => {
      writeResult(finalResult)
      return `Result written to ${RESULT_FILE}`
    })
    steps.push(step11)

    // Rebuild final result to include step 11
    const completeResult = buildResult(overallStatus, overallDetail, startedAt, command, steps)
    writeResult(completeResult)
    return completeResult
  } catch (e) {
    const errorResult: PromotionResult = {
      status: 'PROMOTE_FAILED',
      detail: `Unhandled error: ${e instanceof Error ? e.message : String(e)}`,
      startedAt,
      completedAt: new Date().toISOString(),
      fenceCommandId: command.fenceCommandId,
      venueSlug: command.venueSlug,
      steps,
    }
    writeResult(errorResult)
    void reportToMc(errorResult).catch(logReportError)
    return errorResult
  } finally {
    _promotionInProgress = false
  }
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Detect the installed PostgreSQL version (tries 17, 16, 15 in order).
 */
export function detectPgVersion(): string | null {
  for (const ver of ['17', '16', '15']) {
    const dataDir = `/var/lib/postgresql/${ver}/main`
    if (existsSync(dataDir)) {
      return ver
    }
  }
  return null
}

/**
 * Read PRIMARY_NUC_IP from the .env file on disk.
 */
export function getPrimaryIp(): string | null {
  return getEnvValue('PRIMARY_NUC_IP')
}

function getEnvValue(key: string): string | null {
  // Check process.env first
  if (process.env[key]) return process.env[key] as string

  // Fall back to reading .env from disk
  const envPath = join(APP_BASE, '.env')
  try {
    if (!existsSync(envPath)) return null
    const content = readFileSync(envPath, 'utf8')
    const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'))
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

function getMyIp(): string {
  try {
    return execSync("hostname -I | awk '{print $1}'", {
      timeout: 5000,
      encoding: 'utf8',
    }).trim()
  } catch {
    return '0.0.0.0'
  }
}

function execPg(sql: string): string {
  return execSync(`sudo -u postgres psql -tAc "${sql}"`, {
    timeout: 10000,
    encoding: 'utf8',
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildResult(
  status: PromotionResult['status'],
  detail: string,
  startedAt: string,
  command: PromoteCommand,
  steps: StepResult[]
): PromotionResult {
  const result: PromotionResult = {
    status,
    detail,
    startedAt,
    completedAt: new Date().toISOString(),
    fenceCommandId: command.fenceCommandId,
    venueSlug: command.venueSlug,
    steps,
  }
  _lastResult = result
  return result
}

function writeResult(result: PromotionResult): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2))
    _lastResult = result
  } catch (e) {
    log.error({ err: e }, 'Failed to write promotion result to disk')
  }
}

async function reportToMc(result: PromotionResult): Promise<void> {
  const mcUrl = (
    process.env.MISSION_CONTROL_URL ||
    process.env.BACKOFFICE_API_URL ||
    ''
  ).replace(/\/+$/, '')

  const apiKey = process.env.SERVER_API_KEY || ''
  const nodeId = process.env.SERVER_NODE_ID || ''

  if (!mcUrl || !apiKey) {
    log.warn('Cannot report to MC — missing MISSION_CONTROL_URL or SERVER_API_KEY')
    return
  }

  const body = {
    event: 'promotion',
    status: result.status,
    detail: result.detail,
    fenceCommandId: result.fenceCommandId,
    venueSlug: result.venueSlug,
    timestamp: result.completedAt,
    steps: result.steps,
  }

  // Try both endpoints: failover-event (primary) and promotion-result (fallback)
  for (const endpoint of ['/api/fleet/failover-event', '/api/fleet/promotion-result']) {
    try {
      const resp = await fetch(`${mcUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Server-Node-Id': nodeId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      })

      if (resp.ok) {
        log.info({ endpoint, status: result.status }, 'Reported promotion to MC')
        return
      }
      log.warn({ endpoint, httpStatus: resp.status }, 'MC report non-OK — trying fallback')
    } catch (e) {
      log.warn({ endpoint, err: e }, 'MC report failed — trying fallback')
    }
  }

  log.error('All MC report endpoints failed')
}

async function runStep(
  step: number,
  name: string,
  fn: () => Promise<string | void>
): Promise<StepResult> {
  const start = Date.now()
  try {
    const detail = await fn()
    log.info({ step, name, durationMs: Date.now() - start }, detail || 'OK')
    return {
      step,
      name,
      status: 'ok',
      detail: detail || undefined,
      durationMs: Date.now() - start,
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    log.error({ step, name, durationMs: Date.now() - start }, detail)
    return {
      step,
      name,
      status: 'fail',
      detail,
      durationMs: Date.now() - start,
    }
  }
}

function logReportError(e: unknown): void {
  log.error({ err: e }, 'Failed to report promotion result to MC')
}
