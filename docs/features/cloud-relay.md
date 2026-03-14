# Feature: Cloud Relay

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Outbound WebSocket connection from the NUC to a cloud relay endpoint for real-time bidirectional push. The NUC connects to the cloud (rather than the cloud connecting to the NUC) because NUCs have no public IP. The relay accelerates cloud→NUC data delivery (instant push vs 5s polling) and enables Mission Control to receive real-time telemetry (sync summaries, health, outage alerts) from each venue.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | Relay client, sync integration, server.ts wiring | Full |
| `gwi-mission-control` | Relay endpoint (WebSocket server), dashboard consumers | Partial |
| `gwi-android-register` | N/A (sync via NUC, not relay) | None |
| `gwi-cfd` | N/A | None |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/cloud-relay-client.ts` | Outbound socket.io-client to cloud relay — connect, emit, receive, auto-reconnect |
| `src/lib/sync/upstream-sync-worker.ts` | Emits `SYNC_SUMMARY` via relay after each cycle with rows synced > 0 |
| `src/lib/sync/sync-config.ts` | `DOWNSTREAM_INTERVAL_MS` (5s default) |
| `server.ts` | Relay start/stop wiring (inside `SYNC_ENABLED` + non-backup guard) |

---

## API Endpoints

None — the cloud relay is a WebSocket connection, not an HTTP API. The NUC connects outbound to `CLOUD_RELAY_URL`.

---

## Socket Events (Relay Protocol)

### NUC → Cloud (outbound)
| Event | Payload | Trigger |
|-------|---------|---------|
| `SYNC_SUMMARY` | `{ modelsChanged, rowsSynced, duration, errors }` | After each upstream sync cycle with rows > 0 |
| `BUSINESS_EVENT` | `{ type, payload }` | Significant business events (future) |
| `HEALTH` | `{ uptime, memory, syncStatus }` | Periodic health report |
| `OUTAGE_DEAD_LETTER` | `{ entryId, tableName, recordId, error }` | When outage queue entry is dead-lettered |

### Cloud → NUC (inbound)
| Event | Payload | Action |
|-------|---------|--------|
| `DATA_CHANGED` | `{ models?: string[] }` | Triggers immediate downstream sync cycle |
| `CONFIG_UPDATED` | `{ settings }` | Triggers immediate settings refresh |
| `COMMAND` | `{ commandId, type, payload }` | Executes fleet command (same as SSE delivery) |

---

## Business Logic

### Connection Lifecycle
1. On NUC startup (after sync workers start), `cloud-relay-client.ts` connects to `CLOUD_RELAY_URL`
2. Auth via `SERVER_API_KEY` header in handshake
3. Maintains persistent connection with 60s heartbeat keepalive
4. On disconnect: exponential backoff reconnect (1s → 2s → 4s → ... → 30s cap)
5. On NUC shutdown: graceful disconnect

### Safety Switch
After 5 consecutive connection failures, the relay enters polling fallback mode (2s interval). This prevents connection storms when the cloud is unreachable. Normal relay operation resumes automatically when the connection succeeds.

### Relay as Acceleration Layer (INV-14)
The relay is strictly an acceleration layer. All durability guarantees remain in the DB-backed sync workers:
- **Upstream sync** (5s): NUC → Neon via direct SQL — unaffected by relay status
- **Downstream sync** (5s): Neon → NUC via direct SQL — relay triggers immediate cycle but polling continues regardless
- **Outage queue**: OutageQueueEntry records in local PG — replayed via FIFO when Neon recovers
- If the relay is unavailable, the only impact is increased latency (5s polling vs instant push). No data is lost.

### Edge Cases & Business Rules
- Relay is gated by `SYNC_ENABLED` flag — disabled on backup NUCs (INV-6)
- Relay disabled when `CLOUD_RELAY_URL` is not set — NUC operates in polling-only mode
- `DATA_CHANGED` events are debounced — multiple rapid changes trigger a single downstream sync
- `COMMAND` events are processed identically to SSE-delivered fleet commands
- Relay connection status is reported in `GET /api/health/sockets`

---

## Cross-Feature Dependencies

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Offline Sync | Accelerates downstream sync via instant push on `DATA_CHANGED` |
| Mission Control | Provides real-time telemetry (`SYNC_SUMMARY`, `HEALTH`, `OUTAGE_DEAD_LETTER`) |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Offline Sync | Upstream sync worker emits `SYNC_SUMMARY` through the relay |
| Mission Control | Cloud relay endpoint hosted in MC infrastructure |
| Settings | `CLOUD_RELAY_URL` env var configures the relay target |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **INV-14** — Relay remains acceleration-only; no durability logic added
- [ ] **INV-6** — Relay disabled on backup NUCs
- [ ] **Safety switch** — Auto-fallback to polling on connection failure preserved
- [ ] **Auth** — `SERVER_API_KEY` used for connection authentication

---

## Known Constraints & Limits
- `CLOUD_RELAY_URL` required — relay is disabled when unset
- Auth: `SERVER_API_KEY` header on WebSocket handshake
- Auto-reconnect: exponential backoff 1s–30s
- Heartbeat: 60s keepalive interval
- Safety switch: 5 consecutive failures → 2s polling fallback
- Relay is NOT a message queue — no guaranteed delivery, no replay, no persistence
- Relay disabled on backup NUCs (SYNC_ENABLED guard)

---

## Related Docs
- **Architecture doc:** `docs/architecture/LOCAL-CORE-CELLULAR-EDGE-HA.md` Phase 7.3
- **Socket guide:** `docs/guides/SOCKET-REALTIME.md` § Cloud Relay
- **Offline sync:** `docs/features/offline-sync.md`
- **Mission Control:** `docs/features/mission-control.md` § Cloud Relay
- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` → Cloud Relay row

---

*Last updated: 2026-03-14*
