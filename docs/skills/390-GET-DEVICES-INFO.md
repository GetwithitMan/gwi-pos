# Skill 390 — GetDevicesInfo (UDP Device Discovery)

**Domain:** Payments / Hardware
**Date:** 2026-02-20
**Commit:** e46d997
**Datacap Cert Test:** 1.0

---

## Overview

Discovers Datacap payment readers on the local network via UDP broadcast on port 9001. Two modes: scan all devices on the network, or find a specific reader by serial number.

---

## API Routes

### `GET /api/datacap/discover` — Scan All Readers

Broadcasts to the entire local subnet and collects all Datacap reader responses within a time window.

```
GET /api/datacap/discover?timeoutMs=5000
```

Response:
```json
{
  "data": {
    "devices": [
      { "serialNumber": "PAX-123456", "ipAddress": "192.168.1.50", "port": 8080 },
      { "serialNumber": "PAX-789012", "ipAddress": "192.168.1.51", "port": 8080 }
    ],
    "count": 2,
    "discoveryTimeoutMs": 5000
  }
}
```

- `timeoutMs` capped at 15000ms (default 5000ms)
- Deduplicates by serial number — each reader appears once

### `POST /api/datacap/discover` — Find by Serial Number

Discovers the IP address of a specific reader by serial number.

```json
{ "serialNumber": "PAX-123456" }
```

Response:
```json
{
  "data": {
    "found": true,
    "device": { "serialNumber": "PAX-123456", "ipAddress": "192.168.1.50", "port": 8080 }
  }
}
```

---

## UDP Protocol

- **Port:** 9001 (Datacap discovery port)
- **Broadcast:** `255.255.255.255`
- **Request (all):** `"Who has"` — any reader responds
- **Request (specific):** `"Who has PAX-123456"` — only that reader responds
- **Response format:** `"PAX-123456 is at: 192.168.1.50"`

---

## Library Functions

```typescript
import { discoverDevice, discoverAllDevices } from '@/lib/datacap/discovery'

// Find all readers on the network
const devices = await discoverAllDevices(5000)  // 5s window

// Find specific reader by serial
const device = await discoverDevice('PAX-123456')  // up to 15s (30 retries)
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No readers on network | Empty array / `found: false` |
| Multiple readers same SN | Deduplicated — first response wins |
| UDP not available (browser) | Returns empty array (dgram is Node.js only) |
| Reader on different subnet | Won't respond — UDP broadcast is subnet-local |
