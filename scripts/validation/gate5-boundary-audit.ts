/**
 * GATE 5: Architecture Boundary Audit
 *
 * Verifies all enforcement mechanisms are active and counts are frozen.
 *
 * Usage: tsx scripts/validation/gate5-boundary-audit.ts
 */

import { execSync } from 'child_process'

let passed = 0
let failed = 0

function check(name: string, condition: boolean, actual?: string) {
  if (condition) {
    console.log(`✓ ${name}${actual ? ` (${actual})` : ''}`)
    passed++
  } else {
    console.log(`❌ ${name}${actual ? ` (${actual})` : ''}`)
    failed++
  }
}

function exec(cmd: string): string {
  try {
    return execSync(cmd, { cwd: process.cwd(), encoding: 'utf-8' }).trim()
  } catch {
    return ''
  }
}

console.log('=== GATE 5: Architecture Boundary Audit ===\n')

// ESLint rule level
const eslintConfig = exec('cat eslint.config.mjs')
const isError = eslintConfig.includes('"no-restricted-syntax": ["error"')
check('ESLint no-restricted-syntax is ERROR', isError)

// ESLint violations
const violations = exec('npx eslint "src/app/api/**/*.ts" "src/lib/**/*.ts" 2>&1 | grep "no-restricted-syntax" | wc -l').trim()
check('ESLint violations = 0', violations === '0', violations)

// TX-KEEP count
const txKeeps = exec('grep -rn "TX-KEEP" src/app/api/ --include="*.ts" | wc -l').trim()
check('TX-KEEP tags = 48', txKeeps === '48', txKeeps)

// CI workflow
const ciExists = exec('ls .github/workflows/ci.yml 2>/dev/null')
check('CI workflow exists', ciExists.includes('ci.yml'))

// CI has typecheck
const ciContent = exec('cat .github/workflows/ci.yml')
check('CI runs typecheck', ciContent.includes('tsc --noEmit'))
check('CI runs lint', ciContent.includes('npm run lint'))
check('CI checks schema drift', ciContent.includes('Schema drift'))

// Repos
const repoCount = exec('ls src/lib/repositories/*.ts | grep -v index | grep -v base | grep -v bootstrap | wc -l').trim()
check('Model repos >= 10', parseInt(repoCount) >= 10, repoCount)

// Query services
const qsCount = exec('ls src/lib/query-services/*.ts | grep -v index | wc -l').trim()
check('Query services >= 3', parseInt(qsCount) >= 3, qsCount)

// Pino usage
const pinoFiles = exec('grep -rln "createChildLogger" src/ --include="*.ts" | grep -v node_modules | wc -l').trim()
check('Files using pino >= 100', parseInt(pinoFiles) >= 100, pinoFiles)

// Server-side console calls
const consoleCalls = exec('grep -rn "console\\.\\(log\\|warn\\|error\\)" src/lib/ server.ts --include="*.ts" | grep -v node_modules | grep -v "use client" | wc -l').trim()
check('Server-side console calls <= 15', parseInt(consoleCalls) <= 15, consoleCalls)

// Summary
console.log(`\n--- GATE 5 RESULTS ---`)
console.log(`Passed: ${passed}/${passed + failed}, Failed: ${failed}/${passed + failed}`)

if (failed === 0) {
  console.log('\n✅ GATE 5: PASS — All boundaries frozen and enforced')
} else {
  console.log('\n❌ GATE 5: FAIL — Review failed checks')
}
