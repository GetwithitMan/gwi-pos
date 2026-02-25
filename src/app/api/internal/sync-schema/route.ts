import { NextRequest } from 'next/server'
import { venueDbName } from '@/lib/db'
import { neon, Pool } from '@neondatabase/serverless'
import { readFileSync } from 'fs'
import path from 'path'

// Allow up to 60s — schema diff + apply to Neon typically takes 10-30s
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

/**
 * POST /api/internal/sync-schema
 *
 * Pushes the current Prisma schema to a venue's Neon database.
 * Called by Mission Control after deploying a release to a cloud venue.
 *
 * Uses Neon serverless driver (HTTP) to introspect the master DB
 * (source of truth — pushed during vercel-build.js) and apply any
 * missing enums, tables, columns, indexes, and foreign keys to the
 * venue database. This replaces the previous execSync approach which
 * cannot work in Vercel serverless (no Prisma CLI binary at runtime).
 *
 * Headers:
 *   x-api-key: PROVISION_API_KEY (shared secret between MC and POS)
 *
 * Body:
 *   { slug: "fruita-grill" }
 *
 * Response:
 *   { success: true, slug, databaseName, changes: [...] }
 */
export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────
  const apiKey = request.headers.get('x-api-key')
  if (!apiKey || apiKey !== process.env.PROVISION_API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── Validate slug ─────────────────────────────────────────────────────
  const body = await request.json()
  const slug: string = body.slug

  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return Response.json(
      { error: 'Invalid slug. Use lowercase alphanumeric with hyphens.' },
      { status: 400 }
    )
  }

  // ── Build venue database URL ──────────────────────────────────────────
  const masterUrl = process.env.DIRECT_URL || process.env.DATABASE_URL
  if (!masterUrl) {
    return Response.json({ error: 'DATABASE_URL not configured' }, { status: 500 })
  }

  const dbName = venueDbName(slug)
  const venueUrl = replaceDbName(masterUrl, dbName)

  try {
    const changes: string[] = []

    // ── Check if venue DB is empty (fresh provision) ────────────────────
    const venueCheck = new Pool({ connectionString: venueUrl })
    let tableCount: number
    try {
      const res = await venueCheck.query(
        `SELECT COUNT(*)::int as count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
      )
      tableCount = res.rows[0].count
    } finally {
      await venueCheck.end()
    }

    if (tableCount === 0) {
      // Empty database — apply full schema.sql (same approach as provision)
      const schemaSqlText = readFileSync(
        path.join(process.cwd(), 'prisma/schema.sql'),
        'utf-8'
      )
      const pool = new Pool({ connectionString: venueUrl })
      try {
        await pool.query(schemaSqlText)
      } finally {
        await pool.end()
      }
      changes.push('Applied full schema to empty database')
      console.log(`[sync-schema] ${slug}: applied full schema`)
      return Response.json({ success: true, slug, databaseName: dbName, changes })
    }

    // ── Existing database — incremental diff sync ───────────────────────
    const masterPool = new Pool({ connectionString: masterUrl })
    const venuePool = new Pool({ connectionString: venueUrl })

    try {
      // 1. Sync enums
      const enumChanges = await syncEnums(masterPool, venuePool)
      changes.push(...enumChanges)

      // 2. Sync tables (create missing ones from schema.sql)
      const tableChanges = await syncTables(masterPool, venuePool)
      changes.push(...tableChanges)

      // 3. Sync columns (add missing columns to existing tables)
      const columnChanges = await syncColumns(masterPool, venuePool)
      changes.push(...columnChanges)

      // 4. Sync indexes
      const indexChanges = await syncIndexes(masterPool, venuePool)
      changes.push(...indexChanges)

      // 5. Sync foreign keys
      const fkChanges = await syncForeignKeys(masterPool, venuePool)
      changes.push(...fkChanges)
    } finally {
      await Promise.all([masterPool.end(), venuePool.end()])
    }

    console.log(`[sync-schema] ${slug}: ${changes.length} changes applied`)

    return Response.json({
      success: true,
      slug,
      databaseName: dbName,
      changes,
    })
  } catch (error: unknown) {
    const err = error as { message?: string }
    console.error(`[sync-schema] Failed for ${slug}:`, err.message || error)
    return Response.json(
      { error: 'Schema sync failed', details: err.message || 'Unknown error' },
      { status: 500 }
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Sync helpers — all use Pool (standard pg interface, supports raw SQL)
// ═══════════════════════════════════════════════════════════════════════════

async function query(pool: Pool, sql: string): Promise<Row[]> {
  const res = await pool.query(sql)
  return res.rows
}

/** Sync enum types — create missing enums, add missing enum values */
async function syncEnums(masterPool: Pool, venuePool: Pool): Promise<string[]> {
  const changes: string[] = []

  const enumQuery = `
    SELECT t.typname, e.enumlabel
    FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    ORDER BY t.typname, e.enumsortorder
  `

  const [masterEnums, venueEnums] = await Promise.all([
    query(masterPool, enumQuery),
    query(venuePool, enumQuery),
  ])

  const masterMap = groupByKey(masterEnums, 'typname', 'enumlabel')
  const venueMap = groupByKey(venueEnums, 'typname', 'enumlabel')

  for (const [enumName, values] of masterMap) {
    if (!venueMap.has(enumName)) {
      const vals = values.map(v => `'${v}'`).join(', ')
      await venuePool.query(`CREATE TYPE "${enumName}" AS ENUM (${vals})`)
      changes.push(`Created enum ${enumName}`)
    } else {
      const existing = new Set(venueMap.get(enumName)!)
      for (const val of values) {
        if (!existing.has(val)) {
          await venuePool.query(`ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${val}'`)
          changes.push(`Added enum value ${enumName}.${val}`)
        }
      }
    }
  }

  return changes
}

/** Sync tables — create missing tables from schema.sql */
async function syncTables(masterPool: Pool, venuePool: Pool): Promise<string[]> {
  const changes: string[] = []

  const tableQuery = `
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `

  const [masterTables, venueTables] = await Promise.all([
    query(masterPool, tableQuery),
    query(venuePool, tableQuery),
  ])

  const venueTableSet = new Set(venueTables.map(t => t.table_name as string))
  const missingTables = masterTables
    .map(t => t.table_name as string)
    .filter(name => !venueTableSet.has(name))

  if (missingTables.length === 0) return changes

  // Read schema.sql and extract statements for missing tables
  const schemaSqlText = readFileSync(
    path.join(process.cwd(), 'prisma/schema.sql'),
    'utf-8'
  )

  const missingSet = new Set(missingTables)
  const statements = splitStatements(schemaSqlText)

  // Execute DDL for missing tables in order: CREATE TABLE, then indexes, then FKs
  for (const stmt of statements) {
    const createMatch = stmt.match(/^CREATE TABLE "([^"]+)"/)
    if (createMatch && missingSet.has(createMatch[1])) {
      await venuePool.query(stmt)
      changes.push(`Created table ${createMatch[1]}`)
    }
  }

  for (const stmt of statements) {
    const idxMatch = stmt.match(/CREATE (?:UNIQUE )?INDEX[^"]*ON "([^"]+)"/)
    if (idxMatch && missingSet.has(idxMatch[1])) {
      try {
        await venuePool.query(stmt)
      } catch (e: unknown) {
        const msg = (e as { message?: string }).message || ''
        if (!msg.includes('already exists')) throw e
      }
    }
  }

  for (const stmt of statements) {
    const fkMatch = stmt.match(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT/)
    if (fkMatch && missingSet.has(fkMatch[1])) {
      try {
        await venuePool.query(stmt)
      } catch (e: unknown) {
        const msg = (e as { message?: string }).message || ''
        if (!msg.includes('already exists')) throw e
      }
    }
  }

  return changes
}

/** Sync columns — add missing columns to existing tables */
async function syncColumns(masterPool: Pool, venuePool: Pool): Promise<string[]> {
  const changes: string[] = []

  const colQuery = `
    SELECT table_name, column_name, udt_name, is_nullable, column_default,
           character_maximum_length, numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `

  const [masterCols, venueCols, venueTableRows] = await Promise.all([
    query(masterPool, colQuery),
    query(venuePool, `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`),
    query(venuePool, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`),
  ])

  const venueColSet = new Set(venueCols.map(c => `${c.table_name}.${c.column_name}`))
  const venueTableSet = new Set(venueTableRows.map(t => t.table_name as string))

  for (const col of masterCols) {
    const key = `${col.table_name}.${col.column_name}`

    // Skip if column exists or table doesn't exist in venue (handled by syncTables)
    if (venueColSet.has(key) || !venueTableSet.has(col.table_name)) continue

    const pgType = buildPgType(col)
    const nullable = col.is_nullable === 'YES'
    const defaultClause = col.column_default ? ` DEFAULT ${col.column_default}` : ''

    // If NOT NULL with a default, add directly.
    // If NOT NULL without a default, add as nullable (safe for existing rows).
    let ddl = `ALTER TABLE "${col.table_name}" ADD COLUMN IF NOT EXISTS "${col.column_name}" ${pgType}${defaultClause}`
    if (!nullable && col.column_default) {
      ddl += ' NOT NULL'
    }

    await venuePool.query(ddl)
    changes.push(`Added column ${col.table_name}.${col.column_name}`)
  }

  return changes
}

/** Sync indexes — create missing indexes */
async function syncIndexes(masterPool: Pool, venuePool: Pool): Promise<string[]> {
  const changes: string[] = []

  const [masterIndexes, venueIndexes] = await Promise.all([
    query(masterPool, `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`),
    query(venuePool, `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`),
  ])

  const venueIndexSet = new Set(venueIndexes.map(i => i.indexname as string))

  for (const idx of masterIndexes) {
    if (venueIndexSet.has(idx.indexname)) continue

    try {
      let idxDef = idx.indexdef as string
      if (idxDef.startsWith('CREATE UNIQUE INDEX') && !idxDef.includes('IF NOT EXISTS')) {
        idxDef = idxDef.replace('CREATE UNIQUE INDEX', 'CREATE UNIQUE INDEX IF NOT EXISTS')
      } else if (idxDef.startsWith('CREATE INDEX') && !idxDef.includes('IF NOT EXISTS')) {
        idxDef = idxDef.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS')
      }
      await venuePool.query(idxDef)
      changes.push(`Created index ${idx.indexname}`)
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message || ''
      if (!msg.includes('already exists')) {
        console.warn(`[sync-schema] Index ${idx.indexname} failed:`, msg)
      }
    }
  }

  return changes
}

/** Sync foreign keys — add missing FK constraints */
async function syncForeignKeys(masterPool: Pool, venuePool: Pool): Promise<string[]> {
  const changes: string[] = []

  const fkQuery = `
    SELECT
      tc.constraint_name,
      tc.table_name,
      kcu.column_name,
      ccu.table_name AS foreign_table_name,
      ccu.column_name AS foreign_column_name,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
  `

  const [masterFks, venueFks] = await Promise.all([
    query(masterPool, fkQuery),
    query(venuePool, `SELECT constraint_name FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY' AND table_schema = 'public'`),
  ])

  const venueFkSet = new Set(venueFks.map(f => f.constraint_name as string))

  for (const fk of masterFks) {
    if (venueFkSet.has(fk.constraint_name)) continue

    try {
      const onDelete = fk.delete_rule === 'NO ACTION' ? '' : ` ON DELETE ${fk.delete_rule}`
      const onUpdate = fk.update_rule === 'NO ACTION' ? '' : ` ON UPDATE ${fk.update_rule}`
      await venuePool.query(
        `ALTER TABLE "${fk.table_name}" ADD CONSTRAINT "${fk.constraint_name}" ` +
        `FOREIGN KEY ("${fk.column_name}") REFERENCES "${fk.foreign_table_name}"("${fk.foreign_column_name}")${onDelete}${onUpdate}`
      )
      changes.push(`Added FK ${fk.constraint_name}`)
    } catch (e: unknown) {
      const msg = (e as { message?: string }).message || ''
      if (!msg.includes('already exists')) {
        console.warn(`[sync-schema] FK ${fk.constraint_name} failed:`, msg)
      }
    }
  }

  return changes
}

// ═══════════════════════════════════════════════════════════════════════════
// Utility functions
// ═══════════════════════════════════════════════════════════════════════════

/** Map information_schema udt_name to PostgreSQL DDL type */
function buildPgType(col: Row): string {
  switch (col.udt_name) {
    case 'text': return 'TEXT'
    case 'int4': return 'INTEGER'
    case 'int8': return 'BIGINT'
    case 'int2': return 'SMALLINT'
    case 'bool': return 'BOOLEAN'
    case 'float4': return 'REAL'
    case 'float8': return 'DOUBLE PRECISION'
    case 'numeric':
      return `DECIMAL(${col.numeric_precision ?? 65},${col.numeric_scale ?? 30})`
    case 'timestamp':
      return 'TIMESTAMP(3)'
    case 'timestamptz':
      return 'TIMESTAMPTZ(3)'
    case 'jsonb': return 'JSONB'
    case 'json': return 'JSON'
    case 'varchar':
      return col.character_maximum_length
        ? `VARCHAR(${col.character_maximum_length})`
        : 'VARCHAR'
    case 'uuid': return 'UUID'
    case 'bytea': return 'BYTEA'
    default:
      // Custom enum types are stored as their type name
      return `"${col.udt_name}"`
  }
}

/** Split schema.sql into individual statements */
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'))
}

/** Group rows by a key field, collecting values of another field */
function groupByKey(rows: Row[], keyField: string, valueField: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const row of rows) {
    const key = row[keyField]
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(row[valueField])
  }
  return map
}

/** Replace the database name in a PostgreSQL connection URL */
function replaceDbName(url: string, dbName: string): string {
  return url.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)
}
