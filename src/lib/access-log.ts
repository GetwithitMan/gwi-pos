/**
 * GWI Access Log (T-070)
 *
 * Writes access events to a gwi_access_logs table in the Neon DB.
 * Uses the neon serverless driver directly (no Prisma migration needed —
 * the table is created on first use via CREATE TABLE IF NOT EXISTS).
 *
 * Set ACCESS_DATABASE_URL to use a dedicated log DB; falls back to DATABASE_URL.
 */

import { neon } from '@neondatabase/serverless'

function getSql() {
  const url = process.env.ACCESS_DATABASE_URL || process.env.DATABASE_URL
  if (!url) throw new Error('No database URL configured for access log')
  return neon(url)
}

async function ensureTable() {
  const sql = getSql()
  await sql`
    CREATE TABLE IF NOT EXISTS gwi_access_logs (
      id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
      phone_mask  TEXT        NOT NULL,
      ip          TEXT        NOT NULL,
      user_agent  TEXT,
      action      TEXT        NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `
  return sql
}

let tableReady: Promise<void> | null = null
function getTableReady(): Promise<void> {
  if (!tableReady) tableReady = ensureTable().then(() => {})
  return tableReady
}

export type AccessAction = 'code_sent' | 'verified' | 'denied' | 'blocked'

export async function logAccess(
  phone: string,
  ip: string,
  userAgent: string,
  action: AccessAction
): Promise<void> {
  try {
    await getTableReady()
    const sql = getSql()
    await sql`
      INSERT INTO gwi_access_logs (phone_mask, ip, user_agent, action)
      VALUES (${phone}, ${ip}, ${userAgent}, ${action})
    `
  } catch (err) {
    // Non-fatal — log to Vercel logs
    console.error('[gwi-access-log] write failed:', err)
  }
}

export interface AccessLogEntry {
  id: string
  phone_mask: string
  ip: string
  user_agent: string | null
  action: string
  created_at: string
}

export async function getAccessLogs(limit = 100): Promise<AccessLogEntry[]> {
  try {
    await getTableReady()
    const sql = getSql()
    const rows = await sql`
      SELECT id, phone_mask, ip, user_agent, action, created_at
      FROM gwi_access_logs
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
    return rows as AccessLogEntry[]
  } catch (err) {
    console.error('[gwi-access-log] read failed:', err)
    return []
  }
}

export async function getAccessStats(): Promise<{
  totalToday: number
  uniquePhonesToday: number
  verifiedToday: number
}> {
  try {
    await getTableReady()
    const sql = getSql()
    const rows = await sql`
      SELECT
        COUNT(*)                                            AS total_today,
        COUNT(DISTINCT phone_mask)                         AS unique_phones_today,
        COUNT(*) FILTER (WHERE action = 'verified')        AS verified_today
      FROM gwi_access_logs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    `
    const r = rows[0] as Record<string, unknown>
    return {
      totalToday: Number(r.total_today ?? 0),
      uniquePhonesToday: Number(r.unique_phones_today ?? 0),
      verifiedToday: Number(r.verified_today ?? 0),
    }
  } catch {
    return { totalToday: 0, uniquePhonesToday: 0, verifiedToday: 0 }
  }
}
