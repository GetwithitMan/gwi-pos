/**
 * NUC Update Agent — Safe Version-Targeted Updates
 *
 * Checks MC heartbeat for targetVersion, compares to current,
 * runs preflight checks, executes update, reports back.
 *
 * Does NOT pull "latest" blindly. Only updates to the exact
 * version MC has approved for this venue's release channel.
 */

import { createHmac, randomUUID } from 'crypto'
import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync, readdirSync } from 'fs'
import path from 'path'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('update-agent')

const APP_DIR = process.env.APP_DIR || '/opt/gwi-pos/app'
const UPDATE_LOCK_FILE = path.join(APP_DIR, '..', '.update-lock')

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
 * Get the current running app version from package.json
 */
export function getCurrentVersion(): string {
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
function isValidVersion(version: string): boolean {
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
 * Version compatibility check — block unsafe version skips.
 * Runs an external compat script (if present) that can enforce
 * migration ordering, minimum-version requirements, etc.
 */
async function checkVersionCompatibility(currentVersion: string, targetVersion: string): Promise<void> {
  const versionCompat = '/opt/gwi-pos/scripts/version-compat.sh'
  if (!existsSync(versionCompat)) {
    log.info('[UpdateAgent] Version compat script not found, skipping check')
    return
  }

  // Get current schema version from migration files
  const currentSchema = getCurrentSchemaVersion()
  const targetSchema = targetVersion // MC should send schema version in payload

  try {
    execSync(`bash ${versionCompat} "${currentSchema}" "${targetSchema}" "${currentVersion}" "${targetVersion}"`, {
      encoding: 'utf8',
      timeout: 10_000,
    })
    log.info('[UpdateAgent] Version compatibility check passed')
  } catch (err: unknown) {
    const errObj = err as { stdout?: string; message?: string }
    throw new Error(`Version compatibility check failed: ${errObj.stdout || errObj.message}`)
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
  const attemptId = randomUUID()
  let backupInfo: { path?: string; size?: number; checksum?: string; status: string } = { status: 'SKIPPED' }
  let previousSha = 'unknown'

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
    // Write lock file
    writeFileSync(UPDATE_LOCK_FILE, JSON.stringify({ targetVersion, startedAt: new Date().toISOString() }))

    // Version compatibility check — block unsafe version skips BEFORE any git operations
    await checkVersionCompatibility(previousVersion, targetVersion)

    // Pre-update safety: backup + code snapshot via atomic transaction
    try {
      log.info('[UpdateAgent] Starting update transaction (backup + snapshot)...')
      const txOutput = execSync(
        'bash -c "export APP_DIR=\\"' + APP_DIR + '\\" && export APP_BASE=\\"/opt/gwi-pos\\" && source /opt/gwi-pos/app/public/installer-modules/lib/atomic-update.sh && start_update_transaction"',
        { encoding: 'utf8', timeout: 120_000 }
      )
      try { backupInfo = JSON.parse(txOutput.trim().split('\n').pop() || '{}') } catch {}
      log.info(`[UpdateAgent] Backup: ${backupInfo.status} (${backupInfo.path || 'none'})`)
    } catch (txErr) {
      const msg = txErr instanceof Error ? txErr.message : String(txErr)
      log.warn(`[UpdateAgent] Transaction start failed (non-fatal): ${msg.slice(0, 200)}`)
      backupInfo = { status: 'FAILED' }
    }

    // ── Git self-repair ──────────────────────────────────────────────
    // Clear stale git lock files (left by interrupted fetch/reset/merge)
    const lockFiles = [
      path.join(APP_DIR, '.git', 'index.lock'),
      path.join(APP_DIR, '.git', 'refs', 'remotes', 'origin', 'main.lock'),
      path.join(APP_DIR, '.git', 'HEAD.lock'),
      path.join(APP_DIR, '.git', 'config.lock'),
      path.join(APP_DIR, '.git', 'shallow.lock'),
      path.join(APP_DIR, '.git', 'refs', 'heads', 'main.lock'),
    ]
    for (const f of lockFiles) {
      try {
        if (existsSync(f)) {
          unlinkSync(f)
          log.info(`[UpdateAgent] Removed stale lock: ${f}`)
        }
      } catch {}
    }

    // Abort interrupted merge/rebase/cherry-pick state
    const gitDir = path.join(APP_DIR, '.git')
    if (existsSync(path.join(gitDir, 'MERGE_HEAD'))) {
      log.info('[UpdateAgent] Aborting interrupted merge')
      try { execSync('git merge --abort', { cwd: APP_DIR, timeout: 10_000 }) } catch {}
    }
    if (existsSync(path.join(gitDir, 'rebase-merge')) || existsSync(path.join(gitDir, 'rebase-apply'))) {
      log.info('[UpdateAgent] Aborting interrupted rebase')
      try { execSync('git rebase --abort', { cwd: APP_DIR, timeout: 10_000 }) } catch {}
    }
    if (existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) {
      log.info('[UpdateAgent] Aborting interrupted cherry-pick')
      try { execSync('git cherry-pick --abort', { cwd: APP_DIR, timeout: 10_000 }) } catch {}
    }

    // Fix ownership before git operations — previous sudo commands (installer, manual fixes)
    // can leave files root-owned, causing git reset to fail with "Permission denied"
    // Safety: validate APP_DIR is the expected path before running chown -R
    if (APP_DIR.startsWith('/opt/gwi-pos/') && APP_DIR.length > 15) {
      try {
        const posUser = process.env.POSUSER || execSync('whoami', { encoding: 'utf8' }).trim()
        if (posUser && posUser !== 'root' && /^[a-zA-Z0-9_-]+$/.test(posUser)) {
          execSync(`sudo chown -R ${posUser}:${posUser} "${APP_DIR}"`, { timeout: 30_000 })
          // Re-lock sensitive files
          try { execSync(`sudo chown root:${posUser} /opt/gwi-pos/.env && sudo chmod 640 /opt/gwi-pos/.env`, { timeout: 5_000, stdio: 'pipe' }) } catch {}
          try { execSync('sudo chown -R root:root /opt/gwi-pos/keys && sudo chmod 700 /opt/gwi-pos/keys', { timeout: 5_000, stdio: 'pipe' }) } catch {}
          try { execSync(`sudo chown root:${posUser} /opt/gwi-pos/.git-credentials && sudo chmod 640 /opt/gwi-pos/.git-credentials`, { timeout: 5_000, stdio: 'pipe' }) } catch {}
        }
      } catch {
        // Non-fatal — might not have sudo, or already correct
      }
    }

    // Capture current SHA before fetching — used for deterministic rollback
    previousSha = execSync('git rev-parse HEAD', { cwd: APP_DIR, encoding: 'utf8' }).trim()

    // Fetch with retry (transient network failures)
    let fetchSuccess = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        execSync('git fetch --all --prune', { cwd: APP_DIR, timeout: 60_000 })
        fetchSuccess = true
        break
      } catch (fetchErr) {
        const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
        log.warn(`[UpdateAgent] git fetch failed (attempt ${attempt}/3): ${msg.slice(0, 200)}`)
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 5_000))
        }
      }
    }
    if (!fetchSuccess) {
      throw new Error('git fetch failed after 3 attempts')
    }

    // Check if the target version exists as a tag or use origin/main
    let ref = `v${targetVersion}`
    try {
      execSync(`git rev-parse ${ref}`, { cwd: APP_DIR })
    } catch {
      // No tag — use origin/main (standard flow for now)
      ref = 'origin/main'
      log.info(`[UpdateAgent] Tag v${targetVersion} not found, using origin/main`)
    }

    // Reset to target
    execSync(`git reset --hard ${ref}`, { cwd: APP_DIR, timeout: 30_000 })

    // Re-copy env files (same as sync-agent pattern)
    const envFile = '/opt/gwi-pos/.env'
    try { const { copyFileSync } = await import('fs'); copyFileSync(envFile, path.join(APP_DIR, '.env')) } catch {}
    try { const { copyFileSync } = await import('fs'); copyFileSync(envFile, path.join(APP_DIR, '.env.local')) } catch {}

    // Install dependencies (with retry on failure)
    log.info('[UpdateAgent] Running npm ci...')
    try {
      execSync('npm ci', { cwd: APP_DIR, timeout: 180_000 })
    } catch {
      log.warn('[UpdateAgent] npm ci failed — clearing cache and retrying...')
      try { execSync('npm cache clean --force', { cwd: APP_DIR, timeout: 30_000 }) } catch {}
      try { execSync('rm -rf node_modules', { cwd: APP_DIR, timeout: 30_000 }) } catch {}
      execSync('npm ci', { cwd: APP_DIR, timeout: 300_000 })
    }

    // Prisma generate
    log.info('[UpdateAgent] Running prisma generate...')
    execSync('npx prisma generate', { cwd: APP_DIR, timeout: 120_000 })

    // Pre-migrate script (if exists)
    try {
      execSync('node scripts/nuc-pre-migrate.js', { cwd: APP_DIR, timeout: 180_000 })
    } catch {}

    // Prisma migrate deploy (with P3005 baselining fallback)
    try {
      execSync('npx prisma migrate deploy', { cwd: APP_DIR, timeout: 120_000 })
    } catch (migrateErr) {
      const stderr = migrateErr instanceof Error ? (migrateErr as { stderr?: string }).stderr || migrateErr.message : String(migrateErr)
      if (stderr.includes('P3005')) {
        log.info('[UpdateAgent] Database needs baselining (P3005)...')
        const migrationsDir = path.join(APP_DIR, 'prisma', 'migrations')
        const migDirs = readdirSync(migrationsDir)
        for (const name of migDirs) {
          if (statSync(path.join(migrationsDir, name)).isDirectory()) {
            try {
              execSync(`npx prisma migrate resolve --applied ${name}`, { cwd: APP_DIR, timeout: 30_000 })
            } catch {}
          }
        }
        execSync('npx prisma db push', { cwd: APP_DIR, timeout: 180_000 })
      }
    }

    // Build — back up .next first so a failed build doesn't leave the server without a working build
    const nextDir = path.join(APP_DIR, '.next')
    const nextBackup = path.join(APP_DIR, '.next.backup')
    try {
      if (existsSync(nextDir)) {
        // Remove stale backup, then rename current build to backup
        if (existsSync(nextBackup)) {
          execSync(`rm -rf "${nextBackup}"`, { cwd: APP_DIR, timeout: 30_000 })
        }
        execSync(`mv "${nextDir}" "${nextBackup}"`, { cwd: APP_DIR, timeout: 30_000 })
        log.info('[UpdateAgent] Backed up .next to .next.backup')
      }
    } catch (backupErr) {
      log.warn('[UpdateAgent] .next backup failed (non-fatal):', backupErr instanceof Error ? backupErr.message : backupErr)
    }

    // Skip typecheck on NUC (already verified in CI) + set heap for Next.js build
    log.info('[UpdateAgent] Running npm run build...')
    try {
      execSync('npm run build', { cwd: APP_DIR, timeout: 600_000, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096', SKIP_TYPECHECK: '1' } })
      // Build succeeded — remove backup
      try {
        if (existsSync(nextBackup)) {
          execSync(`rm -rf "${nextBackup}"`, { cwd: APP_DIR, timeout: 30_000 })
        }
      } catch {}
    } catch (buildErr) {
      // Build failed — restore backup so the previous build can still serve
      log.error('[UpdateAgent] Build failed — restoring .next.backup')
      try {
        if (existsSync(nextBackup)) {
          if (existsSync(nextDir)) {
            execSync(`rm -rf "${nextDir}"`, { cwd: APP_DIR, timeout: 30_000 })
          }
          execSync(`mv "${nextBackup}" "${nextDir}"`, { cwd: APP_DIR, timeout: 30_000 })
          log.info('[UpdateAgent] Restored .next from backup')
        }
      } catch (restoreErr) {
        log.error('[UpdateAgent] .next restore failed:', restoreErr instanceof Error ? restoreErr.message : restoreErr)
      }
      throw buildErr
    }

    // Stamp the MC-provided version into package.json AFTER successful build.
    // bump-version.sh may overwrite during build — this ensures the final version
    // matches what MC deployed, and only on success.
    try {
      const pkgPath = path.join(APP_DIR, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      if (pkg.version !== targetVersion) {
        pkg.version = targetVersion
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
        log.info(`[UpdateAgent] Stamped final version ${targetVersion} into package.json`)
      }
    } catch (stampErr) {
      log.warn('[UpdateAgent] Version stamp failed (non-fatal):', stampErr instanceof Error ? stampErr.message : stampErr)
    }

    // Update dashboard .deb (non-fatal — POS update still succeeds if dashboard fails)
    const stationRole = process.env.STATION_ROLE || 'server'
    if (stationRole !== 'terminal') {
      try {
        await updateDashboard()
      } catch (dashErr) {
        log.warn('[UpdateAgent] Dashboard update failed (non-fatal):', dashErr instanceof Error ? dashErr.message : dashErr)
      }
    }

    // Clean lock
    try { unlinkSync(UPDATE_LOCK_FILE) } catch {}

    log.info(`[UpdateAgent] Update complete: ${previousVersion} → ${targetVersion}`)

    // Write success state file before restart (restart may kill this process)
    const finalState: UpdateState = {
      attemptId,
      commandId: options?.commandId,
      attemptedAt: new Date(startTime).toISOString(),
      targetVersion,
      previousVersion,
      gitShaBefore: previousSha,
      gitShaAfter: execSync('git rev-parse HEAD', { cwd: APP_DIR, encoding: 'utf8' }).trim(),
      status: 'COMPLETED',
      backupStatus: backupInfo.status,
      backupPath: backupInfo.path,
      backupChecksum: backupInfo.checksum,
      rollbackAttempted: false,
      manualInterventionRequired: false,
      proceededWithoutBackup: backupInfo.status !== 'OK',
      duration: Date.now() - startTime,
      steps: ['backup', 'git-fetch', 'npm-ci', 'prisma-generate', 'migrate', 'build', 'restart', 'health-pending'],
    }
    writeUpdateState(finalState)

    // Request service restart (graceful, delayed to allow response delivery)
    setTimeout(() => {
      const useRollingRestart = options?.rollingRestart === true

      // Rolling restart path: delegate to external script, skip manual health gate
      if (useRollingRestart) {
        log.info('[UpdateAgent] Attempting rolling restart...')
        void (async () => {
          const rollingOk = await performRollingRestart(targetVersion)
          if (rollingOk) {
            writeUpdateState({
              ...finalState,
              status: 'COMPLETED',
              steps: ['backup', 'git-fetch', 'npm-ci', 'prisma-generate', 'migrate', 'build', 'rolling-restart', 'health-ok'],
              duration: Date.now() - startTime,
            })
            return
          }
          // Rolling restart not available or failed — fall through to standard restart
          log.info('[UpdateAgent] Falling back to standard restart after rolling restart failure')
          standardRestart()
        })()
        return
      }

      standardRestart()

      function standardRestart(): void {
        log.info('[UpdateAgent] Requesting service restart...')
        const restartTimestamp = Date.now()
        try {
          execSync('sudo systemctl restart thepasspos', { timeout: 30_000 })
        } catch (err) {
          log.error({ err: err }, '[UpdateAgent] Restart failed:')
          return
        }

        // Health gate: verify POS boots successfully after update
        void (async () => {
          let healthy = false
          for (let i = 0; i < 6; i++) {
            await new Promise(r => setTimeout(r, 10_000)) // 10s intervals, 60s total
            try {
              const res = await fetch('http://localhost:3005/api/health', {
                signal: AbortSignal.timeout(5000),
              })
              if (res.ok) {
                const data = await res.json() as { data?: { database?: string; readiness?: { level?: string } } }
                if (data.data?.database === 'connected') {
                  const readiness = data.data?.readiness
                  if (!readiness || readiness.level === 'FAILED') {
                    // DB is up but readiness failed — keep retrying
                    continue
                  }
                  healthy = true
                  break
                }
              }
            } catch {
              // Still booting, retry
            }
          }

          if (!healthy) {
            log.error('[UpdateAgent] POS failed health check after update — initiating conservative rollback')

            const rollbackState: Partial<UpdateState> = { rollbackAttempted: true }
            const rollbackReport: RollbackReport = {
              attempted: true,
              succeeded: false,
              method: 'none',
              reason: 'Health check failed after update restart',
              codeRestored: false,
              dbRestored: false,
              manualInterventionRequired: false,
            }

            // Capture diagnostics BEFORE rolling back (preserves failed state for debugging)
            const diagPath = captureDiagnostics(`Health check failed after update ${previousVersion} → ${targetVersion}`)
            if (diagPath) {
              rollbackReport.diagnosticsPath = diagPath
            }

            try {
              // Conservative rollback: code only, NO database restore
              // If writes may have been accepted, mark for manual review
              const uptimeAfterRestart = Date.now() - restartTimestamp
              const mayHaveAcceptedWrites = uptimeAfterRestart > 15_000 // >15s after restart = may have served requests

              // Restore code from snapshot if available
              if (existsSync('/opt/gwi-pos/app.last-good')) {
                execSync('bash -c "export APP_DIR=\\"' + APP_DIR + '\\" && source /opt/gwi-pos/app/public/installer-modules/lib/atomic-update.sh && rollback_transaction"', { timeout: 60_000 })
                log.info('[UpdateAgent] Code restored from snapshot')
                rollbackReport.method = 'full'
                rollbackReport.codeRestored = true
              } else {
                // Fallback: git reset
                execSync(`cd ${APP_DIR} && git reset --hard ${previousSha}`, { timeout: 30_000 })
                rollbackReport.method = 'code_only'
                rollbackReport.codeRestored = true
              }

              // Rebuild from rolled-back code
              const buildEnv = { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096', SKIP_TYPECHECK: '1' }
              try {
                execSync('npm ci', { cwd: APP_DIR, timeout: 300_000 })
                execSync('npx prisma generate', { cwd: APP_DIR, timeout: 60_000 })
                execSync('npm run build', { cwd: APP_DIR, timeout: 600_000, env: buildEnv })
                log.info('[UpdateAgent] Rollback rebuild complete')
              } catch (rebuildErr) {
                log.error({ err: rebuildErr }, '[UpdateAgent] Rollback rebuild failed')
              }

              execSync('sudo systemctl restart thepasspos', { timeout: 30_000 })

              rollbackState.rollbackSucceeded = true
              rollbackState.manualInterventionRequired = mayHaveAcceptedWrites
              rollbackReport.succeeded = true
              rollbackReport.manualInterventionRequired = mayHaveAcceptedWrites

              if (mayHaveAcceptedWrites) {
                rollbackReport.reason = 'Health check failed; rollback complete but POS may have accepted writes during window'
                log.warn('[UpdateAgent] Rollback complete but POS may have accepted writes — manual DB review required')
              } else {
                rollbackReport.reason = 'Health check failed; clean rollback to previous version'
                log.info('[UpdateAgent] Rollback complete — reverted to previous version')
              }
            } catch (rollbackErr) {
              log.error({ err: rollbackErr }, '[UpdateAgent] Rollback failed — manual intervention required')
              rollbackState.rollbackSucceeded = false
              rollbackState.manualInterventionRequired = true
              rollbackReport.succeeded = false
              rollbackReport.manualInterventionRequired = true
              rollbackReport.reason = `Rollback failed: ${rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr)}`
            }

            // Write structured rollback report
            writeRollbackReport(rollbackReport)

            // Update state file with rollback info
            writeUpdateState({
              ...finalState,
              status: 'ROLLED_BACK',
              rollbackAttempted: rollbackState.rollbackAttempted ?? true,
              rollbackSucceeded: rollbackState.rollbackSucceeded,
              manualInterventionRequired: rollbackState.manualInterventionRequired ?? true,
              steps: ['backup', 'git-fetch', 'npm-ci', 'prisma-generate', 'migrate', 'build', 'restart', 'health-failed', 'rollback'],
              duration: Date.now() - startTime,
            })
          } else {
            log.info('[UpdateAgent] Health check passed — update verified')
            // Update state file with health-ok
            writeUpdateState({
              ...finalState,
              status: 'COMPLETED',
              steps: ['backup', 'git-fetch', 'npm-ci', 'prisma-generate', 'migrate', 'build', 'restart', 'health-ok'],
              duration: Date.now() - startTime,
            })
          }
        })()
      } // end standardRestart()
    }, 2000)

    return {
      success: true,
      previousVersion,
      targetVersion,
      preflightResult: preflight,
      durationMs: Date.now() - startTime,
    }
  } catch (err) {
    // Clean lock
    try { unlinkSync(UPDATE_LOCK_FILE) } catch {}

    const error = err instanceof Error ? err.message : String(err)
    log.error({ err: error }, `[UpdateAgent] Update failed:`)

    // Write error state file
    const errorState: UpdateState = {
      attemptId,
      attemptedAt: new Date(startTime).toISOString(),
      targetVersion,
      previousVersion,
      gitShaBefore: previousSha || 'unknown',
      status: 'FAILED',
      backupStatus: backupInfo.status,
      backupPath: backupInfo.path,
      rollbackAttempted: false,
      manualInterventionRequired: false,
      proceededWithoutBackup: backupInfo.status !== 'OK',
      duration: Date.now() - startTime,
      steps: [],
      error,
    }
    writeUpdateState(errorState)

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

  // Include backup info from last-update state file
  try {
    if (existsSync(UPDATE_STATE_FILE)) {
      const lastUpdate = JSON.parse(readFileSync(UPDATE_STATE_FILE, 'utf8')) as UpdateState
      body.backupStatus = lastUpdate.backupStatus
      body.backupPath = lastUpdate.backupPath
      body.proceededWithoutBackup = lastUpdate.proceededWithoutBackup
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
      const baseUrl = process.env.POS_BASE_URL || 'https://app.thepasspos.com'
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
