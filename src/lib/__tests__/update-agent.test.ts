/**
 * Update Agent — Failure Recovery & Rollback Tests
 *
 * Tests the CRITICAL paths in the update agent:
 * 1. Service restore on failure (P0 safety net)
 * 2. Preflight safety gates
 * 3. Version validation (shell injection defense)
 * 4. Health check and rollback flow
 * 5. Concurrent update rejection
 * 6. Deploy health reporting to MC
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Mocks — must be declared before imports ─────────────────────────────────

const mockExecSync = vi.fn()
const mockExistsSyncImpl = vi.fn().mockReturnValue(false)
const mockReadFileSync = vi.fn().mockReturnValue('{"version":"1.0.50"}')
const mockWriteFileSync = vi.fn()
const mockUnlinkSync = vi.fn()
const mockStatSync = vi.fn()
const mockReaddirSync = vi.fn().mockReturnValue([])
const mockMkdirSync = vi.fn()

vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}))

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSyncImpl(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  statSync: (...args: unknown[]) => mockStatSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  copyFileSync: vi.fn(),
}))

vi.mock('crypto', () => ({
  randomUUID: () => 'test-uuid-0000-0000-000000000000',
  createHmac: () => ({
    update: () => ({ digest: () => 'mock-signature' }),
  }),
}))

vi.mock('@/lib/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock db module — runPreflightChecks uses dynamic import('./db')
vi.mock('@/lib/db', () => ({
  masterClient: {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
  },
}))

// ─── Import after mocks ──────────────────────────────────────────────────────

import {
  getCurrentVersion,
  runPreflightChecks,
  executeUpdate,
  isValidVersion,
  reportDeployHealth,
  getUpdateAgentStatus,
} from '@/lib/update-agent'

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a mock for execSync that handles common commands.
 * Pass overrides to change behavior for specific commands.
 */
function buildExecSyncMock(overrides: Record<string, () => string> = {}, tracker?: string[]) {
  return (cmd: string, _opts?: unknown) => {
    if (tracker && typeof cmd === 'string') tracker.push(cmd)

    // Check overrides first
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (cmd.includes(pattern)) return handler()
    }

    // Defaults for all standard commands
    if (cmd.includes('git rev-parse HEAD')) return 'abc123def456'
    if (cmd.includes('git fetch')) return ''
    if (cmd.includes('git rev-parse v')) throw new Error('tag not found')
    if (cmd.includes('git reset')) return ''
    if (cmd.includes('git status')) return ''
    if (cmd.includes('npm ci')) return ''
    if (cmd.includes('prisma generate')) return ''
    if (cmd.includes('prisma migrate')) return ''
    if (cmd.includes('prisma db push')) return ''
    if (cmd.includes('nuc-pre-migrate')) return ''
    if (cmd.includes('npm run build')) return ''
    if (cmd.includes('systemctl')) return ''
    if (cmd.includes('mkdir')) return ''
    if (cmd.includes('chown') || cmd.includes('chmod')) return ''
    if (cmd === 'whoami' || cmd.includes('whoami')) return 'gwipos'
    if (cmd.includes('df ')) return '2048M'
    if (cmd.includes('nohup')) return ''
    if (cmd.includes('dpkg-query')) return '1.0.0'
    if (cmd.includes('pkill')) return ''
    if (cmd.includes('sudo cp') || cmd.includes('sudo mkdir')) return ''
    if (cmd.includes('version-compat.sh')) return ''
    if (cmd.includes('atomic-update.sh')) return '{"status":"OK","path":"/opt/gwi-pos/backup"}'
    if (cmd.includes('psql')) return '90'
    if (cmd.includes('mv ')) return ''
    if (cmd.includes('rm -rf')) return ''
    if (cmd.includes('deploy-release.sh')) return 'deploy ok'
    return ''
  }
}

/**
 * Configure existsSync to return specific values per path pattern.
 * Paths not in the map default to `defaultValue`.
 */
function setupExistsSync(pathMap: Record<string, boolean>, defaultValue = false) {
  mockExistsSyncImpl.mockImplementation((p: string) => {
    for (const [key, val] of Object.entries(pathMap)) {
      if (p.includes(key)) return val
    }
    return defaultValue
  })
}

/** Standard existsSync setup for legacy deploy tests */
const LEGACY_EXISTS_MAP: Record<string, boolean> = {
  'package.json': true,
  'deploy-release.sh': false,
  '.update-lock': false,
  'disk-pressure.json': false,
  'last-update.json': false,
  '.git/MERGE_HEAD': false,
  '.git/rebase-merge': false,
  '.git/rebase-apply': false,
  '.git/CHERRY_PICK_HEAD': false,
  '.git/index.lock': false,
  '.git/HEAD.lock': false,
  'app.last-good': false,
  'version-contract.json': false,
  'version-compat.sh': false,
  '.next': true,
  '.next.backup': false,
}

// ─── Test Suites ─────────────────────────────────────────────────────────────

describe('update-agent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    setupExistsSync(LEGACY_EXISTS_MAP)
    mockExecSync.mockImplementation(buildExecSyncMock())
    mockReadFileSync.mockImplementation((p: string) => {
      if (typeof p === 'string' && p.includes('package.json')) return '{"version":"1.0.50"}'
      return '{}'
    })
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. VERSION VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('isValidVersion — shell injection defense', () => {
    it('accepts valid semver', () => {
      expect(isValidVersion('1.2.3')).toBe(true)
    })

    it('accepts semver with pre-release', () => {
      expect(isValidVersion('1.0.50-beta.1')).toBe(true)
    })

    it('accepts semver with build metadata', () => {
      expect(isValidVersion('1.0.50-rc1+build123')).toBe(true)
    })

    it('rejects semicolon (command chaining)', () => {
      expect(isValidVersion('; rm -rf /')).toBe(false)
    })

    it('rejects backticks (command substitution)', () => {
      expect(isValidVersion('`whoami`')).toBe(false)
    })

    it('rejects dollar sign (variable expansion)', () => {
      expect(isValidVersion('$HOME')).toBe(false)
    })

    it('rejects pipe (command piping)', () => {
      expect(isValidVersion('1.0|cat /etc/passwd')).toBe(false)
    })

    it('rejects ampersand (background exec)', () => {
      expect(isValidVersion('1.0 && rm -rf /')).toBe(false)
    })

    it('rejects empty string', () => {
      expect(isValidVersion('')).toBe(false)
    })

    it('rejects versions over 64 chars', () => {
      const longVersion = '1.' + '0'.repeat(64)
      expect(isValidVersion(longVersion)).toBe(false)
    })

    it('rejects parentheses', () => {
      expect(isValidVersion('$(whoami)')).toBe(false)
    })

    it('rejects newlines', () => {
      expect(isValidVersion('1.0.0\nrm -rf /')).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. executeUpdate — VERSION VALIDATION INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('executeUpdate — version validation', () => {
    it('rejects shell metacharacters with immediate failure', async () => {
      const result = await executeUpdate('; rm -rf /')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid targetVersion format')
      expect(result.durationMs).toBe(0)
      // Must NOT have called any execSync (no git, no npm, no systemctl)
      expect(mockExecSync).not.toHaveBeenCalled()
    })

    it('rejects empty string before any work', async () => {
      const result = await executeUpdate('')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid targetVersion format')
      expect(mockExecSync).not.toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. PREFLIGHT CHECKS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('runPreflightChecks', () => {
    it('passes when all checks succeed', async () => {
      const mockDb = await import('@/lib/db')
      ;(mockDb.masterClient.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([{ count: 0n }])

      const result = await runPreflightChecks()
      expect(result.passed).toBe(true)
      expect(result.checks.every(c => c.passed)).toBe(true)
    })

    it('blocks update during active payment', async () => {
      const mockDb = await import('@/lib/db')
      let callCount = 0
      ;(mockDb.masterClient.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve([{ '?column?': 1 }])
        return Promise.resolve([{ count: 3n }])
      })

      const result = await runPreflightChecks()
      expect(result.passed).toBe(false)

      const paymentCheck = result.checks.find(c => c.name === 'no_active_payments')
      expect(paymentCheck).toBeDefined()
      expect(paymentCheck!.passed).toBe(false)
      expect(paymentCheck!.detail).toContain('3 orders in paying state')
    })

    it('blocks when lock file is fresh (not stale)', async () => {
      setupExistsSync({
        ...LEGACY_EXISTS_MAP,
        '.update-lock': true,
      })

      mockStatSync.mockReturnValue({
        mtimeMs: Date.now() - 5 * 60 * 1000, // 5 min old — fresh
      })

      const mockDb = await import('@/lib/db')
      ;(mockDb.masterClient.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([{ count: 0n }])

      const result = await runPreflightChecks()
      expect(result.passed).toBe(false)

      const lockCheck = result.checks.find(c => c.name === 'not_already_updating')
      expect(lockCheck).toBeDefined()
      expect(lockCheck!.passed).toBe(false)
      expect(lockCheck!.detail).toContain('lock file exists')
    })

    it('detects stale lock (>30min) and removes it', async () => {
      // First call existsSync for update-lock => true, but after unlink
      // we need it to return false for the not_already_updating check.
      let lockRemoved = false
      mockExistsSyncImpl.mockImplementation((p: string) => {
        if (p.includes('.update-lock')) {
          return !lockRemoved // true before removal, false after
        }
        if (p.includes('package.json')) return true
        if (p.includes('disk-pressure.json')) return false
        return false
      })

      mockStatSync.mockReturnValue({
        mtimeMs: Date.now() - 45 * 60 * 1000, // 45 min old — stale
      })

      mockUnlinkSync.mockImplementation(() => {
        lockRemoved = true
      })

      const mockDb = await import('@/lib/db')
      ;(mockDb.masterClient.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([{ count: 0n }])

      const result = await runPreflightChecks()

      // Stale lock should have been removed
      expect(mockUnlinkSync).toHaveBeenCalled()
      // After removal, the not_already_updating check should pass
      const lockCheck = result.checks.find(c => c.name === 'not_already_updating')
      expect(lockCheck).toBeDefined()
      expect(lockCheck!.passed).toBe(true)
    })

    it('fails when disk space is critically low', async () => {
      mockExecSync.mockImplementation(buildExecSyncMock({
        'df ': () => '200M',
      }))

      const mockDb = await import('@/lib/db')
      ;(mockDb.masterClient.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([{ count: 0n }])

      const result = await runPreflightChecks()
      expect(result.passed).toBe(false)

      const diskCheck = result.checks.find(c => c.name === 'disk_space')
      expect(diskCheck).toBeDefined()
      expect(diskCheck!.passed).toBe(false)
      expect(diskCheck!.detail).toContain('200MB free')
    })

    it('fails when disk pressure is critical (<4GB)', async () => {
      setupExistsSync({
        ...LEGACY_EXISTS_MAP,
        'disk-pressure.json': true,
      })

      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('disk-pressure.json')) {
          return JSON.stringify({ alert: true, usagePercent: 95, freeGb: 2 })
        }
        if (typeof p === 'string' && p.includes('package.json')) return '{"version":"1.0.50"}'
        return '{}'
      })

      const mockDb = await import('@/lib/db')
      ;(mockDb.masterClient.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([{ count: 0n }])

      const result = await runPreflightChecks()
      expect(result.passed).toBe(false)

      const pressureCheck = result.checks.find(c => c.name === 'disk_pressure')
      expect(pressureCheck).toBeDefined()
      expect(pressureCheck!.passed).toBe(false)
      expect(pressureCheck!.detail).toContain('Insufficient disk space')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. SERVICE RESTORE ON FAILURE (P0 SAFETY NET)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('service restore on failure', () => {
    it('does NOT restart POS when build fails in legacy path — exposes P0 gap', async () => {
      // This test documents the current behavior: when `npm run build` fails
      // in the legacy path, the catch block does NOT call
      // `systemctl start thepasspos`. The service was stopped at L802 but
      // the error handler only cleans the lock file and writes state.
      //
      // The service relies on systemd Restart=on-failure to self-recover.

      const execCalls: string[] = []
      mockExecSync.mockImplementation(buildExecSyncMock({
        'npm run build': () => { throw new Error('Build failed: OOM') },
      }, execCalls))

      const result = await executeUpdate('1.0.51')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Build failed')

      // Verify service was stopped
      const stopCalls = execCalls.filter(c => c.includes('systemctl stop thepasspos'))
      expect(stopCalls.length).toBeGreaterThan(0)

      // Document: the catch block does NOT explicitly restart the service.
      // This is the P0 gap — the service is left stopped after a build failure.
      // systemd Restart=on-failure provides the safety net.
      const startCalls = execCalls.filter(c =>
        c.includes('systemctl start thepasspos') || c.includes('systemctl restart thepasspos')
      )
      expect(startCalls.length).toBe(0)
    })

    it('does not stop service when preflight fails (no service disruption)', async () => {
      const execCalls: string[] = []
      mockExecSync.mockImplementation(buildExecSyncMock({
        'df ': () => '100M', // Too low — preflight will fail
      }, execCalls))

      const mockDb = await import('@/lib/db')
      ;(mockDb.masterClient.$queryRawUnsafe as ReturnType<typeof vi.fn>).mockResolvedValue([{ count: 0n }])

      const result = await executeUpdate('1.0.51')
      expect(result.success).toBe(false)

      const systemctlCalls = execCalls.filter(c => c.includes('systemctl'))
      expect(systemctlCalls.length).toBe(0)
    })

    it('cleans up lock file when update fails', async () => {
      // Git fetch will fail all 3 attempts — use fake timers to skip 5s delays
      mockExecSync.mockImplementation(buildExecSyncMock({
        'git fetch': () => { throw new Error('network error') },
      }))

      // Run executeUpdate (non-blocking for timer advancement)
      const updatePromise = executeUpdate('1.0.51')

      // Advance timers past the 5-second retry delays (2 retries x 5s = 10s)
      await vi.advanceTimersByTimeAsync(15_000)

      const result = await updatePromise
      expect(result.success).toBe(false)

      // Lock file should be cleaned up via unlinkSync
      expect(mockUnlinkSync).toHaveBeenCalled()
    })

    it('resets isUpdating flag even when update throws', async () => {
      mockExecSync.mockImplementation(buildExecSyncMock({
        'git fetch': () => { throw new Error('catastrophic failure') },
      }))

      const updatePromise = executeUpdate('1.0.51')
      await vi.advanceTimersByTimeAsync(15_000)
      await updatePromise

      const status = getUpdateAgentStatus()
      expect(status.isUpdating).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. CONCURRENT UPDATE REJECTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('concurrent update rejection', () => {
    it('resets isUpdating after failed update allowing next update', async () => {
      mockExecSync.mockImplementation(buildExecSyncMock({
        'git fetch': () => { throw new Error('fetch timeout') },
      }))

      // First update — will fail on git fetch after preflight
      const p1 = executeUpdate('1.0.51')
      await vi.advanceTimersByTimeAsync(15_000)
      const result1 = await p1
      expect(result1.success).toBe(false)

      // After failure, isUpdating should be reset (finally block)
      const status = getUpdateAgentStatus()
      expect(status.isUpdating).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. ARTIFACT DEPLOY PATH
  // ═══════════════════════════════════════════════════════════════════════════

  describe('artifact deploy path', () => {
    it('uses deploy-release.sh when available', async () => {
      setupExistsSync({
        ...LEGACY_EXISTS_MAP,
        'deploy-release.sh': true,
      })

      const execCalls: string[] = []
      mockExecSync.mockImplementation(buildExecSyncMock({}, execCalls))

      const result = await executeUpdate('1.0.51')
      expect(result.success).toBe(true)

      // Should have called deploy-release.sh, NOT npm run build
      const deployScriptCalls = execCalls.filter(c => c.includes('deploy-release.sh'))
      expect(deployScriptCalls.length).toBe(1)

      const buildCalls = execCalls.filter(c => c.includes('npm run build'))
      expect(buildCalls.length).toBe(0)
    })

    it('returns failure result when deploy-release.sh fails', async () => {
      setupExistsSync({
        ...LEGACY_EXISTS_MAP,
        'deploy-release.sh': true,
        'deploy-state.json': true,
      })

      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('package.json')) return '{"version":"1.0.50"}'
        if (typeof p === 'string' && p.includes('deploy-state.json')) return '{"state":"rolled_back"}'
        return '{}'
      })

      mockExecSync.mockImplementation(buildExecSyncMock({
        'deploy-release.sh': () => { throw new Error('artifact checksum mismatch') },
      }))

      const result = await executeUpdate('1.0.51')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Artifact deploy failed')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. LEGACY DEPLOY PATH — BUILD FAILURE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('legacy deploy — build failure', () => {
    it('restores .next backup when build fails', async () => {
      setupExistsSync({
        ...LEGACY_EXISTS_MAP,
        '.next': true,
        '.next.backup': true,
      })

      const execCalls: string[] = []
      mockExecSync.mockImplementation(buildExecSyncMock({
        'npm run build': () => { throw new Error('Module not found') },
      }, execCalls))

      const result = await executeUpdate('1.0.51')
      expect(result.success).toBe(false)

      // Verify .next.backup was restored (mv .next.backup .next)
      const mvCalls = execCalls.filter(c => c.includes('mv') && c.includes('.next.backup'))
      expect(mvCalls.length).toBeGreaterThan(0)
    })

    it('writes error state file on failure', async () => {
      mockExecSync.mockImplementation(buildExecSyncMock({
        'git fetch': () => { throw new Error('DNS resolution failed') },
      }))

      const updatePromise = executeUpdate('1.0.51')
      await vi.advanceTimersByTimeAsync(15_000)
      await updatePromise

      // Verify writeFileSync was called with the state file
      const stateWrites = mockWriteFileSync.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('last-update.json')
      )
      expect(stateWrites.length).toBeGreaterThan(0)

      const stateJson = JSON.parse(stateWrites[0][1] as string)
      expect(stateJson.status).toBe('FAILED')
      expect(stateJson.error).toContain('git fetch failed after 3 attempts')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. SUCCESSFUL LEGACY DEPLOY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('legacy deploy — success path', () => {
    it('completes full legacy deploy cycle and returns success', async () => {
      const execCalls: string[] = []
      mockExecSync.mockImplementation(buildExecSyncMock({}, execCalls))

      const result = await executeUpdate('1.0.51')
      expect(result.success).toBe(true)
      expect(result.previousVersion).toBe('1.0.50')
      expect(result.targetVersion).toBe('1.0.51')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)

      // Verify the essential steps were called
      expect(execCalls.some(c => c.includes('git fetch'))).toBe(true)
      expect(execCalls.some(c => c.includes('npm ci'))).toBe(true)
      expect(execCalls.some(c => c.includes('npm run build'))).toBe(true)
    })

    it('stamps version into package.json after successful build', async () => {
      mockExecSync.mockImplementation(buildExecSyncMock())

      await executeUpdate('1.0.51')

      // Find the writeFileSync call that stamps package.json
      const pkgWrites = mockWriteFileSync.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('package.json')
      )
      expect(pkgWrites.length).toBeGreaterThan(0)
      const writtenPkg = JSON.parse(pkgWrites[0][1] as string)
      expect(writtenPkg.version).toBe('1.0.51')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. GIT RETRY LOGIC
  // ═══════════════════════════════════════════════════════════════════════════

  describe('git fetch retry', () => {
    it('retries git fetch up to 3 times before failing', async () => {
      let fetchAttempts = 0
      mockExecSync.mockImplementation(buildExecSyncMock({
        'git fetch': () => {
          fetchAttempts++
          throw new Error(`network timeout attempt ${fetchAttempts}`)
        },
      }))

      const updatePromise = executeUpdate('1.0.51')
      // Advance past the 5s delays between retries
      await vi.advanceTimersByTimeAsync(15_000)
      const result = await updatePromise

      expect(result.success).toBe(false)
      expect(result.error).toContain('git fetch failed after 3 attempts')
      expect(fetchAttempts).toBe(3)
    })

    it('succeeds on second fetch attempt after first failure', async () => {
      let fetchAttempts = 0
      mockExecSync.mockImplementation(buildExecSyncMock({
        'git fetch': () => {
          fetchAttempts++
          if (fetchAttempts === 1) throw new Error('temporary network issue')
          return ''
        },
      }))

      const updatePromise = executeUpdate('1.0.51')
      // Advance past the 5s delay before second attempt
      await vi.advanceTimersByTimeAsync(10_000)
      const result = await updatePromise

      expect(result.success).toBe(true)
      expect(fetchAttempts).toBe(2)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. DEPLOY HEALTH REPORTING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('reportDeployHealth', () => {
    const originalEnv = { ...process.env }

    beforeEach(() => {
      process.env.MISSION_CONTROL_URL = 'https://mc.example.com'
      process.env.SERVER_API_KEY = 'test-api-key'
      process.env.SERVER_NODE_ID = 'test-node-id'
      process.env.HARDWARE_FINGERPRINT = 'test-fingerprint'
    })

    afterEach(() => {
      process.env = { ...originalEnv }
    })

    it('reports success to MC deploy-health endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      global.fetch = mockFetch

      await reportDeployHealth({
        success: true,
        previousVersion: '1.0.50',
        targetVersion: '1.0.51',
        preflightResult: { passed: true, checks: [] },
        durationMs: 5000,
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://mc.example.com/api/fleet/deploy-health',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key',
            'X-Server-Node-Id': 'test-node-id',
            'X-Hardware-Fingerprint': 'test-fingerprint',
          }),
        })
      )

      const bodyString = mockFetch.mock.calls[0][1].body
      const body = JSON.parse(bodyString)
      expect(body.success).toBe(true)
      expect(body.targetVersion).toBe('1.0.51')
    })

    it('reports failure with error message to MC', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      global.fetch = mockFetch

      await reportDeployHealth({
        success: false,
        previousVersion: '1.0.50',
        targetVersion: '1.0.51',
        preflightResult: { passed: true, checks: [] },
        error: 'Build failed: OOM',
        durationMs: 3000,
      })

      const bodyString = mockFetch.mock.calls[0][1].body
      const body = JSON.parse(bodyString)
      expect(body.success).toBe(false)
      expect(body.error).toBe('Build failed: OOM')
    })

    it('silently fails when MC credentials are missing', async () => {
      process.env.MISSION_CONTROL_URL = ''
      const mockFetch = vi.fn()
      global.fetch = mockFetch

      await reportDeployHealth({
        success: true,
        previousVersion: '1.0.50',
        targetVersion: '1.0.51',
        preflightResult: { passed: true, checks: [] },
        durationMs: 5000,
      })

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('does not throw when fetch fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('network error'))

      await expect(
        reportDeployHealth({
          success: true,
          previousVersion: '1.0.50',
          targetVersion: '1.0.51',
          preflightResult: { passed: true, checks: [] },
          durationMs: 5000,
        })
      ).resolves.toBeUndefined()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 11. getCurrentVersion
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getCurrentVersion', () => {
    it('reads version from package.json', () => {
      setupExistsSync({ 'package.json': true })
      mockReadFileSync.mockReturnValue('{"version":"1.0.50"}')
      expect(getCurrentVersion()).toBe('1.0.50')
    })

    it('returns "unknown" when package.json is missing', () => {
      setupExistsSync({ 'package.json': false })
      expect(getCurrentVersion()).toBe('unknown')
    })

    it('returns "unknown" when package.json has no version field', () => {
      setupExistsSync({ 'package.json': true })
      mockReadFileSync.mockReturnValue('{"name":"gwi-pos"}')
      expect(getCurrentVersion()).toBe('unknown')
    })

    it('returns "unknown" on parse error', () => {
      setupExistsSync({ 'package.json': true })
      mockReadFileSync.mockReturnValue('not json')
      expect(getCurrentVersion()).toBe('unknown')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 12. getUpdateAgentStatus
  // ═══════════════════════════════════════════════════════════════════════════

  describe('getUpdateAgentStatus', () => {
    it('reports lock file state correctly', () => {
      setupExistsSync({ 'package.json': true, '.update-lock': true })
      mockReadFileSync.mockReturnValue('{"version":"1.0.50"}')

      const status = getUpdateAgentStatus()
      expect(status.currentVersion).toBe('1.0.50')
      expect(status.lockFileExists).toBe(true)
    })

    it('reports no lock file when absent', () => {
      setupExistsSync({ 'package.json': true, '.update-lock': false })
      mockReadFileSync.mockReturnValue('{"version":"1.0.50"}')

      const status = getUpdateAgentStatus()
      expect(status.lockFileExists).toBe(false)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. GIT SELF-REPAIR
  // ═══════════════════════════════════════════════════════════════════════════

  describe('git self-repair', () => {
    it('removes stale git lock files before fetch', async () => {
      // Override the specific .git lock file paths to return true
      mockExistsSyncImpl.mockImplementation((p: string) => {
        if (p.includes('index.lock')) return true
        if (p.includes('HEAD.lock')) return true
        // Standard paths
        if (p.includes('package.json')) return true
        if (p.includes('deploy-release.sh')) return false
        if (p.includes('.update-lock')) return false
        if (p.includes('disk-pressure.json')) return false
        if (p.includes('MERGE_HEAD')) return false
        if (p.includes('rebase-merge')) return false
        if (p.includes('rebase-apply')) return false
        if (p.includes('CHERRY_PICK_HEAD')) return false
        if (p.includes('.next')) return true
        return false
      })

      const execCalls: string[] = []
      mockExecSync.mockImplementation(buildExecSyncMock({}, execCalls))

      await executeUpdate('1.0.51')

      // unlinkSync should have been called for the stale git lock files
      const unlinkCalls = mockUnlinkSync.mock.calls.map((c: unknown[]) => c[0])
      const gitLockRemovals = unlinkCalls.filter(
        (p: unknown) => typeof p === 'string' && ((p as string).includes('index.lock') || (p as string).includes('HEAD.lock'))
      )
      expect(gitLockRemovals.length).toBeGreaterThan(0)
    })

    it('aborts interrupted merge if MERGE_HEAD exists', async () => {
      // MERGE_HEAD must match before .git/MERGE_HEAD: false in the legacy map
      mockExistsSyncImpl.mockImplementation((p: string) => {
        if (p.includes('MERGE_HEAD')) return true
        if (p.includes('package.json')) return true
        if (p.includes('deploy-release.sh')) return false
        if (p.includes('.update-lock')) return false
        if (p.includes('disk-pressure.json')) return false
        if (p.includes('rebase-merge')) return false
        if (p.includes('rebase-apply')) return false
        if (p.includes('CHERRY_PICK_HEAD')) return false
        if (p.includes('index.lock')) return false
        if (p.includes('.next')) return true
        return false
      })

      const execCalls: string[] = []
      mockExecSync.mockImplementation(buildExecSyncMock({}, execCalls))

      await executeUpdate('1.0.51')

      const mergeAbortCalls = execCalls.filter(c => c.includes('git merge --abort'))
      expect(mergeAbortCalls.length).toBe(1)
    })
  })
})
