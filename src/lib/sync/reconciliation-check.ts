/**
 * Reconciliation Check — Lightweight Drift Detection
 *
 * Compares row COUNTs per sync model between local PG and Neon.
 * Reports models where the count difference exceeds a threshold.
 *
 * Called periodically by the downstream sync worker (every ~5 minutes).
 * Results are exposed via the /api/health/sync endpoint for MC consumption.
 */

import { createChildLogger } from '@/lib/logger'
import { masterClient } from '../db'
import { neonClient, hasNeonConnection } from '../neon-client'
import { getDownstreamModels, getUpstreamModels } from './sync-config'

const log = createChildLogger('reconciliation')

export interface DriftedModel {
  model: string
  localCount: number
  neonCount: number
  diffPercent: number
  direction: 'local_ahead' | 'neon_ahead'
}

export interface ReconciliationResult {
  checkedAt: Date
  modelsChecked: number
  driftedModels: DriftedModel[]
  error: string | null
}

/** Minimum row count in either DB before drift percentage is meaningful */
const MIN_COUNT_FOR_DRIFT = 5

/** Default drift threshold — report when difference exceeds this percentage */
const DRIFT_THRESHOLD_PERCENT = parseFloat(process.env.RECONCILIATION_DRIFT_THRESHOLD || '5')

// ── Module-level cached result ──────────────────────────────────────────────

let _lastResult: ReconciliationResult | null = null

/** Returns the most recent reconciliation result, or null if not yet run. */
export function getReconciliationResult(): ReconciliationResult | null {
  return _lastResult
}

/**
 * Run a lightweight reconciliation check.
 *
 * For each synced model, compares COUNT(*) in local PG vs COUNT(*) in Neon.
 * Only reports models where the difference exceeds the threshold.
 *
 * This is intentionally simple — just COUNTs, no row-level comparison.
 * The goal is detecting drift, not fixing it.
 */
export async function runReconciliationCheck(): Promise<ReconciliationResult> {
  if (!hasNeonConnection() || !neonClient) {
    const result: ReconciliationResult = {
      checkedAt: new Date(),
      modelsChecked: 0,
      driftedModels: [],
      error: 'No Neon connection',
    }
    _lastResult = result
    return result
  }

  const driftedModels: DriftedModel[] = []
  let modelsChecked = 0

  try {
    // Quick connectivity check — bail early if Neon is unreachable
    try {
      await neonClient.$queryRawUnsafe<unknown[]>(`SELECT 1`)
    } catch {
      const result: ReconciliationResult = {
        checkedAt: new Date(),
        modelsChecked: 0,
        driftedModels: [],
        error: 'Neon unreachable',
      }
      _lastResult = result
      return result
    }

    // Collect all unique model names from both directions
    const downstreamModels = getDownstreamModels()
    const upstreamModels = getUpstreamModels()
    const allModels = new Map<string, true>()
    for (const [name] of downstreamModels) allModels.set(name, true)
    for (const [name] of upstreamModels) allModels.set(name, true)

    // Check each model in parallel batches of 5
    const modelNames = Array.from(allModels.keys())
    for (let i = 0; i < modelNames.length; i += 5) {
      const batch = modelNames.slice(i, i + 5)
      const results = await Promise.allSettled(
        batch.map(async (tableName) => {
          try {
            const [localResult] = await masterClient.$queryRawUnsafe<[{ count: bigint }]>(
              `SELECT COUNT(*) as count FROM "${tableName}" WHERE "deletedAt" IS NULL`
            )
            const [neonResult] = await neonClient!.$queryRawUnsafe<[{ count: bigint }]>(
              `SELECT COUNT(*) as count FROM "${tableName}" WHERE "deletedAt" IS NULL`
            )

            const localCount = Number(localResult.count)
            const neonCount = Number(neonResult.count)
            modelsChecked++

            // Skip drift calculation for very small tables
            const maxCount = Math.max(localCount, neonCount)
            if (maxCount < MIN_COUNT_FOR_DRIFT) return

            const diff = Math.abs(localCount - neonCount)
            const diffPercent = maxCount > 0 ? (diff / maxCount) * 100 : 0

            if (diffPercent > DRIFT_THRESHOLD_PERCENT) {
              driftedModels.push({
                model: tableName,
                localCount,
                neonCount,
                diffPercent: Math.round(diffPercent * 10) / 10,
                direction: localCount > neonCount ? 'local_ahead' : 'neon_ahead',
              })
            }
          } catch {
            // Table may not exist on one side, or lack deletedAt — try without filter
            try {
              const [localResult] = await masterClient.$queryRawUnsafe<[{ count: bigint }]>(
                `SELECT COUNT(*) as count FROM "${tableName}"`
              )
              const [neonResult] = await neonClient!.$queryRawUnsafe<[{ count: bigint }]>(
                `SELECT COUNT(*) as count FROM "${tableName}"`
              )

              const localCount = Number(localResult.count)
              const neonCount = Number(neonResult.count)
              modelsChecked++

              const maxCount = Math.max(localCount, neonCount)
              if (maxCount < MIN_COUNT_FOR_DRIFT) return

              const diff = Math.abs(localCount - neonCount)
              const diffPercent = maxCount > 0 ? (diff / maxCount) * 100 : 0

              if (diffPercent > DRIFT_THRESHOLD_PERCENT) {
                driftedModels.push({
                  model: tableName,
                  localCount,
                  neonCount,
                  diffPercent: Math.round(diffPercent * 10) / 10,
                  direction: localCount > neonCount ? 'local_ahead' : 'neon_ahead',
                })
              }
            } catch {
              // Table doesn't exist on one or both sides — skip silently
            }
          }
        })
      )

      // Count any rejected promises as errors but don't fail the whole check
      for (const r of results) {
        if (r.status === 'rejected') {
          log.warn({ err: r.reason }, 'Model reconciliation batch error')
        }
      }
    }

    if (driftedModels.length > 0) {
      log.warn(
        { driftedCount: driftedModels.length, models: driftedModels.map(d => d.model) },
        'Sync drift detected'
      )
    }

    const result: ReconciliationResult = {
      checkedAt: new Date(),
      modelsChecked,
      driftedModels,
      error: null,
    }
    _lastResult = result
    return result
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    log.error({ err }, 'Reconciliation check failed')

    const result: ReconciliationResult = {
      checkedAt: new Date(),
      modelsChecked,
      driftedModels,
      error: errorMsg,
    }
    _lastResult = result
    return result
  }
}
