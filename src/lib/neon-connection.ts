/**
 * Shared Neon Connection Helper
 *
 * Single source of truth for all Neon PG connections on the NUC.
 * Provides consistent timeout, SSL handling, and classified error logging.
 *
 * Usage:
 *   import { createNeonClient, classifyConnectionError } from '@/lib/neon-connection'
 *   const client = await createNeonClient()
 *   // ... use client
 *   await client.end()
 */

import { Client, type ClientConfig } from 'pg'
import { createChildLogger } from '@/lib/logger'

const log = createChildLogger('neon-connection')

/** Connection timeout for all Neon connections (60s — Neon cold start can take 3-5s) */
const NEON_CONNECTION_TIMEOUT_MS = 60_000

/** Query timeout (30s — prevents hung queries from blocking boot) */
const NEON_QUERY_TIMEOUT_MS = 30_000

/** Error classification for operational diagnostics */
export type NeonErrorClass =
  | 'dns_failure'
  | 'tcp_timeout'
  | 'tls_failure'
  | 'auth_failure'
  | 'query_timeout'
  | 'connection_refused'
  | 'neon_cold_start'
  | 'unknown'

/**
 * Classify a connection error into an operational category.
 * Distinguishes DNS, TCP, TLS, auth, and timeout failures.
 */
export function classifyConnectionError(err: unknown): { class: NeonErrorClass; message: string } {
  const msg = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string })?.code

  if (code === 'ENOTFOUND' || msg.includes('getaddrinfo')) {
    return { class: 'dns_failure', message: `DNS resolution failed: ${msg}` }
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || msg.includes('timeout') || msg.includes('timed out')) {
    return { class: 'tcp_timeout', message: `Connection timed out: ${msg}` }
  }
  if (code === 'ECONNREFUSED' || msg.includes('Connection refused')) {
    return { class: 'connection_refused', message: `Connection refused: ${msg}` }
  }
  if (msg.includes('SSL') || msg.includes('TLS') || msg.includes('certificate') || msg.includes('self signed')) {
    return { class: 'tls_failure', message: `TLS/SSL error: ${msg}` }
  }
  if (msg.includes('password authentication failed') || msg.includes('no pg_hba.conf entry') || code === '28P01') {
    return { class: 'auth_failure', message: `Authentication failed: ${msg}` }
  }
  if (msg.includes('canceling statement due to statement timeout') || msg.includes('query_wait_timeout')) {
    return { class: 'query_timeout', message: `Query timed out: ${msg}` }
  }
  if (msg.includes('endpoint is disabled') || msg.includes('compute is not ready')) {
    return { class: 'neon_cold_start', message: `Neon compute starting: ${msg}` }
  }
  return { class: 'unknown', message: msg }
}

/**
 * Get the Neon connection URL from environment.
 * Prefers NEON_DIRECT_URL for non-pooled operations, falls back to NEON_DATABASE_URL.
 */
export function getNeonUrl(preferDirect = false): string | null {
  if (preferDirect && process.env.NEON_DIRECT_URL) {
    return process.env.NEON_DIRECT_URL
  }
  return process.env.NEON_DATABASE_URL || process.env.NEON_DIRECT_URL || null
}

/**
 * Create a connected pg.Client for Neon with proper timeout and SSL.
 * Throws with a classified error if connection fails.
 */
export async function createNeonClient(opts?: {
  /** Override connection URL (default: from env) */
  connectionString?: string
  /** Use direct URL instead of pooler (default: false) */
  preferDirect?: boolean
  /** Connection timeout in ms (default: 60000) */
  connectionTimeoutMillis?: number
  /** Query timeout in ms (default: 30000) */
  statementTimeoutMillis?: number
}): Promise<Client> {
  const url = opts?.connectionString || getNeonUrl(opts?.preferDirect ?? false)
  if (!url) {
    throw new Error('No Neon connection URL available (NEON_DATABASE_URL / NEON_DIRECT_URL not set)')
  }

  const config: ClientConfig = {
    connectionString: url,
    connectionTimeoutMillis: opts?.connectionTimeoutMillis ?? NEON_CONNECTION_TIMEOUT_MS,
    statement_timeout: opts?.statementTimeoutMillis ?? NEON_QUERY_TIMEOUT_MS,
  }

  // Neon requires SSL. Ensure it's enabled for neon.tech URLs.
  if (url.includes('neon.tech')) {
    config.ssl = { rejectUnauthorized: false }
  }

  const client = new Client(config)

  try {
    await client.connect()
    return client
  } catch (err) {
    const classified = classifyConnectionError(err)
    log.error({
      errorClass: classified.class,
      url: url.replace(/:[^@]+@/, ':***@'), // mask password
    }, `Neon connection failed: ${classified.message}`)

    // Clean up on failure
    try { await client.end() } catch { /* already failed */ }

    throw Object.assign(new Error(`Neon ${classified.class}: ${classified.message}`), {
      errorClass: classified.class,
      originalError: err,
    })
  }
}

/**
 * Run a single query against Neon with a fresh connection.
 * Connects, runs query, disconnects. For one-off checks.
 */
export async function queryNeon<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
  opts?: Parameters<typeof createNeonClient>[0]
): Promise<T[]> {
  const client = await createNeonClient(opts)
  try {
    const result = await client.query(sql, params)
    return result.rows as T[]
  } finally {
    await client.end()
  }
}
