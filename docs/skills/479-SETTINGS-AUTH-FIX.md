# Skill 479 — Settings Permission Fix

**Date:** 2026-03-04
**Domain:** Settings, Auth, Roles
**Commit:** TBD
**Priority:** P1

## Summary

Settings PUT route was gated on `PERMISSIONS.ADMIN` (`'admin'`), a token that no standard employee role possesses — only the super admin `'all'` bypass. Manager had `settings.edit` and `settings.payments` in their role permissions but could never save settings. Fixed by:

1. Settings route uses `PERMISSIONS.SETTINGS_EDIT` (`'settings.edit'`) — Manager has this.
2. `hasPermission()` adds `'all'` to the universal bypass list (alongside `'admin'`, `'super_admin'`, `'*'`).
3. Super admin PIN `0000` added to `CLAUDE.md` quick reference.

## Root Cause

The settings route was added before the granular `settings.*` permission keys existed. When those keys were added to Manager's role in the roles overhaul (Skill 471), the route was never updated to use them. Result: no one except super admin (PIN 0000) could ever save settings.

## Files Changed

| File | Change |
|------|--------|
| `src/app/api/settings/route.ts` | `PERMISSIONS.ADMIN` → `PERMISSIONS.SETTINGS_EDIT` |
| `src/lib/auth-utils.ts` | Added `'all'` to `hasPermission()` bypass |
| `CLAUDE.md` | Added Super Admin PIN 0000 to credentials table |

## Permission Model (correct going forward)

| Route | Required Permission | Who Has It |
|-------|--------------------|----|
| PUT /api/settings | `settings.edit` | Manager, Super Admin |
| GET /api/settings | (no auth) | Everyone |

## Pattern: Route Permission Alignment

When adding `requirePermission()` to a route, always use the most specific `PERMISSIONS.*` constant that exists for that area — not `PERMISSIONS.ADMIN`. Check `src/lib/auth-utils.ts` PERMISSIONS export and the seed `managerPermissions` array to confirm the permission exists in standard roles.

## Verification

Playwright test confirmed:
- PIN 1234 (Manager) → `/settings/payments` → change processor to Simulated → Save Changes → ✅ 200 OK, no 403.
