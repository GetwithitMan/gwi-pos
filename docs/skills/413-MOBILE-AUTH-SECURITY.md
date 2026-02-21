# Skill 413 — Mobile Bartender Auth Security (T-025)

## Overview

Mobile bartender pages (tabs list, tab detail, schedule) require a valid httpOnly session cookie to render. The session is established at `/mobile/login` and validated on every page mount via `GET /api/mobile/device/auth`. There is no URL parameter bypass — `employeeId` is never read from query string to skip the auth check. Any request without a valid, unexpired session token is redirected to `/mobile/login`.

## Schema Changes

No schema changes in this skill. The `RegisteredDevice` and `MobileSession` models were introduced in an earlier skill (P2-E02).

```prisma
model RegisteredDevice {
  id                String   @id @default(cuid())
  locationId        String
  location          Location @relation(fields: [locationId], references: [id])
  name              String                     // "Sarah's iPhone"
  deviceType        String   @default("phone") // phone, tablet
  deviceFingerprint String?                    // optional browser fingerprint
  registeredById    String                     // employeeId who first registered
  isActive          Boolean  @default(true)
  lastSeenAt        DateTime @default(now())
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  deletedAt         DateTime?
  syncedAt          DateTime?
  sessions          MobileSession[]
}

model MobileSession {
  id           String           @id @default(cuid())
  locationId   String
  location     Location         @relation(fields: [locationId], references: [id])
  deviceId     String
  device       RegisteredDevice @relation(fields: [deviceId], references: [id])
  employeeId   String
  employee     Employee         @relation(fields: [employeeId], references: [id])
  sessionToken String           @unique
  expiresAt    DateTime
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  revokedAt    DateTime?
}
```

## Key Files

| File | Role |
|------|------|
| `src/app/(mobile)/mobile/tabs/page.tsx` | Tabs list page — unconditional `checkAuth()` on mount |
| `src/app/(mobile)/mobile/tabs/[id]/page.tsx` | Tab detail page — same unconditional `checkAuth()` pattern |
| `src/app/(mobile)/mobile/schedule/page.tsx` | Schedule page — same unconditional `checkAuth()` pattern |
| `src/app/api/mobile/device/auth/route.ts` | Session validation endpoint |
| `prisma/schema.prisma` | `RegisteredDevice` and `MobileSession` models |

## How It Works

### Auth flow

Every mobile page follows the same pattern on mount:

```typescript
useEffect(() => {
  async function checkAuth() {
    try {
      const res = await fetch('/api/mobile/device/auth')
      if (res.ok) {
        const data = await res.json()
        setEmployeeId(data.data.employeeId)
        setAuthChecked(true)
        return
      }
    } catch {
      // network error — fall through to redirect
    }

    const loginUrl = locationId
      ? `/mobile/login?locationId=${locationId}`
      : '/mobile/login'
    router.replace(loginUrl)
  }

  checkAuth()
}, []) // runs unconditionally on mount
```

Key properties:
- `checkAuth()` is called unconditionally on every mount — there is no early return or conditional skip.
- The page renders a blank dark screen (`<div className="min-h-screen bg-gray-950" />`) until `authChecked` is true. Data loading (`loadTabs`, `loadSchedule`) only begins after `authChecked` flips to true.
- On any non-`ok` response or network error, the user is immediately redirected to `/mobile/login`. The `locationId` query param is forwarded to the login page so a QR-code-embedded URL survives the auth redirect.

### `GET /api/mobile/device/auth`

```typescript
GET /api/mobile/device/auth
```

The endpoint reads the session token from two sources, in priority order:
1. `request.cookies.get('mobile-session')?.value` — httpOnly cookie (primary)
2. `request.headers.get('x-mobile-session')` — header fallback

If no token is found: `401 { error: 'No session token' }`

The token is looked up in `MobileSession` where `revokedAt: null`. If not found or `session.expiresAt < new Date()`: `401 { error: 'Session expired or invalid' }`.

On success, returns:
```json
{
  "data": {
    "employeeId": "...",
    "employee": {
      "id": "...",
      "firstName": "...",
      "lastName": "...",
      "displayName": "...",
      "role": { "id": "...", "name": "...", "permissions": { ... } }
    },
    "expiresAt": "2026-03-01T00:00:00.000Z"
  }
}
```

The full employee + role + permissions object is returned in the auth response, so pages do not need a second fetch to determine what the employee can do.

### What was removed

In an earlier (pre-T-025) implementation, the tabs page initialized `employeeId` from the URL search params:

```typescript
// REMOVED — was in earlier version
const [employeeId, setEmployeeId] = useState<string | null>(
  searchParams.get('employeeId')  // URL bypass — removed
)

// REMOVED — conditional auth check
useEffect(() => {
  if (!employeeId) {  // only checked if no URL param
    checkAuth()
  }
}, [employeeId])
```

This allowed a URL like `/mobile/tabs?employeeId=abc123` to skip the cookie check entirely. The bypass was introduced during initial rollout when QR codes embedded `employeeId` for ease of setup, but it meant any person who knew an `employeeId` could access the tab list without a valid session.

### What remained

The `locationId` query param is still read from `searchParams`:

```typescript
const locationId = searchParams.get('locationId') ?? ''
```

This is intentional and safe — `locationId` is used only to construct the redirect URL back to the login page. It is not used to authenticate or authorize the user.

## Configuration / Usage

No configuration is required. Authentication is handled automatically on mount for all mobile pages.

To provision a new mobile device:
1. Navigate to `/mobile/login` on the device (typically via a QR code containing `?locationId=...`)
2. Pair the device with an employee PIN — this creates a `RegisteredDevice` and `MobileSession` with an httpOnly cookie
3. Subsequent page loads validate the cookie via `/api/mobile/device/auth`

Sessions expire at `expiresAt` (set during login). Revocation is available by setting `MobileSession.revokedAt`.

## Notes

- The httpOnly cookie cannot be read by JavaScript — it is sent automatically by the browser on every same-origin request. This is the primary security property: there is no client-side token that can be extracted from `localStorage` or URL params.
- The `x-mobile-session` header fallback exists for non-browser clients (e.g., automated testing or native app wrappers) but is secondary to the cookie.
- The blank dark screen shown during auth resolution (`!authChecked`) prevents any flash of content before the session is verified. This is intentional UX — the user sees a black screen briefly, then either the page or the login redirect.
- All three mobile pages (`tabs/page.tsx`, `tabs/[id]/page.tsx`, `schedule/page.tsx`) implement the identical `checkAuth()` pattern. Any future mobile page must follow the same pattern — never read `employeeId` from search params to initialize auth state.
- The `locationId` query param on the mobile login page allows QR codes to be generated per-venue and to survive the auth redirect without losing venue context.
