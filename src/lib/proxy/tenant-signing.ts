import { NextRequest } from 'next/server'
import { signTenantContext, hashBody } from '@/lib/tenant-context-signer'
import { proxyConfig } from './proxy-config'

/**
 * Sign tenant context JWT and attach to request headers.
 * Only active when TENANT_JWT_ENABLED=true.
 * For mutating methods, hashes the request body for integrity binding.
 */
export async function signAndAttachTenantJwt(
  request: NextRequest,
  headers: Headers,
  venueSlug: string,
  locationId: string,
): Promise<void> {
  if (!proxyConfig.tenantJwtEnabled) return
  if (!proxyConfig.tenantSigningKey) {
    console.warn('[proxy] TENANT_JWT_ENABLED=true but no signing key — skipping JWT')
    return
  }

  const method = request.method
  const path = request.nextUrl.pathname
  let bodySha256: string | undefined

  // Hash body for mutating methods — use clone() to preserve the original
  // body stream for downstream route handlers.
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    try {
      const body = await request.clone().text()
      if (body) {
        bodySha256 = await hashBody(body)
      }
    } catch {
      // Body may not be available — skip hash
    }
  }

  try {
    const jwt = await signTenantContext(
      { venueSlug, locationId: locationId || '', method, path, bodySha256 },
      proxyConfig.tenantSigningKey,
    )
    headers.set('x-tenant-context', jwt)
    // Pass body digest as a trusted internal header so with-venue can verify
    // the JWT's bodySha256 claim without re-reading the request body.
    if (bodySha256) {
      headers.set('x-tenant-body-hash', bodySha256)
    }
  } catch (err) {
    console.error('[proxy] Failed to sign tenant context:', err)
  }
}
