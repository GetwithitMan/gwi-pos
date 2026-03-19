/**
 * Generate prisma/schema.sql from the current Prisma schema.
 * Output is CLEAN SQL only — no dotenv logs, no Prisma warnings.
 * This file is served as a static asset for MC provisioning.
 */
import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import { createHash } from 'crypto'
import path from 'path'

const raw = execSync(
  'npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script',
  { encoding: 'utf-8', timeout: 30000 }
)

// Strip non-SQL lines (dotenv logs, Prisma warnings)
const sql = raw.split('\n')
  .filter(l => !l.startsWith('[dotenv') && !l.startsWith('Loaded Prisma') && !l.startsWith('Prisma schema'))
  .join('\n')

const outPath = path.join(process.cwd(), 'prisma/schema.sql')
writeFileSync(outPath, sql, 'utf-8')

// Generate SHA-256 hash for version contract verification
const hash = createHash('sha256').update(sql).digest('hex')
console.log(`[generate-schema-sql] ${sql.split('\n').length} lines, sha256: ${hash.substring(0, 16)}...`)

// Write hash to a sidecar file for version contract
writeFileSync(
  path.join(process.cwd(), 'prisma/schema-hash.txt'),
  hash,
  'utf-8'
)
