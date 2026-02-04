# Skill 115: Hardware Status Dashboard

## Status: TODO

## Overview

A simple, always-accessible hardware connection status page showing real-time status of all connected devices. Staff can quickly check if printers, card readers, or KDS screens are online without digging through settings.

## User Stories

1. **As a manager**, I want to see at a glance if all hardware is connected so I can catch issues before they affect service.

2. **As a server**, I want to know why my order didn't print so I can alert a manager or retry.

3. **As IT support**, I want to see connection history and error logs to diagnose intermittent issues.

## UI Design

### Quick Status Bar (Optional - Header Integration)
Small icons in the main header showing overall status:
```
[Orders]  [Menu]  [Settings]  🟢🟢🟡🔴  [Hardware]
                               └── Click to expand
```

### Hardware Status Page (`/settings/hardware/status`)

```
┌─────────────────────────────────────────────────────────────────┐
│ Hardware Status                                    [Refresh] 🔄 │
│                                                    Auto: 10s    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PRINTERS                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🟢 Kitchen Printer 1    192.168.1.50:9100    2s ago     │   │
│  │    Epson TM-U220 (Impact)                    [Test] [→] │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 🟢 Bar Printer          192.168.1.51:9100    5s ago     │   │
│  │    Epson TM-T88VI (Thermal)                  [Test] [→] │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 🟡 Receipt Printer      192.168.1.52:9100    45s ago    │   │
│  │    Star TSP143 (Thermal)  ⚠ Slow response   [Test] [→] │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  PAYMENT TERMINALS                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🔴 Card Reader 1        192.168.1.60         OFFLINE    │   │
│  │    MagTek DynaPro       Last seen: 2h ago   [Test] [→] │   │
│  │    ⚠ Connection lost at 2:34 PM                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  KDS SCREENS                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🟢 Kitchen Display      192.168.1.70         1s ago     │   │
│  │    iPad Pro 12.9"       Station: Grill      [Test] [→] │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │ 🟢 Expo Display         192.168.1.71         1s ago     │   │
│  │    Android Tablet       Station: Expo       [Test] [→] │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  CASH DRAWERS                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ 🟢 Main Register        via Receipt Printer  Connected  │   │
│  │    APG Vasario                               [Test] [→] │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Status Indicators

| Icon | Status | Meaning |
|------|--------|---------|
| 🟢 | Online | Connected, responding normally (< 5s) |
| 🟡 | Warning | Slow response (5-30s) or intermittent |
| 🔴 | Offline | No response for > 30s |
| ⚪ | Unknown | Never connected or disabled |

## Features

### Core Features (MVP)
- [ ] List all configured hardware devices
- [ ] Real-time status with auto-refresh (10s default)
- [ ] Last successful ping timestamp
- [ ] Manual refresh button
- [ ] Test print/ping button per device
- [ ] Link to device settings (→ button)

### Enhanced Features (Later)
- [ ] Connection history graph (last 24h)
- [ ] Error log viewer per device
- [ ] Email/SMS alerts when device goes offline
- [ ] Quick status icons in header
- [ ] Automatic retry on failure
- [ ] Maintenance mode toggle (silence alerts)

## API Endpoints

### GET /api/hardware/status
Returns status of all hardware devices.

```typescript
interface HardwareStatusResponse {
  printers: DeviceStatus[]
  cardReaders: DeviceStatus[]
  kdsScreens: DeviceStatus[]
  cashDrawers: DeviceStatus[]
  lastChecked: string // ISO timestamp
}

interface DeviceStatus {
  id: string
  name: string
  type: string // 'thermal' | 'impact' | 'card_reader' | 'kds' | 'cash_drawer'
  model?: string
  ipAddress?: string
  port?: number
  status: 'online' | 'warning' | 'offline' | 'unknown'
  lastPing?: string // ISO timestamp
  lastError?: string
  metadata?: {
    station?: string // For KDS
    deviceInfo?: string // Browser, OS, etc.
  }
}
```

### POST /api/hardware/[id]/ping
Manually ping a specific device.

```typescript
interface PingResponse {
  success: boolean
  latencyMs?: number
  error?: string
}
```

### POST /api/hardware/[id]/test
Send test print/command to device.

```typescript
interface TestResponse {
  success: boolean
  message: string
  error?: string
}
```

## Database Schema

```prisma
model HardwareDevice {
  id              String    @id @default(cuid())
  locationId      String
  name            String
  type            String    // printer, card_reader, kds, cash_drawer
  model           String?
  ipAddress       String?
  port            Int?
  isEnabled       Boolean   @default(true)
  status          String    @default("unknown") // online, warning, offline, unknown
  lastPingAt      DateTime?
  lastOnlineAt    DateTime?
  lastErrorAt     DateTime?
  lastError       String?

  location        Location  @relation(fields: [locationId], references: [id])

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  deletedAt       DateTime?
  syncedAt        DateTime?

  @@index([locationId])
  @@index([status])
}

model HardwareLog {
  id              String    @id @default(cuid())
  locationId      String
  deviceId        String
  event           String    // ping_success, ping_fail, test_print, error, status_change
  latencyMs       Int?
  errorMessage    String?
  metadata        Json?

  location        Location  @relation(fields: [locationId], references: [id])

  createdAt       DateTime  @default(now())

  @@index([locationId])
  @@index([deviceId])
  @@index([createdAt])
}
```

## Health Check Logic

```typescript
// Run every 10 seconds
async function checkDeviceHealth(device: HardwareDevice) {
  const startTime = Date.now()

  try {
    if (device.type === 'printer') {
      // TCP connect to printer port
      await tcpPing(device.ipAddress, device.port || 9100, 5000)
    } else if (device.type === 'kds') {
      // Check KDS last heartbeat from database
      const screen = await db.kDSScreen.findUnique({ where: { id: device.id } })
      const lastSeen = screen?.lastSeenAt
      if (!lastSeen || Date.now() - lastSeen.getTime() > 30000) {
        throw new Error('KDS heartbeat timeout')
      }
    }

    const latency = Date.now() - startTime
    const status = latency < 5000 ? 'online' : 'warning'

    await updateDeviceStatus(device.id, status, latency)
  } catch (error) {
    await updateDeviceStatus(device.id, 'offline', null, error.message)
  }
}
```

## Dependencies

- Skill 55: Receipt Printer (printer connection logic)
- Skill 56: Cash Drawer (drawer status)
- Skill 57: Card Reader (terminal connection)
- Skill 102: KDS Device Security (KDS heartbeat data)

## Implementation Notes

1. **Existing Data**: KDS screens already track `lastSeenAt` - reuse this
2. **Printer Ping**: Simple TCP socket connect, no need to send data
3. **Card Readers**: May need vendor-specific API integration
4. **Cash Drawers**: Usually connected via printer, status follows printer
5. **Performance**: Background health checks, don't block UI

## Files to Create

- `src/app/(admin)/settings/hardware/status/page.tsx` - Main status page
- `src/app/api/hardware/status/route.ts` - Status API
- `src/app/api/hardware/[id]/ping/route.ts` - Manual ping
- `src/app/api/hardware/[id]/test/route.ts` - Test print/command
- `src/lib/hardware-health.ts` - Health check logic
- `src/components/hardware/DeviceStatusCard.tsx` - Status card component
- `src/components/hardware/StatusIndicator.tsx` - Status icon component
