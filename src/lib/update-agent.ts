/**
 * NUC Update Agent — Safe Version-Targeted Updates
 *
 * Checks MC heartbeat for targetVersion, compares to current,
 * runs preflight checks, executes update, reports back.
 *
 * Does NOT pull "latest" blindly. Only updates to the exact
 * version MC has approved for this venue's release channel.
 */

import { createHmac } from 'crypto'
import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync, readdirSync } from 'fs'
import path from 'path'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('update-agent')

const APP_DIR = process.env.APP_DIR || '/opt/gwi-pos/current'
const UPDATE_LOCK_FILE = path.join(APP_DIR, '..', '.update-lock')

interface ComponentUpdateResult {
  dashboard?: { from: string; to: string; updated: boolean }
  monitoring?: { updated: boolean }
  syncAgent?: { updated: boolean }
  watchdog?: { active: boolean }
}

interface PreflightResult {
  passed: boolean
  checks: Array<{ name: string; passed: boolean; detail?: string }>
}

interface UpdateResult {
  success: boolean
  previousVersion: string
  targetVersion: string
  preflightResult: PreflightResult
  error?: string
  durationMs: number
}

interface UpdateState {
  attemptId: string
  commandId?: string
  attemptedAt: string
  targetVersion: string
  previousVersion: string
  gitShaBefore: string
  gitShaAfter?: string
  schemaVersionBefore?: string
  schemaVersionAfter?: string
  status: string
  backupStatus: string
  backupPath?: string
  backupChecksum?: string
  pendingSyncCounts?: Record<string, number>
  rollbackAttempted: boolean
  rollbackSucceeded?: boolean
  manualInterventionRequired: boolean
  proceededWithoutBackup: boolean
  duration: number
  steps: string[]
  error?: string
  componentUpdates?: ComponentUpdateResult
}

const UPDATE_STATE_FILE = '/opt/gwi-pos/state/last-update.json'

function writeUpdateState(state: UpdateState): void {
  try {
    execSync('mkdir -p /opt/gwi-pos/state', { timeout: 5_000 })
    writeFileSync(UPDATE_STATE_FILE, JSON.stringify(state, null, 2))
  } catch {}
}

let isUpdating = false

/**
 * Tracks whether the update-agent intentionally stopped the POS service.
 * While true, external health monitors (watchdog, heartbeat) should treat
 * "service down" as expected rather than triggering restart/escalation.
 */
let serviceWasStopped = false

/**
 * Set to true only after a post-update health check confirms the service
 * is fully ready (DB connected + readiness != FAILED). Prevents premature
 * health reporting to MC before the service has finished booting.
 */
const readinessVerified = false

export function isServiceIntentionallyStopped(): boolean {
  return serviceWasStopped
}

export function isReadinessVerified(): boolean {
  return readinessVerified
}

/**
 * Get the current running app version.
 * Priority: running-version.json > /opt/gwi-pos/current/package.json > legacy APP_DIR
 */
export function getCurrentVersion(): string {
  // Single source of truth: running-version.json (written by deploy-release.sh)
  try {
    const rvPath = '/opt/gwi-pos/shared/state/running-version.json'
    if (existsSync(rvPath)) {
      const rv = JSON.parse(readFileSync(rvPath, 'utf8'))
      if (rv.version) return rv.version
    }
  } catch {}
  // Fallback: current symlink
  try {
    const currentPkg = '/opt/gwi-pos/current/package.json'
    if (existsSync(currentPkg)) {
      const pkg = JSON.parse(readFileSync(currentPkg, 'utf8'))
      if (pkg.version) return pkg.version
    }
  } catch {}
  // Legacy fallback
  try {
    const pkgPath = path.join(APP_DIR, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      return pkg.version || 'unknown'
    }
  } catch {}
  return 'unknown'
}

/**
 * Run preflight checks before attempting an update.
 * All checks must pass before proceeding.
 */
export async function runPreflightChecks(): Promise<PreflightResult> {
  const checks: PreflightResult['checks'] = []

  // 1. Disk space — need at least 500MB free
  try {
    const df = execSync("df -BM /opt/gwi-pos | tail -1 | awk '{print $4}'", { encoding: 'utf8' }).trim()
    const freeMB = parseInt(df.replace('M', ''), 10)
    checks.push({
      name: 'disk_space',
      passed: freeMB >= 500,
      detail: `${freeMB}MB free`,
    })
  } catch {
    checks.push({ name: 'disk_space', passed: true, detail: 'check skipped (non-linux)' })
  }

  // 1b. Disk pressure state (from watchdog)
  const diskPressurePath = '/opt/gwi-pos/state/disk-pressure.json'
  if (existsSync(diskPressurePath)) {
    try {
      const diskState = JSON.parse(readFileSync(diskPressurePath, 'utf8')) as {
        alert?: boolean
        usagePercent?: number
        freeGb?: number
      }
      if (diskState.alert) {
        log.warn(`[UpdateAgent] WARNING: Disk pressure alert — ${diskState.usagePercent}% used, ${diskState.freeGb}GB free`)
        if (diskState.freeGb !== undefined && diskState.freeGb < 4) {
          checks.push({
            name: 'disk_pressure',
            passed: false,
            detail: `Insufficient disk space: ${diskState.freeGb}GB free (need >= 4GB)`,
          })
        } else {
          checks.push({
            name: 'disk_pressure',
            passed: true,
            detail: `Disk pressure alert active but sufficient space: ${diskState.freeGb}GB free`,
          })
        }
      } else {
        checks.push({ name: 'disk_pressure', passed: true })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Insufficient disk')) {
        checks.push({ name: 'disk_pressure', passed: false, detail: msg })
      } else {
        // Ignore parse errors — disk pressure file may be corrupt
        checks.push({ name: 'disk_pressure', passed: true, detail: 'check skipped (parse error)' })
      }
    }
  }

  // 2. Local PG reachable
  try {
    const { masterClient } = await import('./db')
    await masterClient.$queryRawUnsafe('SELECT 1')
    checks.push({ name: 'local_pg', passed: true })
  } catch (err) {
    checks.push({ name: 'local_pg', passed: false, detail: err instanceof Error ? err.message : String(err) })
  }

  // 3. No active payment in progress (check for locked orders)
  try {
    const { masterClient } = await import('./db')
    const activePayments = await masterClient.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count FROM "Order" WHERE status = 'paying' AND "deletedAt" IS NULL`
    )
    const count = Number(activePayments[0]?.count || 0)
    checks.push({
      name: 'no_active_payments',
      passed: count === 0,
      detail: count > 0 ? `${count} orders in paying state` : undefined,
    })
  } catch {
    checks.push({ name: 'no_active_payments', passed: true, detail: 'check skipped' })
  }

  // 4. Git is available and repo is clean-ish
  try {
    execSync('git status --porcelain', { cwd: APP_DIR, encoding: 'utf8' })
    checks.push({ name: 'git_available', passed: true })
  } catch {
    checks.push({ name: 'git_available', passed: false, detail: 'git not available or repo corrupt' })
  }

  // 5. Stale lock detection: if lock file is older than 30 minutes, it's from a crashed update
  if (existsSync(UPDATE_LOCK_FILE)) {
    try {
      const lockStat = statSync(UPDATE_LOCK_FILE)
      const lockAgeMs = Date.now() - lockStat.mtimeMs
      if (lockAgeMs > 30 * 60 * 1000) {
        log.warn(`[UpdateAgent] Stale lock file detected (${Math.round(lockAgeMs / 60000)}m old) — removing`)
        unlinkSync(UPDATE_LOCK_FILE)
      }
    } catch {}
  }

  // 6. Not already updating
  checks.push({
    name: 'not_already_updating',
    passed: !isUpdating && !existsSync(UPDATE_LOCK_FILE),
    detail: isUpdating ? 'update in progress' : existsSync(UPDATE_LOCK_FILE) ? 'lock file exists' : undefined,
  })

  return {
    passed: checks.every(c => c.passed),
    checks,
  }
}

/**
 * Execute a version-targeted update.
 * Called when heartbeat returns a targetVersion different from current.
 */
/** Validate targetVersion is a safe semver-like string (no shell metacharacters) */
export function isValidVersion(version: string): boolean {
  // Allow: 1.0.50, 1.0.50-beta.1, 1.0.50-rc1+build123
  return /^[a-zA-Z0-9][a-zA-Z0-9._\-+]*$/.test(version) && version.length <= 64
}

// ── Version compatibility check ────────────────────────────────────────────

/**
 * Get the latest schema migration number from the migrations directory.
 * Returns a 3-digit string (e.g. "093") or "000" if none found.
 */
function getCurrentSchemaVersion(): string {
  try {
    const migrationsDir = path.join(process.cwd(), 'scripts/migrations')
    if (existsSync(migrationsDir)) {
      const files = readdirSync(migrationsDir).filter(f => /^\d{3}-/.test(f)).sort()
      return files.length > 0 ? (files[files.length - 1].match(/^(\d{3})/)?.[1] || '000') : '000'
    }
    return '000'
  } catch { return '000' }
}

/**
 * Version compatibility check — advisory only, NEVER blocks updates.
 * If schema is behind, triggers schema update (prisma db push + migrations).
 * A failed update can be rolled back; a blocked update leaves the venue stuck.
 */
async function checkVersionCompatibility(currentVersion: string, targetVersion: string): Promise<void> {
  const currentSchema = getCurrentSchemaVersion()
  log.info(`[UpdateAgent] Version check: app ${currentVersion} → ${targetVersion}, schema ${currentSchema}`)

  // The compat script only works with numeric schema versions
  // App versions (semver like 1.2.15) are NOT schema versions (numeric like 096)
  // This check is advisory — if it fails or can't run, we proceed anyway
  const versionCompat = '/opt/gwi-pos/scripts/version-compat.sh'
  if (existsSync(versionCompat) && /^\d+$/.test(currentSchema)) {
    try {
      execSync(`bash ${versionCompat} "${currentSchema}" "${currentSchema}" "${currentVersion}" "${targetVersion}"`, {
        encoding: 'utf8',
        timeout: 10_000,
      })
      log.info('[UpdateAgent] Version compatibility check passed')
    } catch (err: unknown) {
      const errObj = err as { stdout?: string; message?: string }
      log.warn(`[UpdateAgent] Version compat advisory: ${(errObj.stdout || errObj.message || '').slice(0, 200)}`)
      // Proceed anyway — don't block the update
    }
  }

  // Ensure local schema is up to date (prisma db push + migrations)
  // This runs BEFORE the git pull so the current code's schema is applied.
  // After git pull, pre-start.sh will run again with the NEW schema.
  try {
    log.info('[UpdateAgent] Ensuring local schema is current...')
    execSync(`cd "${APP_DIR}" && npx prisma db push --accept-data-loss=false 2>&1 | tail -3`, {
      encoding: 'utf8',
      timeout: 120_000,
    })
    if (existsSync(path.join(APP_DIR, 'scripts/nuc-pre-migrate.js'))) {
      execSync(`cd "${APP_DIR}" && node scripts/nuc-pre-migrate.js 2>&1 | tail -5`, {
        encoding: 'utf8',
        timeout: 300_000,
      })
    }
    log.info('[UpdateAgent] Local schema verified/updated')
  } catch (schemaErr: unknown) {
    const errObj = schemaErr as { message?: string }
    log.warn(`[UpdateAgent] Pre-update schema sync warning: ${(errObj.message || '').slice(0, 200)}`)
    // Non-fatal — proceed with update, post-restart pre-start.sh will retry
  }
}

// ── Rolling restart ────────────────────────────────────────────────────────

/**
 * Perform a rolling restart using the rolling-restart.sh script.
 * Returns true if rolling restart succeeded, false if script not found or failed
 * (caller should fall back to standard restart).
 */
async function performRollingRestart(targetVersion: string): Promise<boolean> {
  const rollingScript = '/opt/gwi-pos/scripts/rolling-restart.sh'
  if (!existsSync(rollingScript)) {
    log.info('[UpdateAgent] Rolling restart script not found, falling back to standard restart')
    return false
  }

  try {
    execSync(`bash ${rollingScript} "${targetVersion}"`, {
      encoding: 'utf8',
      timeout: 600_000, // 10 min for build + restart
      stdio: 'pipe',
    })
    log.info('[UpdateAgent] Rolling restart completed successfully')
    return true
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error(`[UpdateAgent] Rolling restart failed: ${msg}`)
    return false
  }
}

// ── gwi-node deploy (single deploy engine) ───────────────────────────────

async function performDeploy(targetVersion: string, commandId?: string): Promise<UpdateResult> {
  const GWI_NODE = '/opt/gwi-pos/gwi-node.sh'
  const startTime = Date.now()
  const previousVersion = getCurrentVersion()

  if (!existsSync(GWI_NODE)) {
    log.error('[UpdateAgent] gwi-node.sh not found')
    return { success: false, previousVersion, targetVersion, preflightResult: { passed: false, checks: [] }, durationMs: 0, error: 'gwi-node.sh not found' }
  }

  log.info(`[UpdateAgent] Deploy via gwi-node: ${previousVersion} → ${targetVersion}`)

  try {
    execSync(`bash "${GWI_NODE}" deploy`, {
      encoding: 'utf8',
      timeout: 600_000,
      stdio: 'pipe',
    })

    log.info('[UpdateAgent] gwi-node deploy completed')
    return {
      success: true,
      previousVersion,
      targetVersion,
      preflightResult: { passed: true, checks: [] },
      durationMs: Date.now() - startTime,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error(`[UpdateAgent] gwi-node deploy failed: ${msg.slice(0, 500)}`)
    return {
      success: false,
      previousVersion,
      targetVersion,
      preflightResult: { passed: true, checks: [] },
      durationMs: Date.now() - startTime,
      error: msg,
    }
  }
}

// ── Rollback reporting ─────────────────────────────────────────────────────

interface RollbackReport {
  attempted: boolean
  succeeded: boolean
  method: 'code_only' | 'full' | 'none'
  reason: string
  codeRestored: boolean
  dbRestored: boolean
  manualInterventionRequired: boolean
  diagnosticsPath?: string
}

const ROLLBACK_REPORT_FILE = '/opt/gwi-pos/state/last-rollback.json'

/**
 * Capture diagnostics before a rollback so operators can debug later.
 * Returns the path to the diagnostics directory, or undefined on failure.
 */
function captureDiagnostics(reason: string): string | undefined {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const diagDir = `/opt/gwi-pos/state/diagnostics/${timestamp}`
    execSync(`mkdir -p "${diagDir}"`, { timeout: 5_000 })

    // Capture journal logs (last 200 lines)
    try {
      const journal = execSync('journalctl -u thepasspos --no-pager -n 200 2>/dev/null || true', { encoding: 'utf8', timeout: 10_000 })
      writeFileSync(path.join(diagDir, 'journal.log'), journal)
    } catch {}

    // Capture PM2 logs (if available)
    try {
      const pm2Log = execSync('tail -200 /opt/gwi-pos/logs/pm2-out.log 2>/dev/null || true', { encoding: 'utf8', timeout: 5_000 })
      writeFileSync(path.join(diagDir, 'pm2-out.log'), pm2Log)
    } catch {}

    // Capture git state
    try {
      const gitLog = execSync(`git log --oneline -5`, { cwd: APP_DIR, encoding: 'utf8', timeout: 5_000 })
      const gitStatus = execSync(`git status --short`, { cwd: APP_DIR, encoding: 'utf8', timeout: 5_000 })
      writeFileSync(path.join(diagDir, 'git-state.txt'), `=== git log ===\n${gitLog}\n=== git status ===\n${gitStatus}`)
    } catch {}

    // Capture disk usage
    try {
      const df = execSync('df -h /opt/gwi-pos 2>/dev/null || true', { encoding: 'utf8', timeout: 5_000 })
      writeFileSync(path.join(diagDir, 'disk-usage.txt'), df)
    } catch {}

    // Capture reason
    writeFileSync(path.join(diagDir, 'reason.txt'), reason)

    log.info(`[UpdateAgent] Diagnostics captured at ${diagDir}`)
    return diagDir
  } catch (err) {
    log.warn('[UpdateAgent] Failed to capture diagnostics:', err instanceof Error ? err.message : err)
    return undefined
  }
}

/**
 * Write a structured rollback report to /opt/gwi-pos/state/last-rollback.json
 */
function writeRollbackReport(report: RollbackReport): void {
  try {
    execSync('mkdir -p /opt/gwi-pos/state', { timeout: 5_000 })
    writeFileSync(ROLLBACK_REPORT_FILE, JSON.stringify({ ...report, timestamp: new Date().toISOString() }, null, 2))
    log.info(`[UpdateAgent] Rollback report written to ${ROLLBACK_REPORT_FILE}`)
  } catch (err) {
    log.warn('[UpdateAgent] Failed to write rollback report:', err instanceof Error ? err.message : err)
  }
}

export async function executeUpdate(targetVersion: string, options?: { rollingRestart?: boolean; commandId?: string }): Promise<UpdateResult> {
  const startTime = Date.now()
  const previousVersion = getCurrentVersion()

  // Defense-in-depth: reject shell metacharacters in targetVersion
  // even though the API endpoint requires auth. Prevents command injection
  // via execSync interpolation (git rev-parse, git reset --hard).
  if (!isValidVersion(targetVersion)) {
    return {
      success: false,
      previousVersion,
      targetVersion,
      preflightResult: { passed: false, checks: [{ name: 'version_format', passed: false, detail: 'Invalid version string' }] },
      error: `Invalid targetVersion format: "${targetVersion.slice(0, 32)}"`,
      durationMs: 0,
    }
  }

  if (isUpdating) {
    return {
      success: false,
      previousVersion,
      targetVersion,
      preflightResult: { passed: false, checks: [{ name: 'not_already_updating', passed: false }] },
      error: 'Update already in progress',
      durationMs: 0,
    }
  }

  // Run preflight
  const preflight = await runPreflightChecks()
  if (!preflight.passed) {
    log.warn('[UpdateAgent] Preflight failed:', preflight.checks.filter(c => !c.passed))
    return {
      success: false,
      previousVersion,
      targetVersion,
      preflightResult: preflight,
      error: 'Preflight checks failed: ' + preflight.checks.filter(c => !c.passed).map(c => c.name).join(', '),
      durationMs: Date.now() - startTime,
    }
  }

  isUpdating = true
  log.info(`[UpdateAgent] Starting update: ${previousVersion} → ${targetVersion}`)

  try {
    // ── Single deploy path via gwi-node.sh ──
    const result = await performDeploy(targetVersion, options?.commandId)
    isUpdating = false
    return result
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    log.error({ err: error }, `[UpdateAgent] Update failed:`)

    return {
      success: false,
      previousVersion,
      targetVersion,
      preflightResult: preflight,
      error,
      durationMs: Date.now() - startTime,
    }
  } finally {
    isUpdating = false
    serviceWasStopped = false
  }
}

/**
 * Report deploy result directly to MC's /api/fleet/deploy-health endpoint.
 * Uses the same fleet HMAC auth as heartbeat.sh (Authorization: Bearer, X-Server-Node-Id,
 * X-Hardware-Fingerprint, X-Request-Signature).
 */
export async function reportDeployHealth(result: UpdateResult): Promise<void> {
  const mcUrl = (process.env.MISSION_CONTROL_URL || process.env.BACKOFFICE_API_URL || '').replace(/\/+$/, '')
  const apiKey = process.env.SERVER_API_KEY || ''
  const nodeId = process.env.SERVER_NODE_ID || ''
  const fingerprint = process.env.HARDWARE_FINGERPRINT || ''

  if (!mcUrl || !apiKey || !nodeId) {
    log.warn('[UpdateAgent] Cannot report deploy health — missing MISSION_CONTROL_URL, SERVER_API_KEY, or SERVER_NODE_ID')
    return
  }

  const body: Record<string, unknown> = {
    success: result.success,
    previousVersion: result.previousVersion,
    targetVersion: result.targetVersion,
    preflightResult: result.preflightResult,
    durationMs: result.durationMs,
    version: result.targetVersion,
  }
  if (result.error) {
    body.error = result.error
  }

  // Include backup info + component updates from last-update state file
  try {
    if (existsSync(UPDATE_STATE_FILE)) {
      const lastUpdate = JSON.parse(readFileSync(UPDATE_STATE_FILE, 'utf8')) as UpdateState
      body.backupStatus = lastUpdate.backupStatus
      body.backupPath = lastUpdate.backupPath
      body.proceededWithoutBackup = lastUpdate.proceededWithoutBackup
      if (lastUpdate.componentUpdates) {
        body.componentUpdates = lastUpdate.componentUpdates
      }
    }
  } catch {}

  const bodyString = JSON.stringify(body)
  const signature = createHmac('sha256', apiKey).update(bodyString).digest('hex')

  try {
    const res = await fetch(`${mcUrl}/api/fleet/deploy-health`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Server-Node-Id': nodeId,
        'X-Hardware-Fingerprint': fingerprint,
        'X-Request-Signature': signature,
      },
      body: bodyString,
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`)
    }

    log.info(`[UpdateAgent] Deploy health reported to MC: success=${result.success} version=${result.targetVersion}`)
  } catch (err) {
    log.error({ err }, '[UpdateAgent] Failed to report deploy health to MC')
  }
}

/**
 * Check heartbeat response and trigger update if needed.
 * Called after each fleet heartbeat.
 */
export function checkForUpdate(heartbeatResponse: {
  targetVersion?: string
  releaseChannelTier?: string
  rollingRestart?: boolean
  commandId?: string
}): void {
  const { targetVersion, rollingRestart, commandId } = heartbeatResponse
  if (!targetVersion) return

  const current = getCurrentVersion()
  if (current === targetVersion || current === 'unknown') return

  log.info(`[UpdateAgent] Version mismatch: running ${current}, target ${targetVersion}`)

  // Fire-and-forget update
  void executeUpdate(targetVersion, { rollingRestart, commandId }).then(result => {
    if (result.success) {
      log.info(`[UpdateAgent] Update succeeded: ${result.previousVersion} → ${result.targetVersion} (${result.durationMs}ms)`)
    } else {
      log.error(`[UpdateAgent] Update failed: ${result.error}`)
    }

    // Report result back to MC deploy-health endpoint (fleet-authenticated)
    void reportDeployHealth(result).catch((err) => log.error({ err }, 'reportDeployHealth failed'))
  }).catch((err) => log.error({ err }, 'operation failed'))
}

/**
 * Get update agent status for health endpoint
 */
export function getUpdateAgentStatus(): {
  currentVersion: string
  isUpdating: boolean
  lockFileExists: boolean
} {
  return {
    currentVersion: getCurrentVersion(),
    isUpdating,
    lockFileExists: existsSync(UPDATE_LOCK_FILE),
  }
}

// ── Component updates ───────────────────────────────────────────────────────

/**
 * Update all components from the checkout after a successful POS update.
 * Called after POS restart + health check pass. Non-fatal — POS update
 * still succeeds even if component updates fail.
 */
async function updateComponents(): Promise<ComponentUpdateResult> {
  log.info('[update-agent] Checking component versions...')
  const result: ComponentUpdateResult = {}

  // ── Dashboard .deb ──────────────────────────────────────────────────────
  try {
    const installedVer = execSync('dpkg-query -W -f="${Version}" gwi-nuc-dashboard 2>/dev/null || echo "0.0.0"', { encoding: 'utf8' }).trim()
    const versionFilePath = path.join(APP_DIR, 'public/dashboard-version.txt')
    const availableVer = existsSync(versionFilePath)
      ? readFileSync(versionFilePath, 'utf8').trim()
      : '0.0.0'

    if (installedVer !== availableVer && availableVer !== '0.0.0') {
      log.info(`[update-agent] Dashboard update: ${installedVer} -> ${availableVer}`)
      const debPath = path.join(APP_DIR, 'public/gwi-nuc-dashboard.deb')
      if (existsSync(debPath)) {
        execSync(`sudo dpkg -i "${debPath}" 2>/dev/null || sudo apt-get install -f -y`, {
          encoding: 'utf8',
          timeout: 60_000,
        })
        log.info('[update-agent] Dashboard updated successfully')
        // Restart the dashboard app (auto-restarts via systemd)
        try { execSync('pkill -f gwi-dashboard || true', { timeout: 5_000, stdio: 'pipe' }) } catch {}
        result.dashboard = { from: installedVer, to: availableVer, updated: true }
      } else {
        // Fall back to existing updateDashboard() download flow
        await updateDashboard()
        result.dashboard = { from: installedVer, to: availableVer, updated: true }
      }
    } else {
      log.info(`[update-agent] Dashboard is current (v${installedVer})`)
      result.dashboard = { from: installedVer, to: installedVer, updated: false }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error(`[update-agent] Dashboard update failed: ${msg}`)
    result.dashboard = { from: 'unknown', to: 'unknown', updated: false }
  }

  // ── Monitoring scripts ──────────────────────────────────────────────────
  try {
    const scripts = [
      { src: 'public/watchdog.sh', dest: '/opt/gwi-pos/watchdog.sh' },
      { src: 'public/scripts/hardware-inventory.sh', dest: '/opt/gwi-pos/scripts/hardware-inventory.sh' },
      { src: 'public/scripts/disk-pressure-monitor.sh', dest: '/opt/gwi-pos/scripts/disk-pressure-monitor.sh' },
      { src: 'public/scripts/version-compat.sh', dest: '/opt/gwi-pos/scripts/version-compat.sh' },
      { src: 'public/scripts/rolling-restart.sh', dest: '/opt/gwi-pos/scripts/rolling-restart.sh' },
    ]

    let updated = false
    for (const { src, dest } of scripts) {
      const srcPath = path.join(APP_DIR, src)
      if (existsSync(srcPath)) {
        execSync(`sudo mkdir -p "$(dirname "${dest}")" && sudo cp "${srcPath}" "${dest}" && sudo chmod +x "${dest}"`, { encoding: 'utf8', timeout: 10_000 })
        updated = true
      }
    }

    // Deploy latest installer libraries
    const libDir = path.join(APP_DIR, 'public/installer-modules/lib')
    if (existsSync(libDir)) {
      execSync(`sudo mkdir -p /opt/gwi-pos/installer-modules/lib && sudo cp "${libDir}"/*.sh /opt/gwi-pos/installer-modules/lib/ && sudo chmod +x /opt/gwi-pos/installer-modules/lib/*.sh`, { encoding: 'utf8', timeout: 10_000 })
      updated = true
    }

    // Ensure heartbeat.sh includes nucReadiness.
    // New installs already have it baked into the template (04-database.sh).
    // For OLD heartbeat.sh files (pre-template), we use a companion script approach:
    //   1. Write /opt/gwi-pos/heartbeat-readiness.sh (self-contained, reads .env + calls API)
    //   2. Patch heartbeat.sh to source the companion + add nucReadiness to the jq payload
    // This is far more robust than the old multi-regex sed-style injection.
    try {
      const hbPath = '/opt/gwi-pos/heartbeat.sh'
      const companionPath = '/opt/gwi-pos/heartbeat-readiness.sh'

      // Always write the companion script (keeps it up-to-date even on new installs)
      // NOTE: All bash $ must be escaped as \$ inside the JS template literal.
      const companionScript = `#!/bin/bash
# Sourced by heartbeat.sh — provides NUC_READINESS_JSON variable
# Auto-generated by update-agent — do not edit manually
NUC_READINESS_JSON='null'
_PROV_KEY=""
if [ -n "\${PROVISION_API_KEY:-}" ]; then
  _PROV_KEY="\$PROVISION_API_KEY"
else
  _PROV_KEY=\$(grep '^PROVISION_API_KEY=' /opt/gwi-pos/.env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || echo "")
fi
if [ -n "\$_PROV_KEY" ]; then
  NUC_READINESS_RAW=\$(curl -sf --max-time 3 -H "x-api-key: \$_PROV_KEY" http://localhost:3005/api/internal/nuc-readiness 2>/dev/null || echo "")
  if [ -n "\$NUC_READINESS_RAW" ] && echo "\$NUC_READINESS_RAW" | jq empty 2>/dev/null; then
    NUC_READINESS_JSON="\$NUC_READINESS_RAW"
  fi
fi
# Fallback: sync-status.json (available even when POS app is down)
if [ "\$NUC_READINESS_JSON" = "null" ] && [ -f /opt/gwi-pos/state/sync-status.json ] && jq empty /opt/gwi-pos/state/sync-status.json 2>/dev/null; then
  NUC_READINESS_JSON=\$(jq -c '{
    localDb: true,
    neonReachable: .neonReachable,
    neonSchemaVersion: (.observedVersion // "unknown"),
    seedVersion: null,
    baseSeedPresent: .syncReady,
    schemaBehind: false,
    schemaAhead: false,
    syncWorkers: .syncReady,
    expectedSchemaVersion: (.expectedVersion // "unknown"),
    observedNeonSchemaVersion: (.observedVersion // "unknown"),
    schemaRecheckCount: .retryCount,
    readinessLevel: (if .syncReady then "ORDERS" else "BOOT" end)
  }' /opt/gwi-pos/state/sync-status.json 2>/dev/null || echo 'null')
fi
`
      writeFileSync(companionPath, companionScript, { mode: 0o755 })
      log.info('[update-agent] Wrote heartbeat-readiness.sh companion script')

      // Patch OLD heartbeat.sh files that lack nucReadiness
      if (existsSync(hbPath)) {
        const hbContent = readFileSync(hbPath, 'utf8')
        if (!hbContent.includes('nucReadiness') && !hbContent.includes('NUC_READINESS')) {
          // OLD heartbeat.sh — needs patching.
          // Strategy: insert a source line + add nucReadiness to the jq payload.
          let patched = hbContent

          // 1. Insert "source companion" before the BODY= line
          patched = patched.replace(
            /^(BODY=\$\(jq -nc)/m,
            '# ── NUC Readiness (sourced companion — injected by update-agent) ──\n' +
            'if [ -f /opt/gwi-pos/heartbeat-readiness.sh ]; then\n' +
            '  . /opt/gwi-pos/heartbeat-readiness.sh\n' +
            'fi\n\n$1'
          )

          // 2. Add --argjson nucReadiness to the jq command.
          //    Match the last --argjson line before the jq format string.
          patched = patched.replace(
            /(--argjson\s+componentVersions\s+"\$COMPONENT_VERSIONS_JSON")/,
            '$1 \\\n  --argjson nucReadiness "${NUC_READINESS_JSON:-null}"'
          )

          // 3. Add nucReadiness field to the jq output object.
          //    Match the closing brace of the jq format string that ends the BODY.
          patched = patched.replace(
            /componentVersions:\$componentVersions}/,
            'componentVersions:$componentVersions,nucReadiness:$nucReadiness}'
          )

          if (patched !== hbContent) {
            writeFileSync(hbPath, patched)
            execSync(`chmod +x "${hbPath}"`, { timeout: 5_000 })
            log.info('[update-agent] Patched old heartbeat.sh with nucReadiness (companion source)')
            updated = true
          } else {
            log.warn('[update-agent] Heartbeat.sh patch regexes did not match — file may have unexpected format')
          }
        } else if (!hbContent.includes('heartbeat-readiness.sh')) {
          // heartbeat.sh has nucReadiness in payload but doesn't source the companion.
          // This happens when the old inline patch added the jq field but not the source.
          // Add the source line so the variable actually gets populated.
          const patched = hbContent.replace(
            /^(BODY=\$\(jq -nc)/m,
            '# ── NUC Readiness (sourced companion — injected by update-agent) ──\n' +
            'if [ -f /opt/gwi-pos/heartbeat-readiness.sh ]; then\n' +
            '  . /opt/gwi-pos/heartbeat-readiness.sh\n' +
            'fi\n\n$1'
          )
          if (patched !== hbContent) {
            writeFileSync(hbPath, patched)
            execSync(`chmod +x "${hbPath}"`, { timeout: 5_000 })
            log.info('[update-agent] Added companion source to existing nucReadiness heartbeat.sh')
            updated = true
          }
        }
      }
    } catch (patchErr) {
      log.warn('[update-agent] Heartbeat readiness setup failed (non-fatal):', patchErr instanceof Error ? patchErr.message : patchErr)
    }

    result.monitoring = { updated }
    log.info('[update-agent] Monitoring scripts updated from checkout')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error(`[update-agent] Script update failed: ${msg}`)
    result.monitoring = { updated: false }
  }

  // ── Sync agent ──────────────────────────────────────────────────────────
  try {
    const syncSrc = path.join(APP_DIR, 'public/sync-agent.js')
    if (existsSync(syncSrc)) {
      execSync(`sudo cp "${syncSrc}" /opt/gwi-pos/sync-agent.js`, { encoding: 'utf8', timeout: 10_000 })
      result.syncAgent = { updated: true }
      log.info('[update-agent] Sync agent updated from checkout')
    } else {
      result.syncAgent = { updated: false }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error(`[update-agent] Sync agent update failed: ${msg}`)
    result.syncAgent = { updated: false }
  }

  // ── Watchdog timer ──────────────────────────────────────────────────────
  try {
    const timerActive = execSync('systemctl is-active gwi-watchdog.timer 2>/dev/null || echo inactive', { encoding: 'utf8' }).trim()
    if (timerActive !== 'active') {
      if (existsSync('/opt/gwi-pos/watchdog.sh')) {
        const svcSrc = path.join(APP_DIR, 'public/watchdog.service')
        const timerSrc = path.join(APP_DIR, 'public/watchdog.timer')
        if (existsSync(svcSrc) && existsSync(timerSrc)) {
          execSync(`sudo cp "${svcSrc}" /etc/systemd/system/gwi-watchdog.service; sudo cp "${timerSrc}" /etc/systemd/system/gwi-watchdog.timer; sudo systemctl daemon-reload; sudo systemctl enable --now gwi-watchdog.timer`, { encoding: 'utf8', timeout: 15_000 })
          log.info('[update-agent] Watchdog timer activated')
        }
      }
      result.watchdog = { active: true }
    } else {
      result.watchdog = { active: true }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error(`[update-agent] Watchdog activation failed: ${msg}`)
    result.watchdog = { active: false }
  }

  // ── Ansible baseline enforcement ──────────────────────────────────────
  // Run Stage 11 after every update to ensure hardening is current.
  // Non-fatal — direct hardening fallback in the script covers critical items.
  try {
    const hardeningScript = path.join(APP_DIR, 'public/installer-modules/11-system-hardening.sh')
    if (existsSync(hardeningScript)) {
      log.info('[update-agent] Running Ansible baseline enforcement...')
      execSync(`bash "${hardeningScript}"`, {
        encoding: 'utf8',
        timeout: 600_000,  // 10 min
        env: {
          ...process.env,
          APP_BASE: '/opt/gwi-pos',
          APP_DIR,
          POSUSER: process.env.POSUSER || 'gwipos',
          STATION_ROLE: process.env.STATION_ROLE || 'server',
        },
      })
      log.info('[update-agent] Ansible baseline completed')
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn(`[update-agent] Ansible baseline failed (non-fatal): ${msg.slice(0, 200)}`)
  }

  return result
}

// ── Dashboard .deb update ──────────────────────────────────────────────────

const DASHBOARD_DEB_DIR = '/opt/gwi-pos/dashboard'
const DASHBOARD_DEB_PATH = path.join(DASHBOARD_DEB_DIR, 'gwi-nuc-dashboard.deb')

/**
 * Download and install the latest NUC Dashboard .deb.
 * Non-fatal — called from executeUpdate() but failures never block POS updates.
 * Skips if dashboard is not already installed (initial install is Stage 12).
 */
async function updateDashboard(): Promise<void> {
  // Only update if dashboard is already installed (Stage 12 handles first install)
  // Binary is "gwi-dashboard" (Tauri productName → binary name mapping)
  try {
    execSync('which gwi-dashboard', { encoding: 'utf8', stdio: 'pipe' })
  } catch {
    log.info('[UpdateAgent] Dashboard not installed — skipping (Stage 12 handles first install)')
    return
  }

  log.info('[UpdateAgent] Checking for dashboard updates...')
  try { execSync(`mkdir -p "${DASHBOARD_DEB_DIR}"`) } catch {}

  let downloaded = false

  // Method 1: Download from GitHub releases (primary — CI publishes here)
  try {
    const credFile = '/opt/gwi-pos/.git-credentials'
    if (existsSync(credFile)) {
      const creds = readFileSync(credFile, 'utf8')
      // Format: https://TOKEN:x-oauth-basic@github.com
      const tokenMatch = creds.match(/https:\/\/([^:]+):x-oauth-basic@github\.com/)
      const token = tokenMatch?.[1]
      if (token) {
        const apiRes = await fetch('https://api.github.com/repos/GetwithitMan/gwi-dashboard/releases/latest', {
          headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' },
          signal: AbortSignal.timeout(30_000),
        })
        if (apiRes.ok) {
          const release = await apiRes.json() as { assets?: Array<{ name: string; url: string }> }
          const debAsset = release.assets?.find((a: { name: string }) => a.name.endsWith('.deb'))
          if (debAsset?.url) {
            const assetRes = await fetch(debAsset.url, {
              headers: { Authorization: `token ${token}`, Accept: 'application/octet-stream' },
              signal: AbortSignal.timeout(120_000),
            })
            if (assetRes.ok) {
              const buffer = Buffer.from(await assetRes.arrayBuffer())
              if (buffer.length > 100_000) {
                writeFileSync(DASHBOARD_DEB_PATH, buffer)
                downloaded = true
                log.info(`[UpdateAgent] Dashboard .deb downloaded from GitHub (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`)
              }
            }
          }
        }
      }
    }
  } catch (err) {
    log.warn('[UpdateAgent] GitHub release download failed:', err instanceof Error ? err.message : err)
  }

  // Method 2: Fallback to POS base URL (Vercel)
  if (!downloaded) {
    try {
      const baseUrl = process.env.POS_BASE_URL || 'https://www.ordercontrolcenter.com'
      const res = await fetch(`${baseUrl}/gwi-nuc-dashboard.deb`, {
        signal: AbortSignal.timeout(60_000),
      })
      if (res.ok) {
        const buffer = Buffer.from(await res.arrayBuffer())
        if (buffer.length > 100_000) {
          writeFileSync(DASHBOARD_DEB_PATH, buffer)
          downloaded = true
          log.info(`[UpdateAgent] Dashboard .deb downloaded from Vercel (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`)
        }
      }
    } catch {}
  }

  if (!downloaded) {
    log.warn('[UpdateAgent] Dashboard .deb download failed from all sources — skipping')
    return
  }

  // Install the .deb
  log.info('[UpdateAgent] Installing dashboard .deb...')
  try {
    execSync(`sudo dpkg -i "${DASHBOARD_DEB_PATH}"`, { timeout: 60_000, stdio: 'pipe' })
  } catch {
    try {
      execSync('sudo apt-get install -f -y -qq', { timeout: 60_000, stdio: 'pipe' })
      execSync(`sudo dpkg -i "${DASHBOARD_DEB_PATH}"`, { timeout: 60_000, stdio: 'pipe' })
    } catch (installErr) {
      log.warn('[UpdateAgent] Dashboard install failed:', installErr instanceof Error ? installErr.message : installErr)
      return
    }
  }

  // Restart the dashboard app if it's running (auto-starts via XDG on next login)
  try {
    execSync('pkill -f gwi-dashboard || true', { timeout: 5_000, stdio: 'pipe' })
  } catch {}

  log.info('[UpdateAgent] Dashboard updated successfully')
}
