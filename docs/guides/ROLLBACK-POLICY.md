# Rollback Policy

## Boundaries by Component

**Image rollback: SUPPORTED** -- `gwi-node rollback` restores the LKG Docker
image. LKG ref + version persisted after every successful deploy.

**Dashboard rollback: SUPPORTED IF cached .deb exists** --
`gwi-node dashboard-rollback` reinstalls from `/var/cache/gwi-dashboard/`.
If no cached package exists, a fresh deploy is required.

**Schema rollback: NOT SUPPORTED** -- Prisma migrations are forward-only.
All migrations must be backward-compatible with the previous app version:
- New columns: nullable or have defaults
- Column removal: not until N+2 (two releases after code stops using them)
- Column rename: copy-then-drop across two releases

## Rollback Triggers

| Trigger | Mechanism |
|---------|-----------|
| Health check failure after deploy | Automatic -- `gwi-node` rolls back |
| Manual operator intervention | `gwi-node rollback` |
| Dashboard install failure | `gwi-node dashboard-rollback` |

## LKG Tracking

After every successful deploy (health checks pass), these files are
written to `/opt/gwi-pos/shared/state/`:
- `last-known-good-image` -- GHCR image reference
- `last-known-good-version` -- app semver string
- `last-known-good-dashboard` -- dashboard package version

These are the sole source of truth for rollback targets.
