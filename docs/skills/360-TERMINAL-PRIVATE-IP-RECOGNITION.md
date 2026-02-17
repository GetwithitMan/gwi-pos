# Skill 360: Terminal Private IP Recognition (Local Mode Detection)

**Date:** February 17, 2026
**Commit:** `e647eee`
**Domain:** Infrastructure / Multi-Tenancy
**Status:** Complete

---

## Problem

Terminals connecting to the POS server via private IP addresses (e.g., `172.16.1.254`, `192.168.1.100`, `10.0.0.5`) were not recognized as local network connections. The middleware attempted to extract a venue slug from the hostname, failed, and fell through to cloud Neon DB routing instead of using the local database.

### Impact

- Local terminals on the NUC's LAN experienced unnecessary latency (routed to cloud DB instead of local PostgreSQL)
- If the NUC lost internet, terminals on private IPs could not connect at all (cloud DB unreachable)
- Defeated the purpose of the local server architecture (speed + offline capability)

### Root Cause

The middleware's host parsing logic only recognized `localhost` and `127.0.0.1` as local. Any other IP address — including RFC 1918 private ranges — was treated as a potential venue subdomain host and ran through slug extraction.

## Solution

### `isLocalNetworkHost()` Function

Added a new function in `src/middleware.ts` that recognizes all RFC 1918 private address ranges and loopback addresses:

```typescript
function isLocalNetworkHost(host: string): boolean {
  // Strip port if present
  const hostname = host.split(':')[0]

  // IPv4 loopback
  if (hostname === '127.0.0.1' || hostname === 'localhost') return true

  // IPv6 loopback
  if (hostname === '::1') return true

  // RFC 1918 private ranges
  if (hostname.startsWith('10.')) return true
  if (hostname.startsWith('192.168.')) return true

  // 172.16.0.0 - 172.31.255.255
  if (hostname.startsWith('172.')) {
    const secondOctet = parseInt(hostname.split('.')[1], 10)
    if (secondOctet >= 16 && secondOctet <= 31) return true
  }

  return false
}
```

### Middleware Integration

The middleware now calls `isLocalNetworkHost(host)` before attempting venue slug extraction. When a private IP is detected, the middleware skips slug parsing entirely and allows the request to proceed with local DB routing (the default path when no venue slug is set).

```typescript
// In middleware
const host = request.headers.get('host') || ''

if (isLocalNetworkHost(host)) {
  // Local network — skip venue slug extraction, use local DB
  return NextResponse.next()
}

// Cloud — extract venue slug from subdomain
const slug = extractVenueSlug(host)
// ... route to venue-specific Neon DB
```

### Recognized Address Ranges

| Range | CIDR | Description |
|-------|------|-------------|
| `10.0.0.0` - `10.255.255.255` | `10.0.0.0/8` | Class A private |
| `172.16.0.0` - `172.31.255.255` | `172.16.0.0/12` | Class B private |
| `192.168.0.0` - `192.168.255.255` | `192.168.0.0/16` | Class C private |
| `127.0.0.1` | `127.0.0.0/8` | IPv4 loopback |
| `::1` | | IPv6 loopback |
| `localhost` | | Hostname alias |

## Key Files

| File | Changes |
|------|---------|
| `src/middleware.ts` | Added `isLocalNetworkHost()`, integrated into routing logic |

## Verification

1. Access POS from `http://192.168.1.100:3000` — middleware skips slug extraction, uses local DB
2. Access POS from `http://172.16.1.254:3000` — same behavior, local DB routing
3. Access POS from `http://10.0.0.5:3000` — same behavior, local DB routing
4. Access POS from `http://localhost:3000` — still works as before (local)
5. Access POS from `https://venue-slug.ordercontrolcenter.com` — slug extracted correctly, cloud DB routing
6. Access POS from `https://www.barpos.restaurant` — cloud routing unaffected
7. NUC offline test: terminal on `192.168.x.x` connects and operates with zero internet dependency
8. `npx tsc --noEmit` — clean
