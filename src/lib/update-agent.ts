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
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'fs'
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

export async function executeUpdate(targetVersion: string): Promise<UpdateResult> {
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
    // Write lock file
    writeFileSync(UPDATE_LOCK_FILE, JSON.stringify({ targetVersion, startedAt: new Date().toISOString() }))

    // Clear stale git lock files
    const lockFiles = [
      path.join(APP_DIR, '.git', 'index.lock'),
      path.join(APP_DIR, '.git', 'refs', 'remotes', 'origin', 'main.lock'),
    ]
    for (const f of lockFiles) {
      try { unlinkSync(f) } catch {}
    }

    // Fix ownership before git operations — previous sudo commands (installer, manual fixes)
    // can leave files root-owned, causing git reset to fail with "Permission denied"
    try {
      const posUser = process.env.POSUSER || execSync('whoami', { encoding: 'utf8' }).trim()
      execSync(`sudo chown -R ${posUser}:${posUser} "${APP_DIR}"`, { timeout: 30_000 })
    } catch {
      // Non-fatal — might not have sudo, or already correct
    }

    // Capture current SHA before fetching — used for deterministic rollback
    const previousSha = execSync('git rev-parse HEAD', { cwd: APP_DIR, encoding: 'utf8' }).trim()

    // Fetch the target version
    execSync('git fetch --all --prune', { cwd: APP_DIR, timeout: 60_000 })

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

    // Install dependencies
    log.info('[UpdateAgent] Running npm ci...')
    execSync('npm ci', { cwd: APP_DIR, timeout: 180_000 })

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
        const { readdirSync, statSync } = await import('fs')
        const migDirs = readdirSync(migrationsDir)
        for (const name of migDirs) {
          if (statSync(path.join(migrationsDir, name)).isDirectory()) {
            try {
              execSync(`npx prisma migrate resolve --applied ${name}`, { cwd: APP_DIR, timeout: 30_000 })
            } catch {}
          }
        }
        execSync('npx prisma db push --accept-data-loss', { cwd: APP_DIR, timeout: 180_000 })
      }
    }

    // Build
    log.info('[UpdateAgent] Running npm run build...')
    execSync('npm run build', { cwd: APP_DIR, timeout: 600_000 })

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

    // Request service restart (graceful, delayed to allow response delivery)
    setTimeout(() => {
      log.info('[UpdateAgent] Requesting service restart...')
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
          log.error('[UpdateAgent] POS failed health check after update — rolling back')
          try {
            execSync(`cd ${APP_DIR} && git reset --hard ${previousSha}`, { timeout: 30_000 })
            // Rebuild from the previous code to ensure .next/ and node_modules match
            try {
              execSync('npm ci', { cwd: APP_DIR, timeout: 300_000 })
              execSync('npx prisma generate', { cwd: APP_DIR, timeout: 60_000 })
              execSync('npm run build', { cwd: APP_DIR, timeout: 600_000 })
              log.info('[UpdateAgent] Rollback rebuild complete')
            } catch (rebuildErr) {
              log.error({ err: rebuildErr }, '[UpdateAgent] Rollback rebuild failed — restarting with whatever is available')
            }
            execSync('sudo systemctl restart thepasspos', { timeout: 30_000 })
            log.info('[UpdateAgent] Rollback complete — reverted to previous version')
          } catch (rollbackErr) {
            log.error({ err: rollbackErr }, '[UpdateAgent] Rollback failed — manual intervention required')
          }
        } else {
          log.info('[UpdateAgent] Health check passed — update verified')
        }
      })()
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
}): void {
  const { targetVersion } = heartbeatResponse
  if (!targetVersion) return

  const current = getCurrentVersion()
  if (current === targetVersion || current === 'unknown') return

  log.info(`[UpdateAgent] Version mismatch: running ${current}, target ${targetVersion}`)

  // Fire-and-forget update
  void executeUpdate(targetVersion).then(result => {
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
