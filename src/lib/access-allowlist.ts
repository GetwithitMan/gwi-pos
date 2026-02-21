/**
 * GWI Access Allowlist
 *
 * Manages the list of phone numbers allowed to receive SMS OTP codes.
 * Uses the neon serverless driver directly (no Prisma migration needed —
 * the table is created on first use via CREATE TABLE IF NOT EXISTS).
 *
 * Set ACCESS_DATABASE_URL to use a dedicated DB; falls back to DATABASE_URL.
 */

import { neon } from '@neondatabase/serverless'

export interface AllowlistEntry {
  id: string
  name: string
  email: string
  phone: string       // E.164 full number
  notes: string | null
  added_by: string
  created_at: string
}

function getSql() {
  const url = process.env.ACCESS_DATABASE_URL || process.env.DATABASE_URL
  if (!url) throw new Error('No database URL configured for access allowlist')
  return neon(url)
}

async function ensureTable() {
  const sql = getSql()
  await sql`
    CREATE TABLE IF NOT EXISTS gwi_access_allowlist (
      id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      name       TEXT        NOT NULL,
      email      TEXT        NOT NULL,
      phone      TEXT        NOT NULL,
      notes      TEXT,
      added_by   TEXT        NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `
  return sql
}

let tableReady: Promise<void> | null = null
function getTableReady(): Promise<void> {
  if (!tableReady) tableReady = ensureTable().then(() => {})
  return tableReady
}

/** Check if a normalized E.164 phone is on the allowlist */
export async function isPhoneAllowed(phone: string): Promise<boolean> {
  try {
    await getTableReady()
    const sql = getSql()
    const rows = await sql`
      SELECT 1 FROM gwi_access_allowlist WHERE phone = ${phone} LIMIT 1
    `
    return rows.length > 0
  } catch (err) {
    console.error('[gwi-access-allowlist] check failed:', err)
    return false
  }
}

/** Get all entries ordered by created_at DESC */
export async function getAllowlist(): Promise<AllowlistEntry[]> {
  try {
    await getTableReady()
    const sql = getSql()
    const rows = await sql`
      SELECT id, name, email, phone, notes, added_by, created_at
      FROM gwi_access_allowlist
      ORDER BY created_at DESC
    `
    return rows as AllowlistEntry[]
  } catch (err) {
    console.error('[gwi-access-allowlist] read failed:', err)
    return []
  }
}

/** Add a new entry. Returns the created entry. */
export async function addToAllowlist(
  name: string,
  email: string,
  phone: string,
  notes: string | null,
  addedBy: string
): Promise<AllowlistEntry> {
  await getTableReady()
  const sql = getSql()
  const rows = await sql`
    INSERT INTO gwi_access_allowlist (name, email, phone, notes, added_by)
    VALUES (${name}, ${email}, ${phone}, ${notes}, ${addedBy})
    RETURNING id, name, email, phone, notes, added_by, created_at
  `
  return rows[0] as AllowlistEntry
}

/** Remove an entry by id */
export async function removeFromAllowlist(id: string): Promise<void> {
  await getTableReady()
  const sql = getSql()
  await sql`
    DELETE FROM gwi_access_allowlist WHERE id = ${id}
  `
}
