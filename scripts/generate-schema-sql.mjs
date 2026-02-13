/**
 * Generate prisma/schema.sql from the current Prisma schema.
 *
 * This SQL file is used by the provision endpoint to create tables
 * in new venue databases without needing `prisma db push` (which
 * requires execSync and fails in Vercel serverless).
 *
 * Runs at build time: `node scripts/generate-schema-sql.mjs`
 */
import { execSync } from 'child_process'
import { writeFileSync } from 'fs'
import path from 'path'

const output = execSync(
  'npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script',
  { encoding: 'utf-8', timeout: 30000 }
)

const outPath = path.join(process.cwd(), 'prisma/schema.sql')
writeFileSync(outPath, output, 'utf-8')

const lines = output.split('\n').length
console.log(`[generate-schema-sql] Wrote ${lines} lines to prisma/schema.sql`)
