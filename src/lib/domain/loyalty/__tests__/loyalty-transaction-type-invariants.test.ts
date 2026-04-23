/**
 * LoyaltyTransaction.type taxonomy invariants
 *
 * Q4 (resolved 2026-04-23): the legacy `'adjust'` type has been removed from
 * the supported writer set. T7 replaced inline reversal code with `'reversal'`
 * and T8b uses `'admin_adjustment'`. This test enforces — by static analysis —
 * that no source file under `src/` writes `type: 'adjust'` or `type = 'adjust'`
 * on `LoyaltyTransaction` insert paths.
 *
 * Historical reads of `'adjust'` rows are still permitted (legacy data may
 * exist) — `reverse-earn.ts` queries `type IN ('reversal', 'adjust')` so a
 * legacy reversal won't be re-applied. The admin transaction filter UI may
 * also list `'adjust'` as a filter option for old rows. Only WRITES are
 * forbidden.
 *
 * Pattern follows `src/lib/__tests__/socket-emission-invariants.test.ts`
 * (static-analysis structural invariants).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

const SRC_ROOT = path.resolve(__dirname, '../../../..') // .../src

/** Recursively list every .ts/.tsx file under `dir`, skipping node_modules + generated. */
function walkSrc(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'generated' || entry === '__tests__') continue
    const full = path.join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      walkSrc(full, out)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

// Match writer-style assignments only:
//   type: 'adjust'           (object literal in JS/TS)
//   type: "adjust"
//   "type": "adjust"         (JSON-style)
//   type = 'adjust'
//   "type" = 'adjust'
//
// Deliberately does NOT match read-style usages such as:
//   type IN ('reversal', 'adjust')   (raw SQL filter)
//   value="adjust"                   (UI <option> in transactions filter page)
//   action: 'adjust'                 (gift-card "adjust" action — different model)
const ADJUST_WRITE_PATTERNS: RegExp[] = [
  /["']?type["']?\s*[:=]\s*['"]adjust['"]/,
]

describe('LoyaltyTransaction.type taxonomy (Q4 — no legacy adjust writes)', () => {
  it('no source file under src/ writes type: "adjust" to LoyaltyTransaction', () => {
    const files = walkSrc(SRC_ROOT)
    const offenders: Array<{ file: string; line: number; text: string }> = []

    for (const file of files) {
      // Skip THIS test file (its own pattern strings would self-trigger)
      if (file === __filename) continue

      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.toLowerCase().includes('adjust')) continue
        for (const pat of ADJUST_WRITE_PATTERNS) {
          if (pat.test(line)) {
            offenders.push({
              file: path.relative(SRC_ROOT, file),
              line: i + 1,
              text: line.trim(),
            })
            break
          }
        }
      }
    }

    if (offenders.length > 0) {
      const summary = offenders
        .map((o) => `  - ${o.file}:${o.line}\n      ${o.text}`)
        .join('\n')
      throw new Error(
        `Found ${offenders.length} forbidden LoyaltyTransaction writer(s) using legacy type='adjust':\n` +
          summary +
          '\n\nUse type=\'reversal\' (T7) for refund/void reversals or ' +
          "type='admin_adjustment' (T8b, /api/loyalty/adjust) for manual corrections.",
      )
    }

    expect(offenders).toEqual([])
  })

  it('canonical writer types stay represented somewhere in the codebase', () => {
    // Sanity: the supported types must still be writable from at least one
    // source file. If a future refactor removes them all, this test fires so
    // we can confirm the change was intentional.
    const files = walkSrc(SRC_ROOT)
    const expected = ['earn', 'reversal', 'admin_adjustment']
    const seen = new Set<string>()

    for (const file of files) {
      if (file === __filename) continue
      const content = readFileSync(file, 'utf-8')
      for (const t of expected) {
        // Match either the JS literal forms or a raw-SQL VALUES (..., 'type', ...)
        // by looking for the bare quoted token. False-positives are tolerable
        // here since the test only fails when the token disappears entirely.
        if (content.includes(`'${t}'`) || content.includes(`"${t}"`)) {
          seen.add(t)
        }
      }
    }

    for (const t of expected) {
      expect(seen.has(t), `Expected to find at least one writer for LoyaltyTransaction type '${t}'`).toBe(true)
    }
  })
})
