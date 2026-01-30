---
skill: 102
title: KDS Device Security
status: DONE
depends_on: [23]
---

# Skill 102: KDS Device Security

> **Status:** DONE
> **Dependencies:** Skill 23
> **Last Updated:** 2026-01-30

## Overview

Secure device pairing system for KDS screens deployed to merchants. Prevents unauthorized access to kitchen displays using multi-layer authentication including device tokens, httpOnly cookies, and optional static IP enforcement.

## Problem Solved

When deploying KDS tablets to restaurants across the country, anyone who knows the URL could access the kitchen display. This skill ensures only authorized, paired devices can view orders.

## Security Layers

| Layer | Protection | Implementation |
|-------|-----------|----------------|
| **Device Token** | Unique 256-bit token per device | `crypto.randomBytes(32).toString('hex')` |
| **httpOnly Cookie** | XSS-proof token storage | Cannot be read by JavaScript |
| **Secure flag** | HTTPS-only transmission | Enabled in production |
| **SameSite: strict** | CSRF protection | Cookie not sent cross-origin |
| **Pairing Code** | Time-limited (5 min) 6-digit code | Prevents brute force |
| **Static IP Binding** | Network-level lock (optional) | For UniFi/static networks |
| **IP Tracking** | Audit trail | Last known IP logged |

## Pairing Flow

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Admin Panel   │      │      Server     │      │   KDS Device    │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         │ 1. Generate Code       │                        │
         │───────────────────────>│                        │
         │                        │                        │
         │    6-digit code        │                        │
         │<───────────────────────│                        │
         │                        │                        │
         │    Display code        │                        │
         │        to user         │                        │
         │                        │                        │
         │                        │    2. Enter code       │
         │                        │<───────────────────────│
         │                        │                        │
         │                        │    Validate code       │
         │                        │    Generate token      │
         │                        │                        │
         │                        │    3. Return token +   │
         │                        │       Set httpOnly     │
         │                        │       cookie           │
         │                        │───────────────────────>│
         │                        │                        │
         │                        │    4. All requests     │
         │                        │       include cookie   │
         │                        │<───────────────────────│
         │                        │                        │
         │                        │    Verify token        │
         │                        │    Check static IP     │
         │                        │                        │
```

## Database Schema

```prisma
model KDSScreen {
  // ... existing fields ...

  // Device Pairing & Authentication
  deviceToken          String?   @unique // Secure token after pairing
  pairingCode          String?            // 6-digit temporary code
  pairingCodeExpiresAt DateTime?          // 5-minute expiry
  isPaired             Boolean   @default(false)

  // Static IP Configuration (for UniFi/private networks)
  staticIp        String?  // Expected IP (e.g., "192.168.1.50")
  enforceStaticIp Boolean  @default(false)

  // Device Info (troubleshooting)
  lastKnownIp String?  // Last IP address seen
  deviceInfo  Json?    // User agent, screen size, etc.
}
```

## API Endpoints

### Generate Pairing Code
```
POST /api/hardware/kds-screens/[id]/generate-code

Response:
{
  "pairingCode": "571202",
  "expiresAt": "2026-01-29T12:05:00Z"
}
```

### Complete Pairing
```
POST /api/hardware/kds-screens/pair

Request:
{
  "pairingCode": "571202",
  "deviceInfo": {
    "userAgent": "...",
    "screenWidth": 1920,
    "screenHeight": 1080
  }
}

Response:
{
  "success": true,
  "deviceToken": "abc123...",
  "screen": { ... }
}

Headers Set:
Set-Cookie: kds_device_token=abc123...; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000
```

### Authenticate Device
```
GET /api/hardware/kds-screens/auth?screenId=xxx

Reads token from:
1. Cookie: kds_device_token (primary - most secure)
2. Header: x-device-token (fallback)

Response:
{
  "authenticated": true,
  "screen": { ... }
}

Errors:
- 401: Device not paired / invalid token
- 403: IP address not authorized (if enforceStaticIp)
- 404: Screen not found
```

### Heartbeat
```
POST /api/hardware/kds-screens/[id]/heartbeat

- Sent every 30 seconds from KDS page
- Updates lastSeenAt, isOnline, lastKnownIp
- Verifies token and static IP
```

### Unpair Device
```
POST /api/hardware/kds-screens/[id]/unpair

- Clears deviceToken, pairingCode, isPaired
- Keeps lastKnownIp for troubleshooting
```

## Admin UI

### KDS Screens Page (`/settings/hardware/kds-screens`)

**List View:**
- Green/gray dot for online/offline status
- "Paired" / "Not Paired" badges
- Static IP display with "Enforced" badge
- Last seen timestamp and IP

**Pairing Controls:**
- Generate Pairing Code button (key icon)
- Modal displays large 6-digit code
- Instructions for device setup
- Copy URL button
- Unpair button (if paired)

**Edit Modal - Network Security Section:**
- Static IP Address input
- "Use Current" button (auto-fills from lastKnownIp)
- "Enforce IP address" checkbox
- Warning about static IP requirement

## KDS Device Pages

### Pair Page (`/kds/pair`)
- 6-digit code entry with auto-advance
- Auto-submit when complete
- Paste support
- Success animation
- Redirects to KDS after pairing

### KDS Page (`/kds`)
- Checks authentication on mount
- Auth states: `checking`, `authenticated`, `requires_pairing`, `employee_fallback`
- Redirects to `/kds/pair` if not authenticated
- Green dot indicator when paired
- Employee fallback mode for troubleshooting

## Static IP Configuration (UniFi Networks)

For merchants using UniFi or similar managed networks:

1. **In UniFi Controller:**
   - Go to Clients → Find KDS tablet
   - Settings → Use Fixed IP Address
   - Assign IP (e.g., 192.168.1.50)

2. **In GWI POS Admin:**
   - Edit KDS Screen
   - Enter static IP address
   - Enable "Enforce IP address"

3. **Result:**
   - KDS only works from that specific IP
   - Token theft from another device = useless

## Files Modified/Created

| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Added staticIp, enforceStaticIp fields |
| `src/app/api/hardware/kds-screens/auth/route.ts` | Device auth + IP check |
| `src/app/api/hardware/kds-screens/pair/route.ts` | Pairing + httpOnly cookie |
| `src/app/api/hardware/kds-screens/[id]/heartbeat/route.ts` | Status + IP check |
| `src/app/api/hardware/kds-screens/[id]/generate-code/route.ts` | Code generation |
| `src/app/api/hardware/kds-screens/[id]/unpair/route.ts` | Remove pairing |
| `src/app/api/hardware/kds-screens/route.ts` | List/create with new fields |
| `src/app/api/hardware/kds-screens/[id]/route.ts` | Update with new fields |
| `src/app/(kds)/kds/page.tsx` | Auth flow + token handling |
| `src/app/(kds)/kds/pair/page.tsx` | Pairing code entry UI |
| `src/app/(admin)/settings/hardware/kds-screens/page.tsx` | Admin UI for pairing |

## Future Enhancements

### Planned
- [ ] Device naming from pairing page (e.g., "Kitchen iPad")
- [ ] Multi-device per screen (for redundancy)
- [ ] Remote device revocation
- [ ] Device activity log
- [ ] Push notifications for offline devices
- [ ] QR code pairing (scan from admin panel)

### Potential
- [ ] Certificate pinning for enterprise deployments
- [ ] Biometric unlock option
- [ ] Scheduled access windows (e.g., only during business hours)
- [ ] Geofencing (must be at restaurant location)
- [ ] Integration with MDM (Mobile Device Management)

## Testing Checklist

- [ ] Generate pairing code → displays 6-digit code
- [ ] Code expires after 5 minutes
- [ ] Enter code on device → pairs successfully
- [ ] Paired device can access KDS
- [ ] Unpaired device redirects to pairing page
- [ ] Unpair from admin → device loses access
- [ ] Set static IP → only that IP can access
- [ ] Wrong static IP → 403 error
- [ ] Token stored in httpOnly cookie (not visible in JS)
- [ ] Employee fallback works for troubleshooting

## Security Considerations

1. **Token Generation:** Uses `crypto.randomBytes(32)` for cryptographic security
2. **Code Expiry:** 5-minute window prevents replay attacks
3. **httpOnly Cookie:** Primary storage, immune to XSS
4. **localStorage Backup:** For UI state only, not authoritative
5. **IP Validation:** Optional but recommended for static networks
6. **Audit Trail:** IP addresses logged for troubleshooting

## Dependencies

- Skill 23: KDS Display (base functionality)
- Skill 67: Prep Stations (station assignment)

## Status

**DONE** - Core pairing and security implemented. Future enhancements tracked above.
