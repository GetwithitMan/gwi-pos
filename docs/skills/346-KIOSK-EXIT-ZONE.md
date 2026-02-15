# Skill 346: Kiosk Exit Zone

**Status:** DONE
**Domain:** Hardware / DevOps
**Created:** 2026-02-14
**Dependencies:** Skill 345 (NUC Installer Package)

## Summary

Hidden 5-tap zone in the top-left corner of the POS UI that allows admins to exit Chromium kiosk/fullscreen mode without SSH. Rendered in the root layout so it works on every page.

## Problem

NUCs run in Chromium kiosk mode (fullscreen, no address bar, no window controls). When admins need to access the desktop (for debugging, configuration, RealVNC, etc.), they had no way to exit without SSH or a physical keyboard shortcut (which may not be available on a touchscreen terminal).

## Solution

An invisible 64×64px div in the top-left corner. Tap it 5 times within 3 seconds to exit kiosk mode.

## Deliverables

| # | File | Description |
|---|------|-------------|
| 1 | `src/components/KioskExitZone.tsx` | Client component — 5-tap detection |
| 2 | `src/app/api/system/exit-kiosk/route.ts` | Server API — stops kiosk service + kills Chromium |
| 3 | `src/app/layout.tsx` | Root layout — renders KioskExitZone on every page |

## Component: `KioskExitZone.tsx`

```tsx
// Fixed 64x64px div, top-left corner, z-50 (above content)
// aria-hidden="true" — invisible to screen readers
// Tracks tapCount via useRef (no re-renders)
// 5 taps within 3 seconds → POST /api/system/exit-kiosk
// Timer resets tapCount to 0 after 3 seconds of inactivity
```

Key design decisions:
- **useRef for tap count** — no state updates, no re-renders
- **useCallback for handler** — stable reference, no dependencies
- **3-second window** — enough time for 5 deliberate taps, short enough to prevent accidental triggers
- **Fire-and-forget fetch** — `.catch(() => {})`, doesn't block UI
- **Root layout placement** — works on login, orders, admin, KDS, settings, everywhere

## API: `/api/system/exit-kiosk`

**Method:** POST

**Production behavior:**
1. `sudo systemctl stop pulse-kiosk` — stops the systemd service (prevents auto-restart)
2. `sudo pkill -f "chromium.*localhost"` — kills Chromium processes from desktop launcher

Both commands may "fail" (service not running, no process to kill) — that's fine, always returns `{ ok: true }`.

**Dev behavior:**
Returns `{ ok: true, dev: true }` — no-op, safe to call during development.

## Sudoers Integration

The installer (`installer.run`) configures sudoers at `/etc/sudoers.d/gwi-pos`:

```
posuser ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop pulse-kiosk
posuser ALL=(ALL) NOPASSWD: /usr/bin/pkill -f chromium*
```

This allows the Node.js POS process (running as `posuser`) to execute these commands without a password prompt.

## Root Layout Integration

```tsx
// src/app/layout.tsx
import { KioskExitZone } from '@/components/KioskExitZone'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <KioskExitZone />
        {children}
      </body>
    </html>
  )
}
```

## Why Root Layout (Not Per-Page)

Previously KioskExitZone was only on the login page. Problem: if the NUC reboots and auto-navigates to `/orders`, there's no exit zone. By placing it in the root layout:
- Works on every page: `/login`, `/orders`, `/kds`, `/settings`, etc.
- No need to remember to add it to new pages
- Single render, minimal overhead (just a fixed div)

## Security Considerations

- **Not a vulnerability**: 5 deliberate taps in the exact corner is very unlikely by accident
- **Production only**: The actual system commands only run in production (NODE_ENV check)
- **No auth required**: Intentional — the kiosk user should be able to exit without PIN login
- **Sudoers locked**: Only specific commands allowed, not wildcard sudo access

## Related Skills

- **Skill 345**: NUC Installer Package (installs sudoers rules, kiosk service, desktop launcher)
