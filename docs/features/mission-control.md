# Feature: Mission Control

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Cloud fleet management platform for GWI POS. **MC is the sole schema and provisioning authority** for all venues. It handles schema versioning (`_venue_schema_state`), venue provisioning, release channel management, NUC server registration, heartbeat monitoring, license validation, remote command execution (50+ command types), and secure credential delivery. HMAC-SHA256 for fleet API auth, AES-256-GCM for sensitive config at rest, RSA-OAEP for key exchange during registration. Separate repo (`gwi-mission-control`).

MC owns the full lifecycle: provisioning a venue, assigning its Neon database, managing schema migrations via release channels, and rolling out updates. The NUC defers to MC for all provisioning and schema decisions — it never writes `_venue_schema_state` or mutates Neon schema directly. See `docs/architecture/LOCAL-CORE-CELLULAR-EDGE-HA.md` for the full authority model.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | License enforcement, terminal pairing, heartbeat endpoints | Partial |
| `gwi-android-register` | Native heartbeat (30s), device pairing | Partial |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | Cloud event ingestion | Partial |
| `gwi-mission-control` | Fleet API, admin console, sync agent, provisioning | Full |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Mission Control | `/dashboard` (fleet monitoring) | GWI admins |
| Mission Control | `/locations/[id]` (location detail) | GWI admins, venue owners |
| POS Web | Terminal status indicators | All staff |

---

## Code Locations

### gwi-pos (integration points)
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/license-enforcement.ts` | Device limit checks against sync-agent status API |
| `src/app/api/hardware/terminals/heartbeat-native/route.ts` | Native heartbeat endpoint |
| `src/app/api/hardware/terminals/heartbeat/route.ts` | Web terminal heartbeat |
| `src/app/api/hardware/terminals/pair-native/route.ts` | Native device pairing |

### gwi-mission-control
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/fleet/register/route.ts` | One-time server registration (key exchange) |
| `src/app/api/fleet/heartbeat/route.ts` | 60-second health heartbeat + metrics |
| `src/app/api/fleet/license/validate/route.ts` | License validation + grace period logic |
| `src/app/api/fleet/commands/stream/route.ts` | SSE command delivery |
| `src/app/api/fleet/commands/[id]/ack/route.ts` | Command acknowledgment |
| `src/app/api/admin/locations/[id]/payment-config/route.ts` | Datacap credential management |
| `src/lib/hmac.ts` | HMAC-SHA256 signing/verification |
| `src/lib/crypto.ts` | AES-256-GCM encryption, RSA, key generation |
| `sync-agent/src/` | Docker sidecar (heartbeat, license, SSE, command execution) |

---

## API Endpoints (Fleet — HMAC-Authenticated)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/fleet/register` | Registration token | One-time server registration |
| `POST` | `/fleet/heartbeat` | HMAC | 60-second health heartbeat |
| `POST` | `/fleet/license/validate` | HMAC | License validation with caching |
| `GET` | `/fleet/commands/stream` | HMAC | SSE command delivery |
| `POST` | `/fleet/commands/[id]/ack` | HMAC | Command acknowledgment |
| `GET` | `/fleet/sync/settings` | HMAC | Download location settings |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `terminal:status_changed` | `{ terminalId, isOnline, lastSeenAt, source }` | Heartbeat, socket connect/disconnect |

---

## Data Model (gwi-mission-control schema)

```
ServerNode {
  id                    String
  serverApiKey          String            // unique, HMAC signing key
  hardwareFingerprint   String            // SHA-256 of CPU/disk/MAC
  publicKey             String            // RSA-2048 public key
  status                Enum              // REGISTERED | ONLINE | DEGRADED | OFFLINE | DECOMMISSIONED
  isKilled              Boolean           // kill switch
  targetVersion         String?           // desired POS version
}

CloudLocation {
  id                    String
  licenseKey            String
  licenseStatus         Enum              // ACTIVE | GRACE_PERIOD | SUSPENDED | KILLED | CANCELLED
  licenseExpiresAt      DateTime?
  paymentConfig         String            // AES-256-GCM encrypted Datacap credentials
  subscriptionLimits    Json              // hardware limits by tier
}

FleetCommand {
  id                    String
  commandType           String            // 50+ types (FORCE_SYNC, KILL_SWITCH, etc.)
  priority              Enum              // NORMAL | HIGH | CRITICAL
  status                Enum              // PENDING | DELIVERED | ACKNOWLEDGED | COMPLETED | FAILED | EXPIRED
  payload               Json
}
```

---

## Business Logic

### Schema & Provisioning Authority (MC-Only)

MC is the **sole authority** for the following. No other system (NUC, installer, sync worker) may perform these actions:

| Authority | MC Owns | NUC/Installer NEVER |
|-----------|---------|---------------------|
| Schema version | `_venue_schema_state` table — tracks migration state per venue | Writes `_venue_schema_state` |
| Schema migration | Rollout via release channels (dev → canary → production) | Uses `--accept-data-loss` or pushes schema to Neon |
| Venue provisioning | Creates CloudLocation, assigns Neon DB, generates registration token | Self-provisions or re-provisions |
| Release management | Sets `targetVersion` per venue, health-gated rollout | Auto-updates without MC approval |
| Device approval | Cellular device lifecycle (PENDING → APPROVED → ACTIVE → REVOKED) | Approves its own cellular devices |

The installer is **pointer-only**: it receives venue identity + Neon URL from MC registration, symlinks `.env.local` → `/opt/gwi-pos/.env`, and never hardcodes URLs or asserts schema authority. Schema updates flow automatically via MC rollout → Neon → NUC downstream sync.

See `docs/architecture/LOCAL-CORE-CELLULAR-EDGE-HA.md` for the full dual-ingress architecture and authority model.

### Registration Flow
1. Admin creates location in Mission Control, generates registration token (24h expiry)
2. Admin runs `./provision.sh` on NUC, provides token
3. NUC calls `POST /api/fleet/register` with token + hardware fingerprint + RSA public key
4. Cloud returns RSA-encrypted: `serverApiKey`, database URLs, deploy token
5. NUC decrypts with private key, stores credentials in env vars
6. Sync agent starts with config

### License Validation
- Sync agent validates license every 60 seconds
- Cloud returns HMAC-signed response (tamper-proof local caching)
- Grace period: 14 days after past-due/expired
- Kill switch: immediate KILLED status (no grace)
- POS reads license from sync agent: `http://localhost:8081/status`
- **Fail-open**: if sync agent unavailable, POS continues normally

### Security Model
| Threat | Protection |
|--------|------------|
| Stolen disk | Hardware fingerprint binding + unique RSA keys |
| MITM | HTTPS + HMAC-SHA256 body signature + timing-safe comparison |
| API key compromise | Per-server unique key + rotatable via REVOKE_CREDENTIAL |
| License tampering | HMAC-signed cache + cloud-generated secret |
| Payment credential theft | AES-256-GCM at rest + RSA-encrypted in transit |

### Hardware Limits (by Tier)
| Tier | POS Terminals | Handhelds | KDS Screens | Printers | Payment Readers |
|------|--------------|-----------|-------------|----------|-----------------|
| STARTER | 2 | 0 | 2 | 2 | 1 |
| PRO | 8 | 4 | 4 | 6 | 4 |
| ENTERPRISE | 999 | 999 | 999 | 999 | 999 |

MC syncs tier-appropriate limits to POS `LocationSettings.hardwareLimits` during fleet heartbeat. POS enforces these limits at 4 device creation/pairing endpoints via `checkDeviceLimit()` in `src/lib/device-limits.ts`. When a venue exceeds its tier cap, the API returns 403 `DEVICE_LIMIT_EXCEEDED` with an upgrade message. See `docs/features/hardware.md` for enforcement details.

### Cellular Device Management (Venue-Side)
Cellular device viewing and revocation is now available from the venue admin at `/settings/hardware/cellular` — venue managers no longer need Mission Control access to see connected cellular devices or revoke them. MC remains the authority for initial device approval/deny via the CellularDevice lifecycle, but day-to-day session monitoring and revocation is handled venue-side.

### Cloud Relay (NUC → Cloud WebSocket)

A persistent outbound WebSocket from each NUC to the cloud relay enables real-time bidirectional communication without the NUC needing a public IP.

- **Env var:** `CLOUD_RELAY_URL` on the NUC — points to the cloud relay WebSocket endpoint
- **Auth:** `SERVER_API_KEY` header on connection handshake
- **NUC → Cloud events:** `SYNC_SUMMARY` (per upstream cycle), `BUSINESS_EVENT`, `HEALTH`, `OUTAGE_DEAD_LETTER`
- **Cloud → NUC events:** `DATA_CHANGED` (triggers immediate downstream sync), `CONFIG_UPDATED` (settings push), `COMMAND` (fleet commands)
- MC receives these events in real time for live dashboard updates (sync status, venue health, outage alerting)
- **Resilience:** Auto-reconnect with exponential backoff (1s–30s), 60s heartbeat. Safety switch: 5 consecutive failures → falls back to 2s polling. Relay is an acceleration layer — all durability remains in DB-backed sync workers.

**Key file (NUC side):** `src/lib/cloud-relay-client.ts`

### Edge Cases & Business Rules
- HMAC-SHA256 for ALL fleet API calls (6-header auth model)
- AES-256-GCM for sensitive config (payment keys) — NEVER store in plain text
- Hardware fingerprint binding prevents cloned disks from registering
- NUC self-registers via `POST /api/fleet/register` (one-time)
- Heartbeat every 60 seconds from sync agent
- Payment config hash verified on every heartbeat (auto-push on mismatch)
- POS never calls Mission Control directly — sync agent is the only cloud client

---

## Cross-Feature Dependencies

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Settings | Pushes config from cloud |
| Payments | Delivers Datacap credentials |
| Hardware | Subscription tier limits synced to POS `HardwareLimitsSettings` via heartbeat |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Settings | Config pushed from cloud to NUC |
| Employees | License limits affect max employees |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Security** — HMAC/AES/RSA implementations
- [ ] **Offline** — POS must work when Mission Control is unreachable
- [ ] **Fail-open** — license enforcement never blocks POS when sync agent is down

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Fleet admin | GWI admin (Clerk B2B) | Super Admin |
| Venue owner portal | Clerk org member | Owner |

---

## Known Constraints & Limits
- Registration token expires after 24 hours
- Heartbeat interval: 60 seconds
- License check interval: 60 seconds
- SSE command stream supports `Last-Event-ID` for reconnection
- Max 5 retry attempts for fleet commands (then EXPIRED)
- Sync agent status API on port 8081

---

## Android-Specific Notes
- Native heartbeat every 30 seconds via `POST /api/hardware/terminals/heartbeat-native`
- Device pairing via `POST /api/hardware/terminals/pair-native`
- APK updates pushed via `FORCE_UPDATE_APK` fleet command
- Wipe via `WIPE_ANDROID_TERMINAL` fleet command

---

## Related Docs
- **Domain doc:** `docs/domains/MISSION-CONTROL-DOMAIN.md`
- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` → Mission Control row
- **Architecture rules:** `docs/guides/ARCHITECTURE-RULES.md`
- **MC repo:** `/Users/brianlewis/Documents/My websites/GWI-POS FULL/gwi-mission-control/`
- **Skills:** Skills 300-320 (Mission Control series)

---

*Last updated: 2026-03-20*
