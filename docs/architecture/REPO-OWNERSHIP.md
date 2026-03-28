# Repo Ownership & Artifact Boundaries

## Who owns what

### gwi-pos owns

| Artifact | Location | Canonical URL |
|----------|----------|---------------|
| Installer bundle | `public/installer.run` | `https://ordercontrolcenter.com/installer.run` |
| Installer modules | `public/installer-modules/*.sh` | Embedded in installer.run |
| Deploy-tools artifact | `deploy-tools/` | `https://ordercontrolcenter.com/artifacts/deploy-tools-{releaseId}.tar.zst` |
| App release artifact | Built by `scripts/build-nuc-artifact.sh` | `https://ordercontrolcenter.com/artifacts/pos-release-{releaseId}.tar.zst` |
| Dashboard .deb | `public/gwi-nuc-dashboard.deb` | `https://ordercontrolcenter.com/gwi-nuc-dashboard.deb` |
| Release manifest | Built by `scripts/build-nuc-artifact.sh` | `https://ordercontrolcenter.com/artifacts/manifest.json` |
| Schema SQL | `prisma/schema.sql` | `https://ordercontrolcenter.com/schema.sql` |
| Deploy script | `public/scripts/deploy-release.sh` | `https://ordercontrolcenter.com/scripts/deploy-release.sh` |
| Version contract | `src/generated/version-contract.json` | `https://ordercontrolcenter.com/version-contract.json` |

### gwi-mission-control owns

| Responsibility | Notes |
|----------------|-------|
| Fleet orchestration | Send commands to NUCs (FORCE_UPDATE, RE_PROVISION) |
| Provisioning | Registration codes, venue setup, schema state tracking |
| Status/reporting | Heartbeat collection, health dashboard |
| Catalog management | Master catalog, push-to-venue, overrides |

MC does NOT own any POS deployable artifacts. It may reference their URLs but the canonical definitions originate from gwi-pos.

## Domain rules

| Domain | Purpose | Used by |
|--------|---------|---------|
| `ordercontrolcenter.com` | POS Vercel deployment. All POS assets. | Installer downloads, artifact downloads, dashboard .deb, schema.sql |
| `app.thepasspos.com` | Mission Control Vercel deployment. MC API only. | Registration, heartbeat, fleet commands, admin console |

### Rules

- POS asset downloads MUST use `ordercontrolcenter.com`
- MC API calls MUST use `app.thepasspos.com` (or `MC_URL` env var)
- NEVER use `app.thepasspos.com` to download POS assets (installer, dashboard, manifests)
- NEVER use `ordercontrolcenter.com` for MC API calls

### Banned patterns

These patterns in POS installer/deploy code indicate a bug:

```
# WRONG — downloading POS asset from MC domain
curl https://app.thepasspos.com/installer.run
curl https://app.thepasspos.com/gwi-nuc-dashboard.deb
curl https://app.thepasspos.com/artifacts/manifest.json

# RIGHT — downloading POS asset from POS domain
curl https://ordercontrolcenter.com/installer.run
curl https://ordercontrolcenter.com/gwi-nuc-dashboard.deb
curl https://ordercontrolcenter.com/artifacts/manifest.json
```

## Version bump rules

Any change to these paths REQUIRES a version bump in `package.json`:

```
public/installer.run
public/installer-modules/**
public/scripts/deploy-release.sh
scripts/build-nuc-artifact.sh
scripts/vercel-build.js
deploy-tools/**
```

CI enforces this via `scripts/ci/enforce-version-bump.sh`.

## Manifest contract

- `artifactFormatVersion` must be bumped for any manifest shape change
- Currently at version 3
- deploy-release.sh gates on format version — old scripts reject unknown formats
- Manifest fields: releaseId, artifactUrl, deployToolsUrl, deployToolsSha256, deployToolsSize

## Installer self-update

- Compares SHA hashes (early check) and version numbers (late check)
- Downloads from `https://ordercontrolcenter.com/installer.run`
- Re-execs with `--skip-self-update` to prevent infinite loop
- Deletes old modules before re-exec — new modules come from new installer
