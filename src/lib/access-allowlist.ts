/**
 * GWI Access Allowlist
 *
 * Each approved user gets a permanent personal access code (e.g., A3K9MN).
 * Brian shares codes manually — no SMS, email, or external service required.
 *
 * Table is created/migrated on first use:
 *   CREATE TABLE IF NOT EXISTS   (safe for new installs)
 *   ALTER TABLE ADD COLUMN IF NOT EXISTS access_code  (safe migration for existing tables)
 *
 * Set ACCESS_DATABASE_URL to use a dedicated DB; falls back to DATABASE_URL.
 */

import { neon } from '@neondatabase/serverless'
import { randomBytes } from 'crypto'

export interface AllowlistEntry {
  id: string
  name: string
  email: string
  phone: string         // E.164 full number (e.g. +12125551234)
  access_code: string   // 6-char personal code (e.g. A3K9MN)
  notes: string | null
  added_by: string
  created_at: string
}

// Uppercase alphanumeric with visually confusable chars removed (0/O, 1/I/L)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Generate a fresh 6-character personal access code */
export function generateAccessCode(): string {
  const bytes = randomBytes(6)
  return Array.from(bytes)
    .map((b) => CODE_CHARS[b % CODE_CHARS.length])
    .join('')
}

function getSql() {
  const url = process.env.ACCESS_DATABASE_URL || process.env.DATABASE_URL
  if (!url) throw new Error('No database URL configured for access allowlist')
  return neon(url)
}

async function ensureTable() {
  const sql = getSql()
  // Create table (no-op if it already exists)
  await sql`
    CREATE TABLE IF NOT EXISTS gwi_access_allowlist (
      id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name        TEXT        NOT NULL,
      email       TEXT        NOT NULL,
      phone       TEXT        NOT NULL,
      access_code TEXT        NOT NULL DEFAULT '',
      notes       TEXT,
      added_by    TEXT        NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `
  // Migrate: add access_code column if the table was created before this column existed
  await sql`
    ALTER TABLE gwi_access_allowlist
    ADD COLUMN IF NOT EXISTS access_code TEXT NOT NULL DEFAULT ''
  `
  // Backfill: generate codes for any existing rows that have an empty code
  const blanks = await sql`
    SELECT id FROM gwi_access_allowlist WHERE access_code = '' OR access_code IS NULL
  `
  for (const row of blanks) {
    const code = generateAccessCode()
    await sql`
      UPDATE gwi_access_allowlist SET access_code = ${code} WHERE id = ${row.id as string}
    `
  }
}

let tableReady: Promise<void> | null = null
function getTableReady(): Promise<void> {
  if (!tableReady) tableReady = ensureTable().then(() => {})
  return tableReady
}

/** Check if a normalized E.164 phone is on the allowlist */
export async function isPhoneAllowed(phone: string): Promise<boolean> {
  return (await getEntryByPhone(phone)) !== null
}

/** Check if an email is on the allowlist */
export async function isEmailAllowed(email: string): Promise<boolean> {
  return (await getEntryByEmail(email)) !== null
}

/** Return the allowlist entry for an email, or null if not found */
export async function getEntryByEmail(email: string): Promise<AllowlistEntry | null> {
  try {
    await getTableReady()
    const sql = getSql()
    const rows = await sql`
      SELECT id, name, email, phone, access_code, notes, added_by, created_at
      FROM gwi_access_allowlist WHERE LOWER(email) = ${email.toLowerCase()} LIMIT 1
    `
    return rows.length > 0 ? (rows[0] as AllowlistEntry) : null
  } catch (err) {
    console.error('[gwi-access-allowlist] email check failed:', err)
    return null
  }
}

/** Return the allowlist entry for a phone, or null if not found */
export async function getEntryByPhone(phone: string): Promise<AllowlistEntry | null> {
  try {
    await getTableReady()
    const sql = getSql()
    const rows = await sql`
      SELECT id, name, email, phone, access_code, notes, added_by, created_at
      FROM gwi_access_allowlist WHERE phone = ${phone} LIMIT 1
    `
    return rows.length > 0 ? (rows[0] as AllowlistEntry) : null
  } catch (err) {
    console.error('[gwi-access-allowlist] check failed:', err)
    return null
  }
}

/**
 * Verify a phone + personal access code pair.
 * Comparison is case-insensitive and trims whitespace.
 */
export async function verifyAccessCode(phone: string, code: string): Promise<boolean> {
  const entry = await getEntryByPhone(phone)
  if (!entry || !entry.access_code) return false
  return entry.access_code.toUpperCase() === code.trim().toUpperCase()
}

/** Get all entries ordered by created_at DESC */
export async function getAllowlist(): Promise<AllowlistEntry[]> {
  try {
    await getTableReady()
    const sql = getSql()
    const rows = await sql`
      SELECT id, name, email, phone, access_code, notes, added_by, created_at
      FROM gwi_access_allowlist
      ORDER BY created_at DESC
    `
    return rows as AllowlistEntry[]
  } catch (err) {
    console.error('[gwi-access-allowlist] read failed:', err)
    return []
  }
}

/** Add a new entry. Generates a personal access code automatically. */
export async function addToAllowlist(
  name: string,
  email: string,
  phone: string,
  notes: string | null,
  addedBy: string
): Promise<AllowlistEntry> {
  await getTableReady()
  const sql = getSql()
  const accessCode = generateAccessCode()
  const rows = await sql`
    INSERT INTO gwi_access_allowlist (name, email, phone, access_code, notes, added_by)
    VALUES (${name}, ${email}, ${phone}, ${accessCode}, ${notes}, ${addedBy})
    RETURNING id, name, email, phone, access_code, notes, added_by, created_at
  `
  return rows[0] as AllowlistEntry
}

/** Regenerate the access code for an existing entry. Returns the new code. */
export async function regenerateAccessCode(id: string): Promise<string> {
  await getTableReady()
  const sql = getSql()
  const code = generateAccessCode()
  await sql`UPDATE gwi_access_allowlist SET access_code = ${code} WHERE id = ${id}`
  return code
}

/** Remove an entry by id */
export async function removeFromAllowlist(id: string): Promise<void> {
  await getTableReady()
  const sql = getSql()
  await sql`DELETE FROM gwi_access_allowlist WHERE id = ${id}`
}
