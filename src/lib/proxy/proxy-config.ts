import { parseBool, parseStationRole, parseNodeEnv } from '@/lib/env-parse'

// ── Edge-safe proxy config ──────────────────────────────────────────────
// All env reads consolidated here. Uses shared parsers from env-parse.ts.
// No direct process.env reads anywhere else in proxy code.
export const proxyConfig = {
  gwiAccessSecret: process.env.GWI_ACCESS_SECRET ?? '',
  tenantJwtEnabled: parseBool(process.env.TENANT_JWT_ENABLED, false),
  tenantSigningKey: process.env.TENANT_SIGNING_KEY || '',
  missionControlUrl: process.env.MISSION_CONTROL_URL || 'https://app.thepasspos.com',
  provisionApiKey: process.env.PROVISION_API_KEY || '',
  isNucStation: !!process.env.STATION_ROLE,
  stationRole: parseStationRole(process.env.STATION_ROLE),
  nodeEnv: parseNodeEnv(process.env.NODE_ENV),
} as const

// Fail-fast: PROVISION_API_KEY is required in production cloud deployments.
// NUC stations use PIN-based auth and never serve cloud subdomain requests.
if (!proxyConfig.provisionApiKey && proxyConfig.nodeEnv === 'production' && !proxyConfig.isNucStation) {
  throw new Error('[Startup] PROVISION_API_KEY environment variable is required in production')
}
