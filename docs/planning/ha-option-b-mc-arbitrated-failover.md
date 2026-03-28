# HA Option B: MC-Arbitrated Failover

**Version:** 1.0
**Created:** 2026-03-28
**Status:** Design Document (no code)
**Scope:** Replace keepalived VRRP peer-election with Mission Control as the single failover arbiter
**Predecessor:** Phase 1 HA in `docs/architecture/LOCAL-CORE-CELLULAR-EDGE-HA.md`

---

## 1. Overview

### What This Is

MC-arbitrated failover: Mission Control becomes the **single authority** for all promotion and demotion decisions. No NUC promotes itself. No peer-to-peer election. MC holds the lease, MC declares the failover, MC commands the promotion.

### Why

The current keepalived/VRRP design (Option A) has a fundamental flaw: **two peers on the same LAN decide who is primary using multicast heartbeats, with no external quorum**. This creates three classes of problems:

1. **Split-brain risk.** A network partition between the two NUCs causes both to claim the VIP. Each accepts writes to its own PG. When the partition heals, the data diverges irreconcilably. The current fence-check (HTTP to old primary) mitigates but does not eliminate this -- it fails open if the old primary is partitioned but still running.

2. **No replication awareness.** keepalived has no knowledge of PG replication state. It promotes the backup even if replication lag is 5 minutes behind. The "promoted" node serves stale data and the gap is lost.

3. **No centralized control.** There is no way for an operator (or MC) to prevent a failover, delay a failover, or force a specific node to be primary. keepalived acts autonomously.

Option B solves all three by making MC the sole arbiter. MC can verify both nodes, check replication lag, and make an informed decision before commanding any state change.

### What It Replaces

| Current (Option A) | New (Option B) |
|---------------------|----------------|
| keepalived VRRP multicast election | MC lease-based arbitration |
| Peer-to-peer health detection | MC centralized health assessment |
| `promote.sh` triggered by keepalived `notify_master` | `PROMOTE` fleet command from MC to standby |
| In-process fencing (`process.env.STATION_ROLE = 'fenced'`) | Persistent fencing (disk-backed, survives reboot) |
| `rejoin-as-standby.sh` triggered by VIP loss detection | `REJOIN_AS_STANDBY` fleet command from MC |
| No replication lag awareness in failover | MC verifies lag < threshold before promoting |

### What It Keeps

- PostgreSQL streaming replication (unchanged -- this is the data layer, not the control layer)
- VIP for device connectivity (keepalived stays as a network-layer supplement, but MC controls who holds MASTER state)
- All existing health check infrastructure (`ha-check.sh`, `/api/health`, `/api/fence-check`)
- Lease renewal from `ha-check.sh` (already posting to MC every 10s)

---

## 2. Architecture

### System Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │           MISSION CONTROL (Cloud)            │
                    │                                              │
                    │  ┌────────────────────────────────────────┐ │
                    │  │  Failover Decision Engine (cron/30s)   │ │
                    │  │  - Monitors primary lease expiry        │ │
                    │  │  - Verifies standby health + lag        │ │
                    │  │  - Issues PROMOTE / REJOIN / UNFENCE    │ │
                    │  └──────┬──────────────────┬──────────────┘ │
                    │         │                  │                 │
                    │  ┌──────┴──────┐   ┌──────┴──────┐         │
                    │  │ ServerNode  │   │ ServerNode  │         │
                    │  │ (primary)   │   │ (standby)   │         │
                    │  │ leaseExp:T  │   │ leaseExp:-  │         │
                    │  └──────┬──────┘   └──────┬──────┘         │
                    └─────────┼─────────────────┼────────────────┘
                              │                 │
                   heartbeat  │                 │  heartbeat
                   + lease    │                 │  + health
                   renew (30s)│                 │  report (30s)
                              │                 │
                 ┌────────────┴─────────────────┴───────────────┐
                 │                  VENUE LAN                    │
                 │                                               │
                 │     ┌─────────────────────────────────┐      │
                 │     │   VIP: 10.10.10.50 (keepalived) │      │
                 │     └────────────┬────────────────────┘      │
                 │                  │                             │
                 │      ┌───────────┴───────────┐                │
                 │      │                       │                │
                 │  ┌───┴────────────┐  ┌──────┴──────────┐     │
                 │  │  PRIMARY NUC   │  │  STANDBY NUC    │     │
                 │  │  10.10.10.11   │  │  10.10.10.12    │     │
                 │  │                │  │                  │     │
                 │  │  PG primary    │──│▶ PG standby      │     │
                 │  │  POS app: ON   │SR│  POS app: OFF    │     │
                 │  │  Sync: ON      │  │  Sync: OFF       │     │
                 │  │  Lease: HELD   │  │  Lease: NONE     │     │
                 │  │  Fenced: NO    │  │  Fenced: NO      │     │
                 │  │                │  │                  │     │
                 │  │ ha-check.sh ──▶│MC│◀── ha-check.sh  │     │
                 │  │ (renews lease) │  │ (reports health) │     │
                 │  └────────────────┘  └─────────────────┘     │
                 │                                               │
                 │  ┌──────┐ ┌──────┐ ┌────────┐ ┌──────────┐  │
                 │  │ Term │ │ Term │ │Register│ │ KDS/CFD  │  │
                 │  │  1   │ │  2   │ │(Droid) │ │ Displays │  │
                 │  └──────┘ └──────┘ └────────┘ └──────────┘  │
                 │       All devices connect to VIP only        │
                 └──────────────────────────────────────────────┘

SR = PostgreSQL Streaming Replication (WAL)
```

### Lease Model

The primary holds a **lease** stored on its `ServerNode` record in the MC database. The lease is the primary's proof of authority. Without a valid lease, no NUC may accept writes.

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Heartbeat interval | 30 seconds | Matches existing heartbeat POST from `ha-check.sh` |
| Lease TTL | 90 seconds | 3x heartbeat = tolerates 2 missed heartbeats before expiry |
| Lease renewal | Every heartbeat (30s) | Primary renews as long as it passes local health checks |
| Expiry detection | MC cron every 30s | Worst case: 30s cron lag + 90s TTL = 120s detection |
| Promotion target | < 2 minutes total | Detection (120s max) + promotion (30s) = 150s worst case |

**Lease lifecycle:**

```
Primary boots → passes health checks → ha-check.sh POSTs to MC
                                            │
                                            ▼
                                   MC sets leaseExpiresAt = now + 90s
                                   MC sets leaseHeldBy = this nodeId
                                            │
                                            ▼
                              ┌──── 30s later: health still good ────┐
                              │                                       │
                              ▼                                       ▼
                    ha-check.sh renews                      ha-check.sh fails
                    MC extends lease +90s                   NO renewal sent
                              │                                       │
                              ▼                                       ▼
                         (repeat)                            MC lease expires
                                                             after 90s TTL
                                                                      │
                                                                      ▼
                                                        MC transitions venue to
                                                        FAILOVER_PENDING
```

### Control Path vs Data Path

MC is in the **control path only**. It decides who is primary and commands state changes. It is never in the data path:

- Orders, payments, KDS, sync -- all flow NUC-to-NUC or NUC-to-Neon. MC is not involved.
- If MC goes down, both NUCs continue operating. The primary keeps serving. No failover can occur (acceptable -- see Failure Matrix).
- MC's cron runs every 30s. This means failover is slower than keepalived (~6s) but dramatically safer (no split-brain).

---

## 3. Components

### 3a. Primary Lease (MC Database)

**Schema change on MC's `ServerNode` model:**

```prisma
model ServerNode {
  // ... existing fields ...

  // HA Lease fields (new)
  primaryLeaseExpiresAt  DateTime?    // null = no lease held
  primaryLeaseHeldBy     String?      // serverNodeId of the lease holder
  haState                String?      // ACTIVE | FAILOVER_PENDING | PROMOTING | REJOINING
  lastHealthReport       DateTime?    // last heartbeat from this node
  lastReplicationLag     Int?         // seconds, reported by standby's ha-check.sh
  fenceCommandId         String?      // ID of the active fence command (null = not fenced)
}
```

**Lease renewal endpoint (MC, already partially exists):**

```
POST /api/fleet/ha/renew-lease
Headers:
  Authorization: Bearer <SERVER_API_KEY>
  X-Server-Node-Id: <nodeId>
Body: {
  venueSlug: string,
  nodeId: string,
  ttl: 90,
  pgInRecovery: boolean,
  replicationLag: number | null,    // standby only
  posHealthy: boolean,
  uptime: number                     // seconds since POS started
}
Response 200: {
  leaseExpiresAt: string (ISO 8601),
  leaseHeldBy: string (nodeId)
}
Response 409: {
  error: "Lease held by another node",
  currentHolder: string (nodeId)
}
```

**Lease renewal logic (MC):**

```
function renewLease(venueSlug, nodeId, ttl):
  venue = findVenue(venueSlug)
  node = findServerNode(nodeId)

  // Only the current primary (or first claimer) can renew
  if venue.primaryLeaseHeldBy != null
     AND venue.primaryLeaseHeldBy != nodeId
     AND venue.primaryLeaseExpiresAt > now():
    return 409 "Lease held by another node"

  // Grant or renew
  venue.primaryLeaseHeldBy = nodeId
  venue.primaryLeaseExpiresAt = now() + ttl
  node.lastHealthReport = now()
  node.haState = 'ACTIVE'
  save()
  return 200 { leaseExpiresAt, leaseHeldBy }
```

**Key invariant:** Only ONE node per venue can hold a valid lease at any time. The lease is stored on the venue (or a venue-level HA record), not on the node. This prevents two nodes from both claiming active leases.

### 3b. Failover Decision Engine (MC-side, NEW)

**New MC cron endpoint:**

```
GET /api/cron/ha-failover-check
Schedule: every 30 seconds (Vercel cron or external scheduler)
Auth: CRON_SECRET header
```

**Algorithm:**

```
function failoverCheck():
  venues = findAllVenuesWithHA()  // venues that have 2+ ServerNodes

  for each venue:
    primary = venue.primaryNode        // node holding the lease
    standby = venue.standbyNode        // the other node
    lease = venue.primaryLeaseExpiresAt

    // ─── STATE: ACTIVE (normal operation) ───
    if venue.haState == 'ACTIVE':
      if lease != null AND lease > now():
        continue  // healthy, nothing to do

      if lease != null AND lease <= now():
        // Lease expired — primary missed 3+ heartbeats
        log("Primary lease expired for venue ${venue.slug}")
        venue.haState = 'FAILOVER_PENDING'
        venue.haStateChangedAt = now()
        alertOps("Lease expired", venue, primary)
        // Fall through to FAILOVER_PENDING handling below

    // ─── STATE: FAILOVER_PENDING ───
    if venue.haState == 'FAILOVER_PENDING':

      // Step 1: Double-check primary is truly dead
      //   Direct HTTP health check from MC → primary NUC
      //   (MC can reach NUC via its public tunnel / Cloudflare Tunnel / tailnet)
      primaryAlive = httpHealthCheck(primary.publicEndpoint, timeout=5s)

      if primaryAlive:
        // False alarm — primary recovered. Re-grant lease.
        log("Primary recovered during FAILOVER_PENDING")
        venue.haState = 'ACTIVE'
        venue.primaryLeaseExpiresAt = now() + 90s
        continue

      // Step 2: Verify standby is healthy and caught up
      if standby == null:
        alertOps("No standby available", venue)
        continue  // can't promote, wait for primary recovery

      standbyHealthy = standby.lastHealthReport != null
                       AND standby.lastHealthReport > now() - 120s

      if NOT standbyHealthy:
        alertOps("Standby not reporting health", venue, standby)
        continue  // wait

      replicationLag = standby.lastReplicationLag ?? 999
      if replicationLag > 30:
        alertOps("Standby replication lag too high: ${replicationLag}s", venue)
        // Don't promote — data loss would exceed threshold
        // Re-check next cycle. If primary comes back, it will reclaim the lease.
        continue

      // Step 3: All checks pass — issue PROMOTE command
      log("Promoting standby ${standby.id} for venue ${venue.slug}")
      venue.haState = 'PROMOTING'

      createFleetCommand({
        targetNodeId: standby.id,
        command: 'PROMOTE',
        payload: {
          oldPrimaryNodeId: primary.id,
          oldPrimaryIp: primary.localIp,
          venueSlug: venue.slug,
          fenceCommandId: generateId(),
        },
        expiresAt: now() + 5m,  // command expires if not consumed
      })

    // ─── STATE: PROMOTING ───
    if venue.haState == 'PROMOTING':
      // Check if promotion timed out (> 5 minutes)
      if venue.haStateChangedAt < now() - 5m:
        alertOps("Promotion timed out for venue ${venue.slug}")
        venue.haState = 'FAILOVER_PENDING'  // retry next cycle
        continue
      // Otherwise: waiting for standby to ACK
```

**Direct health check from MC to NUC:**

MC must be able to reach NUCs for the double-check in Step 1. Options:

1. **Cloudflare Tunnel / Tailscale:** Each NUC maintains an outbound tunnel. MC hits the tunnel endpoint.
2. **Reverse heartbeat:** MC piggybacks a "are you alive?" challenge on the next heartbeat response. If the primary doesn't heartbeat within 30s, it is confirmed dead.
3. **Omit direct check:** Rely solely on lease expiry (3 missed heartbeats = 90s). This is the simplest option and is recommended for v1. The direct check is a v2 optimization.

**Recommendation for v1:** Omit the direct health check. Three missed heartbeats (90s) is sufficient proof. The primary's `ha-check.sh` runs every 2s and renews every 10s -- if it fails to renew for 90s, the primary is genuinely unhealthy. The direct check can be added in v2 when NUC tunnels are standardized.

### 3c. Promotion Flow (NUC-side)

The standby NUC receives a `PROMOTE` fleet command via the sync agent (or heartbeat response). This replaces the keepalived `notify_master` trigger.

**Fleet command delivery mechanism:**

The sync agent on the standby already polls MC for fleet commands as part of its heartbeat loop. When it receives a `PROMOTE` command:

```
PROMOTE fleet command payload:
{
  command: "PROMOTE",
  oldPrimaryNodeId: string,
  oldPrimaryIp: string,      // LAN IP of old primary
  venueSlug: string,
  fenceCommandId: string,     // unique ID for this fence action
  issuedAt: string,           // ISO timestamp
  expiresAt: string           // command expiration
}
```

**Promotion script (`/opt/gwi-pos/scripts/mc-promote.sh`):**

This is a NEW script, separate from the existing `promote.sh` (which is keepalived-triggered). The MC-arbitrated version has additional safety checks and MC reporting.

```bash
#!/usr/bin/env bash
# MC-Arbitrated Promotion — only runs when MC commands it
set -euo pipefail

# Input: JSON payload from fleet command (passed as argument or env)
PAYLOAD="$1"
OLD_PRIMARY_IP=$(echo "$PAYLOAD" | jq -r '.oldPrimaryIp')
FENCE_COMMAND_ID=$(echo "$PAYLOAD" | jq -r '.fenceCommandId')
VENUE_SLUG=$(echo "$PAYLOAD" | jq -r '.venueSlug')

# ── Step 1: Verify this NUC is actually a standby ──
IN_RECOVERY=$(sudo -u postgres psql -tAc "SELECT pg_is_in_recovery()")
if [[ "$IN_RECOVERY" != "t" ]]; then
  report_to_mc "PROMOTE_FAILED" "Not in recovery mode — refusing promotion"
  exit 1
fi

# ── Step 2: Fence the old primary ──
# Try to tell the old primary to step down. If unreachable, that's OK
# (it's probably crashed, which is why we're promoting).
FENCE_BODY=$(printf '{"action":"step_down","newPrimary":"%s","fenceCommandId":"%s"}' \
  "$(hostname -I | awk '{print $1}')" "$FENCE_COMMAND_ID")

FENCE_HTTP=$(curl -sf --max-time 5 --connect-timeout 3 \
  -X POST "http://${OLD_PRIMARY_IP}:3005/api/internal/ha-fence" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $HA_SHARED_SECRET" \
  -d "$FENCE_BODY" \
  -o /dev/null -w "%{http_code}" 2>/dev/null) || FENCE_HTTP="000"

if [[ "$FENCE_HTTP" == "200" ]]; then
  log "Old primary acknowledged fence (stepped down)"
elif [[ "$FENCE_HTTP" == "000" ]]; then
  log "Old primary unreachable (expected if crashed) — proceeding"
else
  log "Old primary returned HTTP $FENCE_HTTP — proceeding anyway"
fi

# ── Step 3: Promote PostgreSQL ──
sudo -u postgres pg_ctl promote -D /var/lib/postgresql/17/main 2>/dev/null \
  || sudo -u postgres pg_ctl promote -D /var/lib/postgresql/16/main 2>/dev/null \
  || { report_to_mc "PROMOTE_FAILED" "pg_ctl promote failed"; exit 2; }

# ── Step 4: Wait for PG to exit recovery ──
WAITED=0
while [[ $WAITED -lt 30 ]]; do
  STILL_RECOVERY=$(sudo -u postgres psql -tAc "SELECT pg_is_in_recovery()" 2>/dev/null || echo "t")
  if [[ "$STILL_RECOVERY" == "f" ]]; then
    log "PG promoted — no longer in recovery after ${WAITED}s"
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if [[ "$STILL_RECOVERY" != "f" ]]; then
  report_to_mc "PROMOTE_FAILED" "PG still in recovery after 30s"
  exit 2
fi

# ── Step 5: Update .env ──
sed -i 's/^STATION_ROLE=.*/STATION_ROLE=server/' /opt/gwi-pos/.env
cp /opt/gwi-pos/.env /opt/gwi-pos/app/.env 2>/dev/null || true
cp /opt/gwi-pos/.env /opt/gwi-pos/app/.env.local 2>/dev/null || true

# ── Step 6: Start POS service ──
systemctl enable thepasspos
systemctl start thepasspos

# Wait for POS to be healthy
WAITED=0
POS_HEALTHY=false
while [[ $WAITED -lt 60 ]]; do
  if curl -sf --max-time 3 http://localhost:3005/api/health >/dev/null 2>&1; then
    POS_HEALTHY=true
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done

if [[ "$POS_HEALTHY" != "true" ]]; then
  report_to_mc "PROMOTE_DEGRADED" "POS app not healthy after 60s"
  # Don't exit — PG is promoted, we're the primary now even if POS is slow
fi

# ── Step 7: Start sync workers ──
systemctl start thepasspos-sync 2>/dev/null || true

# ── Step 8: Report to MC — request new lease ──
report_to_mc "PROMOTE_COMPLETE" "Promotion successful"

# MC receives this and:
#   1. Sets venue.primaryLeaseHeldBy = this node
#   2. Sets venue.primaryLeaseExpiresAt = now + 90s
#   3. Sets venue.haState = 'ACTIVE'
#   4. Updates old primary's haState to 'FENCED'

# ── Step 9: Gratuitous ARP for VIP takeover ──
# If keepalived is still in use as a network supplement:
VIP=$(grep "^VIRTUAL_IP=" /opt/gwi-pos/.env | cut -d= -f2)
if [[ -n "$VIP" ]]; then
  IFACE=$(ip route get 1 | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1); exit}')
  arping -U -c 3 -I "$IFACE" "$VIP" 2>/dev/null || true
fi

exit 0
```

**MC reporting function (`report_to_mc`):**

```bash
report_to_mc() {
  local STATUS="$1"
  local DETAIL="$2"
  curl -sf --max-time 10 -X POST \
    "${MISSION_CONTROL_URL}/api/fleet/failover-event" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SERVER_API_KEY" \
    -H "X-Server-Node-Id: $SERVER_NODE_ID" \
    -d "{\"event\":\"promotion\",\"status\":\"$STATUS\",\"detail\":\"$DETAIL\",\"fenceCommandId\":\"$FENCE_COMMAND_ID\",\"venueSlug\":\"$VENUE_SLUG\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
    >/dev/null 2>&1 || true
}
```

### 3d. Persistent Fencing (NUC-side, FIX)

**Problem with current fencing:**

The current `ha-fence` route sets `process.env.STATION_ROLE = 'fenced'`. This is in-memory only. If the POS process restarts (which it will -- systemd restarts it), the fence is lost and the old primary starts accepting writes again. This is a **split-brain vulnerability**.

**Solution: Disk-persisted fence state.**

**Fence file:** `/opt/gwi-pos/state/fenced.json`

```json
{
  "fenced": true,
  "fencedAt": "2026-03-28T15:30:00Z",
  "fencedBy": "fleet-cmd-abc123",
  "reason": "MC-arbitrated failover: standby promoted",
  "oldPrimaryNodeId": "node-xyz",
  "newPrimaryNodeId": "node-abc"
}
```

**Changes to `proxy.ts`:**

```typescript
// At startup (module-level), read fence state from disk
import { isFenced } from '@/lib/ha-fence-state'

// In proxy():
if (isFenced()) {
  const isFenceEndpoint = pathname === '/api/internal/ha-fence'
  const isHealthEndpoint = pathname === '/api/health'
  if (!isFenceEndpoint && !isHealthEndpoint && method !== 'GET' && method !== 'HEAD') {
    return NextResponse.json(
      { error: 'This server has been fenced. Please reconnect to the primary.' },
      { status: 503 }
    )
  }
}
```

**New module: `src/lib/ha-fence-state.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'

const STATE_DIR = '/opt/gwi-pos/state'
const FENCE_FILE = path.join(STATE_DIR, 'fenced.json')

interface FenceState {
  fenced: boolean
  fencedAt: string
  fencedBy: string       // fleet command ID
  reason: string
  oldPrimaryNodeId?: string
  newPrimaryNodeId?: string
}

// Cache in memory for performance (disk is source of truth)
let cachedFenceState: FenceState | null = null
let lastReadAt = 0
const CACHE_TTL_MS = 5000  // re-read from disk every 5s

export function isFenced(): boolean {
  const now = Date.now()
  if (cachedFenceState !== null && (now - lastReadAt) < CACHE_TTL_MS) {
    return cachedFenceState.fenced
  }
  try {
    if (!existsSync(FENCE_FILE)) return false
    const raw = readFileSync(FENCE_FILE, 'utf-8')
    cachedFenceState = JSON.parse(raw)
    lastReadAt = now
    return cachedFenceState?.fenced ?? false
  } catch {
    return false  // fail open -- better to serve than to fence incorrectly
  }
}

export function setFenced(state: FenceState): void {
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(FENCE_FILE, JSON.stringify(state, null, 2))
  cachedFenceState = state
  lastReadAt = Date.now()
}

export function clearFence(): void {
  try {
    writeFileSync(FENCE_FILE, JSON.stringify({ fenced: false }, null, 2))
    cachedFenceState = { fenced: false, fencedAt: '', fencedBy: '', reason: '' }
    lastReadAt = Date.now()
  } catch { /* ignore */ }
}

export function getFenceState(): FenceState | null {
  isFenced()  // refresh cache
  return cachedFenceState
}
```

**Changes to `/api/internal/ha-fence` route:**

```typescript
// POST handler — step_down action
if (body.action === 'step_down') {
  // 1. Persist fence to disk (survives restart)
  setFenced({
    fenced: true,
    fencedAt: new Date().toISOString(),
    fencedBy: body.fenceCommandId || 'unknown',
    reason: body.reason || 'MC-arbitrated failover',
    newPrimaryNodeId: body.newPrimary,
  })

  // 2. Also set in-memory for immediate effect (belt + suspenders)
  process.env.STATION_ROLE = 'fenced'

  return ok({ status: 'stepped_down', persistent: true })
}

// NEW: unfence action (MC fleet command only)
if (body.action === 'unfence') {
  clearFence()
  // Restore STATION_ROLE from .env (which was updated to 'backup' by rejoin)
  const envRole = readEnvFile('/opt/gwi-pos/.env').STATION_ROLE || 'backup'
  process.env.STATION_ROLE = envRole

  return ok({ status: 'unfenced', restoredRole: envRole })
}
```

**Key design decisions:**

1. **Fence survives reboot.** The file persists on disk. On POS startup, `proxy.ts` reads it before accepting any request.
2. **Only MC can unfence.** The `unfence` action requires the same auth as `step_down` but is only sent by MC after a successful rejoin.
3. **Health endpoint is exempt.** A fenced node still responds to `/api/health` so MC and operators can verify its status.
4. **Fail-open on read error.** If the fence file is corrupted or unreadable, the node is NOT fenced. This prevents a disk error from permanently bricking a node. The risk (serving on a fenced node) is lower than the risk (permanently offline node).

### 3e. Automated Rejoin (NUC-side, FIX)

After failover, the old primary must rejoin as a standby. This is triggered by MC fleet command `REJOIN_AS_STANDBY`, not by VIP detection.

**Fleet command payload:**

```json
{
  "command": "REJOIN_AS_STANDBY",
  "newPrimaryNodeId": "node-abc",
  "newPrimaryIp": "10.10.10.12",
  "venueSlug": "shaunels",
  "fenceCommandId": "fence-cmd-abc123"
}
```

**Rejoin script (`/opt/gwi-pos/scripts/mc-rejoin-as-standby.sh`):**

This is an enhanced version of the existing `rejoin-as-standby.sh` with MC integration and safety gates.

```
Step  1: Verify this NUC is fenced
         - Read /opt/gwi-pos/state/fenced.json
         - If fenced != true: REFUSE to rejoin (safety — prevent accidental data wipe)
         - Rationale: An unfenced node might still be serving traffic

Step  2: Stop POS service
         - systemctl stop thepasspos
         - systemctl stop thepasspos-sync
         - pm2 stop all (if pm2 is running)
         - Wait 15s for connection draining

Step  3: Stop PostgreSQL
         - systemctl stop postgresql
         - Verify stopped: pg_isready returns failure
         - Force kill if needed: pkill -9 postgres

Step  4: Wipe PG data directory
         - SAFETY CHECK: Verify PG is stopped (double-check)
         - rm -rf /var/lib/postgresql/{16,17}/main/*
         - Note: pg_basebackup will recreate everything

Step  5: pg_basebackup from new primary
         - NEW_PRIMARY_IP from fleet command payload
         - sudo -u postgres pg_basebackup \
             -h $NEW_PRIMARY_IP -D $PG_DATA \
             -U replicator -P -R \
             --checkpoint=fast --wal-method=stream
         - Timeout: 30 minutes (large DBs)
         - On failure: report to MC, exit (manual intervention needed)

Step  6: Verify standby.signal exists
         - pg_basebackup -R creates it automatically
         - Verify primary_conninfo in postgresql.auto.conf

Step  7: Fix ownership
         - chown -R postgres:postgres $PG_DATA
         - chmod 700 $PG_DATA

Step  8: Start PostgreSQL in recovery mode
         - systemctl start postgresql
         - Wait up to 30s for pg_isready
         - Verify pg_is_in_recovery() = true

Step  9: Verify replication streaming
         - Check pg_stat_wal_receiver status
         - Expected: 'streaming' or 'catchup'
         - Wait up to 60s for streaming to establish

Step 10: Update .env
         - STATION_ROLE=backup
         - HA_PEER_IP=$NEW_PRIMARY_IP (the new primary is now our peer)
         - Copy to app/.env and app/.env.local

Step 11: Report to MC
         - POST /api/fleet/failover-event
         - Body: { event: "rejoin_standby", status: "COMPLETE", ... }

Step 12: MC receives report and:
         - Sets this node's haState = 'STANDBY'
         - Sends UNFENCE fleet command to this node
         - This node clears /opt/gwi-pos/state/fenced.json
         - This node's proxy.ts resumes allowing GET/HEAD requests
           (no writes — it's a standby, PG rejects writes anyway)
```

**Rejoin safety gates (MUST ALL PASS before Step 4):**

| Gate | Check | On Failure |
|------|-------|------------|
| Fenced | `fenced.json` exists with `fenced: true` | ABORT: "Not fenced, refusing to wipe data" |
| POS stopped | `systemctl is-active thepasspos` returns inactive | ABORT: "POS still running" |
| PG stopped | `pg_isready` returns failure | ABORT: "PG still running" |
| New primary reachable | `pg_isready -h $NEW_PRIMARY_IP` | ABORT: "New primary PG not reachable" |
| New primary is primary | HTTP to new primary's `/api/fence-check` returns `role: primary` | ABORT: "New primary not in primary role" |

### 3f. PG Streaming Replication (Installer, WIRE)

The installer already has the pieces. Stage `04-database.sh` configures PG. Stage `08-ha.sh` sets up keepalived. The wiring needed:

**Primary PG configuration (already in 04-database.sh, verify present):**

```
wal_level = replica
max_wal_senders = 3
wal_keep_size = 1GB
```

**Primary `pg_hba.conf` (add replication line):**

```
host replication replicator <standby_ip>/32 md5
```

**Replication slot (prevents WAL segment deletion while standby is catching up):**

```sql
SELECT pg_create_physical_replication_slot('standby_slot');
```

**Standby setup (already in 08-ha.sh as part of backup role flow):**

```bash
pg_basebackup -h $PRIMARY_NUC_IP -D $PG_DATA -U replicator -P -R \
  --checkpoint=fast --wal-method=stream --slot=standby_slot
```

The `-R` flag creates `standby.signal` and writes `primary_conninfo` into `postgresql.auto.conf`.

**Synchronous replication for payments (OPTIONAL, v2):**

For zero data loss on payment transactions, the primary can be configured for synchronous replication:

```
synchronous_commit = remote_apply    # wait for standby to apply
synchronous_standby_names = 'standby_1'
```

**Trade-off:** Every write waits for standby ACK. Adds ~1-5ms latency on LAN. Recommended for payment writes only (via `SET LOCAL synchronous_commit = 'remote_apply'` in the payment transaction). Default writes remain asynchronous.

---

## 4. Failure Matrix

Every failure scenario the system must handle, the expected behavior, and the recovery path.

| # | Scenario | Detection | Automated Response | Data Loss | Recovery |
|---|----------|-----------|-------------------|-----------|----------|
| F1 | **Primary crashes (power loss, kernel panic)** | `ha-check.sh` stops renewing lease. MC detects lease expiry after 90s. | MC sets FAILOVER_PENDING. Verifies standby health + lag. Sends PROMOTE to standby. Standby promotes PG, starts POS, reports back. MC grants lease to new primary. | Zero (async replication lag, typically < 1s). Committed transactions on primary not yet replicated are lost. With sync replication on payments: zero for payment transactions. | Old primary comes back, MC sends REJOIN_AS_STANDBY. Old primary wipes PG, pg_basebackup from new primary, rejoins as standby. |
| F2 | **Primary network partition (NUC-to-MC)** | MC lease expires (primary can't renew). BUT primary may still be serving LAN devices. | MC promotes standby. Standby fences old primary via LAN (HTTP to `/api/internal/ha-fence`). If fence succeeds: old primary stops accepting writes. If fence fails (LAN also partitioned): standby promotes anyway. | If LAN partition also exists: potential split-brain window until old primary's lease expires and it self-fences (see F2a below). If only MC path is down: fence via LAN prevents split-brain. | On partition heal: old primary discovers it is fenced (or lease expired), stops serving. MC sends REJOIN_AS_STANDBY. |
| F2a | **Primary network partition (NUC-to-MC AND NUC-to-NUC)** | MC lease expires. Standby fence attempt to old primary times out (LAN also partitioned). | Standby promotes. Old primary continues serving (SPLIT BRAIN). Mitigation: primary's `ha-check.sh` detects it cannot renew the MC lease for > 90s and **self-fences** (writes `fenced.json`, stops accepting writes). This is the "lease expiry self-fence" safety net. | Split-brain window = time from standby promotion until primary self-fences (max 90s). Any writes during this window are lost on the primary (standby's data wins as it got the MC lease). | On partition heal: both nodes contact MC. MC sees two primaries — immediately fences the one without the lease. REJOIN_AS_STANDBY on the fenced node. |
| F3 | **Standby crashes** | Standby stops sending heartbeats to MC. MC detects via missing health reports. | No promotion (only one node). MC alerts operators. Primary continues serving. | None. | Operator restarts standby. Standby reconnects replication. If WAL gap too large: run `rejoin-as-standby.sh` manually. |
| F4 | **MC crashes / Vercel outage** | NUCs continue operating. Primary lease cannot be renewed BUT lease was valid when MC went down. Primary keeps serving. | **No failover possible.** Both NUCs continue in their current roles. This is safe: the primary is still healthy (its local health checks still pass), it just can't renew its MC lease. | None. | MC recovers. Primary's next heartbeat renews the lease. If primary also crashed during MC outage: manual intervention needed (operator runs promotion script directly). |
| F5 | **Both NUCs crash simultaneously** | MC detects both leases expired / no heartbeats. | MC alerts operators. No automated recovery (no node to promote). | Potential loss of in-flight transactions. Neon has data up to last upstream sync (5s interval). | Operator restarts one or both NUCs. First to boot with valid lease becomes primary. If both data dirs are intact, the one with the higher WAL position should be primary (operator decision). |
| F6 | **Network partition: NUCs can reach MC but not each other** | MC sees heartbeats from both. Primary lease is valid. Standby reports increasing replication lag (can't reach primary's PG). | No promotion (primary is healthy, lease is valid). MC alerts on replication lag. If primary subsequently crashes: MC promotes standby, but standby may have stale data (lag). | If promotion happens with lag: data from the lag window is lost. MC checks lag before promoting and delays if > 30s. | Partition heals. Replication catches up. If lag was too high for promotion: operator must decide to accept data loss or wait for primary recovery. |
| F7 | **Network partition: primary can reach MC, standby cannot** | MC sees primary heartbeats (lease valid). MC does NOT see standby heartbeats. | No promotion needed (primary is healthy). MC alerts that standby is unreachable. | None. | Partition heals. Standby resumes heartbeats and replication. |
| F8 | **Replication lag > 30s at time of primary failure** | MC detects lease expiry. MC checks standby's `lastReplicationLag`. | MC DELAYS promotion. Logs "standby lag too high, waiting for primary recovery." If primary does not recover within a configurable timeout (e.g., 10 minutes): MC alerts operator for manual decision (promote with data loss, or wait). | If promoted: transactions from the lag window are lost. | Operator makes a manual call: accept data loss and promote, or wait for primary. MC provides a manual promotion endpoint for this case. |
| F9 | **Promotion fails midway (pg_ctl promote succeeds but POS app won't start)** | Standby reports `PROMOTE_DEGRADED` to MC. | MC sets venue to `PROMOTING` state. If POS starts within 5 minutes: automatic recovery. If not: MC alerts operator. PG is primary (writes accepted) but POS app is down (no API). | None (PG is promoted, data is safe). | Operator SSHs in and fixes POS app issue. Or MC sends `REJOIN_AS_STANDBY` to revert (if old primary is still viable). |
| F10 | **Rejoin fails (pg_basebackup from new primary)** | Rejoin script reports failure to MC. | MC alerts operator. Old primary stays fenced. New primary continues serving. | None (new primary has the data). | Operator diagnoses: network issue, PG config issue, disk space. Fixes and re-triggers rejoin via MC. |
| F11 | **Fenced node reboots** | Node reads `/opt/gwi-pos/state/fenced.json` on startup. | Node starts in fenced state. proxy.ts rejects writes. Node is inert. | None. | MC sends UNFENCE after rejoin is complete. Or operator triggers rejoin. |
| F12 | **Clock skew between NUC and MC** | Lease calculations use MC server time (authoritative). NUC's local clock is irrelevant for lease expiry. | NUC sends heartbeat timestamps but MC uses its own `now()` for lease math. Skew > 30s may cause premature lease expiry (NUC thinks it's renewing on time, MC disagrees). | None directly, but could trigger unnecessary failover. | NTP sync on all NUCs (already enforced by installer: `timedatectl set-ntp true`). MC should log a warning if NUC's reported timestamp differs from MC's by > 10s. |

### Self-Fencing on Lease Expiry (F2a Mitigation)

This is a critical safety mechanism. The primary's `ha-check.sh` must track consecutive lease renewal failures:

```bash
# In ha-check.sh, after lease renewal attempt:
if [[ "$RENEW_HTTP" != "200" ]]; then
  FAIL_COUNT_FILE="/tmp/gwi-ha-lease-fail-count"
  PREV=$(cat "$FAIL_COUNT_FILE" 2>/dev/null || echo 0)
  NEW=$((PREV + 1))
  echo "$NEW" > "$FAIL_COUNT_FILE"

  # Self-fence after 9 consecutive failures (9 * 10s interval = 90s = lease TTL)
  if [[ "$NEW" -ge 9 ]]; then
    log "CRITICAL: MC lease renewal failed $NEW times — self-fencing"
    # Write persistent fence file
    echo '{"fenced":true,"fencedAt":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","fencedBy":"self-fence-lease-expiry","reason":"MC lease not renewed for 90s+"}' \
      > /opt/gwi-pos/state/fenced.json

    # Tell the running POS process to fence immediately
    curl -sf --max-time 2 -X POST http://localhost:3005/api/internal/ha-fence \
      -H "Authorization: Bearer $INTERNAL_API_SECRET" \
      -H "Content-Type: application/json" \
      -d '{"action":"step_down","newPrimary":"unknown","reason":"self-fence: MC lease expired"}' \
      >/dev/null 2>&1 || true
  fi
else
  # Reset counter on success
  echo 0 > /tmp/gwi-ha-lease-fail-count 2>/dev/null || true
fi
```

This ensures that even in a full network partition, the primary will self-fence after 90s, limiting the split-brain window.

---

## 5. Endpoint Routing

When the primary changes, LAN devices need to reach the new primary. Three options:

### Option A: DNS-based routing

MC updates a DNS record (e.g., `venue-shaunels.pos.gwi.local` points to the new primary's LAN IP). Devices resolve DNS on each connection.

**Pros:** Clean separation, no VRRP needed.
**Cons:** DNS TTL caching (devices may cache old IP for minutes), requires local DNS infrastructure on the LAN (mDNS or a DNS server on each NUC), Android DNS caching is aggressive.

**Verdict:** Not recommended for v1. DNS caching makes failover latency unpredictable.

### Option B: Proxy-based routing (MC/Vercel)

MC updates a reverse proxy config. All LAN devices connect to a cloud URL. The cloud routes to the correct NUC.

**Pros:** Centralized control, MC knows the current primary.
**Cons:** Every request goes through the internet. Defeats the purpose of local-first. Does not work during internet outage.

**Verdict:** Not viable. Violates the offline-first architecture.

### Option C: VIP via keepalived (RECOMMENDED)

Keep the existing VIP infrastructure. All devices connect to the VIP (e.g., `10.10.10.50`). keepalived manages VIP assignment. MC controls which node is MASTER by:

1. MC sends `PROMOTE` to standby, which includes a keepalived priority boost
2. The promoted standby's keepalived transitions to MASTER and claims the VIP
3. The fenced old primary's keepalived transitions to BACKUP (or is stopped)

**Implementation:**

After promotion, the new primary adjusts keepalived priority:

```bash
# In mc-promote.sh, after PG promotion:
# Boost our keepalived priority above the old primary's
sed -i 's/priority [0-9]*/priority 110/' /etc/keepalived/keepalived.conf
systemctl reload keepalived
```

The fenced old primary has its keepalived deprioritized (or stopped):

```bash
# In ha-fence step_down handler (or a companion script):
systemctl stop keepalived
# Or: reduce priority to 50
```

**Gratuitous ARP** ensures LAN devices update their ARP tables within 1-3 seconds:

```bash
arping -U -c 3 -I eth0 10.10.10.50
```

**Pros:** Already deployed. Works offline. Sub-3s device reconnection. No DNS issues.
**Cons:** keepalived is still on the nodes, but now it's a dumb VIP manager, not a decision-maker.

**Verdict:** Recommended for v1 and likely permanent. keepalived handles the network layer (VIP), MC handles the control layer (who should be primary). This is a clean separation of concerns.

### Recommended Architecture

```
MC (control plane)         keepalived (network plane)       PG (data plane)
─────────────────         ──────────────────────────       ─────────────────
Decides who is primary  → Assigns VIP to that node     → PG promotion/demotion
Lease management           Gratuitous ARP                  WAL replication
Fleet commands             Priority management             Read/write routing
```

---

## 6. Rollout Plan

Each phase is independently deployable. Each phase increases safety without requiring subsequent phases.

### Phase 1: Persistent Fencing + PG Replication Verification

**Goal:** Eliminate the two most dangerous gaps: volatile fencing and unverified replication.

**Changes:**

| Repo | File | Change |
|------|------|--------|
| gwi-pos | `src/lib/ha-fence-state.ts` | NEW: Disk-persisted fence state module |
| gwi-pos | `src/app/api/internal/ha-fence/route.ts` | FIX: Write fence to disk, add `unfence` action |
| gwi-pos | `src/proxy.ts` | FIX: Read fence from disk-backed module instead of `process.env` |
| gwi-pos | `public/ha-check.sh` | FIX: Add self-fence on 9 consecutive MC lease renewal failures |
| gwi-pos | `public/installer-modules/08-ha.sh` | FIX: Create `/opt/gwi-pos/state/` directory, verify replication slot |
| gwi-pos | `public/installer-modules/04-database.sh` | VERIFY: `wal_level=replica`, `max_wal_senders=3`, replication slot created |

**Validation:**

- [ ] Fence a running node via `/api/internal/ha-fence` with `step_down`
- [ ] Reboot the fenced node -- verify it comes up fenced (reads `fenced.json`)
- [ ] Unfence via `/api/internal/ha-fence` with `unfence` -- verify writes resume
- [ ] Verify PG streaming replication is active on a 2-NUC venue
- [ ] Verify replication lag is reported in standby's heartbeat to MC

**Risk:** Low. These are additive safety improvements. No behavior change for single-NUC venues.

### Phase 2: MC Failover Decision Engine + Promotion Flow

**Goal:** MC can detect primary failure and command standby promotion.

**Changes:**

| Repo | File | Change |
|------|------|--------|
| gwi-mission-control | `prisma/schema.prisma` | ADD: `primaryLeaseExpiresAt`, `primaryLeaseHeldBy`, `haState`, `lastReplicationLag`, `fenceCommandId` on ServerNode |
| gwi-mission-control | `src/app/api/fleet/ha/renew-lease/route.ts` | NEW or FIX: Lease renewal with conflict detection |
| gwi-mission-control | `src/app/api/cron/ha-failover-check/route.ts` | NEW: Failover decision engine (30s cron) |
| gwi-mission-control | `src/app/api/fleet/failover-event/route.ts` | NEW or FIX: Receive promotion/rejoin reports from NUCs |
| gwi-mission-control | MC dashboard UI | ADD: HA status panel (venue-level, shows lease state, node states, failover history) |
| gwi-pos | `public/scripts/mc-promote.sh` | NEW: MC-commanded promotion script |
| gwi-pos | `src/lib/update-agent.ts` | FIX: Handle `PROMOTE` fleet command, invoke `mc-promote.sh` |
| gwi-pos | `public/ha-check.sh` | FIX: Standby reports `replicationLag` in heartbeat body |

**Validation:**

- [ ] Simulate primary failure (stop POS + PG on primary)
- [ ] MC detects lease expiry within 120s
- [ ] MC sends PROMOTE to standby
- [ ] Standby promotes PG, starts POS, reports to MC
- [ ] MC grants new lease to promoted standby
- [ ] LAN devices reconnect via VIP within 5s of keepalived transition
- [ ] Old primary (when restarted) comes up fenced

**Risk:** Medium. This is the core behavior change. Requires staging validation with a real 2-NUC venue. keepalived remains as a fallback during this phase.

### Phase 3: Automated Rejoin

**Goal:** Old primary can rejoin as standby without operator intervention.

**Changes:**

| Repo | File | Change |
|------|------|--------|
| gwi-pos | `public/scripts/mc-rejoin-as-standby.sh` | NEW: MC-commanded rejoin script (enhanced `rejoin-as-standby.sh`) |
| gwi-pos | `src/lib/update-agent.ts` | FIX: Handle `REJOIN_AS_STANDBY` fleet command |
| gwi-mission-control | `src/app/api/cron/ha-failover-check/route.ts` | FIX: After promotion ACK, auto-send REJOIN to old primary (if it's reporting heartbeats) |
| gwi-mission-control | `src/app/api/fleet/failover-event/route.ts` | FIX: On rejoin completion, send UNFENCE |

**Validation:**

- [ ] After failover, restart old primary
- [ ] MC detects old primary heartbeats (it's fenced but alive)
- [ ] MC sends REJOIN_AS_STANDBY
- [ ] Old primary wipes PG, pg_basebackup from new primary, starts as standby
- [ ] MC sends UNFENCE after rejoin report
- [ ] Old primary is now a healthy standby with streaming replication
- [ ] End-to-end: crash primary, wait for promotion, restart old primary, wait for rejoin -- verify fully automated

**Risk:** Medium-low. The existing `rejoin-as-standby.sh` already handles the PG mechanics. The new version adds safety gates and MC integration.

### Phase 4: Remove keepalived Dependency (OPTIONAL)

**Goal:** keepalived is no longer required. MC manages VIP assignment directly (via scripts on the NUCs).

**Changes:**

- Replace keepalived VIP management with direct `ip addr add/del` commands issued by the promotion/rejoin scripts
- Remove keepalived package from installer
- VIP is managed as a static secondary IP on the active primary's NIC

**Verdict:** DEFER. keepalived as a dumb VIP manager is fine. Removing it adds complexity for no safety benefit. Only pursue if keepalived causes operational issues.

---

## 7. Success Criteria

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| Failover time (primary crash to service restored) | < 2 minutes | Timestamp: MC detects lease expiry to standby reports PROMOTE_COMPLETE |
| Data loss for committed transactions | Zero (with async replication, limited to replication lag -- typically < 1s) | Compare WAL positions before/after failover |
| Payment transaction data loss | Zero | Synchronous replication for payment writes (Phase 2+ optional) |
| Split-brain window | 0 seconds (with self-fence) or < 90s (worst case network partition) | Test: partition NUCs, verify primary self-fences within 90s |
| Fencing survives reboot | Yes | Test: fence node, reboot, verify fenced on startup |
| Automated rejoin (no operator intervention) | Yes (Phase 3+) | Test: full failover + rejoin cycle without SSH |
| MC outage resilience | Both NUCs continue operating in current roles | Test: stop MC, verify primary keeps serving, verify no spurious failover |
| False failover rate | 0 (no spurious promotions) | Monitored over 30-day pilot period |
| Failover under load | Service restored < 2 minutes under 50 concurrent orders | Load test during controlled failover |

### Comparison with Current (Option A)

| Metric | Option A (keepalived) | Option B (MC-arbitrated) |
|--------|----------------------|--------------------------|
| Failover time | ~10s | ~120s (slower but safer) |
| Split-brain risk | Present (mitigated by fence-check) | Eliminated (single arbiter) |
| Data loss awareness | None (promotes regardless of lag) | Lag-aware (delays if > 30s) |
| Reboot resilience | Fence lost on reboot | Fence persists on disk |
| Centralized control | None | Full (MC dashboard, manual override) |
| MC dependency | None | Control-path only (not data-path) |
| Complexity | Low | Medium |

---

## 8. Open Questions

### Q1: Do we need a witness node?

**Current thinking: No.** MC is effectively the witness. In traditional HA, a witness breaks the tie when two nodes disagree. Since MC is the sole arbiter, there is no tie to break. The only gap is when MC itself is down (see F4 in Failure Matrix) -- in that case, no failover occurs, which is the correct behavior (preserving the current primary is safer than promoting without an arbiter).

**If we wanted a witness:** Deploy a lightweight health-check agent on a third device at the venue (e.g., a Raspberry Pi or the router itself). This agent reports to MC whether each NUC is reachable on the LAN. MC uses this as a third signal when both NUCs claim to be alive but MC can't reach one. This is a v3 consideration.

### Q2: Should we support > 2 NUCs per venue?

**Current thinking: No.** The lease model supports it (lease is held by one node, N-1 are standbys), but the operational complexity is not justified. Two NUCs provide sufficient redundancy for a restaurant/bar. A third NUC adds cost without proportional reliability gain.

**If needed:** The failover engine would need to select the "best" standby (lowest replication lag, most recent heartbeat). The promotion script is unchanged -- it always targets a specific node.

### Q3: What is the maximum acceptable replication lag for promotion?

**Current thinking: 30 seconds.** This is already the threshold in `ha-check.sh`. Rationale:

- At 30s lag, a restaurant might lose ~30s of orders. For a busy venue doing 1 order/s, that's ~30 orders at risk. This is recoverable (re-enter orders from printed tickets).
- Payment transactions should use synchronous replication (zero lag guarantee for payments specifically).
- Lag > 30s suggests a deeper problem (disk I/O, network saturation) that should be investigated before promoting.

**Configurable:** This should be a per-venue setting in MC, stored on the venue's HA configuration. Default: 30s.

### Q4: How do we handle MC planned maintenance?

**Current thinking:**

1. Before MC deploy: MC sets all venues to `MAINTENANCE_HOLD` state. No failover decisions during this window.
2. MC deploys (Vercel typically takes < 60s for cold start).
3. After MC deploy: MC clears `MAINTENANCE_HOLD`. Resumes failover checks.

**Risk during maintenance window:** If a primary crashes during the 60s MC deploy window, no automated failover occurs. This is acceptable for a 60s window. If MC maintenance requires longer downtime, operators should be on standby for manual intervention.

**Implementation:** The cron job checks for `MAINTENANCE_HOLD` flag at the top of the loop and skips all failover logic if set. MC's deploy script sets/clears this flag.

### Q5: Should the primary self-fence on lease expiry, or just stop accepting new connections?

**Current thinking: Self-fence (write `fenced.json` + stop writes).** This is the safest option. A primary that can't renew its MC lease for 90s is in an unknown state. Self-fencing ensures that even if MC has already promoted the standby, the old primary won't accept conflicting writes.

**Alternative:** Stop accepting new TCP connections but finish in-flight requests. This is gentler but harder to implement (requires cooperation from the Node.js process and PG). Self-fencing via proxy.ts is simpler and more reliable.

### Q6: What happens to in-flight requests during promotion?

**Timeline of a promotion:**

```
T+0s    MC sends PROMOTE to standby
T+1s    Standby receives command, begins promotion
T+2s    Standby fences old primary (if reachable)
        ← In-flight requests on old primary: GET requests still served,
          POST/PUT/PATCH/DELETE return 503 immediately after fencing
T+3s    pg_ctl promote on standby
T+5s    PG exits recovery mode
T+10s   POS app starting on standby
T+30s   POS app healthy, accepting requests
        ← LAN devices reconnect to VIP (now points to new primary)
T+35s   Service fully restored
```

During the ~30s window between fencing and new POS being ready, LAN devices will see:
- Old primary: 503 on writes (fenced), GETs still work
- VIP: May point to old primary (keepalived hasn't transitioned yet) or new primary (if keepalived transition is fast)
- Android/register devices: Will retry failed requests automatically (built into the HTTP client)

**Mitigation:** The Android register's HTTP client already retries on 503 with exponential backoff. Web terminals show a "Reconnecting..." banner. This is acceptable for a < 60s window.

---

## 9. Migration Path from Option A to Option B

For venues already running Option A (keepalived-only HA):

### Step 1: Deploy Phase 1 (no behavior change)

- Update POS on both NUCs (persistent fencing module, updated ha-check.sh)
- keepalived continues to manage failover autonomously
- Persistent fencing is additive (doesn't interfere with keepalived)

### Step 2: Deploy Phase 2 on MC

- MC failover engine is deployed but **disabled by default** (per-venue feature flag: `haOptionB: boolean`)
- Enable on staging venue first

### Step 3: Enable Option B per venue

- Set `haOptionB: true` on the venue in MC
- keepalived's `notify_master` and `notify_backup` scripts are updated to **no-op** (they no longer trigger promotion/demotion)
- keepalived continues managing the VIP but does NOT make promotion decisions
- MC is now the sole failover authority

### Step 4: Validate

- Controlled failover test on the venue (stop primary, verify MC-arbitrated promotion)
- Verify rejoin works
- Monitor for 7 days

### Step 5: Roll out to all HA venues

- Enable `haOptionB` on each venue after validation
- Roll back to Option A by setting `haOptionB: false` (keepalived resumes autonomous control)

---

## 10. Operational Runbook

### Manual Promotion (emergency, MC down)

If MC is unavailable and an operator needs to promote manually:

```bash
# On the standby NUC:
sudo /opt/gwi-pos/scripts/mc-promote.sh '{"oldPrimaryIp":"10.10.10.11","fenceCommandId":"manual-$(date +%s)","venueSlug":"shaunels"}'
```

This runs the same promotion script that MC would trigger, but without MC involvement. The operator should notify MC (when it's back) to update its state.

### Manual Rejoin (emergency)

```bash
# On the old primary (must be fenced first):
sudo /opt/gwi-pos/scripts/mc-rejoin-as-standby.sh '{"newPrimaryIp":"10.10.10.12","venueSlug":"shaunels"}'
```

### Manual Fence

```bash
# Via API:
curl -X POST http://10.10.10.11:3005/api/internal/ha-fence \
  -H "Authorization: Bearer $HA_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"step_down","newPrimary":"manual","reason":"Manual operator fence"}'

# Via file (if POS is not running):
echo '{"fenced":true,"fencedAt":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","fencedBy":"manual","reason":"Manual operator fence"}' \
  > /opt/gwi-pos/state/fenced.json
```

### Manual Unfence

```bash
# Via API:
curl -X POST http://10.10.10.11:3005/api/internal/ha-fence \
  -H "Authorization: Bearer $HA_SHARED_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"unfence"}'

# Via file (if POS is not running):
echo '{"fenced":false}' > /opt/gwi-pos/state/fenced.json
```

### Check HA Status

```bash
# On any NUC:
cat /opt/gwi-pos/state/fenced.json 2>/dev/null || echo "No fence file"
curl -s http://localhost:3005/api/internal/ha-lease | jq .
curl -s http://localhost:3005/api/fence-check -H "x-ha-secret: $HA_SHARED_SECRET" | jq .
sudo -u postgres psql -c "SELECT pg_is_in_recovery();"
sudo -u postgres psql -c "SELECT * FROM pg_stat_wal_receiver;" 2>/dev/null || echo "Not a standby"
sudo -u postgres psql -c "SELECT * FROM pg_stat_replication;" 2>/dev/null || echo "Not a primary"
```

---

## 11. Glossary

| Term | Definition |
|------|-----------|
| **Lease** | A time-limited grant from MC to a specific NUC, authorizing it to act as primary. Renewed every heartbeat (30s), expires after TTL (90s). |
| **Fence** | A state where a NUC is prohibited from accepting write requests. Used to prevent split-brain after failover. Persisted to disk. |
| **Self-fence** | When a primary detects it cannot renew its MC lease for > 90s and fences itself without an external command. |
| **Arbiter** | The entity that makes failover decisions. In Option B, this is Mission Control (MC). In Option A, it was keepalived (peer election). |
| **VIP** | Virtual IP. A shared IP address that "floats" between the primary and standby NUCs. All LAN devices connect to the VIP. |
| **WAL** | Write-Ahead Log. PostgreSQL's transaction log, streamed from primary to standby for replication. |
| **Replication lag** | The time difference between the primary's latest WAL position and the standby's applied WAL position. |
| **Fleet command** | A structured instruction from MC to a specific NUC, delivered via the heartbeat/sync channel. Examples: PROMOTE, REJOIN_AS_STANDBY, UNFENCE. |
| **STONITH** | "Shoot The Other Node In The Head." Industry term for fencing a failed node to prevent it from causing split-brain. Our implementation is "STONITH-lite" (software fencing, not hardware power-off). |
