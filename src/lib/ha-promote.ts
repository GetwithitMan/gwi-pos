/**
 * HA Promotion Handler — MC-Arbitrated Failover (Option B, Phase 2)
 *
 * Handles the PROMOTE fleet command from Mission Control.
 * When MC determines the primary has failed (lease expired, standby healthy,
 * replication lag within threshold), it sends a PROMOTE command to the standby.
 *
 * This module executes the promotion sequence:
 *   1. Verify this NUC is actually a standby (PG in recovery)
 *   2. Fence the old primary (best-effort — it may be unreachable)
 *   3. Promote PostgreSQL (pg_ctl promote)
 *   4. Wait for PG to exit recovery mode
 *   5. Update .env to STATION_ROLE=server
 *   6. Start/restart POS service
 *   7. Wait for POS health check
 *   8. Report result to MC
 *
 * See: docs/planning/ha-option-b-mc-arbitrated-failover.md (Section 3c)
 */

import { execSync } from 'child_process'
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('ha-promote')

const STATE_DIR = '/opt/gwi-pos/state'
const PROMOTION_RESULT_FILE = `${STATE_DIR}/promotion-result.json`

// ── Types ────────────────────────────────────────────────────────────────────

export interface PromotionCommand {
  command: 'PROMOTE'
  oldPrimaryNodeId: string
  oldPrimaryIp: string
  venueSlug: string
  fenceCommandId: string
  issuedAt?: string
  expiresAt?: string
}

export interface PromotionResult {
  success: boolean
  newRole: string
  previousRole: string
  pgPromoted: boolean
  serviceStarted: boolean
  fencedOldPrimary: boolean
  posHealthy: boolean
  durationMs: number
  steps: string[]
  error?: string
}

// ── In-progress guard ────────────────────────────────────────────────────────

let isPromoting = false

export function isPromotionInProgress(): boolean {
  return isPromoting
}

// ── Helper: detect PG version ────────────────────────────────────────────────

function detectPgVersion(): string {
  // Try 17 first (newer installs), fall back to 16
  for (const ver of ['17', '16', '15']) {
    const pgCtl = `/usr/lib/postgresql/${ver}/bin/pg_ctl`
    if (existsSync(pgCtl)) {
      return ver
    }
  }
  // Fallback: try pg_lsclusters to find the running version
  try {
    const output = execSync('pg_lsclusters -h 2>/dev/null || true', { encoding: 'utf8', timeout: 5_000 }).trim()
    if (output) {
      const firstLine = output.split('\n')[0]
      const version = firstLine.split(/\s+/)[0]
      if (version && /^\d+$/.test(version)) return version
    }
  } catch { /* ignore */ }
  return '16' // safe default
}

// ── Helper: get auth headers for fence request ───────────────────────────────

function getFenceAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // Use HA_SHARED_SECRET for inter-NUC communication (same as ha-check.sh)
  const haSecret = process.env.HA_SHARED_SECRET
  if (haSecret) {
    headers['Authorization'] = `Bearer ${haSecret}`
  } else {
    // Fall back to INTERNAL_API_SECRET
    const internalSecret = process.env.INTERNAL_API_SECRET
    if (internalSecret) {
      headers['Authorization'] = `Bearer ${internalSecret}`
    }
  }

  return headers
}

// ── Helper: report to MC ─────────────────────────────────────────────────────

async function reportToMc(
  status: string,
  detail: string,
  command: PromotionCommand,
  result: PromotionResult
): Promise<void> {
  const mcUrl = (process.env.MISSION_CONTROL_URL || process.env.BACKOFFICE_API_URL || '').replace(/\/+$/, '')
  const apiKey = process.env.SERVER_API_KEY || ''
  const nodeId = process.env.SERVER_NODE_ID || ''

  if (!mcUrl || !apiKey || !nodeId) {
    log.warn('Cannot report promotion to MC — missing MISSION_CONTROL_URL, SERVER_API_KEY, or SERVER_NODE_ID')
    return
  }

  const body = {
    event: 'promotion',
    status,
    detail,
    fenceCommandId: command.fenceCommandId,
    venueSlug: command.venueSlug,
    oldPrimaryNodeId: command.oldPrimaryNodeId,
    pgPromoted: result.pgPromoted,
    serviceStarted: result.serviceStarted,
    fencedOldPrimary: result.fencedOldPrimary,
    posHealthy: result.posHealthy,
    durationMs: result.durationMs,
    timestamp: new Date().toISOString(),
  }

  try {
    const res = await fetch(`${mcUrl}/api/fleet/failover-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Server-Node-Id': nodeId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })

    if (res.ok) {
      log.info({ status }, 'Promotion result reported to MC')
    } else {
      const text = await res.text().catch(() => '')
      log.warn({ status, httpStatus: res.status, text: text.slice(0, 200) }, 'MC returned non-200 for promotion report')
    }
  } catch (err) {
    log.error({ err: err instanceof Error ? err.message : err }, 'Failed to report promotion to MC')
  }
}

// ── Helper: write promotion result to state file ─────────────────────────────

function writePromotionResult(result: PromotionResult, command: PromotionCommand): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(PROMOTION_RESULT_FILE, JSON.stringify({
      ...result,
      command: {
        oldPrimaryNodeId: command.oldPrimaryNodeId,
        oldPrimaryIp: command.oldPrimaryIp,
        venueSlug: command.venueSlug,
        fenceCommandId: command.fenceCommandId,
      },
      completedAt: new Date().toISOString(),
    }, null, 2))
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'Failed to write promotion result file')
  }
}

// ── Main promotion handler ───────────────────────────────────────────────────

export async function handlePromotion(command: PromotionCommand): Promise<PromotionResult> {
  const startTime = Date.now()

  const result: PromotionResult = {
    success: false,
    newRole: 'backup',
    previousRole: 'backup',
    pgPromoted: false,
    serviceStarted: false,
    fencedOldPrimary: false,
    posHealthy: false,
    durationMs: 0,
    steps: [],
  }

  if (isPromoting) {
    result.error = 'Promotion already in progress'
    result.durationMs = Date.now() - startTime
    return result
  }

  isPromoting = true

  try {
    log.info({
      oldPrimaryNodeId: command.oldPrimaryNodeId,
      oldPrimaryIp: command.oldPrimaryIp,
      venueSlug: command.venueSlug,
      fenceCommandId: command.fenceCommandId,
    }, '=== MC-ARBITRATED PROMOTION STARTED ===')

    // ── Step 1: Check command expiration ──────────────────────────────────
    if (command.expiresAt) {
      const expiry = new Date(command.expiresAt)
      if (!isNaN(expiry.getTime()) && expiry < new Date()) {
        result.error = `PROMOTE command expired at ${command.expiresAt}`
        result.durationMs = Date.now() - startTime
        log.error({ expiresAt: command.expiresAt }, result.error)
        void reportToMc('PROMOTE_EXPIRED', result.error, command, result).catch(() => {})
        writePromotionResult(result, command)
        return result
      }
    }
    result.steps.push('expiry-check-passed')

    // ── Step 2: Verify this NUC is actually a standby ────────────────────
    let isInRecovery: string
    try {
      isInRecovery = execSync(
        'sudo -u postgres psql -tAc "SELECT pg_is_in_recovery()"',
        { encoding: 'utf8', timeout: 10_000 }
      ).trim()
    } catch (err) {
      result.error = `Cannot query PG recovery state: ${err instanceof Error ? err.message : err}`
      result.durationMs = Date.now() - startTime
      log.error(result.error)
      void reportToMc('PROMOTE_FAILED', result.error, command, result).catch(() => {})
      writePromotionResult(result, command)
      return result
    }

    if (isInRecovery !== 't') {
      result.error = `Cannot promote: PostgreSQL is not in recovery mode (got: ${isInRecovery})`
      result.durationMs = Date.now() - startTime
      log.error(result.error)
      void reportToMc('PROMOTE_FAILED', result.error, command, result).catch(() => {})
      writePromotionResult(result, command)
      return result
    }
    result.steps.push('verified-standby')
    log.info('Step 2: Confirmed this NUC is in standby (PG in recovery)')

    // ── Step 3: Fence the old primary (best-effort) ──────────────────────
    try {
      const fenceBody = JSON.stringify({
        action: 'step_down',
        newPrimary: process.env.SERVER_NODE_ID || 'unknown',
        fenceCommandId: command.fenceCommandId,
        reason: `MC-arbitrated failover: standby promoted for venue ${command.venueSlug}`,
      })

      const fenceResp = await fetch(
        `http://${command.oldPrimaryIp}:3005/api/internal/ha-fence`,
        {
          method: 'POST',
          headers: getFenceAuthHeaders(),
          body: fenceBody,
          signal: AbortSignal.timeout(8_000),
        }
      )
      result.fencedOldPrimary = fenceResp.ok
      if (fenceResp.ok) {
        log.info('Step 3: Old primary acknowledged fence (stepped down)')
      } else {
        log.warn({ httpStatus: fenceResp.status }, 'Step 3: Old primary returned non-200 for fence — proceeding anyway')
      }
    } catch (err) {
      // Old primary unreachable — that's expected if it crashed
      result.fencedOldPrimary = false
      log.info({ err: err instanceof Error ? err.message : err }, 'Step 3: Old primary unreachable for fencing (expected if crashed) — proceeding')
    }
    result.steps.push(result.fencedOldPrimary ? 'fenced-old-primary' : 'fence-skipped-unreachable')

    // ── Step 4: Promote PostgreSQL ───────────────────────────────────────
    const pgVersion = detectPgVersion()
    log.info({ pgVersion }, 'Step 4: Promoting PostgreSQL...')

    try {
      // Try direct pg_ctl promote with detected version
      const pgDataDir = `/var/lib/postgresql/${pgVersion}/main`
      execSync(
        `sudo -u postgres /usr/lib/postgresql/${pgVersion}/bin/pg_ctl promote -D ${pgDataDir}`,
        { encoding: 'utf8', timeout: 30_000 }
      )
    } catch (firstErr) {
      // Fallback: try the other version
      const fallbackVersion = pgVersion === '17' ? '16' : '17'
      log.warn({ pgVersion, fallbackVersion }, 'pg_ctl promote failed with detected version, trying fallback')
      try {
        const pgDataDir = `/var/lib/postgresql/${fallbackVersion}/main`
        execSync(
          `sudo -u postgres /usr/lib/postgresql/${fallbackVersion}/bin/pg_ctl promote -D ${pgDataDir}`,
          { encoding: 'utf8', timeout: 30_000 }
        )
      } catch (secondErr) {
        result.error = `pg_ctl promote failed: ${secondErr instanceof Error ? secondErr.message : secondErr}`
        result.durationMs = Date.now() - startTime
        log.error(result.error)
        void reportToMc('PROMOTE_FAILED', result.error, command, result).catch(() => {})
        writePromotionResult(result, command)
        return result
      }
    }
    result.steps.push('pg-promote-issued')

    // ── Step 5: Wait for PG to exit recovery ─────────────────────────────
    log.info('Step 5: Waiting for PG to exit recovery mode...')
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000))
      try {
        const recovered = execSync(
          'sudo -u postgres psql -tAc "SELECT pg_is_in_recovery()"',
          { encoding: 'utf8', timeout: 5_000 }
        ).trim()
        if (recovered === 'f') {
          result.pgPromoted = true
          log.info({ waitSeconds: i + 1 }, 'PG promoted — no longer in recovery')
          break
        }
      } catch {
        // PG might be briefly unavailable during promotion — keep waiting
      }
    }

    if (!result.pgPromoted) {
      result.error = 'PostgreSQL did not exit recovery mode after 30 seconds'
      result.durationMs = Date.now() - startTime
      log.error(result.error)
      void reportToMc('PROMOTE_FAILED', result.error, command, result).catch(() => {})
      writePromotionResult(result, command)
      return result
    }
    result.steps.push('pg-promoted')

    // ── Step 6: Update .env ──────────────────────────────────────────────
    log.info('Step 6: Updating .env to STATION_ROLE=server...')
    const envFile = '/opt/gwi-pos/.env'
    try {
      if (existsSync(envFile)) {
        let envContent = readFileSync(envFile, 'utf8')
        if (/^STATION_ROLE=.*/m.test(envContent)) {
          envContent = envContent.replace(/^STATION_ROLE=.*/m, 'STATION_ROLE=server')
        } else {
          envContent += '\nSTATION_ROLE=server\n'
        }
        writeFileSync(envFile, envContent)
      }
      // Copy to app directory
      try { execSync(`cp ${envFile} /opt/gwi-pos/app/.env 2>/dev/null`, { timeout: 5_000 }) } catch { /* ok */ }
      try { execSync(`cp ${envFile} /opt/gwi-pos/app/.env.local 2>/dev/null`, { timeout: 5_000 }) } catch { /* ok */ }

      // Update in-memory for the current process
      process.env.STATION_ROLE = 'server'
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, 'Failed to update .env (non-fatal)')
    }
    result.steps.push('env-updated')

    // ── Step 7: Start/restart POS service ────────────────────────────────
    log.info('Step 7: Starting POS service...')
    try {
      execSync('sudo systemctl enable thepasspos 2>/dev/null || true', { timeout: 10_000 })
      execSync('sudo systemctl restart thepasspos 2>/dev/null || true', { timeout: 30_000 })
      result.serviceStarted = true
    } catch (err) {
      // If WE are the POS service, the restart may kill our process.
      // That's expected — systemd will restart us with the new STATION_ROLE.
      log.warn({ err: err instanceof Error ? err.message : err }, 'Service restart returned error (may be expected if we ARE the service)')
      result.serviceStarted = true // assume it will restart
    }
    result.steps.push('service-started')

    // ── Step 8: Start sync workers ───────────────────────────────────────
    log.info('Step 8: Starting sync workers...')
    try {
      execSync('sudo systemctl start thepasspos-sync 2>/dev/null || true', { timeout: 10_000 })
    } catch { /* ok — may not exist */ }
    result.steps.push('sync-started')

    // ── Step 9: Wait for POS health ──────────────────────────────────────
    log.info('Step 9: Waiting for POS health check...')
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const resp = await fetch('http://localhost:3005/api/health', {
          signal: AbortSignal.timeout(3_000),
        })
        if (resp.ok) {
          const data = await resp.json() as { data?: { database?: string } }
          if (data?.data?.database === 'connected') {
            result.posHealthy = true
            log.info({ waitSeconds: (i + 1) * 2 }, 'POS health check passed')
            break
          }
        }
      } catch {
        // Still starting — keep waiting
      }
    }

    if (!result.posHealthy) {
      // PG is promoted but POS app isn't healthy yet — degraded state
      log.warn('POS app not healthy after 60s — reporting PROMOTE_DEGRADED')
      result.steps.push('health-timeout')
      result.newRole = 'server'
      result.success = false
      result.error = 'PG promoted but POS app not healthy after 60s'
      result.durationMs = Date.now() - startTime
      void reportToMc('PROMOTE_DEGRADED', result.error, command, result).catch(() => {})
      writePromotionResult(result, command)
      // Don't return failure — PG is promoted, we ARE the primary now
      return result
    }
    result.steps.push('health-ok')

    // ── Step 10: Gratuitous ARP for VIP takeover ─────────────────────────
    const vip = process.env.VIRTUAL_IP
    if (vip) {
      log.info({ vip }, 'Step 10: Sending gratuitous ARP for VIP takeover...')
      try {
        // Detect the default network interface
        const iface = execSync(
          "ip route get 1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i==\"dev\") print $(i+1); exit}'",
          { encoding: 'utf8', timeout: 5_000 }
        ).trim()
        if (iface) {
          execSync(`arping -U -c 3 -I ${iface} ${vip} 2>/dev/null || true`, { timeout: 10_000 })
        }
      } catch {
        log.warn('Gratuitous ARP failed (non-fatal)')
      }
      result.steps.push('arp-sent')
    }

    // ── Step 11: Boost keepalived priority (if running) ──────────────────
    try {
      const kaConf = '/etc/keepalived/keepalived.conf'
      if (existsSync(kaConf)) {
        execSync(`sudo sed -i 's/priority [0-9]*/priority 110/' ${kaConf} 2>/dev/null || true`, { timeout: 5_000 })
        execSync('sudo systemctl reload keepalived 2>/dev/null || true', { timeout: 10_000 })
        result.steps.push('keepalived-boosted')
      }
    } catch {
      log.warn('keepalived priority boost failed (non-fatal)')
    }

    // ── Success ──────────────────────────────────────────────────────────
    result.success = true
    result.newRole = 'server'
    result.durationMs = Date.now() - startTime
    result.steps.push('complete')

    log.info({
      durationMs: result.durationMs,
      pgPromoted: result.pgPromoted,
      fencedOldPrimary: result.fencedOldPrimary,
      posHealthy: result.posHealthy,
    }, '=== MC-ARBITRATED PROMOTION COMPLETE ===')

    // Report success to MC
    void reportToMc('PROMOTE_COMPLETE', 'Promotion successful', command, result).catch(() => {})
    writePromotionResult(result, command)

    return result
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err)
    result.durationMs = Date.now() - startTime
    log.error({ err: result.error, steps: result.steps }, 'Promotion failed with unexpected error')
    void reportToMc('PROMOTE_FAILED', result.error, command, result).catch(() => {})
    writePromotionResult(result, command)
    return result
  } finally {
    isPromoting = false
  }
}

/**
 * Get the last promotion result from the state file.
 * Used by health/heartbeat to include promotion status.
 */
export function getLastPromotionResult(): (PromotionResult & { completedAt?: string }) | null {
  try {
    if (existsSync(PROMOTION_RESULT_FILE)) {
      return JSON.parse(readFileSync(PROMOTION_RESULT_FILE, 'utf8'))
    }
  } catch { /* ignore */ }
  return null
}
