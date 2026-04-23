import { existsSync, readFileSync } from 'fs'
import { execSync } from 'child_process'

const RUNNING_VERSION_FILE = '/opt/gwi-pos/shared/state/running-version.json'
const UPDATE_LOCK_FILE = '/opt/gwi-pos/.update-lock'
const APP_DIR = process.env.APP_DIR || '/opt/gwi-pos/current'

export function getCurrentVersion(): string {
  try {
    if (existsSync(RUNNING_VERSION_FILE)) {
      const rv = JSON.parse(readFileSync(RUNNING_VERSION_FILE, 'utf8'))
      if (rv.version) return rv.version
    }
  } catch {}

  try {
    const pkgPath = `${APP_DIR}/package.json`
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg.version) return pkg.version
    }
  } catch {}

  return process.env.NEXT_PUBLIC_APP_VERSION || process.env.npm_package_version || 'unknown'
}

export function getUpdateAgentStatus(): {
  currentVersion: string
  isUpdating: boolean
  lockFileExists: boolean
} {
  return {
    currentVersion: getCurrentVersion(),
    isUpdating: existsSync(UPDATE_LOCK_FILE),
    lockFileExists: existsSync(UPDATE_LOCK_FILE),
  }
}

export async function runPreflightChecks(): Promise<{
  passed: boolean
  checks: Array<{ name: string; passed: boolean; detail?: string }>
}> {
  const checks: Array<{ name: string; passed: boolean; detail?: string }> = []

  try {
    const df = execSync("df -BM /opt/gwi-pos | tail -1 | awk '{print $4}'", { encoding: 'utf8' }).trim()
    const freeMB = parseInt(df.replace('M', ''), 10)
    checks.push({ name: 'disk_space', passed: freeMB >= 500, detail: `${freeMB}MB free` })
  } catch {
    checks.push({ name: 'disk_space', passed: true, detail: 'check skipped (non-linux)' })
  }

  try {
    const { masterClient } = await import('./db')
    await masterClient.$queryRawUnsafe('SELECT 1')
    checks.push({ name: 'local_pg', passed: true })
  } catch (err) {
    checks.push({ name: 'local_pg', passed: false, detail: err instanceof Error ? err.message : String(err) })
  }

  try {
    const { masterClient } = await import('./db')
    const activePayments = await masterClient.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) as count FROM "Order" WHERE status = 'paying' AND "deletedAt" IS NULL`,
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

  try {
    execSync('git status --porcelain', { cwd: APP_DIR, encoding: 'utf8' })
    checks.push({ name: 'git_available', passed: true })
  } catch {
    checks.push({ name: 'git_available', passed: false, detail: 'git not available or repo corrupt' })
  }

  checks.push({
    name: 'not_already_updating',
    passed: !existsSync(UPDATE_LOCK_FILE),
    detail: existsSync(UPDATE_LOCK_FILE) ? 'lock file exists' : undefined,
  })

  return {
    passed: checks.every(c => c.passed),
    checks,
  }
}
