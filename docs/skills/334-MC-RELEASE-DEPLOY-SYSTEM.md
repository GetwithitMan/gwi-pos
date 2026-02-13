# Skill 334: Mission Control Release Management & Deployment

**Status:** DONE
**Domain:** Mission Control
**Dependencies:** 301 (Cloud Schema), 307 (SSE Command Stream), 308 (Sync Agent)
**Date:** February 12, 2026

## Overview

Release management system for pushing POS software updates to venue locations from the Mission Control admin console. Admins create versioned releases, then deploy them to specific locations. Deployment creates a `FORCE_UPDATE` fleet command that the location's sync agent picks up via SSE.

## Schema

### Release (`prisma/schema.prisma` — Mission Control)

```prisma
model Release {
  id               String         @id @default(cuid())
  version          String         @unique    // Semver (e.g., "1.2.3")
  channel          ReleaseChannel @default(STABLE)
  imageTag         String                    // Docker image tag
  releaseNotes     String?
  minSchemaVersion Int?                      // Blocks deploy if server schema too old
  rollbackVersion  String?                   // Suggested rollback target
  isLatest         Boolean        @default(false)  // One per channel
  isArchived       Boolean        @default(false)
  createdById      String
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  createdBy      AdminUser      @relation(fields: [createdById], references: [id])
  deployCommands FleetCommand[] @relation("ReleaseCommands")
}

enum ReleaseChannel {
  STABLE
  BETA
}
```

## API Routes

### `GET /api/admin/releases`
- Lists all non-archived releases (newest first)
- Includes creator name/email and deploy count
- Auth: `org_admin+`

### `POST /api/admin/releases`
- Creates a new release with version, channel, image tag, notes
- Validates semver format, rejects duplicates
- Sets `isLatest=true` for the channel (clears previous)
- Auto-provisions AdminUser if none exists (via `resolveAdminUserId`)
- Resolves CloudOrganization ID for audit log FK
- Auth: `org_admin+`

### `GET /api/admin/releases/[id]`
- Release detail with deploy history (last 50 commands)
- Auth: `org_admin+`

### `POST /api/admin/releases/[id]/deploy`
- Deploys release to one or more locations
- Body: `{ locationIds: string[] }`
- Per-location: finds active ServerNode, checks schema version gate, creates `FORCE_UPDATE` FleetCommand, sets `targetVersion`
- Returns 207 Multi-Status if mixed results
- Auth: `org_admin+`

### `DELETE /api/admin/releases/[id]`
- Soft archive (sets `isArchived=true`, clears `isLatest`)
- Auth: `org_admin+`

## Deploy Pipeline

```
Admin creates release (v1.2.3)
    ↓
Admin selects locations → clicks Deploy
    ↓
POST /api/admin/releases/[id]/deploy
    ↓
For each location:
  1. Find active ServerNode (not DECOMMISSIONED)
  2. Schema version gate (optional)
  3. Create FORCE_UPDATE FleetCommand
  4. Set ServerNode.targetVersion
  5. Audit log entry
    ↓
ServerNode's sync agent picks up command via SSE
    ↓
Sync agent pulls new Docker image + restarts
```

## Key Library Functions (`src/lib/release-manager.ts`)

| Function | Purpose |
|----------|---------|
| `createRelease()` | Creates Release record, clears previous `isLatest` for channel |
| `deployToLocation()` | Single-location deploy with schema gate + command creation |
| `deployToMultipleLocations()` | Iterates locations, collects per-location results |
| `archiveRelease()` | Soft archive + audit log |

## Auth Helpers Used

| Helper | Purpose |
|--------|---------|
| `resolveAdminUserId()` | Gets AdminUser.id for audit trail (auto-creates if missing) |
| `resolveCloudOrgId()` | Converts Clerk org ID → CloudOrganization.id for FK relations |

## Error Handling

- All routes wrapped in try-catch with `console.error` + `apiError()` response
- Deploy returns per-location success/error (not all-or-nothing)
- "No active server at this location" is a normal result (location without hardware)

## Bug Fix: Organization ID FK Violation (Feb 12, 2026)

**Root cause:** `FleetAuditLog.organizationId` has a FK to `CloudOrganization.id`, but routes were passing `admin.orgId` (Clerk org ID like `org_2abc...`) which doesn't exist in the CloudOrganization table.

**Fix:** Added `resolveCloudOrgId()` helper that looks up CloudOrganization by `clerkOrganizationId` field and returns the database `id` (cuid). All release routes now use this instead of raw Clerk org ID.

## Key Files

| File | Purpose |
|------|---------|
| `src/app/api/admin/releases/route.ts` | GET list + POST create |
| `src/app/api/admin/releases/[id]/route.ts` | GET detail + DELETE archive |
| `src/app/api/admin/releases/[id]/deploy/route.ts` | POST deploy to locations |
| `src/lib/release-manager.ts` | Core release + deploy logic |
| `src/lib/auth.ts` | `resolveAdminUserId()`, `resolveCloudOrgId()` |
| `src/components/admin/DeployReleaseModal.tsx` | Client-side deploy UI |

## UI

### Releases Dashboard (`/dashboard/releases`)
- List of releases with version, channel, status badges
- "Create Release" button → modal with version/channel/image tag/notes
- Click release → detail page with deploy history

### Deploy Modal (`DeployReleaseModal`)
- Shows release info (version, channel, notes)
- Checkbox list of locations with current version
- Deploy button → shows per-location results (success/error)
