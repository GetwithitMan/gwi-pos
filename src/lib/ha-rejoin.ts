/**
 * HA Rejoin Handler (MC-Arbitrated Failover — Phase 3 NUC-side)
 *
 * Executes the rejoin-as-standby sequence when MC commands a fenced
 * (old primary) NUC to rejoin the cluster as a standby. Only runs
 * on NUCs (never Vercel).
 *
 * Steps:
 *   1. Verify this node is fenced (safety gate)
 *   2. Verify the new primary is reachable
 *   3. Execute rejoin-as-standby.sh --automated --new-primary-ip=IP
 *   4. Read result from /opt/gwi-pos/state/rejoin-result.json
 *   5. Unfence this node on success
 *   6. Report to MC
 *   7. Write result to disk
 *
 * Concurrency guard: only one rejoin can run at a time.
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('ha-rejoin')

// -- Types --------------------------------------------------------------------

export interface RejoinCommand {
  command: 'REJOIN_AS_STANDBY'
  newPrimaryNodeId: string
  newPrimaryIp: string
  venueSlug: string
  fenceCommandId: string
  issuedAt: string
  expiresAt: string
}

export interface RejoinResult {
  status: 'REJOIN_COMPLETE' | 'REJOIN_FAILED' | 'REJOIN_DEGRADED'
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

// -- State --------------------------------------------------------------------

const APP_BASE = process.env.APP_BASE || '/opt/gwi-pos'
const STATE_DIR = join(APP_BASE, 'state')
const RESULT_FILE = join(STATE_DIR, 'rejoin-result.json')
const SCRIPT_PATH = join(APP_BASE, 'scripts', 'rejoin-as-standby.sh')

let _rejoinInProgress = false
let _lastResult: RejoinResult | null = null

// Load last result from disk on module init
try {
  if (existsSync(RESULT_FILE)) {
    _lastResult = JSON.parse(readFileSync(RESULT_FILE, 'utf8'))
  }
} catch {
  // Ignore — file may be corrupted or missing
}

// -- Public API ---------------------------------------------------------------

/**
 * Whether a rejoin is currently executing.
 */
export function isRejoinInProgress(): boolean {
  return _rejoinInProgress
}

/**
 * Get the result of the last rejoin attempt (from memory or disk).
 */
export function getLastRejoinResult(): RejoinResult | null {
  return _lastResult
}

/**
 * Execute the full rejoin sequence.
 * Throws if a rejoin is already in progress.
 */
export async function handleRejoin(command: RejoinCommand): Promise<RejoinResult> {
  if (_rejoinInProgress) {
    throw new Error('Rejoin already in progress')
  }

  // Check command expiration
  if (command.expiresAt && new Date(command.expiresAt) < new Date()) {
    const expired: RejoinResult = {
      status: 'REJOIN_FAILED',
      detail: 'REJOIN_AS_STANDBY command expired before execution',
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

  _rejoinInProgress = true
  const startedAt = new Date().toISOString()
  const steps: StepResult[] = []
  let overallStatus: RejoinResult['status'] = 'REJOIN_COMPLETE'
  let overallDetail = 'Rejoin successful'

  try {
    // -- Step 1: Verify this node is fenced (safety gate) ---------------------
    const step1 = await runStep(1, 'Verify node is fenced', async () => {
      const { isFenced } = await import('./ha-fence')
      if (!isFenced()) {
        throw new Error('Node is NOT fenced — refusing rejoin (safety gate)')
      }
      return 'Node is fenced — safe to proceed with rejoin'
    })
    steps.push(step1)
    if (step1.status === 'fail') {
      overallStatus = 'REJOIN_FAILED'
      overallDetail = step1.detail || 'Node not fenced'
      return buildResult(overallStatus, overallDetail, startedAt, command, steps)
    }

    // -- Step 2: Verify the new primary is reachable --------------------------
    const step2 = await runStep(2, 'Verify new primary reachable', async () => {
      try {
        const resp = await fetch(`http://${command.newPrimaryIp}:3005/api/health`, {
          signal: AbortSignal.timeout(5000),
        })
        if (resp.ok) {
          return `New primary at ${command.newPrimaryIp} is healthy`
        }
        return `New primary returned HTTP ${resp.status} — proceeding anyway`
      } catch {
        throw new Error(`New primary at ${command.newPrimaryIp} is unreachable — cannot rejoin`)
      }
    })
    steps.push(step2)
    if (step2.status === 'fail') {
      overallStatus = 'REJOIN_FAILED'
      overallDetail = step2.detail || 'New primary unreachable'
      return buildResult(overallStatus, overallDetail, startedAt, command, steps)
    }

    // -- Step 3: Execute rejoin via gwi-node (or fallback to shell script) ----
    const step3 = await runStep(3, 'Execute rejoin', async () => {
      // Check known gwi-node locations in priority order
      const gwiNodeCandidates = [
        join(APP_BASE, 'gwi-node.sh'),
        '/usr/local/bin/gwi-node',
      ]
      const gwiNode = gwiNodeCandidates.find(p => existsSync(p)) || null

      // Prefer gwi-node rejoin subcommand (Docker-first appliance model)
      if (gwiNode) {
        try {
          const output = execSync(
            `bash "${gwiNode}" rejoin --new-primary-ip=${command.newPrimaryIp}`,
            {
              timeout: 600_000, // 10 minutes
              encoding: 'utf8',
              stdio: 'pipe',
            }
          )
          return `gwi-node rejoin completed: ${output.slice(-200).trim()}`
        } catch (e) {
          const exitCode = (e as { status?: number }).status ?? 1
          const stderr = (e as { stderr?: string }).stderr ?? ''
          log.warn({ exitCode, stderr: stderr.slice(-200) }, 'gwi-node rejoin failed — falling back to shell script')
        }
      }

      // Fallback: direct shell script execution
      const scriptPath = existsSync(SCRIPT_PATH)
        ? SCRIPT_PATH
        : join(APP_BASE, 'app', 'public', 'rejoin-as-standby.sh')

      if (!existsSync(scriptPath)) {
        throw new Error(`Neither gwi-node rejoin nor rejoin-as-standby.sh available`)
      }

      try {
        const output = execSync(
          `bash "${scriptPath}" --automated --new-primary-ip=${command.newPrimaryIp}`,
          {
            timeout: 600_000, // 10 minutes
            encoding: 'utf8',
            stdio: 'pipe',
          }
        )
        return `Script completed: ${output.slice(-200).trim()}`
      } catch (e) {
        const exitCode = (e as { status?: number }).status ?? 1
        const stderr = (e as { stderr?: string }).stderr ?? ''
        if (exitCode === 1) {
          throw new Error(`Safety check failed (exit 1): ${stderr.slice(-300)}`)
        } else if (exitCode === 2) {
          throw new Error(`pg_basebackup failed (exit 2): ${stderr.slice(-300)}`)
        } else if (exitCode === 3) {
          throw new Error(`Verification failed (exit 3): ${stderr.slice(-300)}`)
        } else {
          throw new Error(`Script failed (exit ${exitCode}): ${stderr.slice(-300)}`)
        }
      }
    })
    steps.push(step3)
    if (step3.status === 'fail') {
      overallStatus = 'REJOIN_FAILED'
      overallDetail = step3.detail || 'rejoin-as-standby.sh failed'
      return buildResult(overallStatus, overallDetail, startedAt, command, steps)
    }

    // -- Step 4: Read result from rejoin-result.json --------------------------
    const step4 = await runStep(4, 'Read rejoin result from disk', async () => {
      const resultPath = join(STATE_DIR, 'rejoin-result.json')
      if (!existsSync(resultPath)) {
        return 'No rejoin-result.json found — script completed without structured output'
      }
      try {
        const raw = JSON.parse(readFileSync(resultPath, 'utf8'))
        if (raw.rejoinStatus === 'completed') {
          return `Rejoin confirmed: WAL status=${raw.walStatus || 'unknown'}, lag=${raw.lagBytes || 'unknown'} bytes`
        }
        if (raw.rejoinStatus === 'failed') {
          throw new Error(`Rejoin result reports failure: ${raw.rejoinError || 'unknown'}`)
        }
        return `Rejoin result: ${JSON.stringify(raw).slice(0, 200)}`
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('Rejoin result reports failure')) {
          throw e
        }
        return 'Could not parse rejoin-result.json — proceeding based on exit code'
      }
    })
    steps.push(step4)
    if (step4.status === 'fail') {
      overallStatus = 'REJOIN_DEGRADED'
      overallDetail = step4.detail || 'Rejoin result check failed'
    }

    // -- Step 5: Unfence this node on success ---------------------------------
    const step5 = await runStep(5, 'Unfence node', async () => {
      const { unfence } = await import('./ha-fence')
      unfence()
      return 'Node unfenced — STATION_ROLE restored'
    })
    steps.push(step5)
    if (step5.status === 'fail') {
      if (overallStatus === 'REJOIN_COMPLETE') {
        overallStatus = 'REJOIN_DEGRADED'
        overallDetail = step5.detail || 'Failed to unfence'
      }
    }

    // -- Step 6: Report to MC -------------------------------------------------
    const step6 = await runStep(6, 'Report to MC', async () => {
      const result = buildResult(overallStatus, overallDetail, startedAt, command, steps)
      await reportToMc(result)
      return 'Reported to MC'
    })
    steps.push(step6)

    // -- Step 7: Write result to disk -----------------------------------------
    const finalResult = buildResult(overallStatus, overallDetail, startedAt, command, steps)
    const step7 = await runStep(7, 'Write result to disk', async () => {
      writeResult(finalResult)
      return `Result written to ${RESULT_FILE}`
    })
    steps.push(step7)

    // Rebuild final result to include step 7
    const completeResult = buildResult(overallStatus, overallDetail, startedAt, command, steps)
    writeResult(completeResult)
    return completeResult
  } catch (e) {
    const errorResult: RejoinResult = {
      status: 'REJOIN_FAILED',
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
    _rejoinInProgress = false
  }
}

// -- Internal Helpers ---------------------------------------------------------

function buildResult(
  status: RejoinResult['status'],
  detail: string,
  startedAt: string,
  command: RejoinCommand,
  steps: StepResult[]
): RejoinResult {
  const result: RejoinResult = {
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

function writeResult(result: RejoinResult): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2))
    _lastResult = result
  } catch (e) {
    log.error({ err: e }, 'Failed to write rejoin result to disk')
  }
}

async function reportToMc(result: RejoinResult): Promise<void> {
  if (!process.env.MISSION_CONTROL_URL && process.env.BACKOFFICE_API_URL) {
    console.warn('[DEPRECATED] Using BACKOFFICE_API_URL — migrate to MISSION_CONTROL_URL')
  }
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
    event: 'rejoin_standby',
    status: result.status,
    detail: result.detail,
    fenceCommandId: result.fenceCommandId,
    venueSlug: result.venueSlug,
    timestamp: result.completedAt,
    steps: result.steps,
  }

  // Try both endpoints: failover-event (primary) and rejoin-result (fallback)
  for (const endpoint of ['/api/fleet/failover-event', '/api/fleet/rejoin-result']) {
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
        log.info({ endpoint, status: result.status }, 'Reported rejoin to MC')
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
  log.error({ err: e }, 'Failed to report rejoin result to MC')
}
