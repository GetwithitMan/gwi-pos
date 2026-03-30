# Payment Reader Operations

Operational guide for managing Datacap payment readers (PAX terminals) in GWI POS.

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/datacap/reader-health.ts` | In-memory health state machine per reader |
| `src/lib/datacap/discovery.ts` | UDP broadcast discovery on LAN (port 9001) |
| `src/lib/datacap/client.ts` | DatacapClient — all reader communication |
| `src/lib/datacap/helpers.ts` | `getDatacapClient()` / `requireDatacapClient()` factory |
| `src/lib/datacap/constants.ts` | Ports, timeouts, transaction codes |

## Reader Health States

The health tracker (`reader-health.ts`) maintains an in-memory `Map<readerId, ReaderHealth>` with two states:

| State | Meaning | Transactions Allowed |
|-------|---------|---------------------|
| `healthy` | Reader operating normally | Yes |
| `degraded` | EMVPadReset failed after a transaction | No — `assertReaderHealthy()` throws |

State transitions:
- Every monetary transaction calls `padReset()` after completion (success or failure)
- Successful pad reset: `markReaderHealthy(readerId)`
- Failed pad reset: `markReaderDegraded(readerId, reason)`
- Manual pad reset via API: `clearReaderHealth(readerId)` on success

**Important:** Health state is in-memory only and resets on server restart. This is intentional — a restart is itself a recovery action.

### Checking Health Before Transactions

`assertReaderHealthy(readerId)` is called before every monetary transaction. If the reader is degraded, it throws with a descriptive error including the degradation reason and recovery instructions.

## Communication Modes

### Local Mode (Default)

The POS server communicates directly with the reader over the local network via HTTP.

- Endpoint: `http://<reader-ip>:<port>/ProcessEMVTransaction/`
- Default port: `8080` (PAX), `80` (Ingenico)
- Timeout: Configurable per location, default `60s` for card-present (customer interaction), `5s` for pad reset

### Cloud Mode (Fallback)

When local communication fails, the system can route through Datacap's cloud infrastructure.

- Test: `https://cloud-test.dcap.com/ProcessEMVTransaction/`
- Production: `https://cloud-prod.dcap.com/ProcessEMVTransaction/`
- Auth: HTTP Basic Auth with `merchantId` as username, `tokenKey` as password
- Timeout: `30s` (faster than local because no card interaction)

### Fallback Logic

The `DatacapClient` is configured with `communicationMode: 'local'` by default. Cloud mode is available as an alternative configuration, not an automatic failover. The mode is set per-location in payment settings.

## Reader Discovery

### Auto-Discovery via UDP Broadcast

`discovery.ts` uses Node.js `dgram` to find readers on the LAN. This is server-side only (no browser support for UDP).

**Single device discovery** (`discoverDevice(serialNumber)`):
1. Broadcasts `"Who has <SN>"` on UDP port `9001` to `255.255.255.255`
2. Waits for response matching `"<SN> is at: <IP>"`
3. Retries up to `30` times with `500ms` delay between attempts
4. Returns `{ serialNumber, ipAddress, port: 8080 }` or `null`

**All devices discovery** (`discoverAllDevices(timeoutMs)`):
1. Broadcasts `"Who has"` (generic) on UDP port `9001`
2. Collects all responses within `timeoutMs` (default `5000ms`)
3. Deduplicates by serial number
4. Returns array of discovered devices

### Manual Configuration

Readers can be manually configured in Settings > Payments with:
- IP address
- Port
- Serial number
- Reader name/label

Manual configuration is the primary method; auto-discovery is a convenience tool for initial setup and the Datacap certification `GetDevicesInfo` test.

## Recovery Procedures

### Degraded Reader (PadReset Failed)

1. **Try API pad reset:** `POST /api/datacap/pad-reset` with `{ readerId, locationId }`
2. If pad reset succeeds, the reader state clears to `healthy` automatically
3. If pad reset fails, power-cycle the reader (unplug for 10 seconds)
4. After power-cycle, wait 30-60 seconds for boot, then retry pad reset

### Offline Reader (No Response)

1. Check physical connections (power, Ethernet/USB)
2. Verify reader IP is reachable: `ping <reader-ip>` from NUC
3. Try auto-discovery to see if IP changed: `discoverDevice(serialNumber)`
4. If IP changed, update reader configuration in Settings
5. Power-cycle reader if still unresponsive

### Parameter Download Required

When a reader returns error code `004003` (Param Download Required):

1. Run `EMVParamDownload` from Settings > Payments > Reader Management
2. This calls `client.paramDownload(readerId)` — timeout is `120s` (downloads are slow)
3. After successful download, the reader is ready for transactions

### Stuck Transaction

If a transaction appears stuck (customer waiting, no response):

1. Do NOT attempt a second transaction — this may double-charge
2. Wait for timeout (up to 60 seconds)
3. After timeout, check the `_pending_datacap_sales` table for orphaned records
4. The reconciliation cron (`/api/cron/datacap-reconciliation`) auto-voids orphans every 5 minutes

## Timeouts

| Operation | Timeout | Constant |
|-----------|---------|----------|
| Card-present transaction (local) | 60s | `DEFAULT_LOCAL_TIMEOUT_MS` |
| Cloud transaction | 30s | `DEFAULT_CLOUD_TIMEOUT_MS` |
| Pad reset | 5s | `PAD_RESET_TIMEOUT_MS` |
| Parameter download | 120s | `PARAM_DOWNLOAD_TIMEOUT_MS` |
| PayAPI REST calls | 5s | `PAYAPI_TIMEOUT_MS` |

## Post-Transaction Pad Reset

Every monetary transaction automatically calls `EMVPadReset` after completion. The `withPadReset()` wrapper in `DatacapClient` handles this:

1. Execute the transaction
2. Capture the result (even if it failed)
3. Call `padReset(readerId)`
4. On reset success: `markReaderHealthy(readerId)`
5. On reset failure: `markReaderDegraded(readerId, reason)` — subsequent transactions will be blocked until the reader recovers

Monetary transaction codes that trigger pad reset are defined in `MONETARY_TRAN_CODES` in `constants.ts`.
