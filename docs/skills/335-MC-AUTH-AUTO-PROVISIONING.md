# Skill 335: Mission Control Auth Enhancements

**Status:** DONE
**Domain:** Mission Control
**Dependencies:** 300 (Cloud Project Bootstrap)
**Date:** February 12, 2026

## Overview

Two auth enhancements that fix blocking issues in Mission Control's admin workflows:

1. **AdminUser auto-provisioning** — Automatically creates an `AdminUser` database record for authenticated Clerk users who don't have one yet. This solves the chicken-and-egg problem where features like release creation require an AdminUser record for audit trails, but first-time users have no record.

2. **CloudOrganization ID resolution** — Helper to convert Clerk organization IDs (e.g., `org_2abc...`) to CloudOrganization database IDs (cuids) for foreign key relations. Prevents FK constraint violations in audit logs.

## Problem 1: AdminUser Auto-Provisioning

### Symptom
First-time admin users clicking "Create Release" got: `"Admin user not found in database"`. The AdminUser table was empty because no provisioning step existed — Clerk handles authentication, but the local database needs its own record for FK relations.

### Solution

Updated `resolveAdminUserId()` in `src/lib/auth.ts`:

```typescript
export async function resolveAdminUserId(clerkUserId: string): Promise<string | null> {
  const { db } = await import('@/lib/db')

  // Try to find existing
  const existing = await db.adminUser.findUnique({
    where: { clerkUserId },
    select: { id: true },
  })
  if (existing) return existing.id

  // Auto-provision for authenticated Clerk users
  try {
    const admin = await getAuthenticatedAdmin()
    let organizationId: string | undefined
    if (admin.orgId) {
      const org = await db.cloudOrganization.findFirst({
        where: { clerkOrganizationId: admin.orgId },
        select: { id: true },
      })
      organizationId = org?.id ?? undefined
    }

    const created = await db.adminUser.create({
      data: {
        clerkUserId,
        name: admin.name || admin.email,
        email: admin.email,
        role: admin.role,
        scope: 'org',
        ...(organizationId ? { organizationId } : {}),
      },
      select: { id: true },
    })
    return created.id
  } catch {
    return null
  }
}
```

### How It Works
1. First attempt: look up `AdminUser` by `clerkUserId`
2. If found: return the existing ID
3. If not found: call `getAuthenticatedAdmin()` to get user info from Clerk
4. Look up `CloudOrganization` by Clerk org ID to get the database org ID
5. Create `AdminUser` with name, email, role, scope, and optional org link
6. Return the new ID (or `null` if creation fails)

### Not a Circular Call
`resolveAdminUserId()` calls `getAuthenticatedAdmin()`, which checks the `AdminUser` table but does NOT call `resolveAdminUserId()`. The two functions are independent — `getAuthenticatedAdmin()` only uses the AdminUser lookup for owner/employee role detection, not for ID resolution.

## Problem 2: Cloud Organization ID Resolution

### Symptom
Release creation and deployment returned 500 errors. Root cause: `FleetAuditLog.organizationId` has a FK relation to `CloudOrganization.id`, but routes were passing `admin.orgId` (Clerk org ID like `org_2abc...`). Prisma threw a FK constraint violation.

### Solution

Added `resolveCloudOrgId()` helper:

```typescript
export async function resolveCloudOrgId(
  clerkOrgId: string | null | undefined
): Promise<string | null> {
  if (!clerkOrgId) return null
  const { db } = await import('@/lib/db')
  const org = await db.cloudOrganization.findFirst({
    where: { clerkOrganizationId: clerkOrgId },
    select: { id: true },
  })
  return org?.id ?? null
}
```

### Where It's Used
All release routes that write audit logs:
- `POST /api/admin/releases` (create release)
- `POST /api/admin/releases/[id]/deploy` (deploy to locations)
- `DELETE /api/admin/releases/[id]` (archive release)

### Before vs After
```typescript
// BEFORE (broken — Clerk org ID ≠ CloudOrganization.id)
organizationId: admin.orgId ?? 'system'

// AFTER (correct — resolves to CloudOrganization.id cuid)
const cloudOrgId = await resolveCloudOrgId(admin.orgId)
organizationId: cloudOrgId
```

## Key Files

| File | Changes |
|------|---------|
| `src/lib/auth.ts` | Added `resolveCloudOrgId()`, updated `resolveAdminUserId()` with auto-provisioning |
| `src/app/api/admin/releases/route.ts` | Uses `resolveCloudOrgId`, added try-catch |
| `src/app/api/admin/releases/[id]/route.ts` | Uses `resolveCloudOrgId` |
| `src/app/api/admin/releases/[id]/deploy/route.ts` | Uses `resolveCloudOrgId`, added try-catch |
| `src/lib/release-manager.ts` | Updated `organizationId` param to `string | null` |

## Important Pattern: Clerk ID vs Database ID

Mission Control has two ID systems that must not be confused:

| ID Type | Format | Example | Used For |
|---------|--------|---------|----------|
| Clerk User ID | `user_...` | `user_2nGx...` | Clerk session auth |
| Clerk Org ID | `org_...` | `org_2abc...` | Clerk org membership |
| AdminUser.id | cuid | `cmlk4x...` | Database FK relations |
| CloudOrganization.id | cuid | `cmlk3y...` | Database FK relations |

**Rule:** Always use `resolveAdminUserId()` and `resolveCloudOrgId()` when you need database IDs for FK relations. Never pass raw Clerk IDs to Prisma models with FK constraints.
