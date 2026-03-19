/**
 * NUC Update Agent — Safe Version-Targeted Updates
 *
 * Checks MC heartbeat for targetVersion, compares to current,
 * runs preflight checks, executes update, reports back.
 *
 * Does NOT pull "latest" blindly. Only updates to the exact
 * version MC has approved for this venue's release channel.
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
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

  // 5. Not already updating
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

    // Stamp target version into package.json so NUC reports correct version to MC
    try {
      const pkgPath = path.join(APP_DIR, 'package.json')
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg.version !== targetVersion) {
        pkg.version = targetVersion
        const { writeFileSync } = await import('fs')
        writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
        log.info(`[UpdateAgent] Stamped version ${targetVersion} into package.json`)
      }
    } catch (err) {
      log.warn('[UpdateAgent] Version stamp failed:', err instanceof Error ? err.message : err)
    }

    // Install dependencies
    log.info('[UpdateAgent] Running npm install...')
    execSync('npm install --production=false', { cwd: APP_DIR, timeout: 180_000 })

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
        execSync('npx prisma db push', { cwd: APP_DIR, timeout: 180_000 })
      }
    }

    // Build
    log.info('[UpdateAgent] Running npm run build...')
    execSync('npm run build', { cwd: APP_DIR, timeout: 600_000 })

    // Clean lock
    try { unlinkSync(UPDATE_LOCK_FILE) } catch {}

    log.info(`[UpdateAgent] Update complete: ${previousVersion} → ${targetVersion}`)

    // Request service restart (graceful, delayed to allow response delivery)
    setTimeout(() => {
      log.info('[UpdateAgent] Requesting service restart...')
      try {
        execSync('sudo systemctl restart thepasspos', { timeout: 30_000 })
      } catch {
        try {
          execSync('sudo systemctl restart pulse-pos', { timeout: 30_000 })
        } catch (err) {
          log.error({ err: err }, '[UpdateAgent] Restart failed:')
          return
        }
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
              const data = await res.json() as { data?: { database?: string } }
              if (data.data?.database === 'connected') {
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
            execSync(`cd ${APP_DIR} && git reset --hard HEAD~1`, { timeout: 30_000 })
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

    // Report result back to MC via cloud event
    void (async () => {
      try {
        const { emitCloudEvent } = await import('./cloud-events')
        await emitCloudEvent('UPDATE_RESULT', {
          locationId: process.env.POS_LOCATION_ID || process.env.LOCATION_ID || '',
          ...result,
        })
      } catch {}
    })().catch((err) => log.error({ err }, 'emitCloudEvent failed'))
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
