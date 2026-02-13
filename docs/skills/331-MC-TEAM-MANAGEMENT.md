# Skill 331: Mission Control — Team Management Page

**Status:** DONE
**Date:** February 12, 2026
**Domain:** Mission Control
**Commits:**
- MC: `e3920de` — team management page: invite, role change, remove members via Clerk
- MC: `aa58e24` — link CloudOrganization to Clerk org so team management works
- MC: `8e7980d` — add Venue Admin quick links to location detail page

## Overview

Built-in team management UI in Mission Control so admins can invite, manage roles, and remove venue team members without leaving the MC portal. Uses Clerk B2B Organizations API for member CRUD.

## Features

- **Member list**: Shows all org members with name, email, role badge, join date, action buttons
- **Invite member**: Email input + role selector (org_admin / location_manager), Clerk sends invitation email
- **Role change**: Dropdown to change member role (cannot change own role)
- **Remove member**: Confirmation dialog before removal
- **Pending invitations**: Shows pending invites with revoke option
- **Access control**: Only `org_admin` and `super_admin` can manage team

## Architecture

Clerk membership is **org-level** (not per-location). All org members can access all locations in that org. The team page is accessed through a venue admin path but manages the parent organization's team.

### Role Mapping

| Clerk Role | App Role | Description |
|------------|----------|-------------|
| `org:admin` | `org_admin` | Full organization admin |
| `org:member` | `location_manager` | Location-level manager |

## Key Files

### Pages
- `src/app/venue/[slug]/admin/team/page.tsx` — Server component, fetches members from Clerk API
- `src/components/venue/TeamManager.tsx` — Client component with member table + invite modal

### API Routes
- `src/app/api/venue/[slug]/team/route.ts` — POST invite, GET members
- `src/app/api/venue/[slug]/team/[userId]/route.ts` — PUT role change, DELETE remove

### Supporting
- `src/components/venue/VenueAdminSidebar.tsx` — "Team" link in sidebar nav
- `src/lib/venue-auth.ts` — `getVenueAdminContext(slug)` for auth

## Clerk Backend API Usage

```typescript
import { clerkClient } from '@clerk/nextjs/server'
const clerk = await clerkClient()

// List members
clerk.organizations.getOrganizationMembershipList({ organizationId })

// Invite
clerk.organizations.createOrganizationInvitation({ organizationId, emailAddress, role })

// Update role
clerk.organizations.updateOrganizationMembership({ organizationId, userId, role })

// Remove
clerk.organizations.deleteOrganizationMembership({ organizationId, userId })

// Pending invitations
clerk.organizations.getOrganizationInvitationList({ organizationId })

// Revoke invitation
clerk.organizations.revokeOrganizationInvitation({ organizationId, invitationId, requestingUserId })
```
