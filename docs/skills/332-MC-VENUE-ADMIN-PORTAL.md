# Skill 332: Mission Control — Venue Admin Portal

**Status:** DONE
**Date:** February 12, 2026
**Domain:** Mission Control
**Commits:**
- MC: `2493d11` — venue admin portal: full sidebar nav, POS-matching UI components, CRUD management pages
- MC: `d417ba0` — strip duplicate POS pages, add Neon provisioning for multi-tenant venues
- MC: `e0617e6` — update venue POS links to use ordercontrolcenter.com subdomains

## Overview

Built a venue admin portal in Mission Control that lets cloud admins manage their venue's configuration (settings, employees, menu, floor plan, order types, happy hours, roles) through a POS-matching dark UI served from Mission Control.

## Architecture

The venue portal lives at `/venue/{slug}/admin/*` within Mission Control. It uses Clerk auth (org membership) for access control and fetches/pushes data to the POS cloud admin at `{slug}.ordercontrolcenter.com`.

### Two-Path Strategy

1. **Cloud-native settings** (stored in MC's CloudLocation): Settings, hardware limits, payment config
2. **POS-proxied management** (opens POS cloud admin): Menu builder, floor plan editor, employees, order types

## Pages Created

| Route | Description |
|-------|-------------|
| `/venue/{slug}/admin` | Dashboard overview |
| `/venue/{slug}/admin/settings` | Location settings (matches POS settings layout) |
| `/venue/{slug}/admin/team` | Team management (Skill 331) |
| `/venue/{slug}/admin/floor-plan` | Floor plan editor link |
| `/venue/{slug}/admin/hardware` | Hardware configuration |
| `/venue/{slug}/admin/servers` | Server management |

## Key Components

- `VenueAdminSidebar.tsx` — Dark sidebar with navigation links
- `VenueAdminLayout.tsx` — Layout wrapper with sidebar + content area
- Various setting cards for hardware limits, payment config, provisioning

## Neon Multi-Tenant Provisioning

| File | Purpose |
|------|---------|
| `src/lib/neon-provisioning.ts` | `provisionPosDatabase()` — calls POS `/api/internal/provision` |
| POS: `src/app/api/internal/provision/route.ts` | Creates Neon DB, pushes schema, seeds defaults |
| POS: `src/app/api/internal/venue-health/route.ts` | Health check for provisioned venue DBs |
| POS: `src/lib/db.ts` | `getDbForVenue(slug)` — per-venue PrismaClient cache |

## Integration with POS Cloud Auth

The sidebar "Open POS Admin" button navigates to `/pos-access/{slug}` which generates a JWT and redirects to the POS cloud admin. See Skill 330 for details.
