/**
 * Pure Environment Parsers — Edge-Safe
 *
 * No node:crypto, no Node.js-only APIs.
 * Used by both system-config.ts (Node) and proxy.ts (Edge).
 *
 * Import in edge runtime: import { parseBool, ... } from '@/lib/env-parse'
 */

export type NodeEnv = 'development' | 'production' | 'test'
export type StationRole = 'primary' | 'backup' | 'fenced' | undefined

export function parseNodeEnv(raw: string | undefined): NodeEnv {
  if (raw === 'production' || raw === 'test') return raw
  return 'development'
}

export function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback
  return raw === 'true' || raw === '1'
}

export function parseStationRole(raw: string | undefined): StationRole {
  if (raw === 'primary' || raw === 'backup' || raw === 'fenced') return raw
  return undefined
}

export function parsePort(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  if (isNaN(n) || n < 1 || n > 65535) return fallback
  return n
}
