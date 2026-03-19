/**
 * Generate version contract from migration state.
 * Runs at build time alongside generate-schema-sql.mjs.
 * Output is git-committed and consumed by both POS and MC.
 */
import { readdirSync, writeFileSync } from 'fs'
import path from 'path'

const migrationsDir = path.join(process.cwd(), 'scripts/migrations')
const outPath = path.join(process.cwd(), 'src/generated/version-contract.json')

// Scan for highest NNN prefix
const files = readdirSync(migrationsDir).filter(f => /^\d{3}-/.test(f))
const versions = files.map(f => f.match(/^(\d{3})/)?.[1]).filter(Boolean).sort()
const schemaVersion = versions[versions.length - 1] || '000'

const contract = {
  schemaVersion,
  seedVersion: 'v1',
  provisionerVersion: '1',
  migrationCount: files.length,
  generatedAt: new Date().toISOString(),
}

writeFileSync(outPath, JSON.stringify(contract, null, 2) + '\n', 'utf-8')
console.log(`[generate-version-contract] Schema version: ${schemaVersion}, ${files.length} migrations`)
